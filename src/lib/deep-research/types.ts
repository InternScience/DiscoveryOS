// =============================================================
// Deep Research — Type Definitions
// =============================================================

// --- Enums as union types ---

export type SessionStatus =
  | "intake"
  | "planning"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "awaiting_user_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type Phase =
  | "intake"
  | "planning"
  | "evidence_collection"
  | "structured_understanding"
  | "reviewer_deliberation"
  | "decision"
  | "execution_planning"
  | "execution"
  | "review_correction"
  | "final_report";

export const PHASE_ORDER: Phase[] = [
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

export type NodeType =
  | "intake"
  | "plan"
  | "evidence_gather"
  | "summarize"
  | "review"
  | "deliberate"
  | "execute"
  | "approve"
  | "synthesize"
  | "final_report";

export type NodeStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval"
  | "awaiting_user_confirmation"
  | "superseded";

export type ModelRole =
  | "main_brain"
  | "reviewer_a"
  | "reviewer_b"
  | "worker";

export type ArtifactType =
  | "research_brief"
  | "task_graph"
  | "evidence_card"
  | "structured_summary"
  | "reviewer_packet"
  | "provisional_conclusion"
  | "execution_plan"
  | "step_result"
  | "validation_report"
  | "final_report"
  | "checkpoint";

export type EventType =
  | "session_created"
  | "phase_changed"
  | "node_created"
  | "node_started"
  | "node_completed"
  | "node_failed"
  | "artifact_created"
  | "user_message"
  | "brain_response"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "session_completed"
  | "session_failed"
  | "checkpoint_created"
  | "confirmation_requested"
  | "user_confirmed"
  | "user_requested_revision"
  | "user_requested_branch"
  | "user_rejected_result"
  | "user_requested_stop"
  | "user_approved_execution"
  | "user_approved_remote_submission";

export type MessageRole = "user" | "main_brain" | "system";

/** How the user responded to a confirmation gate. */
export type ConfirmationOutcome =
  | "confirmed"
  | "revision_requested"
  | "branch_requested"
  | "rejected"
  | "stopped";

// --- Core Interfaces ---

export interface DeepResearchSession {
  id: string;
  workspaceId: string;
  title: string;
  status: SessionStatus;
  phase: Phase;
  config: DeepResearchConfig;
  budget: BudgetUsage;
  /** ID of the latest checkpoint artifact when status is awaiting_user_confirmation. */
  pendingCheckpointId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeepResearchMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeepResearchNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  nodeType: NodeType;
  label: string;
  status: NodeStatus;
  assignedRole: ModelRole;
  assignedModel: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  dependsOn: string[];
  supersedesId: string | null;
  supersededById: string | null;
  branchKey: string | null;
  retryOfId: string | null;
  retryCount: number;
  /** Whether this node requires user confirmation after completion. */
  requiresConfirmation: boolean;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmationOutcome: ConfirmationOutcome | null;
  positionX: number | null;
  positionY: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeepResearchArtifact {
  id: string;
  sessionId: string;
  nodeId: string | null;
  artifactType: ArtifactType;
  title: string;
  content: Record<string, unknown>;
  provenance: ArtifactProvenance | null;
  version: number;
  createdAt: string;
}

export interface DeepResearchEvent {
  id: string;
  sessionId: string;
  eventType: EventType;
  nodeId: string | null;
  actorType: string | null;
  actorId: string | null;
  model: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

// --- Configuration ---

export interface DeepResearchConfig {
  modelOverrides?: Partial<Record<ModelRole, { provider: string; modelId: string }>>;
  budget: BudgetLimits;
  maxWorkerFanOut: number;
  maxReviewerRounds: number;
  maxExecutionLoops: number;
  maxWorkerConcurrency: number;
}

export interface BudgetLimits {
  maxTotalTokens: number;
  maxOpusTokens: number;
}

export interface BudgetUsage {
  totalTokens: number;
  opusTokens: number;
  byRole: Partial<Record<ModelRole, number>>;
  byNode: Record<string, number>;
}

// --- Artifact & Review ---

export interface ArtifactProvenance {
  sourceNodeId: string;
  sourceArtifactIds: string[];
  model: string;
  generatedAt: string;
}

export interface ReviewerPacket {
  reviewerRole: "reviewer_a" | "reviewer_b";
  verdict: "approve" | "revise" | "reject";
  critique: string;
  suggestions: string[];
  confidence: number;
}

export interface BrainDecision {
  action: "advance_phase" | "revise_plan" | "request_approval" | "complete" | "respond_to_user";
  nextPhase?: Phase;
  nodesToCreate?: NodeCreationSpec[];
  messageToUser?: string;
  reasoning?: string;
}

export interface NodeCreationSpec {
  nodeType: NodeType;
  label: string;
  assignedRole: ModelRole;
  input?: Record<string, unknown>;
  dependsOn?: string[];
  parentId?: string;
  branchKey?: string;
}

// --- Checkpoint Package ---

export interface CheckpointPackage {
  checkpointId: string;
  sessionId: string;
  nodeId: string;
  stepType: string;
  phase: Phase;
  title: string;
  humanSummary: string;
  machineSummary: string;
  artifactsToReview: string[];
  currentFindings: string;
  openQuestions: string[];
  recommendedNextAction: string;
  alternativeNextActions: string[];
  requiresUserConfirmation: boolean;
  isFinalStep?: boolean;
  createdAt: string;
}

/** What the main brain decides after reading user confirmation feedback. */
export type ConfirmationAction =
  | "continue"
  | "revise"
  | "retry"
  | "branch"
  | "supersede"
  | "stop";

export interface ConfirmationDecision {
  action: ConfirmationAction;
  reasoning: string;
  nodesToCreate?: NodeCreationSpec[];
  nextPhase?: Phase;
  messageToUser?: string;
}
