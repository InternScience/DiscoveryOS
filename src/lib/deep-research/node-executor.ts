import { MainBrain } from "./actors/main-brain";
import { WorkerRegistry } from "./actors/workers";
import type {
  ActorExecutionContext,
  ActorExecutionResult,
  DeepResearchNode,
} from "./types";

const mainBrain = new MainBrain();

export async function executeNode(
  node: DeepResearchNode,
  ctx: ActorExecutionContext,
  abortSignal?: AbortSignal,
): Promise<ActorExecutionResult> {
  if (node.assignedRole === "main_brain") {
    return mainBrain.executeNode(node, ctx, abortSignal);
  }

  const worker = WorkerRegistry.resolve(node);
  return worker.execute(node, ctx, abortSignal);
}
