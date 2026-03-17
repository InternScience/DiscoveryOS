import type {
  DeepResearchSession,
  DeepResearchMessage,
  DeepResearchNode,
  DeepResearchArtifact,
  Phase,
  NodeType,
  CheckpointPackage,
  ConfirmationOutcome,
} from "./types";

/**
 * Build the system prompt for the Main Brain (Opus) orchestrator.
 * Includes full context: session state, messages, nodes, artifacts, current phase.
 */
export function buildMainBrainSystemPrompt(
  session: DeepResearchSession,
  messages: DeepResearchMessage[],
  nodes: DeepResearchNode[],
  artifacts: DeepResearchArtifact[],
  phase: Phase
): string {
  const nodeStatusSummary = nodes.map((n) =>
    `  - [${n.id}] ${n.label} (${n.nodeType}, ${n.status}, role=${n.assignedRole})`
  ).join("\n");

  const artifactSummary = artifacts.map((a) => {
    const contentStr = JSON.stringify(a.content);
    const preview = contentStr.length > 500 ? contentStr.slice(0, 500) + "..." : contentStr;
    return `  - [${a.id}] ${a.title} (${a.artifactType}): ${preview}`;
  }).join("\n");

  const recentMessages = messages.slice(-10).map((m) =>
    `  [${m.role}]: ${m.content.slice(0, 300)}${m.content.length > 300 ? "..." : ""}`
  ).join("\n");

  const reviewerPackets = artifacts
    .filter((a) => a.artifactType === "reviewer_packet")
    .map((a) => `  Reviewer Packet [${a.id}]: ${JSON.stringify(a.content).slice(0, 500)}`)
    .join("\n");

  const phaseGuidance = getPhaseGuidance(phase);

  return `You are the Main Brain orchestrator of a Deep Research system.

## Your Role
You decompose complex research problems, dispatch workers, interpret reviewer feedback, and make strategic decisions. You are the central intelligence coordinating a multi-model research team.

## CRITICAL: Step-Gated Workflow
This research system is STEP-GATED. After every meaningful step, the system halts and waits for explicit user confirmation before continuing. You do NOT auto-continue. You are a supervised research copilot, not an autonomous pipeline.

## Current State
- Session: "${session.title}" (id: ${session.id})
- Status: ${session.status}
- Current Phase: ${phase}
- Budget: ${session.budget.totalTokens} / ${session.config.budget.maxTotalTokens} total tokens used
- Opus tokens: ${session.budget.opusTokens} / ${session.config.budget.maxOpusTokens} used

## Task Graph Nodes
${nodeStatusSummary || "  (none yet)"}

## Artifacts
${artifactSummary || "  (none yet)"}

## Reviewer Feedback
${reviewerPackets || "  (none yet)"}

## Recent Conversation
${recentMessages || "  (no messages yet)"}

## Phase Guidance
${phaseGuidance}

## Output Format
You MUST respond with valid JSON matching the BrainDecision schema:
{
  "action": "advance_phase" | "revise_plan" | "request_approval" | "complete" | "respond_to_user",
  "nextPhase": "(optional) phase to advance to",
  "nodesToCreate": [(optional) array of NodeCreationSpec objects],
  "messageToUser": "(optional) message to display to the user",
  "reasoning": "(optional) internal reasoning for this decision"
}

NodeCreationSpec format:
{
  "nodeType": "intake|plan|evidence_gather|summarize|review|deliberate|execute|approve|synthesize|final_report",
  "label": "human-readable label",
  "assignedRole": "main_brain|reviewer_a|reviewer_b|worker",
  "input": { ... task-specific input ... },
  "dependsOn": ["nodeId1", "nodeId2"],
  "parentId": "optional parent node id",
  "branchKey": "optional branch identifier"
}

## Cost Awareness
- Use workers for bulk evidence gathering and execution work.
- Reserve your (expensive) reasoning for strategic decisions, planning, and synthesis.
- Prefer smaller fan-outs when possible.
- Max worker fan-out: ${session.config.maxWorkerFanOut}
- Max concurrent workers: ${session.config.maxWorkerConcurrency}`;
}

function getPhaseGuidance(phase: Phase): string {
  switch (phase) {
    case "intake":
      return `INTAKE: Analyze the user's research question. Produce a research_brief artifact that clarifies scope, objectives, key sub-questions, and constraints. Then advance to planning.`;
    case "planning":
      return `PLANNING: Decompose the research brief into a task graph. Create evidence_gather nodes for each sub-question. Create a task_graph artifact. Then advance to evidence_collection.`;
    case "evidence_collection":
      return `EVIDENCE COLLECTION: Workers are gathering evidence. Monitor progress. If all evidence nodes are complete, advance to structured_understanding. If issues arise, create new evidence nodes or revise the plan.`;
    case "structured_understanding":
      return `STRUCTURED UNDERSTANDING: Synthesize evidence into structured summaries per sub-question. Create structured_summary artifacts. Then advance to reviewer_deliberation.`;
    case "reviewer_deliberation":
      return `REVIEWER DELIBERATION: Two reviewers will critique the structured summaries. Wait for their reviewer_packet artifacts. Then advance to decision.`;
    case "decision":
      return `DECISION: Based on reviewer feedback, decide whether to:
- advance_phase: Move forward (to execution_planning if experiments needed, or to final_report if purely theoretical)
- revise_plan: Create new nodes and loop back for more evidence or re-review
- request_approval: Pause for user approval on a critical decision
- complete: Skip to final report if research is sufficient`;
    case "execution_planning":
      return `EXECUTION PLANNING: Plan concrete execution steps (code experiments, simulations, etc.). Create execute nodes with approval gates where appropriate. Create an execution_plan artifact.`;
    case "execution":
      return `EXECUTION: Workers are executing planned steps. Monitor progress. When all execute nodes are done, advance to review_correction.`;
    case "review_correction":
      return `REVIEW CORRECTION: Reviewers critique execution results. Based on feedback, either loop back to execution (respecting maxExecutionLoops) or advance to final_report.`;
    case "final_report":
      return `FINAL REPORT: Synthesize all evidence, summaries, execution results, and reviewer feedback into a comprehensive final_report artifact. Then set action to "complete".`;
  }
}

/**
 * Build a prompt that asks the Main Brain to produce a CheckpointPackage
 * summarizing what just happened and what should happen next.
 */
export function buildCheckpointPrompt(
  session: DeepResearchSession,
  completedNode: DeepResearchNode,
  artifacts: DeepResearchArtifact[],
  nodes: DeepResearchNode[],
  phase: Phase
): string {
  const nodeArtifacts = artifacts.filter((a) => a.nodeId === completedNode.id);
  const artifactPreviews = nodeArtifacts.map((a) => {
    const contentStr = JSON.stringify(a.content);
    return `  - [${a.id}] ${a.title} (${a.artifactType}): ${contentStr.length > 300 ? contentStr.slice(0, 300) + "..." : contentStr}`;
  }).join("\n");

  const allNodesSummary = nodes.map((n) =>
    `  - [${n.id}] ${n.label} (${n.nodeType}, ${n.status})`
  ).join("\n");

  return `You have just completed a step in a step-gated deep research workflow.
The system will now HALT and present your summary to the user for review.

## Completed Step
- Node: "${completedNode.label}" (${completedNode.nodeType})
- Role: ${completedNode.assignedRole}
- Status: ${completedNode.status}
- Phase: ${phase}

## Artifacts Produced by This Step
${artifactPreviews || "  (none)"}

## Current Task Graph
${allNodesSummary || "  (none)"}

## Session
- Title: "${session.title}"
- Tokens used: ${session.budget.totalTokens} / ${session.config.budget.maxTotalTokens}

## Instructions
Produce a checkpoint summary as JSON:
{
  "title": "Short title for this checkpoint (e.g. 'Research brief completed')",
  "humanSummary": "A clear 2-5 sentence summary for the user explaining what was done, what was found, and why it matters. Write for a human reader — be specific, not generic.",
  "machineSummary": "Compact internal summary for your own future context.",
  "currentFindings": "What do we know so far? Summarize the key findings at this point.",
  "openQuestions": ["Question 1", "Question 2"],
  "recommendedNextAction": "What the system should do next (e.g. 'Proceed to evidence collection with 3 sub-questions')",
  "alternativeNextActions": ["Alternative 1", "Alternative 2"],
  "requiresUserConfirmation": true
}

Be specific and helpful. The user is reading this to decide whether to continue, revise, or stop.`;
}

/**
 * Build a prompt for the Main Brain to interpret user confirmation feedback
 * and decide how to proceed.
 */
export function buildConfirmationInterpretationPrompt(
  session: DeepResearchSession,
  checkpoint: CheckpointPackage,
  outcome: ConfirmationOutcome,
  userFeedback: string | undefined,
  nodes: DeepResearchNode[],
  artifacts: DeepResearchArtifact[]
): string {
  const nodesSummary = nodes.map((n) =>
    `  - [${n.id}] ${n.label} (${n.nodeType}, ${n.status})`
  ).join("\n");

  return `The user has responded to a checkpoint in the step-gated deep research workflow.

## Checkpoint That Was Presented
- Title: "${checkpoint.title}"
- Phase: ${checkpoint.phase}
- Summary: ${checkpoint.humanSummary}
- Recommended next: ${checkpoint.recommendedNextAction}

## User's Response
- Outcome: ${outcome}
${userFeedback ? `- Feedback: "${userFeedback}"` : "- (no additional feedback)"}

## Current Task Graph
${nodesSummary}

## Outcome Meanings
- "confirmed" — User approves, proceed with recommended action
- "revision_requested" — User wants changes to the current step's output before continuing
- "branch_requested" — User wants to explore an alternative path in parallel
- "rejected" — User is not satisfied and wants to stop or fundamentally rethink
- "stopped" — User wants to halt the entire research session

## Instructions
Based on the user's response, decide how to proceed. Respond with JSON:
{
  "action": "continue" | "revise" | "retry" | "branch" | "supersede" | "stop",
  "reasoning": "Brief explanation of your decision",
  "nodesToCreate": [/* optional: new NodeCreationSpec objects */],
  "nextPhase": "optional: phase to transition to",
  "messageToUser": "optional: message to show the user"
}

Actions:
- "continue" — Proceed to the next step as planned
- "revise" — Re-do the current step with modifications based on feedback
- "retry" — Retry the exact same step (e.g., if there was a transient error)
- "branch" — Create an alternative exploration path
- "supersede" — Replace the current approach entirely
- "stop" — Halt the research session`;
}

/**
 * Build the system prompt for a Worker node (Kimi/Sonnet).
 */
export function buildWorkerSystemPrompt(
  node: DeepResearchNode,
  parentArtifacts: DeepResearchArtifact[],
  taskType: NodeType
): string {
  const contextSection = parentArtifacts.length > 0
    ? "## Context Artifacts\n" + parentArtifacts.map((a) =>
        `### ${a.title} (${a.artifactType})\n${JSON.stringify(a.content, null, 2)}`
      ).join("\n\n")
    : "";

  const outputSchema = getWorkerOutputSchema(taskType);

  return `You are a research worker executing a specific subtask. Focus ONLY on the assigned task.

## Your Task
${node.label}

## Task Input
${node.input ? JSON.stringify(node.input, null, 2) : "(no specific input)"}

${contextSection}

## Output Requirements
${outputSchema}

## Important Rules
- Stay focused on your specific subtask. Do not attempt to address the broader research question.
- Cite provenance for all claims: which source, which section, what evidence.
- Do NOT hallucinate or fabricate information. If information is missing or uncertain, say so explicitly.
- Be thorough but concise.`;
}

function getWorkerOutputSchema(taskType: NodeType): string {
  switch (taskType) {
    case "evidence_gather":
      return `Produce an evidence card as JSON:
{
  "claims": [{ "claim": "...", "evidence": "...", "source": "...", "confidence": "high|medium|low" }],
  "methods": ["..."],
  "datasets": ["..."],
  "gaps": ["areas where evidence is insufficient"],
  "confidence": 0.0-1.0
}`;
    case "execute":
      return `Produce a step result as JSON:
{
  "status": "success|failure|partial",
  "outputs": { ... },
  "commands": ["commands or actions taken"],
  "observations": ["key observations"],
  "errors": ["any errors encountered"]
}`;
    case "summarize":
      return `Produce a structured summary in markdown format. Include:
- Key findings organized by sub-question
- Evidence strength assessment
- Gaps and limitations
- Cross-references between findings`;
    case "synthesize":
      return `Produce a synthesis in markdown format. Include:
- Integrated findings across all sub-questions
- Resolution of conflicting evidence
- Overall conclusions with confidence levels
- Recommendations for further work`;
    default:
      return `Produce a clear, structured response addressing the assigned task.`;
  }
}

/**
 * Build the system prompt for a Reviewer (Sonnet).
 */
export function buildReviewerSystemPrompt(
  role: "reviewer_a" | "reviewer_b",
  targetArtifacts: DeepResearchArtifact[],
  previousPackets?: DeepResearchArtifact[]
): string {
  const artifactsSection = targetArtifacts.map((a) =>
    `### ${a.title} (${a.artifactType})\n${JSON.stringify(a.content, null, 2)}`
  ).join("\n\n");

  const previousSection = previousPackets && previousPackets.length > 0
    ? "\n## Previous Review Rounds\n" + previousPackets.map((p) =>
        `### ${p.title}\n${JSON.stringify(p.content, null, 2)}`
      ).join("\n\n")
    : "";

  const roleLabel = role === "reviewer_a" ? "Reviewer A" : "Reviewer B";

  return `You are ${roleLabel} in a Deep Research review process. Your role is to critically evaluate research artifacts and provide constructive feedback.

## Artifacts to Review
${artifactsSection}
${previousSection}

## Output Format
You MUST respond with valid JSON matching the ReviewerPacket schema:
{
  "reviewerRole": "${role}",
  "verdict": "approve" | "revise" | "reject",
  "critique": "detailed critique of the artifacts",
  "suggestions": ["specific actionable suggestions for improvement"],
  "confidence": 0.0-1.0
}

## Review Guidelines
- Be thorough and specific in your critique.
- Identify logical gaps, unsupported claims, methodological issues.
- Suggest concrete improvements, not vague recommendations.
- You advise the Main Brain. You do NOT control workers directly.
- Consider both the quality of evidence and the quality of reasoning.
- A "revise" verdict means the work has promise but needs improvement.
- An "approve" verdict means the work meets the research standard.
- A "reject" verdict means fundamental issues require starting over.`;
}

/**
 * Build the prompt for evidence gathering with tools.
 */
export function buildEvidenceGatherPrompt(
  query: string,
  constraints?: { maxSources?: number; focusAreas?: string[] }
): string {
  const constraintSection = constraints
    ? `\n## Constraints
- Max sources: ${constraints.maxSources || "no limit"}
- Focus areas: ${constraints.focusAreas?.join(", ") || "none specified"}`
    : "";

  return `Search for and gather evidence related to the following query:

## Query
${query}
${constraintSection}

## Instructions
Use the available search and file reading tools to find relevant information.
For each piece of evidence found, note:
1. The source (URL, file path, paper title)
2. The relevant excerpt or finding
3. Your confidence in the evidence quality (high/medium/low)
4. How it relates to the query

Be systematic and thorough. Gather evidence from multiple sources when possible.`;
}
