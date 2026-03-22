// =============================================================
// Shared utilities for phase handlers
// =============================================================

import * as store from "../event-store";
import { MainBrain } from "../actors/main-brain";
import { executeNode } from "../node-executor";
import {
  loadWorkspaceSkillCatalog,
  createWorkspaceSkillTools,
} from "../workspace-skill-loader";
import type {
  DeepResearchSession,
  DeepResearchNode,
  BrainDecision,
  Phase,
  NodeCreationSpec,
  RequirementState,
  PhaseContext,
} from "../types";

const mainBrain = new MainBrain();

export async function buildNodeContext(sessionId: string) {
  const session = (await store.getSession(sessionId))!;
  const messages = await store.getMessages(sessionId);
  const allNodes = await store.getNodes(sessionId);
  const allArtifacts = await store.getArtifacts(sessionId);

  // Load workspace skills for deep research nodes
  const skillCatalog = await loadWorkspaceSkillCatalog(session.workspaceId);
  const skillTools = skillCatalog.length > 0
    ? await createWorkspaceSkillTools(session.workspaceId)
    : undefined;

  return { session, messages, allNodes, allArtifacts, skillCatalog, skillTools };
}

export async function callMainBrain(
  session: DeepResearchSession,
  abortSignal?: AbortSignal,
  requirementState?: RequirementState | null,
  languageHint?: string
): Promise<BrainDecision> {
  return mainBrain.decide(session, {
    abortSignal,
    requirementState,
    languageHint,
  });
}

export async function createNodesFromSpecs(
  sessionId: string,
  specs: NodeCreationSpec[],
  defaultPhase: Phase
): Promise<DeepResearchNode[]> {
  const created: DeepResearchNode[] = [];
  for (const spec of specs) {
    // Validate required fields to prevent NOT NULL constraint failures
    if (!spec.nodeType || !spec.label || !spec.assignedRole) {
      console.warn(
        `[deep-research] Skipping invalid node spec (missing required field):`,
        JSON.stringify(spec).slice(0, 200)
      );
      continue;
    }
    const node = await store.createNode(sessionId, {
      ...spec,
      phase: spec.phase ?? defaultPhase,
    });
    created.push(node);
  }
  return created;
}

export async function executeReadyWorkers(
  session: DeepResearchSession,
  abortSignal?: AbortSignal
): Promise<void> {
  const maxConcurrent = session.config.maxWorkerConcurrency;
  let readyNodes = await store.getReadyNodes(session.id);
  if (readyNodes.length === 0) return;

  let ctx = await buildNodeContext(session.id);

  while (readyNodes.length > 0) {
    if (abortSignal?.aborted) throw new Error("Aborted");

    const batch = readyNodes.slice(0, maxConcurrent);
    await Promise.allSettled(
      batch.map((node) => executeNode(node, ctx, abortSignal))
    );

    ctx = await buildNodeContext(session.id);
    readyNodes = await store.getReadyNodes(session.id);
  }
}
