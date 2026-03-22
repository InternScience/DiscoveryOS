import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "@/lib/ai/models";
import type { ProviderId } from "@/lib/ai/models";
import { getModelFromOverride } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { LanguageModel } from "ai";
import type {
  ModelRole,
  DeepResearchConfig,
  BudgetLimits,
  BudgetUsage,
} from "./types";

// --- Model routing ---
// All roles use the global model from Settings.
// No fallback models are configured.

/** Sentinel values that mean "not really configured". */
const PLACEHOLDER_KEYS = new Set(["none", "null", "undefined", "placeholder", "xxx", "your-api-key-here", ""]);

function isProviderAvailable(provider: string): boolean {
  const p = PROVIDERS[provider as ProviderId];
  if (!p) return false;
  const key = (process.env[p.envKey] ?? "").trim();
  return key.length > 0 && !PLACEHOLDER_KEYS.has(key.toLowerCase());
}

/**
 * Resolve the global model from process.env first, then fall back to DB.
 * Does NOT check isProviderAvailable — the user explicitly configured it.
 */
async function resolveGlobalModel(): Promise<{ model: LanguageModel; provider: string; modelId: string } | null> {
  // 1. process.env (updated in-memory by settings PATCH)
  const envProvider = process.env.LLM_PROVIDER;
  const envModel = process.env.LLM_MODEL;
  if (envProvider && envModel) {
    const { model } = getModelFromOverride(envProvider, envModel);
    return { model, provider: envProvider, modelId: envModel };
  }

  // 2. Fallback: read from database
  try {
    const settings = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, ["llm_provider", "llm_model"]));
    const provider = settings.find((s) => s.key === "llm_provider")?.value || DEFAULT_PROVIDER;
    const modelId = settings.find((s) => s.key === "llm_model")?.value || DEFAULT_MODEL;
    const { model } = getModelFromOverride(provider, modelId);
    return { model, provider, modelId };
  } catch {
    return null;
  }
}

/**
 * Resolve the current global model info (provider + modelId) without
 * constructing a LanguageModel instance. Used at session creation time
 * to snapshot the configured model into the session config.
 */
export async function resolveCurrentModelInfo(): Promise<{ provider: string; modelId: string }> {
  const envProvider = process.env.LLM_PROVIDER;
  const envModel = process.env.LLM_MODEL;
  if (envProvider && envModel) {
    return { provider: envProvider, modelId: envModel };
  }
  try {
    const settings = await db
      .select()
      .from(appSettings)
      .where(inArray(appSettings.key, ["llm_provider", "llm_model"]));
    const provider = settings.find((s) => s.key === "llm_provider")?.value || DEFAULT_PROVIDER;
    const modelId = settings.find((s) => s.key === "llm_model")?.value || DEFAULT_MODEL;
    return { provider, modelId };
  } catch {
    return { provider: DEFAULT_PROVIDER, modelId: DEFAULT_MODEL };
  }
}

/**
 * Resolve the model for a given role. Tries config overrides first,
 * then the session's resolvedModel, then the global model from Settings.
 */
export async function getModelForRole(
  role: ModelRole,
  config?: DeepResearchConfig
): Promise<{ model: LanguageModel; provider: string; modelId: string }> {
  // Check config overrides first
  const override = config?.modelOverrides?.[role];
  if (override && isProviderAvailable(override.provider)) {
    const { model } = getModelFromOverride(override.provider, override.modelId);
    return { model, provider: override.provider, modelId: override.modelId };
  }

  // Check session-level resolved model (snapshotted at creation time)
  if (config?.resolvedModel) {
    const { provider, modelId } = config.resolvedModel;
    const { model } = getModelFromOverride(provider, modelId);
    return { model, provider, modelId };
  }

  // Use global model (trust user's Settings config, no availability check)
  const global = await resolveGlobalModel();
  if (global) return global;

  throw new Error(
    `No available model for role "${role}". Please configure a model in Settings.`
  );
}

/**
 * Get the model for a role (config override or global model).
 * Returns a single-element array for API compatibility with fallback callers.
 */
export async function getModelChainForRole(
  role: ModelRole,
  config?: DeepResearchConfig
): Promise<Array<{ model: LanguageModel; provider: string; modelId: string }>> {
  const results: Array<{ model: LanguageModel; provider: string; modelId: string }> = [];

  // Config override first
  const override = config?.modelOverrides?.[role];
  if (override && isProviderAvailable(override.provider)) {
    const { model } = getModelFromOverride(override.provider, override.modelId);
    results.push({ model, provider: override.provider, modelId: override.modelId });
  }

  // Session-level resolved model (snapshotted at creation time)
  if (config?.resolvedModel) {
    const { provider, modelId } = config.resolvedModel;
    if (!results.some(r => r.provider === provider && r.modelId === modelId)) {
      const { model } = getModelFromOverride(provider, modelId);
      results.push({ model, provider, modelId });
    }
  }

  // Then use global model as final fallback
  if (results.length === 0) {
    const global = await resolveGlobalModel();
    if (global && !results.some(r => r.provider === global.provider && r.modelId === global.modelId)) {
      results.push(global);
    }
  }

  return results;
}

// --- Budget tracking ---

export function checkBudget(
  role: ModelRole,
  usage: BudgetUsage,
  limits: BudgetLimits
): { allowed: boolean; reason?: string } {
  if (usage.totalTokens >= limits.maxTotalTokens) {
    return { allowed: false, reason: `Total token budget exceeded (${usage.totalTokens}/${limits.maxTotalTokens})` };
  }
  if (role === "main_brain" && usage.opusTokens >= limits.maxOpusTokens) {
    return { allowed: false, reason: `Opus token budget exceeded (${usage.opusTokens}/${limits.maxOpusTokens})` };
  }
  return { allowed: true };
}

export function trackUsage(
  usage: BudgetUsage,
  role: ModelRole,
  nodeId: string,
  tokens: number
): BudgetUsage {
  const updated = { ...usage };
  updated.totalTokens += tokens;
  if (role === "main_brain") {
    updated.opusTokens += tokens;
  }
  updated.byRole = { ...updated.byRole };
  updated.byRole[role] = (updated.byRole[role] || 0) + tokens;
  updated.byNode = { ...updated.byNode, [nodeId]: (updated.byNode[nodeId] || 0) + tokens };
  return updated;
}
