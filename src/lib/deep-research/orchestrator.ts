import { generateText } from "ai";
import { getModelForRole, checkBudget, trackUsage } from "./model-router";
import { buildMainBrainSystemPrompt, buildCheckpointPrompt, buildConfirmationInterpretationPrompt } from "./prompts";
import { executeNode } from "./node-executor";
import * as store from "./event-store";
import { nanoid } from "nanoid";
import type {
  Phase,
  BrainDecision,
  DeepResearchSession,
  DeepResearchNode,
  DeepResearchArtifact,
  DeepResearchMessage,
  DeepResearchEvent,
  NodeCreationSpec,
  CheckpointPackage,
  ConfirmationDecision,
  ConfirmationOutcome,
} from "./types";
import { PHASE_ORDER } from "./types";

type OnEvent = (event: DeepResearchEvent) => void;

/**
 * Main orchestrator loop: runs the Deep Research state machine.
 *
 * STEP-GATED: Each phase handler executes ONE meaningful step, generates a
 * checkpoint, persists it, transitions to `awaiting_user_confirmation`, and
 * returns. The loop then breaks. Execution only resumes when
 * `resumeAfterConfirmation()` is called by the /confirm API route.
 */
export async function runDeepResearch(
  sessionId: string,
  abortSignal?: AbortSignal,
  _onEvent?: OnEvent
): Promise<void> {
  try {
    let session = await store.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Only set to running if we're in a startable state
    if (["intake", "paused", "awaiting_approval"].includes(session.status)) {
      await store.updateSession(sessionId, { status: "running" });
    }

    session = (await store.getSession(sessionId))!;

    // Check terminal / blocked states
    if (["completed", "failed", "cancelled"].includes(session.status)) {
      return;
    }
    if (session.status === "awaiting_user_confirmation") {
      return; // Must go through /confirm, not /run
    }

    if (abortSignal?.aborted) return;

    const phase = session.phase;

    // Execute ONE phase step, then halt for user confirmation
    switch (phase) {
      case "intake":
        await handleIntake(session, abortSignal);
        break;
      case "planning":
        await handlePlanning(session, abortSignal);
        break;
      case "evidence_collection":
        await handleEvidenceCollection(session, abortSignal);
        break;
      case "structured_understanding":
        await handleStructuredUnderstanding(session, abortSignal);
        break;
      case "reviewer_deliberation":
        await handleReviewerDeliberation(session, abortSignal);
        break;
      case "decision":
        await handleDecision(session, abortSignal);
        break;
      case "execution_planning":
        await handleExecutionPlanning(session, abortSignal);
        break;
      case "execution":
        await handleExecution(session, abortSignal);
        break;
      case "review_correction":
        await handleReviewCorrection(session, abortSignal);
        break;
      case "final_report":
        await handleFinalReport(session, abortSignal);
        break;
    }

    // After the phase handler returns, the session should be in
    // awaiting_user_confirmation (or completed/failed). Do NOT loop.
  } catch (error) {
    const message = error instanceof Error ? error.message : "Orchestrator error";
    console.error(`[deep-research] Orchestrator error for session ${sessionId}:`, message);
    await store.updateSession(sessionId, { status: "failed", error: message });
    await store.appendEvent(sessionId, "session_failed", undefined, "system", undefined, undefined, {
      error: message,
    });
  }
}

/**
 * Called by the /confirm API route after the user responds to a checkpoint.
 * The main brain interprets the user's feedback and decides how to proceed.
 */
export async function resumeAfterConfirmation(
  sessionId: string,
  nodeId: string,
  outcome: ConfirmationOutcome,
  feedback?: string,
  abortSignal?: AbortSignal
): Promise<void> {
  const session = await store.getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  if (session.status !== "awaiting_user_confirmation") {
    throw new Error(`Session is not awaiting confirmation (status: ${session.status})`);
  }

  // Record the confirmation on the node
  await store.updateNode(nodeId, {
    confirmedAt: new Date().toISOString(),
    confirmedBy: "user",
    confirmationOutcome: outcome,
  });

  // Emit the appropriate event
  const eventMap: Record<ConfirmationOutcome, string> = {
    confirmed: "user_confirmed",
    revision_requested: "user_requested_revision",
    branch_requested: "user_requested_branch",
    rejected: "user_rejected_result",
    stopped: "user_requested_stop",
  };
  await store.appendEvent(
    sessionId,
    eventMap[outcome] as import("./types").EventType,
    nodeId,
    "user",
    undefined,
    undefined,
    { feedback: feedback || null }
  );

  // Handle stop immediately
  if (outcome === "stopped") {
    await store.updateSession(sessionId, { status: "cancelled", pendingCheckpointId: null });
    return;
  }

  // Get the checkpoint that was pending
  const checkpointArtifact = session.pendingCheckpointId
    ? await store.getArtifact(session.pendingCheckpointId)
    : await store.getLatestCheckpoint(sessionId);

  const checkpoint = checkpointArtifact?.content as unknown as CheckpointPackage | null;

  if (!checkpoint) {
    // No checkpoint context, just resume
    await store.updateSession(sessionId, { status: "running", pendingCheckpointId: null });
    return;
  }

  // Ask the main brain to interpret the user's feedback
  const [nodes, artifacts] = await Promise.all([
    store.getNodes(sessionId),
    store.getArtifacts(sessionId),
  ]);

  const decision = await callMainBrainForConfirmation(
    session,
    checkpoint,
    outcome,
    feedback,
    nodes,
    artifacts,
    abortSignal
  );

  // Act on the decision
  await store.updateSession(sessionId, { pendingCheckpointId: null });

  if (decision.messageToUser) {
    await store.addMessage(sessionId, "main_brain", decision.messageToUser);
  }

  // If this was the final step and user confirmed, complete the session
  if (checkpoint.isFinalStep && (outcome === "confirmed" || decision.action === "continue")) {
    await store.updateSession(sessionId, { status: "completed" });
    await store.appendEvent(sessionId, "session_completed", undefined, "system");
    return;
  }

  switch (decision.action) {
    case "continue": {
      // Advance to the next phase — prefer natural ordering, validate LLM suggestions
      const naturalNext = getNextPhase(session.phase);
      const nextPhase = decision.nextPhase
        ? validatePhase(decision.nextPhase, naturalNext || session.phase)
        : naturalNext;
      if (nextPhase) {
        await store.updateSession(sessionId, { status: "running", phase: nextPhase });
      } else {
        // No next phase means we're at the end — complete the session
        await store.updateSession(sessionId, { status: "completed" });
        await store.appendEvent(sessionId, "session_completed", undefined, "system");
        return;
      }
      break;
    }
    case "revise": {
      if (decision.nodesToCreate) {
        for (const spec of decision.nodesToCreate) {
          await store.createNode(sessionId, spec);
        }
      }
      await store.updateSession(sessionId, { status: "running" });
      break;
    }
    case "retry": {
      await store.updateSession(sessionId, { status: "running" });
      break;
    }
    case "branch": {
      if (decision.nodesToCreate) {
        for (const spec of decision.nodesToCreate) {
          await store.createNode(sessionId, spec);
        }
      }
      await store.updateSession(sessionId, { status: "running" });
      break;
    }
    case "supersede": {
      if (decision.nodesToCreate) {
        for (const spec of decision.nodesToCreate) {
          await store.createNode(sessionId, spec);
        }
      }
      if (decision.nextPhase) {
        const validated = validatePhase(decision.nextPhase, session.phase);
        await store.updateSession(sessionId, { status: "running", phase: validated });
      } else {
        await store.updateSession(sessionId, { status: "running" });
      }
      break;
    }
    case "stop": {
      await store.updateSession(sessionId, { status: "cancelled" });
      return;
    }
    default: {
      // Unknown action from brain — treat as "continue" to avoid stuck state
      console.warn(`[deep-research] Unknown confirmation action: "${decision.action}", treating as continue`);
      const naturalNext = getNextPhase(session.phase);
      if (naturalNext) {
        await store.updateSession(sessionId, { status: "running", phase: naturalNext });
      } else {
        await store.updateSession(sessionId, { status: "running" });
      }
      break;
    }
  }

  // Now run the next step (single step, will halt at next checkpoint)
  await runDeepResearch(sessionId, abortSignal);
}

// --- Phase handlers ---
// Each handler: execute ONE step → generate checkpoint → halt

async function handleIntake(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const messages = await store.getMessages(session.id);

  const intakeNode = await store.createNode(session.id, {
    nodeType: "intake",
    label: "Analyze research question",
    assignedRole: "main_brain",
    input: {
      userQuery: messages.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
    },
  });

  const ctx = await buildContext(session);
  await executeNode(intakeNode, ctx, abortSignal);

  // Generate checkpoint and halt
  await generateCheckpointAndHalt(session, intakeNode, "planning", abortSignal);
}

async function handlePlanning(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const decision = await callMainBrain(session, abortSignal);

  if (decision.nodesToCreate && decision.nodesToCreate.length > 0) {
    for (const spec of decision.nodesToCreate) {
      await store.createNode(session.id, spec);
    }
  }

  if (decision.messageToUser) {
    await store.addMessage(session.id, "main_brain", decision.messageToUser);
  }

  // Create a virtual "planning" node for the checkpoint
  const planNode = await store.createNode(session.id, {
    nodeType: "plan",
    label: "Research plan created",
    assignedRole: "main_brain",
  });
  await store.updateNode(planNode.id, { status: "completed", completedAt: new Date().toISOString() });

  await generateCheckpointAndHalt(session, planNode, "evidence_collection", abortSignal);
}

async function handleEvidenceCollection(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const nodes = await store.getNodes(session.id);
  let evidenceNodes = nodes.filter((n) => n.nodeType === "evidence_gather");

  // If no evidence nodes exist, ask the main brain to create them
  if (evidenceNodes.length === 0) {
    const decision = await callMainBrain(session, abortSignal);
    if (decision.nodesToCreate && decision.nodesToCreate.length > 0) {
      for (const spec of decision.nodesToCreate) {
        await store.createNode(session.id, spec);
      }
    }
    if (decision.messageToUser) {
      await store.addMessage(session.id, "main_brain", decision.messageToUser);
    }
    // Re-fetch nodes after creation
    const refreshedNodes = await store.getNodes(session.id);
    evidenceNodes = refreshedNodes.filter((n) => n.nodeType === "evidence_gather");

    // If STILL no evidence nodes, skip to structured_understanding
    if (evidenceNodes.length === 0) {
      const fallbackNode = refreshedNodes[refreshedNodes.length - 1];
      await generateCheckpointAndHalt(session, fallbackNode, "structured_understanding", abortSignal);
      return;
    }
  }

  await executeReadyWorkers(session, abortSignal);

  // Re-fetch after execution
  const freshNodes = await store.getNodes(session.id);
  const freshEvidenceNodes = freshNodes.filter((n) => n.nodeType === "evidence_gather");
  const terminalStatuses = ["completed", "failed", "skipped", "awaiting_user_confirmation"];
  const allDone = freshEvidenceNodes.length > 0 && freshEvidenceNodes.every(
    (n) => terminalStatuses.includes(n.status)
  );

  if (allDone) {
    // Find a representative completed node for the checkpoint
    const lastCompleted = freshEvidenceNodes.filter((n) => n.status === "completed").pop()
      || freshEvidenceNodes[freshEvidenceNodes.length - 1];

    await generateCheckpointAndHalt(session, lastCompleted, "structured_understanding", abortSignal);
  } else {
    // Still have pending evidence nodes — checkpoint what we have so far
    const anyCompleted = freshEvidenceNodes.find((n) => n.status === "completed");
    if (anyCompleted) {
      await generateCheckpointAndHalt(session, anyCompleted, "evidence_collection", abortSignal);
    } else {
      // Nothing completed yet — still halt for user awareness
      const firstNode = freshEvidenceNodes[0] || freshNodes[freshNodes.length - 1];
      await generateCheckpointAndHalt(session, firstNode, "evidence_collection", abortSignal);
    }
  }
}

async function handleStructuredUnderstanding(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const summaryNode = await store.createNode(session.id, {
    nodeType: "synthesize",
    label: "Synthesize evidence into structured understanding",
    assignedRole: "main_brain",
  });

  const ctx = await buildContext(session);
  await executeNode(summaryNode, ctx, abortSignal);

  await generateCheckpointAndHalt(session, summaryNode, "reviewer_deliberation", abortSignal);
}

async function handleReviewerDeliberation(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const reviewerA = await store.createNode(session.id, {
    nodeType: "review",
    label: "Reviewer A assessment",
    assignedRole: "reviewer_a",
  });

  const reviewerB = await store.createNode(session.id, {
    nodeType: "review",
    label: "Reviewer B assessment",
    assignedRole: "reviewer_b",
  });

  const ctx = await buildContext(session);
  await Promise.allSettled([
    executeNode(reviewerA, ctx, abortSignal),
    executeNode(reviewerB, ctx, abortSignal),
  ]);

  // Use reviewer A as the representative node for checkpoint
  const freshA = (await store.getNodes(session.id)).find((n) => n.id === reviewerA.id) || reviewerA;
  await generateCheckpointAndHalt(session, freshA, "decision", abortSignal);
}

async function handleDecision(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const decision = await callMainBrain(session, abortSignal);

  if (decision.messageToUser) {
    await store.addMessage(session.id, "main_brain", decision.messageToUser);
  }

  // Create a decision node for the checkpoint
  const decisionNode = await store.createNode(session.id, {
    nodeType: "deliberate",
    label: `Decision: ${decision.action}`,
    assignedRole: "main_brain",
  });
  await store.updateNode(decisionNode.id, {
    status: "completed",
    output: decision as unknown as Record<string, unknown>,
    completedAt: new Date().toISOString(),
  });

  if (decision.nodesToCreate) {
    for (const spec of decision.nodesToCreate) {
      await store.createNode(session.id, spec);
    }
  }

  // Determine next phase based on decision
  let nextPhase: Phase;
  switch (decision.action) {
    case "advance_phase":
      nextPhase = validatePhase(decision.nextPhase, "final_report");
      break;
    case "revise_plan": {
      const nodes = await store.getNodes(session.id);
      const reviewRounds = nodes.filter((n) => n.nodeType === "review" && n.status === "completed").length / 2;
      nextPhase = reviewRounds >= session.config.maxReviewerRounds ? "final_report" : "evidence_collection";
      break;
    }
    case "complete":
      nextPhase = "final_report";
      break;
    case "request_approval":
    case "respond_to_user":
    default:
      nextPhase = session.phase; // Stay in decision phase
      break;
  }

  await generateCheckpointAndHalt(session, decisionNode, nextPhase, abortSignal);
}

async function handleExecutionPlanning(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const decision = await callMainBrain(session, abortSignal);

  if (decision.nodesToCreate) {
    for (const spec of decision.nodesToCreate) {
      await store.createNode(session.id, spec);
    }
  }

  if (decision.messageToUser) {
    await store.addMessage(session.id, "main_brain", decision.messageToUser);
  }

  const planNode = await store.createNode(session.id, {
    nodeType: "plan",
    label: "Execution plan created",
    assignedRole: "main_brain",
  });
  await store.updateNode(planNode.id, { status: "completed", completedAt: new Date().toISOString() });

  await generateCheckpointAndHalt(session, planNode, "execution", abortSignal);
}

async function handleExecution(session: DeepResearchSession, abortSignal?: AbortSignal) {
  await executeReadyWorkers(session, abortSignal);

  const nodes = await store.getNodes(session.id);
  const execNodes = nodes.filter((n) => n.nodeType === "execute");

  const allDone = execNodes.length > 0 && execNodes.every(
    (n) => ["completed", "failed", "skipped", "awaiting_user_confirmation"].includes(n.status)
  );

  const lastExec = execNodes.filter((n) => n.status === "completed").pop()
    || execNodes[execNodes.length - 1]
    || nodes[nodes.length - 1];

  const nextPhase: Phase = allDone ? "review_correction" : "execution";
  await generateCheckpointAndHalt(session, lastExec, nextPhase, abortSignal);
}

async function handleReviewCorrection(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const reviewerA = await store.createNode(session.id, {
    nodeType: "review",
    label: "Reviewer A: execution review",
    assignedRole: "reviewer_a",
  });
  const reviewerB = await store.createNode(session.id, {
    nodeType: "review",
    label: "Reviewer B: execution review",
    assignedRole: "reviewer_b",
  });

  const ctx = await buildContext(session);
  await Promise.allSettled([
    executeNode(reviewerA, ctx, abortSignal),
    executeNode(reviewerB, ctx, abortSignal),
  ]);

  const decision = await callMainBrain(session, abortSignal);

  if (decision.messageToUser) {
    await store.addMessage(session.id, "main_brain", decision.messageToUser);
  }

  let nextPhase: Phase;
  if (decision.action === "revise_plan" && decision.nodesToCreate) {
    const nodes = await store.getNodes(session.id);
    const execLoops = nodes.filter(
      (n) => n.nodeType === "review" && n.label.includes("execution") && n.status === "completed"
    ).length / 2;

    if (execLoops < session.config.maxExecutionLoops) {
      for (const spec of decision.nodesToCreate) {
        await store.createNode(session.id, spec);
      }
      nextPhase = "execution";
    } else {
      nextPhase = "final_report";
    }
  } else {
    nextPhase = "final_report";
  }

  const freshA = (await store.getNodes(session.id)).find((n) => n.id === reviewerA.id) || reviewerA;
  await generateCheckpointAndHalt(session, freshA, nextPhase, abortSignal);
}

async function handleFinalReport(session: DeepResearchSession, abortSignal?: AbortSignal) {
  const reportNode = await store.createNode(session.id, {
    nodeType: "final_report",
    label: "Generate final research report",
    assignedRole: "main_brain",
  });

  const ctx = await buildContext(session);
  await executeNode(reportNode, ctx, abortSignal);

  // For the final report, we still checkpoint — user confirms before session closes
  await generateCheckpointAndHalt(session, reportNode, "final_report", abortSignal, true);
}

// --- Core helper: generate checkpoint and halt ---

async function generateCheckpointAndHalt(
  session: DeepResearchSession,
  completedNode: DeepResearchNode,
  suggestedNextPhase: Phase,
  abortSignal?: AbortSignal,
  isFinalStep = false
): Promise<void> {
  // Refresh node state
  const allNodes = await store.getNodes(session.id);
  const allArtifacts = await store.getArtifacts(session.id);
  const freshNode = allNodes.find((n) => n.id === completedNode.id) || completedNode;

  // Ask main brain to produce checkpoint summary
  const checkpointContent = await generateCheckpointContent(
    session,
    freshNode,
    allArtifacts,
    allNodes,
    session.phase,
    abortSignal
  );

  // Build the checkpoint package
  const checkpointPackage: CheckpointPackage = {
    checkpointId: nanoid(),
    sessionId: session.id,
    nodeId: freshNode.id,
    stepType: freshNode.nodeType,
    phase: session.phase,
    title: checkpointContent.title || `${freshNode.label} completed`,
    humanSummary: checkpointContent.humanSummary || `Step "${freshNode.label}" has completed.`,
    machineSummary: checkpointContent.machineSummary || "",
    artifactsToReview: allArtifacts
      .filter((a) => a.nodeId === freshNode.id)
      .map((a) => a.id),
    currentFindings: checkpointContent.currentFindings || "",
    openQuestions: checkpointContent.openQuestions || [],
    recommendedNextAction: checkpointContent.recommendedNextAction
      || (isFinalStep ? "Review and close the research session" : `Proceed to ${suggestedNextPhase}`),
    alternativeNextActions: checkpointContent.alternativeNextActions || [],
    requiresUserConfirmation: true,
    isFinalStep,
    createdAt: new Date().toISOString(),
  };

  // Persist checkpoint as an artifact
  const checkpointArtifact = await store.createCheckpoint(
    session.id,
    freshNode.id,
    checkpointPackage
  );

  // NOTE: We do NOT change the node's execution status here.
  // The checkpoint is a session-level gate. Completed nodes stay completed.
  // Only the session transitions to awaiting_user_confirmation.

  // Transition session
  if (isFinalStep) {
    // For final report, set phase but still await confirmation
    await store.updateSession(session.id, {
      status: "awaiting_user_confirmation",
      phase: suggestedNextPhase,
      pendingCheckpointId: checkpointArtifact.id,
    });
  } else {
    await store.updateSession(session.id, {
      status: "awaiting_user_confirmation",
      phase: suggestedNextPhase,
      pendingCheckpointId: checkpointArtifact.id,
    });
  }

  // Add a message so the user sees the summary in chat
  await store.addMessage(
    session.id,
    "main_brain",
    `**Checkpoint: ${checkpointPackage.title}**\n\n${checkpointPackage.humanSummary}\n\n` +
    `**Recommended next:** ${checkpointPackage.recommendedNextAction}\n\n` +
    `_Please review and confirm to continue._`
  );
}

async function generateCheckpointContent(
  session: DeepResearchSession,
  completedNode: DeepResearchNode,
  artifacts: DeepResearchArtifact[],
  nodes: DeepResearchNode[],
  phase: Phase,
  abortSignal?: AbortSignal
): Promise<{
  title?: string;
  humanSummary?: string;
  machineSummary?: string;
  currentFindings?: string;
  openQuestions?: string[];
  recommendedNextAction?: string;
  alternativeNextActions?: string[];
}> {
  try {
    const { model } = getModelForRole("main_brain", session.config);
    const budgetCheck = checkBudget("main_brain", session.budget, session.config.budget);

    if (!budgetCheck.allowed) {
      return {
        title: "Budget limit reached",
        humanSummary: `Budget limit reached after completing "${completedNode.label}". ${budgetCheck.reason}`,
        recommendedNextAction: "Generate final report with current findings",
      };
    }

    const prompt = buildCheckpointPrompt(session, completedNode, artifacts, nodes, phase);

    const result = await generateText({
      model,
      system: "You are the Main Brain of a step-gated deep research system. Generate a checkpoint summary.",
      messages: [{ role: "user", content: prompt }],
      maxRetries: 0, // Fail fast — fallback template is good enough
      abortSignal,
    });

    const tokens = result.usage?.totalTokens ?? 0;
    const updatedBudget = trackUsage(session.budget, "main_brain", "checkpoint_gen", tokens);
    await store.updateSession(session.id, { budget: updatedBudget });

    return safeParseJson(result.text);
  } catch (error) {
    console.error("[deep-research] Failed to generate checkpoint content:", error);
    return {
      title: `${completedNode.label} completed`,
      humanSummary: `Step "${completedNode.label}" (${completedNode.nodeType}) has completed in the ${phase} phase.`,
    };
  }
}

// --- Helpers ---

async function buildContext(session: DeepResearchSession) {
  const [messages, allNodes, allArtifacts] = await Promise.all([
    store.getMessages(session.id),
    store.getNodes(session.id),
    store.getArtifacts(session.id),
  ]);
  const freshSession = (await store.getSession(session.id))!;
  return { session: freshSession, messages, allNodes, allArtifacts };
}

async function callMainBrain(
  session: DeepResearchSession,
  abortSignal?: AbortSignal
): Promise<BrainDecision> {
  const { model } = getModelForRole("main_brain", session.config);

  const budgetCheck = checkBudget("main_brain", session.budget, session.config.budget);
  if (!budgetCheck.allowed) {
    return {
      action: "complete",
      messageToUser: `Budget limit reached: ${budgetCheck.reason}. Generating final report.`,
    };
  }

  const [messages, nodes, artifacts] = await Promise.all([
    store.getMessages(session.id),
    store.getNodes(session.id),
    store.getArtifacts(session.id),
  ]);

  const systemPrompt = buildMainBrainSystemPrompt(session, messages, nodes, artifacts, session.phase);

  const userContent = messages.filter((m) => m.role === "user").length > 0
    ? `Continue orchestrating. Current phase: ${session.phase}. Review all context and decide the next action.`
    : `Begin processing. Current phase: ${session.phase}.`;

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
    abortSignal,
  });

  const tokens = result.usage?.totalTokens ?? 0;
  const updatedBudget = trackUsage(session.budget, "main_brain", "brain_call", tokens);
  await store.updateSession(session.id, { budget: updatedBudget });

  try {
    return extractJsonFromLLMResponse<BrainDecision>(result.text);
  } catch {
    // Last resort: scan for any JSON object containing "action"
    try {
      const lines = result.text.split('\n');
      let jsonStart = -1;
      let braceCount = 0;
      let jsonCandidate = '';
      for (let i = 0; i < lines.length; i++) {
        if (jsonStart === -1 && lines[i].trim().startsWith('{')) {
          jsonStart = i;
          braceCount = 0;
          jsonCandidate = '';
        }
        if (jsonStart !== -1) {
          jsonCandidate += lines[i] + '\n';
          for (const ch of lines[i]) {
            if (ch === '{') braceCount++;
            if (ch === '}') braceCount--;
          }
          if (braceCount === 0) {
            const parsed = JSON.parse(jsonCandidate.trim());
            if (parsed.action) return parsed as BrainDecision;
            jsonStart = -1;
          }
        }
      }
    } catch { /* ignore */ }

    return {
      action: "respond_to_user",
      messageToUser: result.text,
    };
  }
}

async function callMainBrainForConfirmation(
  session: DeepResearchSession,
  checkpoint: CheckpointPackage,
  outcome: ConfirmationOutcome,
  feedback: string | undefined,
  nodes: DeepResearchNode[],
  artifacts: DeepResearchArtifact[],
  abortSignal?: AbortSignal
): Promise<ConfirmationDecision> {
  const { model } = getModelForRole("main_brain", session.config);

  const budgetCheck = checkBudget("main_brain", session.budget, session.config.budget);
  if (!budgetCheck.allowed) {
    return {
      action: "stop",
      reasoning: `Budget limit reached: ${budgetCheck.reason}`,
      messageToUser: "Budget limit reached. Stopping research.",
    };
  }

  const prompt = buildConfirmationInterpretationPrompt(
    session,
    checkpoint,
    outcome,
    feedback,
    nodes,
    artifacts
  );

  const result = await generateText({
    model,
    system: "You are the Main Brain of a step-gated deep research system. Interpret the user's confirmation response.",
    messages: [{ role: "user", content: prompt }],
    abortSignal,
  });

  const tokens = result.usage?.totalTokens ?? 0;
  const updatedBudget = trackUsage(session.budget, "main_brain", "confirmation_interp", tokens);
  await store.updateSession(session.id, { budget: updatedBudget });

  try {
    return extractJsonFromLLMResponse<ConfirmationDecision>(result.text);
  } catch {
    // If parsing fails, default based on outcome
    if (outcome === "confirmed") {
      return { action: "continue", reasoning: "User confirmed, proceeding." };
    }
    return {
      action: "revise",
      reasoning: "Could not parse brain response, defaulting to revise.",
      messageToUser: result.text,
    };
  }
}

async function executeReadyWorkers(
  session: DeepResearchSession,
  abortSignal?: AbortSignal
): Promise<void> {
  const ready = await store.getReadyNodes(session.id);
  if (ready.length === 0) return;

  const maxConcurrent = session.config.maxWorkerConcurrency;
  const ctx = await buildContext(session);

  for (let i = 0; i < ready.length; i += maxConcurrent) {
    if (abortSignal?.aborted) break;

    const batch = ready.slice(i, i + maxConcurrent);
    await Promise.allSettled(
      batch.map((node) => executeNode(node, ctx, abortSignal))
    );

    if (i + maxConcurrent < ready.length) {
      const refreshed = await buildContext(session);
      Object.assign(ctx, refreshed);
    }
  }
}

function getNextPhase(current: Phase): Phase | null {
  const order: Phase[] = [
    "intake",
    "planning",
    "evidence_collection",
    "structured_understanding",
    "reviewer_deliberation",
    "decision",
    "execution_planning",
    "execution",
    "review_correction",
    "final_report",
  ];
  const idx = order.indexOf(current);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
}

/**
 * Validate a phase string returned by the LLM. If invalid, return the fallback.
 */
function validatePhase(phase: string | undefined, fallback: Phase): Phase {
  if (phase && (PHASE_ORDER as string[]).includes(phase)) {
    return phase as Phase;
  }
  // Try fuzzy matching common LLM mistakes
  const fuzzyMap: Record<string, Phase> = {
    evidence_gather: "evidence_collection",
    evidence_gathering: "evidence_collection",
    evidence: "evidence_collection",
    review: "reviewer_deliberation",
    reviewing: "reviewer_deliberation",
    deliberation: "reviewer_deliberation",
    understanding: "structured_understanding",
    report: "final_report",
    execute: "execution",
    plan: "planning",
  };
  if (phase && fuzzyMap[phase]) {
    return fuzzyMap[phase];
  }
  return fallback;
}

/**
 * Robustly extract a JSON object from LLM text output.
 * Handles: ```json...```, bare JSON, JSON mixed with prose, nested braces.
 */
function extractJsonFromLLMResponse<T>(text: string): T {
  // Strategy 1: Code fence with greedy match
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]+?)\n\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) as T; } catch { /* try next */ }
  }

  // Strategy 2: Find the outermost { ... } by brace counting
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString) {
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.slice(firstBrace, i + 1)) as T;
            } catch { /* try next brace */ break; }
          }
        }
      }
    }
  }

  // Strategy 3: Just try parsing the whole text
  return JSON.parse(text.trim()) as T;
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(jsonStr);
  } catch {
    return { text };
  }
}
