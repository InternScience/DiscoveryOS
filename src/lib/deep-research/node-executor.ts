import { generateText, stepCountIs } from "ai";
import { getModelForRole, checkBudget, trackUsage } from "./model-router";
import * as eventStore from "./event-store";
import {
  buildWorkerSystemPrompt,
  buildReviewerSystemPrompt,
  buildEvidenceGatherPrompt,
  buildMainBrainSystemPrompt,
} from "./prompts";
import { createSearchTools } from "@/lib/ai/tools/search-tools";
import type {
  DeepResearchNode,
  DeepResearchArtifact,
  DeepResearchSession,
  DeepResearchMessage,
  DeepResearchConfig,
  BudgetUsage,
  ArtifactType,
  ArtifactProvenance,
  ReviewerPacket,
} from "./types";

interface ExecutionContext {
  session: DeepResearchSession;
  messages: DeepResearchMessage[];
  allNodes: DeepResearchNode[];
  allArtifacts: DeepResearchArtifact[];
}

interface ExecutionResult {
  output: Record<string, unknown>;
  artifacts: DeepResearchArtifact[];
  tokensUsed: number;
}

/**
 * Execute a single node: resolve model, build prompt, call LLM, persist results.
 */
export async function executeNode(
  node: DeepResearchNode,
  ctx: ExecutionContext,
  abortSignal?: AbortSignal
): Promise<ExecutionResult> {
  const config = ctx.session.config;
  const budget = ctx.session.budget;

  // Check budget
  const budgetCheck = checkBudget(node.assignedRole, budget, config.budget);
  if (!budgetCheck.allowed) {
    throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
  }

  // Resolve model
  const { model, provider, modelId } = getModelForRole(node.assignedRole, config);

  // Mark node as running
  await eventStore.updateNode(node.id, {
    status: "running",
    assignedModel: `${provider}/${modelId}`,
    startedAt: new Date().toISOString(),
  });

  try {
    const result = await executeByNodeType(node, ctx, model, abortSignal);

    // Mark node as completed
    await eventStore.updateNode(node.id, {
      status: "completed",
      output: result.output,
      completedAt: new Date().toISOString(),
    });

    // Create artifacts
    const createdArtifacts: DeepResearchArtifact[] = [];
    for (const art of result.artifacts) {
      const created = await eventStore.createArtifact(
        ctx.session.id,
        node.id,
        art.artifactType,
        art.title,
        art.content,
        art.provenance ?? undefined
      );
      createdArtifacts.push(created);
    }

    // Track token usage
    const updatedBudget = trackUsage(budget, node.assignedRole, node.id, result.tokensUsed);
    await eventStore.updateSession(ctx.session.id, { budget: updatedBudget });

    return {
      output: result.output,
      artifacts: createdArtifacts,
      tokensUsed: result.tokensUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    await eventStore.updateNode(node.id, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

async function executeByNodeType(
  node: DeepResearchNode,
  ctx: ExecutionContext,
  model: ReturnType<typeof getModelForRole>["model"],
  abortSignal?: AbortSignal
): Promise<{
  output: Record<string, unknown>;
  artifacts: Array<{
    artifactType: ArtifactType;
    title: string;
    content: Record<string, unknown>;
    provenance: ArtifactProvenance | null;
  }>;
  tokensUsed: number;
}> {
  const parentArtifacts = ctx.allArtifacts.filter(
    (a) => a.nodeId && node.dependsOn.includes(a.nodeId)
  );

  switch (node.nodeType) {
    case "intake":
    case "plan":
    case "synthesize":
    case "final_report": {
      return executeBrainNode(node, ctx, model, abortSignal);
    }
    case "evidence_gather": {
      return executeEvidenceGather(node, parentArtifacts, model, abortSignal);
    }
    case "summarize": {
      return executeSummarize(node, parentArtifacts, model, abortSignal);
    }
    case "review":
    case "deliberate": {
      return executeReview(node, ctx.allArtifacts, model, abortSignal);
    }
    case "execute": {
      return executeWorkerTask(node, parentArtifacts, model, abortSignal);
    }
    case "approve": {
      // Approval nodes are handled by the orchestrator, not executed directly
      return {
        output: { status: "awaiting_approval" },
        artifacts: [],
        tokensUsed: 0,
      };
    }
    default: {
      return executeGeneric(node, parentArtifacts, model, abortSignal);
    }
  }
}

async function executeBrainNode(
  node: DeepResearchNode,
  ctx: ExecutionContext,
  model: ReturnType<typeof getModelForRole>["model"],
  abortSignal?: AbortSignal
) {
  const systemPrompt = buildMainBrainSystemPrompt(
    ctx.session,
    ctx.messages,
    ctx.allNodes,
    ctx.allArtifacts,
    ctx.session.phase
  );

  const taskPrompt = node.input
    ? JSON.stringify(node.input)
    : `Execute the ${node.nodeType} task: ${node.label}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: taskPrompt }],
    abortSignal,
  });

  const output = safeParseJson(result.text);
  const artifactType = getArtifactTypeForNode(node.nodeType);

  // For final_report nodes, extract the actual report text from the BrainDecision
  // The LLM returns { action, messageToUser, reasoning, ... } where messageToUser
  // contains the full markdown report. Store it in a `report` field for clean access.
  let artifactContent = output;
  if (node.nodeType === "final_report") {
    const reportText = (output.messageToUser as string)
      || (output.report as string)
      || (output.text as string)
      || result.text;
    artifactContent = { report: reportText, ...output };
  }

  const artifacts = artifactType
    ? [{
        artifactType,
        title: node.label,
        content: artifactContent,
        provenance: {
          sourceNodeId: node.id,
          sourceArtifactIds: [],
          model: node.assignedModel || "unknown",
          generatedAt: new Date().toISOString(),
        } as ArtifactProvenance,
      }]
    : [];

  return {
    output,
    artifacts,
    tokensUsed: result.usage?.totalTokens ?? 0,
  };
}

async function executeEvidenceGather(
  node: DeepResearchNode,
  parentArtifacts: DeepResearchArtifact[],
  model: ReturnType<typeof getModelForRole>["model"],
  abortSignal?: AbortSignal
) {
  const query = (node.input as Record<string, unknown>)?.query as string
    || (node.input as Record<string, unknown>)?.researchQuestion as string
    || node.label;
  const constraints = (node.input as Record<string, unknown>)?.constraints as Record<string, unknown> | undefined;

  const systemPrompt = buildWorkerSystemPrompt(node, parentArtifacts, "evidence_gather");
  const userPrompt = buildEvidenceGatherPrompt(query, constraints as { maxSources?: number; focusAreas?: string[] });

  // Provide real search tools so the model can find actual papers
  const searchTools = createSearchTools();

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    tools: searchTools,
    stopWhen: stepCountIs(5), // Allow multiple tool calls for thorough search
    abortSignal,
  });

  const output = safeParseJson(result.text);

  return {
    output,
    artifacts: [{
      artifactType: "evidence_card" as ArtifactType,
      title: `Evidence: ${node.label}`,
      content: output,
      provenance: {
        sourceNodeId: node.id,
        sourceArtifactIds: parentArtifacts.map((a) => a.id),
        model: node.assignedModel || "unknown",
        generatedAt: new Date().toISOString(),
      } as ArtifactProvenance,
    }],
    tokensUsed: result.usage?.totalTokens ?? 0,
  };
}

async function executeSummarize(
  node: DeepResearchNode,
  parentArtifacts: DeepResearchArtifact[],
  model: ReturnType<typeof getModelForRole>["model"],
  abortSignal?: AbortSignal
) {
  const systemPrompt = buildWorkerSystemPrompt(node, parentArtifacts, "summarize");
  const userPrompt = `Summarize and synthesize the evidence from the provided artifacts for: ${node.label}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    abortSignal,
  });

  const output = { summary: result.text };

  return {
    output,
    artifacts: [{
      artifactType: "structured_summary" as ArtifactType,
      title: `Summary: ${node.label}`,
      content: output,
      provenance: {
        sourceNodeId: node.id,
        sourceArtifactIds: parentArtifacts.map((a) => a.id),
        model: node.assignedModel || "unknown",
        generatedAt: new Date().toISOString(),
      } as ArtifactProvenance,
    }],
    tokensUsed: result.usage?.totalTokens ?? 0,
  };
}

async function executeReview(
  node: DeepResearchNode,
  allArtifacts: DeepResearchArtifact[],
  model: ReturnType<typeof getModelForRole>["model"],
  abortSignal?: AbortSignal
) {
  const role = node.assignedRole as "reviewer_a" | "reviewer_b";

  // Target artifacts: summaries, evidence cards, execution results
  const targetArtifacts = allArtifacts.filter((a) =>
    ["structured_summary", "evidence_card", "step_result", "provisional_conclusion"].includes(a.artifactType)
  );

  // Previous reviewer packets
  const previousPackets = allArtifacts.filter((a) => a.artifactType === "reviewer_packet");

  const systemPrompt = buildReviewerSystemPrompt(role, targetArtifacts, previousPackets);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: `Please review the provided artifacts and produce your assessment.` }],
    abortSignal,
  });

  const output = safeParseJson(result.text);

  return {
    output,
    artifacts: [{
      artifactType: "reviewer_packet" as ArtifactType,
      title: `Review by ${role === "reviewer_a" ? "Reviewer A" : "Reviewer B"}`,
      content: output,
      provenance: {
        sourceNodeId: node.id,
        sourceArtifactIds: targetArtifacts.map((a) => a.id),
        model: node.assignedModel || "unknown",
        generatedAt: new Date().toISOString(),
      } as ArtifactProvenance,
    }],
    tokensUsed: result.usage?.totalTokens ?? 0,
  };
}

async function executeWorkerTask(
  node: DeepResearchNode,
  parentArtifacts: DeepResearchArtifact[],
  model: ReturnType<typeof getModelForRole>["model"],
  abortSignal?: AbortSignal
) {
  const systemPrompt = buildWorkerSystemPrompt(node, parentArtifacts, "execute");
  const taskPrompt = node.input
    ? JSON.stringify(node.input)
    : `Execute the task: ${node.label}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: taskPrompt }],
    abortSignal,
  });

  const output = safeParseJson(result.text);

  return {
    output,
    artifacts: [{
      artifactType: "step_result" as ArtifactType,
      title: `Result: ${node.label}`,
      content: output,
      provenance: {
        sourceNodeId: node.id,
        sourceArtifactIds: parentArtifacts.map((a) => a.id),
        model: node.assignedModel || "unknown",
        generatedAt: new Date().toISOString(),
      } as ArtifactProvenance,
    }],
    tokensUsed: result.usage?.totalTokens ?? 0,
  };
}

async function executeGeneric(
  node: DeepResearchNode,
  parentArtifacts: DeepResearchArtifact[],
  model: ReturnType<typeof getModelForRole>["model"],
  abortSignal?: AbortSignal
) {
  const systemPrompt = buildWorkerSystemPrompt(node, parentArtifacts, node.nodeType);
  const taskPrompt = node.input
    ? JSON.stringify(node.input)
    : `Execute: ${node.label}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: taskPrompt }],
    abortSignal,
  });

  return {
    output: safeParseJson(result.text),
    artifacts: [],
    tokensUsed: result.usage?.totalTokens ?? 0,
  };
}

function getArtifactTypeForNode(nodeType: string): ArtifactType | null {
  const map: Record<string, ArtifactType> = {
    intake: "research_brief",
    plan: "task_graph",
    synthesize: "provisional_conclusion",
    final_report: "final_report",
  };
  return map[nodeType] ?? null;
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(jsonStr);
  } catch {
    return { text };
  }
}
