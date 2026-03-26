import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  getMessages,
  getNodes,
  getArtifacts,
  getEvents,
  getExecutionRecords,
} from "@/lib/deep-research/event-store";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [messages, nodes, artifacts, events, executions] = await Promise.all([
    getMessages(sessionId),
    getNodes(sessionId),
    getArtifacts(sessionId),
    getEvents(sessionId),
    getExecutionRecords(sessionId),
  ]);

  return NextResponse.json({
    session,
    messages,
    nodes,
    artifacts,
    events,
    executions,
  });
}
