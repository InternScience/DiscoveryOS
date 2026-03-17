import { db } from "@/lib/db";
import {
  deepResearchSessions,
  deepResearchMessages,
  deepResearchNodes,
  deepResearchArtifacts,
  deepResearchEvents,
} from "@/lib/db/schema";
import { eq, and, desc, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { DEFAULT_CONFIG, createEmptyUsage } from "./model-router";
import type {
  DeepResearchSession,
  DeepResearchMessage,
  DeepResearchNode,
  DeepResearchArtifact,
  DeepResearchEvent,
  DeepResearchConfig,
  BudgetUsage,
  ArtifactProvenance,
  ArtifactType,
  EventType,
  NodeCreationSpec,
  MessageRole,
  SessionStatus,
  Phase,
  NodeStatus,
  ConfirmationOutcome,
  CheckpointPackage,
} from "./types";

// --- Helpers ---

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toJson(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return JSON.stringify(val);
}

function parseSession(row: typeof deepResearchSessions.$inferSelect): DeepResearchSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    status: row.status as SessionStatus,
    phase: row.phase as Phase,
    config: parseJson<DeepResearchConfig>(row.configJson, DEFAULT_CONFIG),
    budget: parseJson<BudgetUsage>(row.budgetJson, createEmptyUsage()),
    pendingCheckpointId: row.pendingCheckpointId ?? null,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseMessage(row: typeof deepResearchMessages.$inferSelect): DeepResearchMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as MessageRole,
    content: row.content,
    metadata: parseJson<Record<string, unknown> | null>(row.metadataJson, null),
    createdAt: row.createdAt,
  };
}

function parseNode(row: typeof deepResearchNodes.$inferSelect): DeepResearchNode {
  return {
    id: row.id,
    sessionId: row.sessionId,
    parentId: row.parentId,
    nodeType: row.nodeType as DeepResearchNode["nodeType"],
    label: row.label,
    status: row.status as NodeStatus,
    assignedRole: row.assignedRole as DeepResearchNode["assignedRole"],
    assignedModel: row.assignedModel,
    input: parseJson<Record<string, unknown> | null>(row.inputJson, null),
    output: parseJson<Record<string, unknown> | null>(row.outputJson, null),
    error: row.error,
    dependsOn: parseJson<string[]>(row.dependsOnJson, []),
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    branchKey: row.branchKey,
    retryOfId: row.retryOfId,
    retryCount: row.retryCount,
    requiresConfirmation: row.requiresConfirmation,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    confirmationOutcome: row.confirmationOutcome as ConfirmationOutcome | null,
    positionX: row.positionX,
    positionY: row.positionY,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseArtifact(row: typeof deepResearchArtifacts.$inferSelect): DeepResearchArtifact {
  return {
    id: row.id,
    sessionId: row.sessionId,
    nodeId: row.nodeId,
    artifactType: row.artifactType as ArtifactType,
    title: row.title,
    content: parseJson<Record<string, unknown>>(row.contentJson, {}),
    provenance: parseJson<ArtifactProvenance | null>(row.provenanceJson, null),
    version: row.version,
    createdAt: row.createdAt,
  };
}

function parseEvent(row: typeof deepResearchEvents.$inferSelect): DeepResearchEvent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    eventType: row.eventType as EventType,
    nodeId: row.nodeId,
    actorType: row.actorType,
    actorId: row.actorId,
    model: row.model,
    payload: parseJson<Record<string, unknown> | null>(row.payloadJson, null),
    createdAt: row.createdAt,
  };
}

// --- Sessions ---

export async function createSession(
  workspaceId: string,
  title: string,
  config?: Partial<DeepResearchConfig>
): Promise<DeepResearchSession> {
  const id = nanoid();
  const now = new Date().toISOString();
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const usage = createEmptyUsage();

  await db.insert(deepResearchSessions).values({
    id,
    workspaceId,
    title,
    status: "intake",
    phase: "intake",
    configJson: toJson(fullConfig),
    budgetJson: toJson(usage),
    createdAt: now,
    updatedAt: now,
  });

  await appendEvent(id, "session_created", undefined, "system", undefined, undefined, { title });

  const [row] = await db
    .select()
    .from(deepResearchSessions)
    .where(eq(deepResearchSessions.id, id));
  return parseSession(row);
}

export async function getSession(sessionId: string): Promise<DeepResearchSession | null> {
  const [row] = await db
    .select()
    .from(deepResearchSessions)
    .where(eq(deepResearchSessions.id, sessionId));
  return row ? parseSession(row) : null;
}

export async function listSessions(workspaceId: string): Promise<DeepResearchSession[]> {
  const rows = await db
    .select()
    .from(deepResearchSessions)
    .where(eq(deepResearchSessions.workspaceId, workspaceId))
    .orderBy(desc(deepResearchSessions.createdAt))
    .limit(50);
  return rows.map(parseSession);
}

export async function deleteSession(sessionId: string): Promise<void> {
  // CASCADE deletes handle messages, nodes, artifacts, and events automatically
  await db
    .delete(deepResearchSessions)
    .where(eq(deepResearchSessions.id, sessionId));
}

export async function updateSession(
  sessionId: string,
  updates: Partial<{
    status: SessionStatus;
    phase: Phase;
    config: DeepResearchConfig;
    budget: BudgetUsage;
    pendingCheckpointId: string | null;
    error: string | null;
    title: string;
  }>
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.phase !== undefined) dbUpdates.phase = updates.phase;
  if (updates.config !== undefined) dbUpdates.configJson = toJson(updates.config);
  if (updates.budget !== undefined) dbUpdates.budgetJson = toJson(updates.budget);
  if (updates.pendingCheckpointId !== undefined) dbUpdates.pendingCheckpointId = updates.pendingCheckpointId;
  if (updates.error !== undefined) dbUpdates.error = updates.error;
  if (updates.title !== undefined) dbUpdates.title = updates.title;

  await db
    .update(deepResearchSessions)
    .set(dbUpdates)
    .where(eq(deepResearchSessions.id, sessionId));

  if (updates.phase) {
    await appendEvent(sessionId, "phase_changed", undefined, "system", undefined, undefined, {
      phase: updates.phase,
    });
  }
}

// --- Messages ---

export async function addMessage(
  sessionId: string,
  role: MessageRole,
  content: string,
  metadata?: Record<string, unknown>
): Promise<DeepResearchMessage> {
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(deepResearchMessages).values({
    id,
    sessionId,
    role,
    content,
    metadataJson: toJson(metadata ?? null),
    createdAt: now,
  });

  const eventType: EventType = role === "user" ? "user_message" : "brain_response";
  await appendEvent(sessionId, eventType, undefined, role, undefined, undefined, {
    messageId: id,
  });

  const [row] = await db
    .select()
    .from(deepResearchMessages)
    .where(eq(deepResearchMessages.id, id));
  return parseMessage(row);
}

export async function getMessages(sessionId: string): Promise<DeepResearchMessage[]> {
  const rows = await db
    .select()
    .from(deepResearchMessages)
    .where(eq(deepResearchMessages.sessionId, sessionId))
    .orderBy(deepResearchMessages.createdAt);
  return rows.map(parseMessage);
}

// --- Nodes ---

export async function createNode(
  sessionId: string,
  spec: NodeCreationSpec
): Promise<DeepResearchNode> {
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(deepResearchNodes).values({
    id,
    sessionId,
    parentId: spec.parentId ?? null,
    nodeType: spec.nodeType,
    label: spec.label,
    status: "pending",
    assignedRole: spec.assignedRole,
    inputJson: toJson(spec.input ?? null),
    dependsOnJson: toJson(spec.dependsOn ?? []),
    branchKey: spec.branchKey ?? null,
    retryCount: 0,
    requiresConfirmation: true,
    createdAt: now,
    updatedAt: now,
  });

  await appendEvent(sessionId, "node_created", id, "system", undefined, undefined, {
    nodeType: spec.nodeType,
    label: spec.label,
    role: spec.assignedRole,
  });

  const [row] = await db
    .select()
    .from(deepResearchNodes)
    .where(eq(deepResearchNodes.id, id));
  return parseNode(row);
}

export async function updateNode(
  nodeId: string,
  updates: Partial<{
    status: NodeStatus;
    assignedModel: string;
    output: Record<string, unknown>;
    error: string | null;
    supersededById: string;
    startedAt: string;
    completedAt: string;
    positionX: number;
    positionY: number;
    confirmedAt: string;
    confirmedBy: string;
    confirmationOutcome: ConfirmationOutcome;
  }>
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.assignedModel !== undefined) dbUpdates.assignedModel = updates.assignedModel;
  if (updates.output !== undefined) dbUpdates.outputJson = toJson(updates.output);
  if (updates.error !== undefined) dbUpdates.error = updates.error;
  if (updates.supersededById !== undefined) dbUpdates.supersededById = updates.supersededById;
  if (updates.startedAt !== undefined) dbUpdates.startedAt = updates.startedAt;
  if (updates.completedAt !== undefined) dbUpdates.completedAt = updates.completedAt;
  if (updates.positionX !== undefined) dbUpdates.positionX = updates.positionX;
  if (updates.positionY !== undefined) dbUpdates.positionY = updates.positionY;
  if (updates.confirmedAt !== undefined) dbUpdates.confirmedAt = updates.confirmedAt;
  if (updates.confirmedBy !== undefined) dbUpdates.confirmedBy = updates.confirmedBy;
  if (updates.confirmationOutcome !== undefined) dbUpdates.confirmationOutcome = updates.confirmationOutcome;

  await db
    .update(deepResearchNodes)
    .set(dbUpdates)
    .where(eq(deepResearchNodes.id, nodeId));

  // Get the node to find sessionId for events
  const [node] = await db
    .select()
    .from(deepResearchNodes)
    .where(eq(deepResearchNodes.id, nodeId));

  if (node && updates.status) {
    const eventMap: Partial<Record<NodeStatus, EventType>> = {
      running: "node_started",
      completed: "node_completed",
      failed: "node_failed",
      awaiting_approval: "approval_requested",
      awaiting_user_confirmation: "confirmation_requested",
    };
    const eventType = eventMap[updates.status];
    if (eventType) {
      await appendEvent(node.sessionId, eventType, nodeId);
    }
  }
}

export async function getNodes(sessionId: string): Promise<DeepResearchNode[]> {
  const rows = await db
    .select()
    .from(deepResearchNodes)
    .where(eq(deepResearchNodes.sessionId, sessionId))
    .orderBy(deepResearchNodes.createdAt);
  return rows.map(parseNode);
}

export async function getReadyNodes(sessionId: string): Promise<DeepResearchNode[]> {
  const allNodes = await getNodes(sessionId);
  const doneStatuses = new Set(["completed", "awaiting_user_confirmation"]);
  const doneIds = new Set(
    allNodes.filter((n) => doneStatuses.has(n.status)).map((n) => n.id)
  );
  return allNodes.filter(
    (n) =>
      n.status === "pending" &&
      n.dependsOn.every((depId) => doneIds.has(depId))
  );
}

// --- Artifacts ---

export async function createArtifact(
  sessionId: string,
  nodeId: string | null,
  type: ArtifactType,
  title: string,
  content: Record<string, unknown>,
  provenance?: ArtifactProvenance
): Promise<DeepResearchArtifact> {
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(deepResearchArtifacts).values({
    id,
    sessionId,
    nodeId,
    artifactType: type,
    title,
    contentJson: JSON.stringify(content),
    provenanceJson: toJson(provenance ?? null),
    version: 1,
    createdAt: now,
  });

  await appendEvent(sessionId, "artifact_created", nodeId ?? undefined, undefined, undefined, undefined, {
    artifactId: id,
    artifactType: type,
    title,
  });

  const [row] = await db
    .select()
    .from(deepResearchArtifacts)
    .where(eq(deepResearchArtifacts.id, id));
  return parseArtifact(row);
}

/**
 * Create a checkpoint artifact and link it to the session.
 */
export async function createCheckpoint(
  sessionId: string,
  nodeId: string,
  checkpoint: CheckpointPackage
): Promise<DeepResearchArtifact> {
  const artifact = await createArtifact(
    sessionId,
    nodeId,
    "checkpoint",
    checkpoint.title,
    checkpoint as unknown as Record<string, unknown>
  );

  await appendEvent(sessionId, "checkpoint_created", nodeId, "system", undefined, undefined, {
    checkpointId: artifact.id,
    stepType: checkpoint.stepType,
  });

  return artifact;
}

export async function getArtifacts(
  sessionId: string,
  filters?: { nodeId?: string; type?: ArtifactType }
): Promise<DeepResearchArtifact[]> {
  const query = db
    .select()
    .from(deepResearchArtifacts)
    .where(eq(deepResearchArtifacts.sessionId, sessionId));

  const rows = await query.orderBy(deepResearchArtifacts.createdAt);

  let result = rows.map(parseArtifact);
  if (filters?.nodeId) {
    result = result.filter((a) => a.nodeId === filters.nodeId);
  }
  if (filters?.type) {
    result = result.filter((a) => a.artifactType === filters.type);
  }
  return result;
}

export async function getArtifact(artifactId: string): Promise<DeepResearchArtifact | null> {
  const [row] = await db
    .select()
    .from(deepResearchArtifacts)
    .where(eq(deepResearchArtifacts.id, artifactId));
  return row ? parseArtifact(row) : null;
}

/**
 * Get the latest checkpoint artifact for a session.
 */
export async function getLatestCheckpoint(sessionId: string): Promise<DeepResearchArtifact | null> {
  const checkpoints = await getArtifacts(sessionId, { type: "checkpoint" });
  return checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
}

// --- Events ---

export async function appendEvent(
  sessionId: string,
  type: EventType,
  nodeId?: string,
  actorType?: string,
  actorId?: string,
  model?: string,
  payload?: Record<string, unknown>
): Promise<void> {
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(deepResearchEvents).values({
    id,
    sessionId,
    eventType: type,
    nodeId: nodeId ?? null,
    actorType: actorType ?? null,
    actorId: actorId ?? null,
    model: model ?? null,
    payloadJson: toJson(payload ?? null),
    createdAt: now,
  });
}

export async function getEvents(
  sessionId: string,
  since?: string
): Promise<DeepResearchEvent[]> {
  if (since) {
    const rows = await db
      .select()
      .from(deepResearchEvents)
      .where(
        and(
          eq(deepResearchEvents.sessionId, sessionId),
          gt(deepResearchEvents.createdAt, since)
        )
      )
      .orderBy(deepResearchEvents.createdAt);
    return rows.map(parseEvent);
  }

  const rows = await db
    .select()
    .from(deepResearchEvents)
    .where(eq(deepResearchEvents.sessionId, sessionId))
    .orderBy(deepResearchEvents.createdAt);
  return rows.map(parseEvent);
}
