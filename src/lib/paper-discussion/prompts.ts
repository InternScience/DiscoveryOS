import type { DiscussionStageId, DiscussionRoleId, DiscussionTurn, PaperDiscussionSharedContext, DiscussionAgentConfig } from "./types";
import { DISCUSSION_AGENTS, DISCUSSION_STAGES, SHARED_DISCUSSION_INSTRUCTION } from "./roles";

// =============================================================
// STAGE GUIDANCE — what the active role should do in each stage
// =============================================================
const STAGE_GUIDANCE: Record<DiscussionStageId, string> = {
  agenda: `CURRENT STAGE: Agenda
Your task: Frame the discussion. Define the agenda. Identify key technical questions the panel should address.
- Briefly identify the paper topic and likely evaluation dimensions: novelty, evidence quality, methodology, reproducibility, limitations.
- Then explicitly invite the Librarian to present the evidence summary next.`,

  evidence_summary: `CURRENT STAGE: Evidence Summary
Your task: Summarize the paper's claims, method, setup, and results. Ground everything with evidence from the paper.
- Present what the paper explicitly says vs. what is inferred vs. what is missing.
- Attach evidence references whenever available.`,

  critique: `CURRENT STAGE: Critical Analysis
Your task: Challenge the evidence and claims. Identify weaknesses, missing baselines, threats to validity, and overclaims.
- Mark each issue with severity: Critical / Moderate / Minor.
- Separate confirmed weaknesses from potential concerns.`,

  reproducibility_check: `CURRENT STAGE: Reproducibility Check
Your task: Assess reproducibility. Extract implementation-critical details. Identify gaps in what's needed to reproduce the results.
- Rate overall reproducibility status: Easily / Partially / Hard to reproduce.
- Propose a minimal reproduction plan.`,

  convergence: `CURRENT STAGE: Convergence
Your task: Synthesize the discussion. Summarize agreement, disagreement, and open questions from Librarian, Skeptic, and Reproducer.
- Ask for final disagreements only if needed.
- Hand off clearly to the Scribe for final synthesis.`,

  final_report: `CURRENT STAGE: Final Report
Your task: Write the final structured report synthesizing the entire discussion.
- Use EXACTLY the required output format with all 7 sections.
- Do not introduce new claims that were not discussed.
- End with "Overall take: ..."`,
};

// =============================================================
// LOCALE INSTRUCTIONS
// =============================================================
const LOCALE_INSTRUCTION: Record<string, string> = {
  en: "Respond entirely in English.",
  zh: "请全部用中文回答。",
};

// =============================================================
// HELPERS
// =============================================================

function formatArticleContext(article: PaperDiscussionSharedContext["article"]): string {
  return `## Paper Under Discussion
- **Title**: ${article.title}
- **Authors**: ${article.authors.join(", ")}
- **Published**: ${article.publishedDate}
- **Source**: ${article.source}

### Abstract
${article.abstract}`;
}

function formatTranscript(transcript: DiscussionTurn[]): string {
  if (transcript.length === 0) return "";

  const lines = transcript.map((turn) => {
    const agent = DISCUSSION_AGENTS[turn.roleId];
    return `### [${agent.displayName} — ${turn.stageId}]\n${turn.content}`;
  });

  return `## Discussion Transcript So Far\n${lines.join("\n\n")}`;
}

function formatRetrievedEvidence(evidence?: string): string {
  if (!evidence) return "";
  return `## Retrieved Evidence / Citations Context\n${evidence}`;
}

function brevityInstruction(mode: "quick" | "full"): string {
  if (mode === "quick") {
    return "\n\nIMPORTANT: Keep your response concise — focus on the top 2-3 most critical points only. Be brief but substantive.";
  }
  return "";
}

// =============================================================
// UNIFIED PROMPT BUILDER
// =============================================================

/**
 * Build the complete system prompt for a discussion agent at a given stage.
 *
 * Combines (in order):
 * 1. Shared discussion instruction
 * 2. Role-specific system prompt
 * 3. Paper context
 * 4. Retrieved evidence (if available)
 * 5. Prior transcript
 * 6. Stage-specific guidance
 * 7. Locale instruction
 * 8. Brevity instruction (quick mode)
 */
export function buildDiscussionPrompt(
  agentConfig: DiscussionAgentConfig,
  context: PaperDiscussionSharedContext,
  transcript: DiscussionTurn[],
  stageId: DiscussionStageId,
): string {
  const parts: string[] = [
    SHARED_DISCUSSION_INSTRUCTION,
    "",
    agentConfig.systemPrompt,
    "",
    formatArticleContext(context.article),
  ];

  const evidence = formatRetrievedEvidence(context.retrievedEvidence);
  if (evidence) {
    parts.push("", evidence);
  }

  const transcriptBlock = formatTranscript(transcript);
  if (transcriptBlock) {
    parts.push("", transcriptBlock);
  }

  parts.push("", STAGE_GUIDANCE[stageId]);

  const localeInstr = LOCALE_INSTRUCTION[context.locale] || LOCALE_INSTRUCTION.en;
  parts.push("", localeInstr);

  parts.push(brevityInstruction(context.mode));

  return parts.join("\n");
}

// =============================================================
// Backward compat — dispatch by stageId (used by old route.ts)
// =============================================================

/** @deprecated Use buildDiscussionPrompt directly */
export function buildDiscussionPhasePrompt(
  phaseId: DiscussionStageId,
  article: { title: string; authors: string[]; publishedDate: string; source: string; abstract: string },
  transcript: string,
  mode: "quick" | "full",
  locale: string,
): string {
  // Convert old-style args to new context
  const context: PaperDiscussionSharedContext = {
    article: { id: "", ...article },
    locale,
    mode,
  };

  // Find the stage to get the role
  const stage = DISCUSSION_STAGES.find((s) => s.id === phaseId);
  if (!stage) throw new Error(`Unknown stage: ${phaseId}`);

  const agentConfig = DISCUSSION_AGENTS[stage.roleId as DiscussionRoleId];

  // Convert old transcript string to empty turns (prompt builder will use the raw string approach)
  // For backward compat, we construct the prompt manually with the old transcript
  const parts: string[] = [
    SHARED_DISCUSSION_INSTRUCTION,
    "",
    agentConfig.systemPrompt,
    "",
    formatArticleContext(context.article),
  ];

  if (transcript) {
    parts.push("", `## Discussion Transcript So Far\n${transcript}`);
  }

  parts.push("", STAGE_GUIDANCE[phaseId]);

  const localeInstr = LOCALE_INSTRUCTION[locale] || LOCALE_INSTRUCTION.en;
  parts.push("", localeInstr);

  parts.push(brevityInstruction(mode));

  return parts.join("\n");
}
