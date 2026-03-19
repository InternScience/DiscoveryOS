# InnoClaw: An AI-Native Platform for Autonomous Research Iteration

## 1. Overview

InnoClaw is an open-source, self-hostable AI research assistant that automates the full research lifecycle — from literature review to experiment execution and result analysis. Built on Next.js, React, and the Vercel AI SDK with multi-LLM support (OpenAI, Anthropic, Google, DeepSeek, Qwen, etc.), the platform orchestrates specialized AI agents across three core engines to minimize manual effort in iterative research workflows.

---

## 2. Current Capabilities

### 2.1 Paper Research Engine

Automates the path from raw literature to actionable research directions.

- **Multi-Source Search**: Parallel queries across arXiv, HuggingFace Daily Papers, and Semantic Scholar with 15-minute caching and LLM-powered query expansion.
- **Multi-Agent Paper Discussion** (6 stages, 5 AI roles): Moderator → Librarian → Skeptic → Reproducer → Scribe. Produces structured reports covering claims, strengths, weaknesses, reproducibility assessment, and recommended next actions. All outputs are evidence-grounded with explicit citation of source material.
- **Multi-Agent Research Ideation** (5 stages, 5 AI roles): Ideator → Feasibility Checker → Experimentalist → Reviewer → Scribe. Generates 3–5 testable hypotheses with feasibility ratings and concrete **Minimum Viable Experiment (MVE)** designs including protocols, baselines, metrics, and expected outcomes.
- **RAG Knowledge Q&A**: Document ingestion (PDF, code, markdown, etc.) with chunking, embedding, and hybrid retrieval for context-augmented answers.

### 2.2 Experiment Execution Engine

Manages the full experiment lifecycle through a **13-stage pipeline** with **5 specialized AI agent roles** and **4 human approval gates**.

| Stage | Agent | Key Action |
|-------|-------|-----------|
| 1. Inspect | Repo Agent | Analyze codebase structure, identify entrypoints and configs |
| 2. Propose Patch | Patch Agent | Design minimal code/config changes |
| 3. **Approve Patch** | — | **Human approval gate** |
| 4. Apply Patch | Patch Agent | Apply changes to workspace |
| 5. Preview Sync | Remote Agent | Dry-run rsync plan |
| 6. **Approve Sync** | — | **Human approval gate** |
| 7. Prepare Job | Remote Agent | Build submission manifest |
| 8. **Approve Submit** | — | **Human approval gate** |
| 9. Monitor Job | Remote Agent | Multi-signal polling (scheduler + markers + heartbeat + logs) |
| 10. **Approve Collect** | — | **Human approval gate** |
| 11. Collect Results | Remote Agent | rsync results to local workspace |
| 12. Analyze Results | Result Analyst | Extract metrics, diagnose outcomes |
| 13. Recommend Next | Research Planner | Suggest next experiment (code change / config change / ablation / rerun / direction change) |

**Scheduler support**: SLURM (HPC), rjob (containerized GPU), Shell (nohup). All operations are gated by 8 capability flags (default off) for fine-grained access control.

### 2.3 Domain Skills Engine

- **206+ scientific computing skills** across 8 domains: Drug Discovery (71), Genomics (41), Protein Science (38), Chemistry (24), Physics (18), and more.
- **MCP protocol integration** with SCP Hub for remote scientific tool invocation.
- **Parameterized workflows** with template injection and tool access control.
- **Task scheduler**: Cron-driven automation for daily/weekly reports, git sync, and RAG source re-indexing.

### 2.4 Platform Infrastructure

- **Multi-LLM**: OpenAI, Anthropic, Google Gemini, DeepSeek, Qwen, Moonshot, MiniMax, Zhipu.
- **Agent modes**: Short (general), Long (full pipeline), Plan (read-only), Ask (Q&A).
- **Context overflow protection**: Auto-summarization at configurable thresholds (60/80/95%).
- **Integrations**: Feishu bot, Kubernetes job management, HuggingFace datasets, Git workspaces.
- **I18n**: English and Chinese.

---

## 3. Current Limitations

The three engines are powerful individually but **operate as disconnected subsystems**:

```
Paper Engine ──X──> Execution Engine ──X──> (STOP)
     ↑                                        │
     └──────────── X (no feedback) ───────────┘
```

| Gap | Description |
|-----|-------------|
| No Ideation → Exec bridge | MVE designs cannot auto-populate experiment manifests |
| No Exec → Ideation feedback | Results and recommendations do not trigger new hypothesis rounds |
| No loop continuation | Pipeline terminates after Stage 13; no automatic re-iteration |
| No policy-based approval bypass | `canAutoApplyChanges` flag defined but unused |
| No experiment lineage | Runs are independent; no parent-child provenance chain |
| No failure auto-recovery | Failed jobs require manual diagnosis and resubmission |

---

## 4. Development Plan

### Phase 1: Bridge Construction (Short-Term)

**Goal**: Connect the engines so a single iteration can flow semi-automatically from hypothesis to analysis.

| Deliverable | Description |
|-------------|-------------|
| **Ideation → Exec Manifest Builder** | LLM-assisted conversion of MVE designs into structured `ExperimentManifest` objects. "Run This Experiment" button on ideation reports. |
| **Exec → Ideation Feedback Injector** | Package experiment results + recommendations as context for the next ideation round. "Iterate" button on completed runs. |
| **Experiment Lineage Tracking** | Add `parentRunId`, `sourceType`, `iteration` fields to `experimentRuns`. Enable tree visualization of experiment evolution. |
| **Risk-Based Approval Policies** | Activate `canAutoApplyChanges`: auto-approve low-risk gates (config-only patches, small syncs, expected outputs) while requiring human review for high-risk operations. |

### Phase 2: Autonomous Loop Orchestrator (Mid-Term)

**Goal**: Enable N-round unattended "train → analyze → adjust → retrain" cycles.

| Deliverable | Description |
|-------------|-------------|
| **Loop Orchestrator** | Top-level controller with configurable objective, max iterations, stopping conditions (e.g., "accuracy > 0.95", "no improvement for 3 rounds"), and approval/retry policies. |
| **Intelligent Failure Recovery** | Policy-based auto-recovery: OOM → reduce batch size; timeout → extend wall-time; transient errors → exponential backoff retry; code bugs → Patch Agent auto-fix. |
| **Cross-Run Comparison Dashboard** | Metric curves, config diffs, code diffs, and resource utilization across iterations. Lineage tree visualization. |
| **Unified Context Memory** | Workspace-scoped memory layer storing paper analyses, experiment results, hypotheses, and insights. Semantic retrieval for cross-module context injection. |

**Target closed loop**:
```
┌─→ Ideation → Bridge → Execution Pipeline → Analysis → Stopping Check ─┐
│                                                                         │
│   condition not met                                              met → EXIT
│         │                                                               │
└─────────┘                                                    Final Report
```

### Phase 3: Autonomous Research Intelligence (Long-Term)

**Goal**: Evolve from automated execution to intelligent research strategy.

| Deliverable | Description |
|-------------|-------------|
| **Multi-Objective Optimization** | Pareto-optimal experiment selection across performance, efficiency, generalization, and simplicity. |
| **Hyperparameter Search Integration** | Embed Optuna/Ray Tune as a sub-loop; parallel trial runs within iterations; Bayesian cross-iteration learning. |
| **Automated Ablation Planning** | Auto-design ablation studies when results are ambiguous; parallel execution; contribution analysis reports. |
| **Cross-Paper Knowledge Graph** | Auto-built graph of methods, datasets, metrics, findings, and their relations. Ideation queries the graph to avoid redundant exploration. |
| **Research Documentation Generation** | Auto-generate structured research logs and paper draft experiment sections from experiment lineage. |

---

## 5. Summary

| Dimension | Current State | After Phase 1 | After Phase 2 | After Phase 3 |
|-----------|--------------|---------------|---------------|---------------|
| Engine connectivity | Disconnected | Bridged | Fully looped | Knowledge-integrated |
| Iteration automation | Single-shot, manual handoffs | Semi-auto single iteration | N-round unattended loops | Strategy-aware autonomous loops |
| Failure handling | Manual | Manual | Auto-recovery with escalation | Predictive avoidance |
| Experiment tracking | Isolated runs | Lineage chains | Cross-run comparison | Knowledge graph + Pareto frontiers |
| Human involvement | Every approval gate | Risk-based selective approval | Exception-only oversight | Strategic direction setting |

The core thesis: **closing the research loop is an orchestration problem, not an AI capability problem.** The individual agents already perform their roles effectively. What is needed is the infrastructure to connect outputs to inputs, track decision lineage across iterations, and apply intelligent policies for when human oversight is truly necessary versus when automation can safely proceed.
