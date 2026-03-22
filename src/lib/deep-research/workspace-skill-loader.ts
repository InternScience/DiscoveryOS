// =============================================================
// Workspace Skill Loader for Deep Research
// =============================================================
// Loads workspace skills from DB and builds the tool set
// (getSkillInstructions + bash) for deep research nodes.

import { db } from "@/lib/db";
import { skills as skillsTable, workspaces } from "@/lib/db/schema";
import { and, eq, or, isNull } from "drizzle-orm";
import path from "path";
import { validatePath } from "@/lib/files/filesystem";
import { baseExecEnv } from "@/lib/utils/shell";
import { getK8sConfig } from "@/lib/cluster/config";
import { createSkillTools } from "@/lib/ai/tools/skill-tools";
import { createShellTools } from "@/lib/ai/tools/shell-tools";
import type { ToolContext } from "@/lib/ai/tools/types";

export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string | null;
}

/** Load enabled skills for a workspace from the DB. */
export async function loadWorkspaceSkillCatalog(
  workspaceId: string
): Promise<SkillCatalogEntry[]> {
  try {
    const rows = await db
      .select({
        slug: skillsTable.slug,
        name: skillsTable.name,
        description: skillsTable.description,
      })
      .from(skillsTable)
      .where(
        and(
          eq(skillsTable.isEnabled, true),
          or(
            isNull(skillsTable.workspaceId),
            eq(skillsTable.workspaceId, workspaceId)
          )
        )
      );
    return rows;
  } catch (err) {
    console.warn("[workspace-skill-loader] Failed to load skill catalog:", err);
    return [];
  }
}

/** Get the workspace folderPath from DB. */
async function getWorkspaceCwd(workspaceId: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ folderPath: workspaces.folderPath })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return rows[0]?.folderPath ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the tool set for deep research nodes: getSkillInstructions + bash.
 * Returns empty object if no workspace or skills available.
 */
export async function createWorkspaceSkillTools(
  workspaceId: string
): Promise<Record<string, unknown>> {
  const skillTools = createSkillTools(workspaceId);

  // Try to get workspace cwd for bash tool
  const cwd = await getWorkspaceCwd(workspaceId);
  if (!cwd) {
    // No workspace folder — return skill instructions tool only (no bash)
    return { ...skillTools };
  }

  try {
    const validatedCwd = validatePath(cwd);
    const k8sConfig = await getK8sConfig();
    const kubeconfigPath = k8sConfig.kubeconfigPath
      ? (path.isAbsolute(k8sConfig.kubeconfigPath)
          ? k8sConfig.kubeconfigPath
          : path.resolve(process.cwd(), k8sConfig.kubeconfigPath))
      : path.join(process.cwd(), "config", "d_k8s");

    const ctx: ToolContext = {
      validatedCwd,
      resolvePath: (filePath: string) => {
        const resolved = path.isAbsolute(filePath)
          ? filePath
          : path.join(validatedCwd, filePath);
        return validatePath(resolved);
      },
      kubeconfigPath,
      k8sConfig,
      baseExecEnv,
      workspaceId,
      isLongAgent: true, // use tighter truncation for deep research
    };

    const shellTools = createShellTools(ctx);
    return { ...skillTools, ...shellTools };
  } catch (err) {
    console.warn("[workspace-skill-loader] Failed to create shell tools:", err);
    return { ...skillTools };
  }
}
