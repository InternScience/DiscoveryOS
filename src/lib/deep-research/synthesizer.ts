// =============================================================
// Deep Research — Synthesizer Role
// =============================================================

import * as store from "./event-store";
import { executeNode } from "./node-executor";
import { buildNodeContext } from "./phases/shared";
import type {
  ClaimMap,
  DeepResearchArtifact,
  DeepResearchSession,
  EvidenceCardCollection,
  RequirementState,
  ReviewRevisionRequest,
} from "./types";

export { buildSynthesizerPrompt, buildRevisionPrompt } from "./synthesizer-runtime";

export async function executeSynthesis(
  session: DeepResearchSession,
  evidenceCards: EvidenceCardCollection,
  abortSignal?: AbortSignal,
  requirementState?: RequirementState | null,
): Promise<{
  claimMap: ClaimMap;
  artifacts: DeepResearchArtifact[];
}> {
  const synthNode = await store.createNode(session.id, {
    nodeType: "synthesize_claims",
    label: "Build claim map from evidence cards",
    assignedRole: "synthesizer",
    input: {
      mode: "claim_map",
      evidenceCards,
      requirementState: requirementState ?? null,
      totalCards: evidenceCards.cards.length,
      totalSources: evidenceCards.totalSources,
      retrievalSummary: evidenceCards.retrievalSummary,
    },
    phase: "literature_synthesis",
  });

  const nodeCtx = await buildNodeContext(session.id);
  const result = await executeNode(synthNode, nodeCtx, abortSignal);
  const claimMap = result.output as unknown as ClaimMap;

  await store.appendEvent(session.id, "synthesis_completed", synthNode.id, "synthesizer", undefined, undefined, {
    claimsCount: claimMap.claims.length,
    contradictionsCount: claimMap.contradictions.length,
    gapsCount: claimMap.gaps.length,
  });

  return { claimMap, artifacts: result.artifacts };
}

export async function executeRevisionSynthesis(
  session: DeepResearchSession,
  existingClaimMap: ClaimMap,
  revisionRequest: ReviewRevisionRequest,
  abortSignal?: AbortSignal,
): Promise<{
  claimMap: ClaimMap;
  artifacts: DeepResearchArtifact[];
}> {
  const synthNode = await store.createNode(session.id, {
    nodeType: "synthesize_claims",
    label: `Revise claim map (addressing ${revisionRequest.revisionPoints.length} reviewer points)`,
    assignedRole: "synthesizer",
    input: {
      mode: "revision",
      existingClaimMap,
      revisionRequest,
      revisionFromRound: revisionRequest.fromRound,
      issueCount: revisionRequest.issueIds.length,
      revisionPointCount: revisionRequest.revisionPoints.length,
      antiPatternCount: revisionRequest.antiPatternsToFix.length,
    },
    phase: "literature_synthesis",
  });

  const nodeCtx = await buildNodeContext(session.id);
  const result = await executeNode(synthNode, nodeCtx, abortSignal);
  const claimMap = result.output as unknown as ClaimMap;

  return { claimMap, artifacts: result.artifacts };
}
