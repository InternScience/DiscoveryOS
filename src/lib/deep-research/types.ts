// =============================================================
// Deep Research — Type Definitions
// =============================================================

// --- Enums as union types ---

/** Valid transitions:
 * intake → running → paused | awaiting_approval | awaiting_user_confirmation | reviewing | awaiting_resource | completed | failed
 * paused → running
 * awaiting_approval → running
 * awaiting_user_confirmation → running | cancelled
 * reviewing → running | awaiting_user_confirmation
 * awaiting_resource → running | failed
 * failed → running (retry)
 */
export type SessionStatus =
  | "intake"
  | "planning"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "awaiting_user_confirmation"
  | "awaiting_resource"
  | "reviewing"
  | "planning_in_progress"
  | "literature_in_progress"
  | "literature_blocked"
  | "awaiting_additional_literature"
  | "validation_planning_in_progress"
  | "execution_prepared"
  | "execution_in_progress"
  | "final_report_generated"
  | "completed"
  | "stopped_by_user"
  | "failed"
  | "cancelled";

export type ContextTag =
  | "intake"
  | "planning"
  | "final_report";

export const VALID_CONTEXT_TAGS: readonly ContextTag[] = [
  "intake",
  "planning",
  "final_report",
];

export type NodeType =
  | "intake"
  | "plan"
  | "evidence_gather"
  | "evidence_extract"
  | "summarize"
  | "synthesize"
  | "review"
  | "audit"
  | "validation_plan"
  | "resource_request"
  | "execute"
  | "monitor"
  | "result_collect"
  | "result_compare"
  | "approve"
  | "final_report"
  | "retrieve"
  | "synthesize_claims"
  | "data_download"
  | "preprocess"
  | "skill_route";

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
  | "researcher"
  | "literature_intelligence_analyst"
  | "experiment_architecture_designer"
  | "research_software_engineer"
  | "experiment_operations_engineer"
  | "results_and_evidence_analyst"
  | "research_asset_reuse_specialist"
  | "worker"
  | "synthesizer";

export type StructuredRoleCategory = "main_brain" | "meta_worker";

export type StructuredPromptKind =
  | "system"
  | "task_intake"
  | "progress_update"
  | "handoff"
  | "escalation"
  | "completion";

export type StructuredSkillKind =
  | "literature_analysis"
  | "experiment_design"
  | "code_implementation"
  | "experiment_execution"
  | "result_analysis"
  | "artifact_packaging"
  | "coordination";

export interface StructuredRolePrompt {
  kind: StructuredPromptKind;
  title: string;
  objective: string;
  requiredSections: string[];
  constraints: string[];
}

export interface StructuredRoleSkill {
  id: string;
  kind: StructuredSkillKind;
  name: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  qualityChecks: string[];
}

export interface StructuredRoleCollaboration {
  partnerRoleId: ModelRole;
  collaborationType: "delegation" | "handoff" | "review" | "feedback" | "escalation" | "reuse";
  trigger: string;
  payload: string[];
  expectedResponse: string[];
}

export interface StructuredRoleDefinition {
  roleId: ModelRole;
  category: StructuredRoleCategory;
  roleName: string;
  workflowSegment: string;
  defaultNodeType: NodeType;
  defaultContextTag: ContextTag;
  summaryArtifactType: ArtifactType;
  corePositioning: string;
  coreResponsibilities: string[];
  skillRequirements: string[];
  collaborationRequirements: string[];
  performanceStandards: string[];
  prompts: StructuredRolePrompt[];
  skills: StructuredRoleSkill[];
  collaborations: StructuredRoleCollaboration[];
}

export interface StructuredCommunicationProtocol {
  id: string;
  fromRoleId: ModelRole;
  toRoleId: ModelRole;
  goal: string;
  trigger: string;
  requiredPayload: string[];
  responseContract: string[];
  escalationPath: string;
}

export interface StructuredTaskAssignment {
  roleId: ModelRole;
  roleName: string;
  workflowSegment: string;
  objective: string;
  deliverables: string[];
  dependencies: ModelRole[];
  status: "planned" | "in_progress" | "blocked" | "completed";
}

export interface StructuredTaskBoard {
  objective: string;
  coordinatorRoleId: ModelRole;
  assignments: StructuredTaskAssignment[];
  milestones: string[];
  completionCriteria: string[];
}

export interface StructuredHandoffPacket {
  type: "handoff" | "progress_update" | "escalation";
  fromRoleId: ModelRole;
  toRoleId: ModelRole;
  goal: string;
  payload: string[];
  expectedResponse: string[];
  status: "drafted" | "shared" | "acknowledged";
}

export type ArtifactType =
  | "research_brief"
  | "task_graph"
  | "evidence_card"
  | "literature_round_summary"
  | "structured_summary"
  | "reviewer_packet"
  | "review_assessment"
  | "main_brain_audit"
  | "provisional_conclusion"
  | "validation_plan"
  | "execution_manifest"
  | "execution_plan"
  | "step_result"
  | "experiment_result"
  | "validation_report"
  | "final_report"
  | "checkpoint"
  | "evidence_card_collection"
  | "claim_map"
  | "memory_profile"
  | "memory_snapshot"
  | "memory_index"
  | "data_manifest";

export type EventType =
  | "session_created"
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
  | "user_approved_remote_submission"
  | "literature_round_started"
  | "literature_round_completed"
  | "review_started"
  | "review_completed"
  | "execution_submitted"
  | "execution_completed"
  | "resource_requested"
  | "resource_acquired"
  | "requirement_changed"
  | "nodes_superseded"
  | "consistency_check"
  | "skill_routing_completed"
  | "synthesis_completed"
  | "execution_plan_created"
  | "data_download_completed";

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
  contextTag: ContextTag;
  config: DeepResearchConfig;
  budget: BudgetUsage;
  /** ID of the latest checkpoint artifact when status is awaiting_user_confirmation. */
  pendingCheckpointId: string | null;
  /** Current literature round number (0 = not started). */
  literatureRound: number;
  /** Current review round number (0 = not started). */
  reviewerRound: number;
  /** Current execution loop number (0 = not started). */
  executionLoop: number;
  error: string | null;
  /** ID of the bound remote execution profile (from research-exec module). */
  remoteProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeepResearchMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  /** Which node produced or relates to this message. */
  relatedNodeId: string | null;
  /** Which artifacts this message references. */
  relatedArtifactIds: string[];
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
  /** Which context tag spawned this node. */
  contextTag: ContextTag;
  /** Legacy compatibility field; workflow routing no longer depends on stage numbering. */
  stageNumber: number;
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
  /** The model resolved from settings at session creation time. */
  resolvedModel?: { provider: string; modelId: string };
  /** Keep the UI shell but disable the current orchestration/runtime. */
  interfaceOnly?: boolean;
  budget: BudgetLimits;
  /** Max number of worker nodes created per fan-out. */
  maxWorkerFanOut: number;
  /** Max review rounds before forcing advancement. */
  maxReviewerRounds: number;
  /** Max execution retry loops before forcing final report. */
  maxExecutionLoops: number;
  /** Max concurrent worker node executions. */
  maxWorkerConcurrency: number;
  /** Literature collection controls. */
  literature: LiteratureConfig;
  /** Execution controls. */
  execution: ExecutionConfig;
  /** Optional: enable dynamic skill routing. */
  skillRouting?: { enabled: boolean };
}

export interface LiteratureConfig {
  /** Max number of literature collection rounds (including reviewer-requested). */
  maxLiteratureRounds: number;
  /** Max papers per single literature round. */
  maxPapersPerRound: number;
  /** Max total papers across all rounds. */
  maxTotalPapers: number;
  /** Max rounds triggered by reviewer requests for more literature. */
  maxReviewerRequestedExpansionRounds: number;
  /** Max retries for failed searches within a single round. */
  maxSearchRetries: number;
}

export interface ExecutionConfig {
  /** Default launcher type for execution. */
  defaultLauncherType: LauncherType;
  /** Default resource profiles for rlaunch/rjob. */
  defaultResources: ResourceProfile;
  /** Default mounts for rlaunch/rjob. */
  defaultMounts: MountSpec[];
  /** Default charged group for resource allocation. */
  defaultChargedGroup: string;
}

// --- Budget ---

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

/** Final review assessment from the Results and Evidence Analyst. */
export interface ReviewAssessment {
  reviewerRole?: "results_and_evidence_analyst";
  reviewerSummary?: string;
  reviewHighlights?: string[];
  openIssues?: string[];
  reviewRounds?: number;
  combinedVerdict: "approve" | "revise" | "reject";
  combinedConfidence: number;
  /** What would reduce uncertainty. */
  uncertaintyReducers: string[];
  /** Whether reviewers recommend more literature. */
  needsMoreLiterature: boolean;
  /** Specific literature gaps identified. */
  literatureGaps: string[];
  /** Whether reviewers recommend experimental validation. */
  needsExperimentalValidation: boolean;
  /** Suggested experiments from reviewers. */
  suggestedExperiments: string[];
}

/** Main brain's audit/opinion on a stage result, shown at every checkpoint. */
export interface MainBrainAudit {
  /** What was completed in this stage. */
  whatWasCompleted: string;
  /** Whether the main brain thinks the result is correct/good. */
  resultAssessment: "good" | "acceptable" | "concerning" | "problematic";
  /** Specific issues or risks the main brain sees. */
  issuesAndRisks: string[];
  /** What the main brain recommends as the next action. */
  recommendedNextAction: string;
  /** What "Continue" will do if the user clicks it. */
  continueWillDo: string;
  /** Alternative actions the user could take. */
  alternativeActions: AlternativeAction[];
  /** Whether the main brain has sufficient confidence to proceed. */
  canProceed: boolean;
}

export interface AlternativeAction {
  label: string;
  description: string;
  /** Maps to a ConfirmationOutcome or custom action. */
  actionType: "continue" | "revise" | "retry" | "more_literature" | "fix_code" | "change_params" | "more_resources" | "stop";
}


// --- Execution / Resource Acquisition ---

export type LauncherType = "rlaunch" | "rjob" | "slurm" | "local_shell" | "ssh";

export interface MountSpec {
  source: string;
  target: string;
}

export interface ResourceProfile {
  gpu: number;
  memoryMb: number;
  cpu: number;
  privateMachine: "yes" | "no" | "group";
  maxWaitDuration?: string;
}

// --- Brain Decisions ---

export interface BrainDecision {
  action: "advance_context" | "revise_plan" | "request_approval" | "complete" | "respond_to_user";
  nextContextTag?: ContextTag;
  nodesToCreate?: NodeCreationSpec[];
  messageToUser?: string;
  reasoning?: string;
}

export type CheckpointInteractionMode = "confirmation" | "answer_required";

export interface NodeCreationSpec {
  nodeType: NodeType;
  label: string;
  assignedRole: ModelRole;
  input?: Record<string, unknown>;
  dependsOn?: string[];
  parentId?: string;
  branchKey?: string;
  contextTag?: ContextTag;
}

// --- Checkpoint Package ---

export interface CheckpointPackage {
  checkpointId: string;
  sessionId: string;
  nodeId: string;
  stepType: string;
  contextTag: ContextTag;
  title: string;
  humanSummary: string;
  machineSummary: string;
  /** Main brain's audit/opinion on this stage result. */
  mainBrainAudit: MainBrainAudit;
  artifactsToReview: string[];
  currentFindings: string;
  openQuestions: string[];
  recommendedNextAction: string;
  recommendedWorker?: {
    roleId: ModelRole;
    roleName: string;
    nodeType: NodeType;
    label: string;
  };
  promptUsed?: {
    title: string;
    kind: StructuredPromptKind;
    objective: string;
  };
  /** What clicking "Continue" will actually do. */
  continueWillDo: string;
  alternativeNextActions: string[];
  requiresUserConfirmation: boolean;
  interactionMode?: CheckpointInteractionMode;
  isFinalStep?: boolean;
  /** Computed transition action from TransitionResolver. */
  transitionAction?: TransitionAction;
  /** Literature round info if relevant. */
  literatureRoundInfo?: {
    roundNumber: number;
    papersCollected: number;
    retrievalTaskCount: number;
    successfulTaskCount: number;
    failedTaskCount: number;
    emptyTaskCount: number;
    coverageSummary: string;
  };
  /** Review assessment info if relevant. */
  reviewInfo?: ReviewAssessment;
  /** Validation/execution info if relevant. */
  executionInfo?: {
    stepsCompleted: number;
    stepsTotal: number;
    currentStatus: string;
  };
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
  nextContextTag?: ContextTag;
  messageToUser?: string;
}

// --- Default Config ---

export const DEFAULT_LITERATURE_CONFIG: LiteratureConfig = {
  maxLiteratureRounds: 3,
  maxPapersPerRound: 10,
  maxTotalPapers: 30,
  maxReviewerRequestedExpansionRounds: 1,
  maxSearchRetries: 2,
};

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  defaultLauncherType: "rjob",
  defaultResources: {
    gpu: 2,
    memoryMb: 200000,
    cpu: 32,
    privateMachine: "yes",
  },
  defaultMounts: [
    { source: "gpfs://gpfs1/suencheng", target: "/mnt/shared-storage-user/suencheng" },
    { source: "gpfs://gpfs1/ai4sreason", target: "/mnt/shared-storage-user/ai4sreason" },
  ],
  defaultChargedGroup: "ai4sdata_gpu",
};

export const DEFAULT_CONFIG: DeepResearchConfig = {
  interfaceOnly: false,
  budget: {
    maxTotalTokens: 2_000_000,
    maxOpusTokens: 500_000,
  },
  maxWorkerFanOut: 1,
  maxReviewerRounds: 2,
  maxExecutionLoops: 3,
  maxWorkerConcurrency: 1,
  literature: DEFAULT_LITERATURE_CONFIG,
  execution: DEFAULT_EXECUTION_CONFIG,
};

export function createEmptyUsage(): BudgetUsage {
  return { totalTokens: 0, opusTokens: 0, byRole: {}, byNode: {} };
}

// =============================================================
// RequirementState & ConstraintState
// =============================================================

export type RequirementStatus = "active" | "satisfied" | "dropped";
export type ConstraintType = "budget" | "time" | "scope" | "method" | "resource";
export type ConstraintStatus = "active" | "relaxed" | "violated";

export interface Requirement {
  id: string;
  text: string;
  source: string;
  priority: "critical" | "high" | "medium" | "low";
  status: RequirementStatus;
  satisfiedByNodeIds: string[];
  addedAtContextTag: ContextTag;
}

export interface Constraint {
  id: string;
  text: string;
  type: ConstraintType;
  value: string;
  status: ConstraintStatus;
  addedAtContextTag: ContextTag;
}

export interface RequirementState {
  requirements: Requirement[];
  constraints: Constraint[];
  version: number;
  lastModifiedAt: string;
  lastModifiedBy: string;
  /** Original user goal text (never changes). */
  originalUserGoal: string;
  /** Currently approved goal (may differ from original after user feedback). */
  currentApprovedGoal: string;
  /** Latest user instruction/feedback text. */
  latestUserInstruction: string | null;
  /** Approved research scope description. */
  approvedResearchScope: string | null;
  /** Approved experiment scope description. */
  approvedExperimentScope: string | null;
  /** Whether execution is explicitly allowed. */
  executionAllowed: boolean;
  /** Main brain's latest accepted interpretation of user goal. */
  latestMainBrainAcceptedInterpretation: string | null;
  /** Version this state supersedes. */
  supersedesVersion: number | null;
}

export interface RequirementDiff {
  added: Requirement[];
  removed: Requirement[];
  modified: Array<{ id: string; field: string; oldValue: unknown; newValue: unknown }>;
  constraintsChanged: boolean;
}

// =============================================================
// TransitionAction
// =============================================================

export interface TransitionAction {
  nextContextTag: ContextTag;
  nodesToCreate: NodeCreationSpec[];
  nodesToSupersede: string[];
  description: string;
}

// =============================================================
// Execution Records
// =============================================================

export type ExecutionRecordType = "rlaunch" | "rjob" | "local";
export type ExecutionRecordStatus = "pending" | "submitted" | "running" | "completed" | "failed" | "cancelled";

export interface PersistedExecutionRecord {
  id: string;
  sessionId: string;
  nodeId: string;
  recordType: ExecutionRecordType;
  status: ExecutionRecordStatus;
  remoteJobId: string | null;
  remoteHost: string | null;
  command: string;
  configJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// =============================================================
// DAG Validation
// =============================================================

export type DAGErrorType = "cycle" | "orphan" | "dangling" | "duplicate";

export interface DAGError {
  type: DAGErrorType;
  nodeIds: string[];
  message: string;
}

export interface DAGValidationResult {
  valid: boolean;
  errors: DAGError[];
}

// =============================================================
// Consistency Check
// =============================================================

export interface ConsistencyReport {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

// =============================================================
// Language State
// =============================================================

export interface LanguageState {
  /** Detected language of latest user message (e.g., "zh", "en", "ja"). */
  currentUserLanguage: string;
  /** Preferred output language for user-facing content. */
  preferredOutputLanguage: string;
  /** Last detected language before any override. */
  lastDetectedUserLanguage: string;
  /** When the language state was last updated. */
  lastLanguageUpdateAt: string;
}

// =============================================================
// Evidence Sufficiency
// =============================================================

export type EvidenceRetrievalStatus =
  | "success"
  | "partial"
  | "failed_retrieval"
  | "insufficient_evidence"
  | "empty";

export interface EvidenceSufficiencyReport {
  /** Overall sufficiency assessment. */
  sufficient: boolean;
  /** Per-stream status. */
  streams: Array<{
    nodeId: string;
    label: string;
    status: EvidenceRetrievalStatus;
    sourcesFound: number;
    failureReason?: string;
  }>;
  /** Total unique sources across all streams. */
  totalSources: number;
  /** Streams that failed or returned empty. */
  failedStreams: number;
  /** Whether synthesis should proceed (requires at least some evidence). */
  canSynthesize: boolean;
  /** Missing topics that need re-retrieval. */
  missingTopics: string[];
}

// =============================================================
// Evidence Cards — Structured evidence format
// =============================================================

export interface RawExcerpt {
  text: string;
  sourceIndex: number;
  page?: string;
  section?: string;
}

export interface SourceEntry {
  title: string;
  url: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  retrievalMethod: string;
  retrievedAt: string;
}

export interface EvidenceCard {
  id: string;
  query: string;
  sources: SourceEntry[];
  rawExcerpts: RawExcerpt[];
  retrievalStatus: EvidenceRetrievalStatus;
  /** Number of sources successfully retrieved. */
  sourcesFound: number;
  /** Total sources attempted. */
  sourcesAttempted: number;
  /** Free-text notes about retrieval quality. */
  retrievalNotes: string;
  createdAt: string;
}

export interface EvidenceCardCollection {
  cards: EvidenceCard[];
  totalSources: number;
  totalExcerpts: number;
  retrievalSummary: {
    successful: number;
    partial: number;
    failed: number;
    empty: number;
  };
}

// =============================================================
// Claim Map — Synthesizer output
// =============================================================

export type ClaimStrength = "strong" | "moderate" | "weak" | "unsupported";

export interface Claim {
  id: string;
  text: string;
  strength: ClaimStrength;
  supportingSources: number[];
  contradictingSources: number[];
  category: string;
  /** Distinguish what kind of knowledge this claim is. */
  knowledgeType: "retrieved_evidence" | "background_knowledge" | "assumption" | "speculation";
}

export interface Contradiction {
  claimAId: string;
  claimBId: string;
  description: string;
  possibleResolution: string;
}

export interface GapAnalysis {
  topic: string;
  description: string;
  suggestedQueries: string[];
  priority: "high" | "medium" | "low";
}

export interface ClaimMap {
  claims: Claim[];
  supportMatrix: Record<string, number[]>;
  contradictions: Contradiction[];
  gaps: GapAnalysis[];
  confidenceDistribution: Record<ClaimStrength, number>;
}

// =============================================================
// Memory Fabric — Long-running research memory
// =============================================================

export type ResearchMemoryKind = "semantic" | "episodic" | "procedural";

export type ResearchMemoryStatus = "active" | "superseded" | "archived";

export type ResearchMemoryCategory =
  | "user_goal"
  | "constraint"
  | "evidence"
  | "claim"
  | "gap"
  | "decision"
  | "execution"
  | "workflow";

export interface ResearchMemoryAnchor {
  artifactId?: string;
  artifactType?: ArtifactType;
  nodeId?: string;
  messageId?: string;
  sourceIndex?: number;
  excerptIndex?: number;
  claimId?: string;
  gapIndex?: number;
  field?: string;
  note?: string;
}

export interface ResearchMemoryItem {
  id: string;
  kind: ResearchMemoryKind;
  category: ResearchMemoryCategory;
  title: string;
  summary: string;
  details?: string;
  tags: string[];
  keywords: string[];
  importance: number;
  confidence: number;
  status: ResearchMemoryStatus;
  createdAt: string;
  updatedAt: string;
  provenance: {
    sourceType: "artifact" | "message" | "event" | "derived";
    artifactId?: string;
    nodeId?: string;
    eventId?: string;
    messageId?: string;
  };
  /** Exact back-pointers into the source-of-truth records for research traceability. */
  anchors?: ResearchMemoryAnchor[];
  relatedMemoryIds?: string[];
}

export interface ResearchMemoryProfile {
  sessionId: string;
  generatedAt: string;
  objective: string;
  currentPhase: ContextTag;
  latestCheckpointTitle?: string;
  latestRecommendedNextAction?: string;
  activeRequirements: string[];
  activeConstraints: string[];
  openQuestions: string[];
  activeHypotheses: string[];
  latestPlanSummary?: string;
  keyDecisions: string[];
}

export interface ResearchMemorySnapshot {
  sessionId: string;
  generatedAt: string;
  title: string;
  summary: string;
  acceptedFacts: string[];
  contestedFacts: string[];
  unresolvedGaps: string[];
  nextStep: string;
  focusAreas: string[];
  relatedArtifactIds: string[];
}

export interface ResearchMemoryIndex {
  sessionId: string;
  generatedAt: string;
  itemCount: number;
  /** Derived retrieval cache built from artifacts/messages, not the source of truth itself. */
  sourceOfTruth: "artifacts_and_messages";
  items: ResearchMemoryItem[];
  stats: {
    semanticCount: number;
    episodicCount: number;
    proceduralCount: number;
    activeCount: number;
  };
}

export interface ResearchMemoryRetrievalResult {
  profile: ResearchMemoryProfile;
  snapshot: ResearchMemorySnapshot | null;
  items: Array<ResearchMemoryItem & { retrievalScore: number }>;
  query: string;
}

