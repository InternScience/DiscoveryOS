# Research Proposal: Towards Fully Autonomous AI Research Loops — Closing the Gap Between Hypothesis Generation and Experiment Execution in InnoClaw

## Abstract

Modern AI research demands rapid iteration cycles: formulating hypotheses from literature, designing experiments, executing training runs, analyzing results, and feeding insights back into the next round of exploration. While individual stages of this pipeline have seen significant tooling advances, the end-to-end loop remains largely manual — researchers must bridge the gap between paper analysis, experiment design, code modification, job submission, result interpretation, and the subsequent ideation of new directions.

**InnoClaw** is an open-source, self-hostable AI research assistant platform that has already implemented three powerful but currently disconnected automation engines: (1) a multi-agent Paper Research Engine for literature analysis and hypothesis generation, (2) a 13-stage Research Execution Engine for experiment orchestration with human-in-the-loop approval gates, and (3) a domain-specific Skills Engine with 206+ scientific computing workflows. This proposal presents a roadmap to close the loop between these engines, evolving InnoClaw from a collection of semi-automated tools into a fully autonomous research iteration platform capable of conducting multi-round "hypothesize → train → analyze → re-hypothesize" cycles with minimal human intervention.

We identify three development phases: (Phase 1) establishing inter-engine bridges and experiment lineage tracking, (Phase 2) implementing a Loop Orchestrator with intelligent approval policies and failure recovery, and (Phase 3) advancing toward autonomous research decision-making with multi-objective optimization, automated ablation planning, and cross-paper knowledge graphs. Together, these phases chart a path from today's "broken chain" to tomorrow's closed-loop AI research assistant.

---

## 1. Introduction and Motivation

### 1.1 The Bottleneck: Manual Iteration in AI Research

A typical AI research iteration cycle involves the following steps:

1. **Literature Review** — Identify relevant prior work, understand state-of-the-art methods and their limitations.
2. **Hypothesis Formulation** — Generate testable research questions grounded in identified gaps.
3. **Experiment Design** — Translate hypotheses into concrete experimental protocols with baselines, metrics, and ablations.
4. **Code Implementation** — Modify model architectures, training scripts, or configuration files.
5. **Job Submission** — Deploy training jobs on HPC clusters (SLURM), containerized environments (rjob), or cloud infrastructure.
6. **Monitoring** — Track job status, detect failures, and ensure resource utilization.
7. **Result Collection & Analysis** — Gather outputs, extract metrics, identify trends, and diagnose failures.
8. **Next-Step Planning** — Decide whether to adjust hyperparameters, modify code, run ablations, change direction, or declare success.

In practice, the transitions between these steps are almost entirely manual. A researcher must copy findings from a paper discussion into an experiment plan, translate an experiment design into code changes, monitor job dashboards, interpret log files, and decide what to try next. Each handoff introduces latency, cognitive overhead, and the risk of lost context.

### 1.2 The Opportunity: Multi-Agent Orchestration

Recent advances in large language models (LLMs) and multi-agent frameworks have demonstrated that AI systems can effectively:

- **Analyze** scientific papers with nuance and evidence grounding (e.g., structured multi-role discussions).
- **Generate** novel research hypotheses with feasibility assessments.
- **Write and modify** code with awareness of project structure.
- **Execute** shell commands, SSH operations, and job submissions.
- **Interpret** experimental outputs and recommend next steps.

The challenge is no longer whether each individual step can be automated, but how to orchestrate these capabilities into a coherent, self-improving loop.

### 1.3 InnoClaw: Current State

InnoClaw has already built substantial infrastructure across the research automation spectrum. The platform is implemented as a full-stack application (Next.js 16, React 19, TypeScript, SQLite/Drizzle, Vercel AI SDK 6) supporting multiple LLM providers (OpenAI, Anthropic, Google, DeepSeek, Qwen, and others). Its three core engines — Paper Research, Experiment Execution, and Domain Skills — collectively cover the entire research lifecycle, but currently operate as isolated subsystems with manual handoffs between them.

---

## 2. Current System Architecture

### 2.1 Engine I: Paper Research Engine — "From Literature to Hypothesis"

The Paper Research Engine automates the first three steps of the research cycle: literature discovery, structured analysis, and hypothesis generation.

#### 2.1.1 Multi-Source Article Search

The system queries three complementary academic sources in parallel:

| Source | Query Type | Strength | Rate Limiting |
|--------|-----------|----------|---------------|
| **arXiv** | Keyword-based (Atom API) | Comprehensive preprint coverage | 3-second inter-request delay |
| **HuggingFace Daily Papers** | Trend-based filtering | Latest ML community papers | 15-second timeout with retry |
| **Semantic Scholar** | Semantic-ranked (Graph API) | Cross-publisher relevance ranking | Exponential backoff on 429/5xx |

Results are unified into a common `Article` interface and cached with a 15-minute TTL to avoid redundant API calls. An optional LLM-powered query expansion endpoint transforms natural language research questions into structured keyword queries.

#### 2.1.2 Multi-Agent Paper Discussion (6 Stages, 5 Roles)

A rigorous, evidence-grounded analysis framework executes through six sequential stages:

```
Stage 1: AGENDA          → Moderator frames the discussion scope
Stage 2: EVIDENCE_SUMMARY → Librarian extracts claims with specific citations
Stage 3: CRITIQUE         → Skeptic stress-tests methodology (Critical/Moderate/Minor)
Stage 4: REPRODUCIBILITY   → Reproducer assesses reproduction feasibility
Stage 5: CONVERGENCE      → Moderator synthesizes agreement and disagreement
Stage 6: FINAL_REPORT     → Scribe produces structured 7-section report
```

**Design principles:**
- Every claim must reference provided evidence; fabrication is explicitly forbidden.
- Speculative inferences are labeled as such.
- Adaptive token budgets: Quick mode (1000–4000 tokens/stage) for rapid triage; Full mode (1500–8000 tokens/stage) for comprehensive analysis.
- Streaming NDJSON output enables real-time progressive disclosure in the frontend.
- Per-stage retry (max 3 attempts) ensures resilience without blocking the pipeline.

**Output:** A structured report covering key claims, strengths, weaknesses, reproducibility status, open questions, and recommended next actions — saved to workspace notes.

#### 2.1.3 Multi-Agent Research Ideation (5 Stages, 5 Roles)

Building on the discussion output, the ideation pipeline generates actionable new research directions:

```
Stage 1: HYPOTHESIS_GENERATION → Ideator produces 3–5 novel, testable hypotheses
Stage 2: FEASIBILITY_REVIEW    → Feasibility Checker assesses data/compute/timeline/risk
Stage 3: EXPERIMENT_DESIGN     → Experimentalist designs protocols with MVE (Minimum Viable Experiment)
Stage 4: REVIEW                → Reviewer checks logic, ethics, statistics, baselines
Stage 5: FINAL_REPORT          → Scribe synthesizes into structured ideation report
```

**Key innovation:** The Experimentalist role produces concrete **Minimum Viable Experiments (MVEs)** — experiment designs achievable in 1–2 weeks with modest resources, including specific datasets, baselines, metrics, expected outcomes, and step-by-step protocols. This specificity is critical for bridging to the Experiment Execution Engine.

**Output:** Structured ideation report with hypotheses, feasibility ratings, experiment plans, review findings, and recommended actions.

### 2.2 Engine II: Research Execution Engine — "From Code to Results"

The Research Execution Engine manages the middle stages of the cycle: code modification, remote deployment, job management, and result analysis.

#### 2.2.1 The 13-Stage Workflow Pipeline

| # | Stage | Agent Role | Approval | Description |
|---|-------|-----------|----------|-------------|
| 1 | `inspect` | Repo Agent | — | Analyze codebase: entrypoints, configs, output dirs |
| 2 | `propose_patch` | Patch Agent | — | Design minimal code/config changes |
| 3 | `approve_patch` | Patch Agent | **Gate** | User reviews proposed patch |
| 4 | `apply_patch` | Patch Agent | — | Apply changes to local workspace |
| 5 | `preview_sync` | Remote Agent | — | Dry-run rsync to remote target |
| 6 | `execute_sync` | Remote Agent | **Gate** | User confirms file synchronization |
| 7 | `prepare_job` | Remote Agent | — | Construct job manifest (SLURM/rjob/shell) |
| 8 | `submit_job` | Remote Agent | **Gate** | User confirms job submission |
| 9 | `monitor_job` | Remote Agent | — | Multi-signal polling until terminal state |
| 10 | `approve_collect` | Remote Agent | **Gate** | User approves result download |
| 11 | `collect_results` | Remote Agent | — | rsync results to local workspace |
| 12 | `analyze_results` | Result Analyst | — | Extract metrics, diagnose outcomes |
| 13 | `recommend_next` | Research Planner | — | Suggest next experiment action |

**Four approval gates** at stages 3, 6, 8, and 10 enforce human oversight for high-impact operations (code changes, remote execution, job submission, data retrieval).

#### 2.2.2 Five Specialized Agent Roles

Each role operates with a focused system prompt, clear output format, and defined tone:

| Role | Color | Responsibility | Key Output |
|------|-------|---------------|------------|
| **Repo Agent** | Blue | Codebase structure analysis | Entrypoints, config files, risky areas |
| **Patch Agent** | Violet | Minimal, reviewable code changes | Patch rationale, expected behavior, risks |
| **Remote Agent** | Amber | SSH operations, sync, job management | Sync plan, manifest, monitoring status |
| **Result Analyst** | Emerald | Output interpretation, metric extraction | Outcome summary, failure diagnosis, confidence |
| **Research Planner** | Pink | Strategic next-step recommendation | Action type, reasoning, alternatives |

#### 2.2.3 Multi-Scheduler Support

The system abstracts three job submission backends:

- **SLURM**: `sbatch --wrap='...'` for HPC clusters; monitoring via `squeue`/`sacct`.
- **rjob**: Container-based with GPU/CPU/memory/image/mount specification; monitoring via `rjob status`/`rjob logs`.
- **Shell**: `nohup bash -c '...' &` for simple remote execution; monitoring via `kill -0 <PID>`.

Cross-scheduler robustness is achieved through multi-signal status inference combining scheduler state, marker files (`DONE`/`FAILED`), heartbeat timestamps, and log tail analysis. When signals conflict, the system flags `needs_attention` rather than guessing.

#### 2.2.4 Job Monitoring Architecture

The monitoring subsystem (`job-monitor.ts`) implements a sophisticated status resolution algorithm:

1. **Batch SSH command** — Collects scheduler state, marker files, heartbeat, and log tail in a single SSH round-trip.
2. **Signal parsing** — Extracts structured data from raw command output.
3. **Multi-signal resolution** — Applies priority rules:
   - Scheduler terminal states (completed/failed/timed_out) are authoritative.
   - Running scheduler state + conflicting markers → `needs_attention`.
   - Unknown scheduler state + present markers → trust markers.
   - Stopped process + no markers → `needs_attention`.
4. **Decision output** — Returns a discriminated union: `still_running | completed | failed | cancelled | unknown`, each with a full `RunStatusSnapshot`.

#### 2.2.5 Capability-Gated Access Control

Eight capability flags (all defaulting to `false`) enforce explicit user opt-in:

```
canReadCodebase          canWriteCodebase
canUseLocalTerminal      canUseSSH
canSyncRemote            canSubmitJobs
canCollectRemoteResults  canAutoApplyChanges
```

Every tool call in the execution pipeline checks capabilities via `requireCapability()` before proceeding, preventing accidental destructive operations.

#### 2.2.6 Data Model

The `experimentRuns` table tracks the full lifecycle:

```
ExperimentRun {
  id, workspaceId, remoteProfileId,
  status: 15 possible states (planning → completed/failed/cancelled/...),
  manifestJson: { entrypoint, command, configOverrides, expectedOutputs, rjobSpec },
  patchSummary, syncSummary, jobId,
  monitoringConfigJson: { heartbeat, marker paths, log paths },
  statusSnapshotJson: { scheduler state, exit code, process alive, log tail, ... },
  resultSummaryJson: { outcome, keyMetrics, logs, observations, failureCause },
  recommendationJson: { nextStep, confidence, reasoning, type, alternatives }
}
```

### 2.3 Engine III: Domain Skills Engine — "Scientific Computing as a Service"

#### 2.3.1 Skills Framework

Skills are parameterized AI agent workflows stored in the database:

```
Skill {
  name, slug (slash command trigger),
  systemPrompt (complete AI instructions),
  steps: SkillStep[] (ordered execution with tool hints),
  allowedTools: string[] (tool whitelist for security),
  parameters: SkillParameter[] (typed user inputs: string/number/boolean/select)
}
```

Execution flow: User request → skill matching → `getSkillInstructions(slug)` → parameter injection (`{{paramName}}` templates) → Python code generation → bash execution → result parsing.

#### 2.3.2 SCP Scientific Skills Catalog

206+ pre-built skills across 8 scientific domains:

| Domain | Count | Examples |
|--------|-------|---------|
| Drug Discovery | 71 | ADMET prediction, molecular docking, target identification |
| Genomics | 41 | Variant analysis, cancer genomics, pathway enrichment |
| Protein Science | 38 | ESMFold, AlphaFold integration, binding site prediction |
| Chemistry | 24 | Molecular fingerprints, QSAR modeling, reaction prediction |
| Physics/Engineering | 18 | Circuit simulation, thermodynamic calculation |
| Experimental Automation | 7 | PubMed search, protocol generation |
| Earth/Environmental | 5 | Atmospheric analysis, oceanography |

Skills connect to remote scientific computing tools via the **MCP (Model Context Protocol)**, authenticated with SCP Hub API keys.

#### 2.3.3 Task Scheduler

A polling-based scheduler (60-second intervals) supports automated recurring tasks:

| Task Type | Handler | Use Case |
|-----------|---------|----------|
| `daily_report` | Auto-generate daily research summaries | Keeping teams informed |
| `weekly_report` | Auto-generate weekly progress reports | Sprint retrospectives |
| `git_sync` | Git pull on workspace | Keeping local repos current |
| `source_sync` | Re-index RAG source chunks | Ensuring search freshness |
| `custom` | Extensible placeholder | Future pipeline triggers |

### 2.4 Supporting Infrastructure

#### 2.4.1 RAG (Retrieval-Augmented Generation) Pipeline

File extraction → text chunking → embedding → vector storage → hybrid retrieval (embedding-based + keyword fallback). Supports PDF, TXT, MD, HTML, JSON, CSV, and 15+ code file formats. MD5-based change detection enables incremental indexing.

#### 2.4.2 Multi-LLM Provider Support

OpenAI (GPT-4o, o3, o4-mini), Anthropic (Claude Opus/Sonnet/Haiku), Google Gemini (2.5 Flash/Pro), and Chinese providers (DeepSeek, Qwen, Moonshot, MiniMax, Zhipu, SH-Lab Intern). Context window management with three overflow strategies (conservative 60%, normal 80%, extended 95%).

#### 2.4.3 Agent Modes

Four operational modes for different research contexts:

- **Agent-Short** (default): 50 max steps, 20 auto-continuations — general-purpose tasks.
- **Agent-Long**: 100 steps, 50 continuations — full 13-stage research pipeline execution.
- **Plan**: Read-only analysis mode for code review and architecture understanding.
- **Ask**: Q&A mode for targeted questions about code and files.

#### 2.4.4 Integration Ecosystem

- **Feishu (Lark) Bot**: WebSocket real-time messaging, agent tool calling from chat.
- **Kubernetes**: Volcano job management, pod/node inspection, log streaming.
- **HuggingFace Datasets**: Dataset discovery and download management.
- **Git Integration**: Repository cloning, pulling, and workspace management.

---

## 3. Gap Analysis: The Broken Chain

Despite the power of each individual engine, InnoClaw currently operates as three disconnected subsystems. The following analysis identifies the critical gaps preventing closed-loop automation.

### 3.1 Gap Map

```
                    CURRENT STATE: "Broken Chain"

 Paper Engine                                    Execution Engine
┌───────────────┐                              ┌──────────────────┐
│ Search Papers  │                              │ Inspect Code     │
│      ↓        │                              │      ↓           │
│ Discuss Paper  │                              │ Propose Patch    │
│      ↓        │                              │      ↓           │
│ Generate Ideas │──── GAP 1: Manual ────────→ │ Apply & Execute  │
│ (MVE Design)  │     Context Transfer         │      ↓           │
└───────────────┘                              │ Monitor & Collect│
                                               │      ↓           │
                         GAP 2: No ←─────────── │ Analyze Results │
                         Feedback Loop          │      ↓           │
                                               │ Recommend Next   │
                                               │      ↓           │
                                               │     STOP ← GAP 3│
                                               └──────────────────┘
```

### 3.2 Detailed Gap Analysis

| Gap ID | Gap Description | Impact | Severity |
|--------|----------------|--------|----------|
| **G1** | **No Ideation→Exec bridge**: MVE designs from the Ideation Engine cannot automatically populate the Execution Engine's ExperimentManifest. Users must manually translate experiment designs into code paths, commands, and configurations. | High iteration latency; context loss during manual translation | **Critical** |
| **G2** | **No Exec→Ideation feedback**: Experiment results and the Research Planner's recommendations do not flow back to trigger a new round of hypothesis generation. The feedback loop is entirely manual. | Prevents autonomous multi-round iteration | **Critical** |
| **G3** | **No loop continuation**: After Stage 13 (`recommend_next`), the pipeline terminates. Even when the recommendation is "code_change" or "new_ablation", no mechanism exists to automatically initiate a new run. | Single-shot execution only; no iterative refinement | **Critical** |
| **G4** | **Approval gates have no policy bypass**: The `canAutoApplyChanges` capability flag is defined but never checked. All four approval gates always require manual intervention, even for low-risk operations. | Unnecessary human bottleneck for routine operations | **High** |
| **G5** | **No experiment lineage tracking**: Each `ExperimentRun` is independent. There is no `parentRunId` or provenance chain linking a recommendation to its subsequent run. | Cannot trace research evolution; no learning across iterations | **High** |
| **G6** | **No failure recovery policy**: When monitoring detects a failed job, no automatic retry or resource-adjustment mechanism exists. Users must manually diagnose and resubmit. | Wasted compute; increased human intervention for transient failures | **Medium** |
| **G7** | **No cross-iteration context memory**: Historical experiment results, paper analyses, and ideation reports are stored in separate tables/notes without a unified queryable context layer. | Agents lack awareness of prior iterations when making decisions | **Medium** |
| **G8** | **No automated ablation planning**: When results are ambiguous, there is no mechanism to automatically design and execute ablation studies to isolate contributing factors. | Requires manual experiment design for deeper understanding | **Medium** |

---

## 4. Proposed Development Roadmap

### 4.1 Phase 1: Bridge Construction — Connecting the Engines (Short-Term)

**Objective:** Enable a single research iteration to flow semi-automatically from hypothesis to analysis, with manual approval only at critical decision points.

#### 4.1.1 Ideation → Execution Bridge

**Problem:** The Ideation Engine's Experimentalist role produces detailed MVE designs (protocol, baselines, metrics, expected outcomes), but these exist only as natural language in markdown reports. The Execution Engine expects structured `ExperimentManifest` objects.

**Proposed Solution:**

Implement a **Manifest Generator** service that:
1. Parses the structured MVE output from the Ideation Scribe's final report.
2. Maps experiment components to ExperimentManifest fields:
   - MVE protocol steps → `command` and `configOverrides`
   - Dataset references → workspace file paths or download URLs
   - Baseline specifications → separate run configurations
   - Metric definitions → `expectedOutputs` patterns
3. Presents the generated manifest for user confirmation (or auto-applies if `canAutoApplyChanges` is enabled).
4. Creates a new `ExperimentRun` with `sourceType: "ideation"` and `sourceId` pointing to the ideation report.

**Technical approach:**
- New module: `src/lib/bridge/ideation-to-exec.ts`
- LLM-assisted structured extraction from ideation report → JSON manifest
- Validation against workspace file structure (entrypoint must exist, paths must be valid)
- UI: "Run This Experiment" button on ideation reports that triggers manifest generation

#### 4.1.2 Execution → Ideation Feedback Chain

**Problem:** Stage 13's `AnalysisRecommendation` (containing `nextStep`, `confidence`, `reasoning`, `type`, `alternatives`) is stored in the database but never consumed by any downstream process.

**Proposed Solution:**

Implement a **Feedback Injector** that:
1. After Stage 13 completes, packages the recommendation + result summary + original objective into a structured context object.
2. Offers the user a "Generate New Directions" action that triggers the Ideation Engine with this context pre-populated.
3. The Ideation Engine's Ideator role receives: original paper context + prior experiment results + prior recommendation, enabling grounded hypothesis generation that builds on empirical evidence.

**Technical approach:**
- New module: `src/lib/bridge/exec-to-ideation.ts`
- Extended ideation context: `{ article, userSeed, priorExperiments: ExperimentResultSummary[] }`
- Modified Ideator prompt to incorporate experimental evidence
- UI: "Iterate" button on completed experiment runs

#### 4.1.3 Experiment Lineage Tracking

**Problem:** No provenance chain exists between experiment runs.

**Proposed Solution:**

Add lineage fields to the `experimentRuns` schema:

```typescript
parentRunId: text("parent_run_id").references(() => experimentRuns.id),
sourceType: text("source_type"), // "ideation" | "recommendation" | "manual" | "retry"
sourceId: text("source_id"),     // ID of the ideation report, parent run, etc.
iteration: integer("iteration"), // Auto-incremented within a lineage chain
```

This enables:
- Tree visualization of experiment evolution
- "Show me all experiments descended from hypothesis X"
- Automatic iteration numbering for reporting

#### 4.1.4 Activate Intelligent Approval Policies

**Problem:** `canAutoApplyChanges` exists but is never enforced.

**Proposed Solution:**

Implement a **Risk Assessment Module** that evaluates each approval gate:

| Risk Signal | Low Risk (Auto-approve) | High Risk (Require human) |
|-------------|------------------------|--------------------------|
| Patch scope | Config-only changes, <10 lines | Code logic changes, >50 lines |
| Sync scope | Unchanged files excluded | New binary files, large deltas |
| Job resources | Within prior run's resource envelope | New GPU types, >2x resource increase |
| Collection scope | Expected output files only | Unexpected files, large downloads |

When `canAutoApplyChanges` is enabled and risk is assessed as low, the approval gate is automatically passed with a logged justification. The user is notified but not blocked.

### 4.2 Phase 2: Loop Orchestrator — Autonomous Multi-Round Iteration (Mid-Term)

**Objective:** Enable N-round unattended "train → analyze → adjust → retrain" cycles with configurable stopping conditions and intelligent failure recovery.

#### 4.2.1 Loop Orchestrator Service

A new top-level orchestration layer that manages multi-round experiment iteration:

```typescript
interface LoopConfig {
  objective: string;                    // Natural language research goal
  maxIterations: number;                // Safety bound (default: 10)
  stoppingConditions: StoppingCondition[]; // e.g., "accuracy > 0.95", "no improvement for 3 rounds"
  approvalPolicy: ApprovalPolicy;       // "all_manual" | "risk_based" | "auto_with_notify"
  retryPolicy: RetryPolicy;            // Max retries, resource escalation rules
  baselineRunId?: string;              // Reference run for comparison
}
```

**Loop execution flow:**

```
Initialize: Set iteration=0, load objective + stopping conditions
     │
     ▼
┌─── Loop Start ◄──────────────────────────────────────────────┐
│    │                                                          │
│    ▼                                                          │
│  [Ideation Engine] Generate/refine hypothesis                 │
│    │ (iteration 0: from paper; iteration N: from prior results)│
│    ▼                                                          │
│  [Bridge] Convert MVE → ExperimentManifest                    │
│    │                                                          │
│    ▼                                                          │
│  [Execution Engine] Run 13-stage pipeline                     │
│    │ (approval gates governed by ApprovalPolicy)              │
│    ▼                                                          │
│  [Analysis] Extract metrics, compare with baseline/prior runs │
│    │                                                          │
│    ▼                                                          │
│  [Stopping Check] Evaluate stopping conditions                │
│    │                                                          │
│    ├── Condition met → Exit loop, generate final report       │
│    │                                                          │
│    └── Condition not met → increment iteration ───────────────┘
```

#### 4.2.2 Intelligent Failure Recovery

Implement policy-based automatic recovery for common failure modes:

| Failure Type | Detection Signal | Recovery Action |
|--------------|-----------------|-----------------|
| **OOM (Out of Memory)** | Exit code 137, "CUDA out of memory" in logs | Reduce batch size by 50%, or request larger GPU |
| **Timeout** | `timed_out` status from scheduler | Extend wall-time by 50%, or checkpoint + resume |
| **Transient Infrastructure** | SSH connection refused, NFS stale handle | Exponential backoff retry (max 3 attempts) |
| **Code Bug** | Python traceback in stderr | Invoke Patch Agent to diagnose and fix, then retry |
| **Data Issue** | FileNotFoundError, corrupted data warnings | Verify data paths, re-download if necessary |

Each recovery action is logged with full provenance, and repeated failures of the same type escalate to human attention.

#### 4.2.3 Cross-Run Experiment Comparison Dashboard

A dedicated UI panel for comparing experiments across iterations:

- **Metric curves**: Plot key metrics (loss, accuracy, F1, etc.) across iterations with automated best-run highlighting.
- **Configuration diff**: Side-by-side comparison of hyperparameters and config changes between any two runs.
- **Code diff**: View exact patch differences between iterations.
- **Resource utilization**: GPU hours, memory peaks, wall-time per run.
- **Lineage tree**: Visual graph of experiment evolution from root hypothesis.

#### 4.2.4 Unified Context Memory Layer

A workspace-scoped memory system that provides cross-module context:

```typescript
interface WorkspaceMemory {
  papers: PaperAnalysis[];           // Discussion reports + ideation outputs
  experiments: ExperimentSummary[];   // Run results + recommendations
  hypotheses: Hypothesis[];          // Tracked across ideation rounds
  insights: Insight[];               // Cross-cutting observations
}
```

All agents (in both Paper and Execution engines) can query this memory to ground their reasoning in the full history of the research project, not just the current run's context.

### 4.3 Phase 3: Autonomous Research Intelligence (Long-Term)

**Objective:** Evolve from automated execution to intelligent research decision-making, where the system not only runs experiments but actively guides research strategy.

#### 4.3.1 Multi-Objective Optimization

Current recommendations consider a single dimension (e.g., "improve accuracy"). Phase 3 introduces Pareto-optimal experiment selection across multiple objectives:

- **Performance** (accuracy, F1, BLEU, etc.)
- **Efficiency** (training time, GPU hours, memory usage)
- **Generalization** (cross-dataset transfer, robustness to perturbation)
- **Simplicity** (model size, number of hyperparameters)

The Research Planner evolves from single-step recommendation to multi-objective frontier exploration, suggesting experiments that explore different trade-off regions.

#### 4.3.2 Hyperparameter Search Integration

Embed automated hyperparameter optimization as a sub-loop within the experiment cycle:

- Integration with Optuna, Ray Tune, or similar frameworks.
- The Loop Orchestrator can spawn parallel trial runs within a single iteration.
- Results feed into the analysis stage with trial-level granularity.
- Bayesian optimization leverages cross-iteration learning.

#### 4.3.3 Automated Ablation Planning

When experiment results are ambiguous or multi-factor, automatically generate ablation studies:

1. **Component identification**: Parse the experiment configuration to identify independent variables.
2. **Ablation matrix design**: Generate a systematic plan to isolate each component's contribution.
3. **Execution**: Submit ablation runs in parallel where resources allow.
4. **Synthesis**: Aggregate ablation results into a contribution analysis report.

#### 4.3.4 Cross-Paper Knowledge Graph

Automatically build and maintain a knowledge graph from analyzed papers:

- **Entities**: Methods, datasets, metrics, findings, limitations.
- **Relations**: "improves upon", "evaluated on", "contradicts", "extends".
- **Queries**: "What methods have been tried for task X?", "What are the known failure modes of approach Y?"
- **Integration**: The Ideation Engine queries the knowledge graph to avoid proposing already-explored directions and to identify genuinely novel combinations.

#### 4.3.5 Research Log and Paper Draft Generation

Automatically generate structured research documentation from experiment lineage:

- **Research log**: Chronological narrative of decisions, experiments, results, and pivots.
- **Experiment section draft**: Auto-generated LaTeX/Markdown for the experimental methodology and results sections of a paper.
- **Reproducibility package**: Auto-bundled code, configs, data references, and execution scripts for each key experiment.

#### 4.3.6 Collaborative Research Workspace

Extend the platform for team-based research:

- **Multi-user sessions**: Concurrent researchers working on the same project.
- **Role-based access**: PI approval for high-cost experiments, student access for analysis.
- **Shared knowledge base**: Team-level insights, cross-project learning.
- **Notification system**: Alert relevant team members when experiments complete or when interesting results emerge.

---

## 5. Technical Architecture for the Closed Loop

### 5.1 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          LOOP ORCHESTRATOR (Phase 2)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Stopping  │  │ Approval │  │  Retry   │  │ Lineage  │              │
│  │ Condition │  │  Policy  │  │  Policy  │  │ Tracker  │              │
│  │ Evaluator │  │  Engine  │  │  Engine  │  │          │              │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘              │
│         │              │            │             │                    │
│         └──────────────┼────────────┼─────────────┘                   │
│                        ▼                                               │
│  ┌─────────────── BRIDGE LAYER (Phase 1) ──────────────────────────┐  │
│  │                                                                  │  │
│  │  ┌──────────────────┐           ┌──────────────────┐            │  │
│  │  │ Ideation → Exec  │           │ Exec → Ideation  │            │  │
│  │  │ Manifest Builder │           │ Feedback Injector│            │  │
│  │  └────────┬─────────┘           └────────┬─────────┘            │  │
│  │           │                               │                      │  │
│  └───────────┼───────────────────────────────┼──────────────────────┘  │
│              │                               │                         │
│              ▼                               ▼                         │
│  ┌──────────────────┐           ┌──────────────────────┐              │
│  │  PAPER RESEARCH   │◄─────────│  EXPERIMENT EXECUTION │              │
│  │  ENGINE           │           │  ENGINE               │              │
│  │                   │           │                       │              │
│  │  • Article Search │           │  • 13-Stage Pipeline  │              │
│  │  • Discussion (6) │           │  • 5 Agent Roles      │              │
│  │  • Ideation (5)   │           │  • Job Monitoring     │              │
│  │  • RAG Q&A        │           │  • Result Analysis    │              │
│  └──────────────────┘           └──────────────────────┘              │
│              │                               │                         │
│              └───────────┬───────────────────┘                        │
│                          ▼                                             │
│              ┌──────────────────────┐                                  │
│              │   CONTEXT MEMORY     │ (Phase 2)                       │
│              │   LAYER              │                                  │
│              │                      │                                  │
│              │  • Papers & Analyses │                                  │
│              │  • Experiment History│                                  │
│              │  • Hypothesis Track  │                                  │
│              │  • Cross-Run Insights│                                  │
│              └──────────────────────┘                                  │
│                          │                                             │
│                          ▼                                             │
│              ┌──────────────────────┐                                  │
│              │   DOMAIN SKILLS      │                                  │
│              │   ENGINE (206+)      │                                  │
│              │                      │                                  │
│              │  • SCP/MCP Tools     │                                  │
│              │  • Task Scheduler    │                                  │
│              │  • Scientific Compute│                                  │
│              └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Data Flow for a Complete Loop Iteration

```
Iteration N:

1. [Context Memory] Load: original objective + results from iterations 0..N-1
                       ↓
2. [Ideation Engine] Generate hypotheses grounded in prior evidence
                       ↓
3. [Bridge: I→E] Extract MVE → build ExperimentManifest → create ExperimentRun
                       ↓
4. [Execution: Stages 1-4] Inspect repo → propose patch → (auto-approve if low risk) → apply
                       ↓
5. [Execution: Stages 5-8] Preview sync → (auto-approve) → sync → prepare job → (auto-approve) → submit
                       ↓
6. [Execution: Stage 9] Monitor job (poll every 60s until terminal state)
                       ↓
7. [Execution: Stages 10-11] (Auto-approve collection if job succeeded) → collect results
                       ↓
8. [Execution: Stages 12-13] Analyze results → recommend next step
                       ↓
9. [Context Memory] Store: run results, metrics, recommendation, patch summary
                       ↓
10. [Loop Orchestrator] Evaluate stopping conditions
                       ↓
    ├── MET: Generate final report summarizing all iterations → DONE
    └── NOT MET: Set iteration = N+1 → Go to step 1
```

### 5.3 New Database Schema Additions

```sql
-- Experiment lineage tracking (Phase 1)
ALTER TABLE experiment_runs ADD COLUMN parent_run_id TEXT REFERENCES experiment_runs(id);
ALTER TABLE experiment_runs ADD COLUMN source_type TEXT; -- 'ideation' | 'recommendation' | 'manual' | 'retry'
ALTER TABLE experiment_runs ADD COLUMN source_id TEXT;
ALTER TABLE experiment_runs ADD COLUMN iteration INTEGER DEFAULT 0;

-- Loop configuration (Phase 2)
CREATE TABLE experiment_loops (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  objective TEXT NOT NULL,
  max_iterations INTEGER DEFAULT 10,
  stopping_conditions_json TEXT, -- StoppingCondition[]
  approval_policy TEXT DEFAULT 'all_manual',
  retry_policy_json TEXT, -- RetryPolicy
  baseline_run_id TEXT REFERENCES experiment_runs(id),
  current_iteration INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle', -- 'idle' | 'running' | 'paused' | 'completed' | 'stopped'
  final_report_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workspace context memory (Phase 2)
CREATE TABLE workspace_memory (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  entry_type TEXT NOT NULL, -- 'paper_analysis' | 'experiment_result' | 'hypothesis' | 'insight'
  source_module TEXT NOT NULL, -- 'paper_discussion' | 'ideation' | 'execution' | 'manual'
  source_id TEXT,
  content_json TEXT NOT NULL,
  embedding BLOB, -- For semantic retrieval
  created_at TEXT DEFAULT (datetime('now'))
);

-- Knowledge graph entries (Phase 3)
CREATE TABLE knowledge_graph (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  entity_type TEXT NOT NULL, -- 'method' | 'dataset' | 'metric' | 'finding' | 'limitation'
  entity_name TEXT NOT NULL,
  description TEXT,
  source_paper_id TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE knowledge_relations (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT REFERENCES knowledge_graph(id),
  to_entity_id TEXT REFERENCES knowledge_graph(id),
  relation_type TEXT NOT NULL, -- 'improves_upon' | 'evaluated_on' | 'contradicts' | 'extends'
  confidence REAL DEFAULT 1.0,
  evidence TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 6. Evaluation Plan

### 6.1 Phase 1 Evaluation Metrics

| Metric | Target | Measurement |
|--------|--------|------------|
| **Bridge accuracy** | >80% of MVE designs correctly converted to valid manifests | Manual review of 50 ideation-to-manifest conversions |
| **Context preservation** | >90% of relevant prior experiment context available to ideation | Compare agent outputs with/without feedback injection |
| **Lineage completeness** | 100% of recommendation-triggered runs have parent links | Database audit |
| **Approval policy precision** | <5% false auto-approvals (low risk classified as high risk) | Review auto-approved operations against manual assessment |

### 6.2 Phase 2 Evaluation Metrics

| Metric | Target | Measurement |
|--------|--------|------------|
| **Loop completion rate** | >70% of loops reach stopping condition without manual intervention | Track across 20+ loop executions |
| **Failure recovery success** | >60% of transient failures auto-recovered | Count recovered vs. escalated failures |
| **Iteration efficiency** | <30 min average time from recommendation to next job submission | Measure wall-clock time per iteration |
| **Result improvement** | Monotonic improvement in target metric for >50% of iterations | Track primary metric across iterations |

### 6.3 Phase 3 Evaluation Metrics

| Metric | Target | Measurement |
|--------|--------|------------|
| **Pareto optimality** | >80% of suggested experiments lie on or near the Pareto frontier | Post-hoc analysis of experiment outcomes |
| **Ablation utility** | >70% of auto-planned ablations produce actionable insights | Expert review of ablation reports |
| **Knowledge graph coverage** | >60% of key entities from analyzed papers captured | Compare against manual annotation |
| **Research acceleration** | 3–5x reduction in time from hypothesis to validated result | Controlled comparison with manual workflow |

---

## 7. Risk Analysis and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| **Runaway compute costs** | Medium | High | Hard budget limits per loop; cost estimation before submission; escalation alerts |
| **Cascading bad hypotheses** | Medium | Medium | Stopping conditions include "no improvement for N rounds"; diversity enforcement in ideation |
| **Auto-approval of harmful changes** | Low | High | Conservative risk thresholds; all auto-approvals logged and reviewable; kill-switch for loop pause |
| **Context window overflow** | Medium | Medium | Aggressive summarization of prior iterations; selective context injection based on relevance |
| **LLM hallucination in code patches** | Medium | High | Mandatory test execution after patch application; diff review even in auto-approve mode |
| **Data loss from automated operations** | Low | Critical | All destructive operations require git commits; snapshot before sync; rollback capability |

---

## 8. Implementation Timeline

| Phase | Duration | Key Deliverables |
|-------|----------|-----------------|
| **Phase 1a**: Ideation→Exec Bridge | 3–4 weeks | Manifest generator, "Run This Experiment" UI, bridge module |
| **Phase 1b**: Exec→Ideation Feedback | 2–3 weeks | Feedback injector, modified ideation prompts, "Iterate" button |
| **Phase 1c**: Lineage & Approval Policies | 2–3 weeks | Schema migration, lineage tracking, risk assessment module |
| **Phase 2a**: Loop Orchestrator | 4–6 weeks | Loop config UI, orchestration service, stopping condition evaluator |
| **Phase 2b**: Failure Recovery | 3–4 weeks | Failure classifier, recovery policy engine, escalation system |
| **Phase 2c**: Comparison Dashboard & Memory | 4–5 weeks | Cross-run comparison UI, workspace memory layer, semantic retrieval |
| **Phase 3a**: Multi-Objective & HPO | 6–8 weeks | Pareto frontier tracking, Optuna/Ray integration, parallel trial management |
| **Phase 3b**: Ablation & Knowledge Graph | 6–8 weeks | Ablation planner, KG construction, graph queries |
| **Phase 3c**: Documentation & Collaboration | 4–6 weeks | Auto research logs, paper draft generation, multi-user features |

**Total estimated timeline: 8–12 months for full roadmap completion.**

---

## 9. Conclusion

InnoClaw has established a strong foundation with three powerful automation engines that individually address key stages of the AI research lifecycle. The critical missing piece is the connective tissue between these engines — the bridges, feedback loops, and orchestration logic that transform isolated tools into a coherent, self-improving research loop.

This proposal charts a progressive path from today's "broken chain" (where each engine operates independently with manual handoffs) through a "bridged pipeline" (Phase 1, where engines can communicate but humans still drive iteration) to a "closed loop" (Phase 2, where multi-round iteration proceeds autonomously within configurable bounds) and ultimately toward "autonomous research intelligence" (Phase 3, where the system actively guides research strategy through multi-objective optimization and knowledge graph reasoning).

The key insight is that **closing the loop is not primarily an AI capability problem — it is an orchestration and integration problem**. The individual agents are already capable of performing their roles effectively. What is needed is the infrastructure to connect their outputs to each other's inputs, to track the lineage of decisions across iterations, and to apply intelligent policies for when human oversight is truly necessary versus when automation can safely proceed.

By pursuing this roadmap, InnoClaw can evolve from a powerful but manually-operated research toolkit into a genuine AI research collaborator — one that not only executes experiments but actively participates in the scientific reasoning process.

---

## References

1. InnoClaw GitHub Repository: https://github.com/zjowowen/InnoClaw
2. Vercel AI SDK Documentation: https://sdk.vercel.ai/docs
3. Drizzle ORM: https://orm.drizzle.team/
4. Model Context Protocol (MCP): https://modelcontextprotocol.io/
5. SLURM Workload Manager: https://slurm.schedmd.com/
6. Optuna: A Next-generation Hyperparameter Optimization Framework (Akiba et al., 2019)
7. Ray Tune: Scalable Hyperparameter Tuning (Liaw et al., 2018)
