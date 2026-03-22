import { generateText, stepCountIs } from "ai";
import { createSearchTools } from "@/lib/ai/tools/search-tools";
import { getModelChainForRole, checkBudget, trackUsage } from "../model-router";
import * as store from "../event-store";
import {
  buildEvidenceGatherPrompt,
  buildReviewerSystemPrompt,
  buildWorkerSystemPrompt,
} from "../prompts";
import {
  buildRevisionPrompt,
  buildSynthesizerPrompt,
  parseClaimMap,
} from "../synthesizer-runtime";
import {
  buildScientificReviewPrompt,
  parseScientificReviewPacket,
} from "../scientific-review-runtime";
import type {
  ActorArtifactDraft,
  ActorExecutionContext,
  ActorExecutionResult,
  ArtifactProvenance,
  ArtifactType,
  DeepResearchArtifact,
  DeepResearchNode,
} from "../types";

type ModelLike = Awaited<ReturnType<typeof getModelChainForRole>>[number]["model"];
type GenerateResultLike = {
  text: string;
  usage?: { totalTokens?: number };
  steps?: Array<{ toolResults?: Array<{ output?: unknown }> }>;
};

abstract class MetaWorker {
  abstract supports(node: DeepResearchNode): boolean;

  async execute(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    abortSignal?: AbortSignal,
  ): Promise<ActorExecutionResult> {
    const budgetCheck = checkBudget(node.assignedRole, ctx.session.budget, ctx.session.config.budget);
    if (!budgetCheck.allowed) {
      throw new Error(`Budget exceeded: ${budgetCheck.reason}`);
    }

    const modelChain = await getModelChainForRole(node.assignedRole, ctx.session.config);
    let lastError: Error | null = null;

    for (let i = 0; i < modelChain.length; i++) {
      const { model, provider, modelId } = modelChain[i];
      await store.updateNode(node.id, {
        status: "running",
        assignedModel: `${provider}/${modelId}`,
        startedAt: new Date().toISOString(),
      });

      try {
        const result = await this.executeTask(node, ctx, model, abortSignal);
        await store.updateNode(node.id, {
          status: "completed",
          output: result.output,
          completedAt: new Date().toISOString(),
        });

        const artifacts = await createArtifacts(ctx.session.id, node.id, result.artifactDrafts);
        const updatedBudget = trackUsage(ctx.session.budget, node.assignedRole, node.id, result.tokensUsed);
        await store.updateSession(ctx.session.id, { budget: updatedBudget });

        return {
          output: result.output,
          artifacts,
          tokensUsed: result.tokensUsed,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isLast = i === modelChain.length - 1;
        if (!isLast) {
          await store.updateNode(node.id, { status: "pending" });
        }
      }
    }

    const message = lastError?.message ?? "Unknown execution error";
    await store.updateNode(node.id, {
      status: "failed",
      error: `All models failed. Last error: ${message}`,
      completedAt: new Date().toISOString(),
    });
    throw lastError ?? new Error(message);
  }

  protected abstract executeTask(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    model: ModelLike,
    abortSignal?: AbortSignal,
  ): Promise<{
    output: Record<string, unknown>;
    artifactDrafts: ActorArtifactDraft[];
    tokensUsed: number;
  }>;

  protected buildProvenance(
    node: DeepResearchNode,
    sourceArtifactIds: string[],
  ): ArtifactProvenance {
    return {
      sourceNodeId: node.id,
      sourceArtifactIds,
      model: node.assignedModel || "unknown",
      generatedAt: new Date().toISOString(),
    };
  }
}

abstract class PromptWorker extends MetaWorker {
  protected getParentArtifacts(node: DeepResearchNode, ctx: ActorExecutionContext): DeepResearchArtifact[] {
    return ctx.allArtifacts.filter((artifact) => artifact.nodeId && node.dependsOn.includes(artifact.nodeId));
  }

  protected getTools(
    _node: DeepResearchNode,
    ctx: ActorExecutionContext,
  ): Record<string, unknown> | undefined {
    return ctx.skillTools;
  }

  protected getStepLimit(_node: DeepResearchNode): number {
    return 20;
  }

  protected abstract buildSystemPrompt(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string;

  protected abstract buildUserPrompt(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string;

  protected parseOutput(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    _parentArtifacts: DeepResearchArtifact[],
    result: GenerateResultLike,
  ): Record<string, unknown> {
    return safeParseJson(result.text);
  }

  protected abstract buildArtifactDrafts(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
    output: Record<string, unknown>,
  ): ActorArtifactDraft[];

  protected async executeTask(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    model: ModelLike,
    abortSignal?: AbortSignal,
  ) {
    const parentArtifacts = this.getParentArtifacts(node, ctx);
    const tools = this.getTools(node, ctx);
    const stepLimit = this.getStepLimit(node);
    const result = await generateText({
      model,
      system: this.buildSystemPrompt(node, ctx, parentArtifacts),
      messages: [{ role: "user", content: this.buildUserPrompt(node, ctx, parentArtifacts) }],
      ...(tools ? { tools: tools as Record<string, never>, stopWhen: stepCountIs(stepLimit) } : {}),
      abortSignal,
    });

    const output = this.parseOutput(node, ctx, parentArtifacts, result);
    return {
      output,
      artifactDrafts: this.buildArtifactDrafts(node, ctx, parentArtifacts, output),
      tokensUsed: result.usage?.totalTokens ?? 0,
    };
  }
}

class EvidenceGatherWorker extends PromptWorker {
  supports(node: DeepResearchNode): boolean {
    return node.nodeType === "evidence_gather" && node.assignedRole === "worker";
  }

  protected getTools(_node: DeepResearchNode, ctx: ActorExecutionContext): Record<string, unknown> {
    const searchTools = createSearchTools();
    return ctx.skillTools
      ? { ...searchTools, ...ctx.skillTools }
      : searchTools;
  }

  protected getStepLimit(): number {
    return 15;
  }

  protected buildSystemPrompt(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string {
    return buildWorkerSystemPrompt(node, parentArtifacts, "evidence_gather", ctx.skillCatalog as never);
  }

  protected buildUserPrompt(node: DeepResearchNode): string {
    const input = (node.input as Record<string, unknown>) ?? {};
    const query = (input.query as string)
      || (input.researchQuestion as string)
      || node.label;
    const maxSources = (input.maxPapers as number) || (input.maxSources as number) || 10;
    const focusAreas = input.focusAreas as string[] | undefined;
    return buildEvidenceGatherPrompt(query, { maxSources, focusAreas });
  }

  protected parseOutput(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    _parentArtifacts: DeepResearchArtifact[],
    result: GenerateResultLike,
  ): Record<string, unknown> {
    const input = (node.input as Record<string, unknown>) ?? {};
    const query = (input.query as string)
      || (input.researchQuestion as string)
      || node.label;

    let output = safeParseJson(result.text);
    if (Object.keys(output).length > 0 && !("text" in output && Object.keys(output).length === 1)) {
      return output;
    }

    const toolResults = result.steps?.flatMap(step => step.toolResults ?? []) ?? [];
    const allArticles: unknown[] = [];
    for (const toolResult of toolResults) {
      const payload = (toolResult as { output?: unknown }).output as { articles?: unknown[] } | undefined;
      if (payload?.articles && Array.isArray(payload.articles)) {
        allArticles.push(...payload.articles);
      }
    }

    if (allArticles.length > 0) {
      output = {
        sources: allArticles,
        totalFound: allArticles.length,
        query,
        note: "Extracted directly from search tool results",
      };
    } else {
      output = {
        sources: [],
        totalFound: 0,
        query,
        rawText: result.text?.slice(0, 2000) || "No response text",
        note: "No articles found via search tools",
      };
    }

    return output;
  }

  protected buildArtifactDrafts(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
    output: Record<string, unknown>,
  ): ActorArtifactDraft[] {
    return [{
      artifactType: "evidence_card",
      title: `Evidence: ${node.label}`,
      content: output,
      provenance: this.buildProvenance(node, parentArtifacts.map(artifact => artifact.id)),
    }];
  }
}

class SummaryWorker extends PromptWorker {
  supports(node: DeepResearchNode): boolean {
    return node.nodeType === "summarize" && node.assignedRole === "worker";
  }

  protected buildSystemPrompt(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string {
    return buildWorkerSystemPrompt(node, parentArtifacts, "summarize", ctx.skillCatalog as never);
  }

  protected buildUserPrompt(node: DeepResearchNode): string {
    return `Summarize and synthesize the evidence from the provided artifacts for: ${node.label}`;
  }

  protected parseOutput(
    _node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    _parentArtifacts: DeepResearchArtifact[],
    result: GenerateResultLike,
  ): Record<string, unknown> {
    return { summary: result.text };
  }

  protected buildArtifactDrafts(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
    output: Record<string, unknown>,
  ): ActorArtifactDraft[] {
    return [{
      artifactType: "structured_summary",
      title: `Summary: ${node.label}`,
      content: output,
      provenance: this.buildProvenance(node, parentArtifacts.map(artifact => artifact.id)),
    }];
  }
}

class ReviewerWorker extends PromptWorker {
  supports(node: DeepResearchNode): boolean {
    return (node.nodeType === "review" || node.nodeType === "deliberate")
      && (node.assignedRole === "reviewer_a" || node.assignedRole === "reviewer_b");
  }

  protected getParentArtifacts(_node: DeepResearchNode, ctx: ActorExecutionContext): DeepResearchArtifact[] {
    return ctx.allArtifacts.filter((artifact) =>
      ["structured_summary", "evidence_card", "step_result", "provisional_conclusion", "experiment_result", "claim_map"].includes(artifact.artifactType)
    );
  }

  protected buildSystemPrompt(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string {
    const previousPackets = ctx.allArtifacts.filter((artifact) => artifact.artifactType === "reviewer_packet");
    const round = typeof node.input?.round === "number" ? node.input.round : undefined;
    const maxRounds = typeof node.input?.maxRounds === "number" ? node.input.maxRounds : undefined;
    return buildReviewerSystemPrompt(
      node.assignedRole as "reviewer_a" | "reviewer_b",
      parentArtifacts,
      previousPackets,
      round && maxRounds ? { round, maxRounds } : undefined,
    );
  }

  protected buildUserPrompt(): string {
    return "Please review the provided artifacts and produce your assessment.";
  }

  protected buildArtifactDrafts(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
    output: Record<string, unknown>,
  ): ActorArtifactDraft[] {
    return [{
      artifactType: "reviewer_packet",
      title: `Review by ${node.assignedRole === "reviewer_a" ? "Reviewer A" : "Reviewer B"}`,
      content: output,
      provenance: this.buildProvenance(node, parentArtifacts.map(artifact => artifact.id)),
    }];
  }
}

class ScientificReviewWorker extends PromptWorker {
  supports(node: DeepResearchNode): boolean {
    return node.nodeType === "scientific_review"
      && (node.assignedRole === "reviewer_a" || node.assignedRole === "reviewer_b");
  }

  protected getParentArtifacts(node: DeepResearchNode, ctx: ActorExecutionContext): DeepResearchArtifact[] {
    const input = (node.input as Record<string, unknown>) ?? {};
    const claimMapIds = new Set(Array.isArray(input.claimMapArtifactIds) ? input.claimMapArtifactIds as string[] : []);
    const synthesisIds = new Set(Array.isArray(input.synthesisArtifactIds) ? input.synthesisArtifactIds as string[] : []);
    return ctx.allArtifacts.filter((artifact) => claimMapIds.has(artifact.id) || synthesisIds.has(artifact.id));
  }

  protected buildSystemPrompt(): string {
    return "You are a scientific reviewer performing a structured dimension-based audit. Respond ONLY with valid JSON matching the ScientificReviewPacket schema.";
  }

  protected buildUserPrompt(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string {
    const input = (node.input as Record<string, unknown>) ?? {};
    const claimMapIds = new Set(Array.isArray(input.claimMapArtifactIds) ? input.claimMapArtifactIds as string[] : []);
    const synthesisIds = new Set(Array.isArray(input.synthesisArtifactIds) ? input.synthesisArtifactIds as string[] : []);
    const claimMapArtifacts = parentArtifacts.filter((artifact) => claimMapIds.has(artifact.id));
    const synthesisArtifacts = parentArtifacts.filter((artifact) => synthesisIds.has(artifact.id));
    return buildScientificReviewPrompt(
      node.assignedRole as "reviewer_a" | "reviewer_b",
      claimMapArtifacts,
      synthesisArtifacts,
      typeof input.round === "number" ? input.round : 1,
      typeof input.maxRounds === "number" ? input.maxRounds : 3,
      Array.isArray(input.previousReviewPackets) ? input.previousReviewPackets as never : undefined,
      Array.isArray(input.issueLedger) ? input.issueLedger as never : undefined,
    );
  }

  protected parseOutput(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    _parentArtifacts: DeepResearchArtifact[],
    result: GenerateResultLike,
  ): Record<string, unknown> {
    const input = (node.input as Record<string, unknown>) ?? {};
    return parseScientificReviewPacket(
      result.text,
      node.assignedRole as "reviewer_a" | "reviewer_b",
      typeof input.round === "number" ? input.round : 1,
    ) as unknown as Record<string, unknown>;
  }

  protected buildArtifactDrafts(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
    output: Record<string, unknown>,
  ): ActorArtifactDraft[] {
    const packet = output as {
      verdict?: string;
      overallScore?: number;
      round?: number;
    };
    const overallScore = typeof packet.overallScore === "number" ? packet.overallScore.toFixed(1) : "0.0";
    return [{
      artifactType: "scientific_review_packet",
      title: `Scientific Review: ${node.assignedRole} Round ${packet.round ?? "?"} (verdict: ${packet.verdict ?? "revise"}, score: ${overallScore})`,
      content: output,
      provenance: this.buildProvenance(node, parentArtifacts.map(artifact => artifact.id)),
    }];
  }
}

class SynthesizerWorker extends PromptWorker {
  supports(node: DeepResearchNode): boolean {
    return node.nodeType === "synthesize_claims" || node.assignedRole === "synthesizer";
  }

  protected buildSystemPrompt(): string {
    return "You are a research synthesizer. Produce a structured ClaimMap from evidence. Respond ONLY with valid JSON.";
  }

  protected buildUserPrompt(node: DeepResearchNode): string {
    const input = (node.input as Record<string, unknown>) ?? {};
    if (input.mode === "revision") {
      return buildRevisionPrompt(
        input.existingClaimMap as never,
        input.revisionRequest as never,
      );
    }
    return buildSynthesizerPrompt(
      input.evidenceCards as never,
      input.requirementState as never,
    );
  }

  protected parseOutput(
    _node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    _parentArtifacts: DeepResearchArtifact[],
    result: GenerateResultLike,
  ): Record<string, unknown> {
    return parseClaimMap(result.text) as unknown as Record<string, unknown>;
  }

  protected buildArtifactDrafts(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    _parentArtifacts: DeepResearchArtifact[],
    output: Record<string, unknown>,
  ): ActorArtifactDraft[] {
    const claimCount = Array.isArray(output.claims) ? output.claims.length : 0;
    const contradictionCount = Array.isArray(output.contradictions) ? output.contradictions.length : 0;
    const gapCount = Array.isArray(output.gaps) ? output.gaps.length : 0;

    return [{
      artifactType: "claim_map",
      title: `Claim Map (${claimCount} claims, ${contradictionCount} contradictions, ${gapCount} gaps)`,
      content: output,
      provenance: this.buildProvenance(node, []),
    }];
  }
}

class TaskWorker extends PromptWorker {
  constructor(
    private readonly supportedNodeTypes: DeepResearchNode["nodeType"][],
    private readonly artifactType: ArtifactType,
  ) {
    super();
  }

  supports(node: DeepResearchNode): boolean {
    return node.assignedRole === "worker" && this.supportedNodeTypes.includes(node.nodeType);
  }

  protected getStepLimit(node: DeepResearchNode): number {
    return node.nodeType === "execute" ? 25 : 20;
  }

  protected buildSystemPrompt(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string {
    return buildWorkerSystemPrompt(node, parentArtifacts, node.nodeType, ctx.skillCatalog as never);
  }

  protected buildUserPrompt(node: DeepResearchNode): string {
    return node.input
      ? JSON.stringify(node.input)
      : `Execute the task: ${node.label}`;
  }

  protected buildArtifactDrafts(
    node: DeepResearchNode,
    _ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
    output: Record<string, unknown>,
  ): ActorArtifactDraft[] {
    return [{
      artifactType: this.artifactType,
      title: `Result: ${node.label}`,
      content: output,
      provenance: this.buildProvenance(node, parentArtifacts.map(artifact => artifact.id)),
    }];
  }
}

class GenericWorker extends PromptWorker {
  supports(node: DeepResearchNode): boolean {
    return node.assignedRole === "worker";
  }

  protected buildSystemPrompt(
    node: DeepResearchNode,
    ctx: ActorExecutionContext,
    parentArtifacts: DeepResearchArtifact[],
  ): string {
    return buildWorkerSystemPrompt(node, parentArtifacts, node.nodeType, ctx.skillCatalog as never);
  }

  protected buildUserPrompt(node: DeepResearchNode): string {
    return node.input
      ? JSON.stringify(node.input)
      : `Execute: ${node.label}`;
  }

  protected buildArtifactDrafts(): ActorArtifactDraft[] {
    return [];
  }
}

export class WorkerRegistry {
  private static readonly workers: MetaWorker[] = [
    new EvidenceGatherWorker(),
    new SummaryWorker(),
    new ReviewerWorker(),
    new ScientificReviewWorker(),
    new SynthesizerWorker(),
    new TaskWorker(["evidence_extract"], "evidence_card"),
    new TaskWorker(["resource_request"], "execution_manifest"),
    new TaskWorker(["execute", "monitor"], "step_result"),
    new TaskWorker(["result_collect"], "experiment_result"),
    new GenericWorker(),
  ];

  static resolve(node: DeepResearchNode): MetaWorker {
    const worker = this.workers.find(candidate => candidate.supports(node));
    if (!worker) {
      throw new Error(`No MetaWorker registered for node ${node.id} (${node.nodeType}, role=${node.assignedRole})`);
    }
    return worker;
  }
}

async function createArtifacts(
  sessionId: string,
  nodeId: string,
  drafts: ActorArtifactDraft[],
) {
  const created = [];
  for (const draft of drafts) {
    created.push(await store.createArtifact(
      sessionId,
      nodeId,
      draft.artifactType,
      draft.title,
      draft.content,
      draft.provenance ?? undefined,
    ));
  }
  return created;
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(jsonStr);
  } catch {
    return { text };
  }
}
