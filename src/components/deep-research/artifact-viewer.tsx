"use client";

import type { DeepResearchArtifact } from "@/lib/deep-research/types";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ArtifactViewerProps {
  artifact: DeepResearchArtifact;
}

export function ArtifactViewer({ artifact }: ArtifactViewerProps) {
  const content = artifact.content;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold flex-1">{artifact.title}</h4>
        <Badge variant="outline" className="text-[10px]">
          {artifact.artifactType}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          v{artifact.version}
        </Badge>
      </div>

      <ScrollArea className="max-h-[600px]">
        {renderContent(artifact.artifactType, content)}
      </ScrollArea>
    </div>
  );
}

function renderContent(type: string, content: Record<string, unknown>) {
  switch (type) {
    case "research_brief":
      return <KeyValueDisplay data={content} />;

    case "evidence_card":
      return <EvidenceCardDisplay data={content} />;

    case "structured_summary":
      return <MarkdownDisplay text={content.summary as string || JSON.stringify(content, null, 2)} />;

    case "reviewer_packet":
      return <ReviewerPacketDisplay data={content} />;

    case "provisional_conclusion":
      return <KeyValueDisplay data={content} />;

    case "execution_plan":
      return <ExecutionPlanDisplay data={content} />;

    case "step_result":
      return <StepResultDisplay data={content} />;

    case "final_report":
      return <MarkdownDisplay text={
        content.text as string
        || content.report as string
        || content.messageToUser as string
        || content.content as string
        || JSON.stringify(content, null, 2)
      } />;

    case "task_graph":
      return <pre className="text-xs bg-muted p-3 rounded overflow-auto">{JSON.stringify(content, null, 2)}</pre>;

    case "checkpoint":
      return <CheckpointDisplay data={content} />;

    default:
      return <pre className="text-xs bg-muted p-3 rounded overflow-auto">{JSON.stringify(content, null, 2)}</pre>;
  }
}

function KeyValueDisplay({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="text-sm">
          <span className="font-medium text-muted-foreground capitalize">
            {key.replace(/_/g, " ")}:
          </span>{" "}
          <span>{typeof value === "string" ? value : JSON.stringify(value)}</span>
        </div>
      ))}
    </div>
  );
}

function EvidenceCardDisplay({ data }: { data: Record<string, unknown> }) {
  const claims = Array.isArray(data.claims) ? data.claims : [];
  const gaps = Array.isArray(data.gaps) ? data.gaps : [];

  return (
    <div className="space-y-3">
      {claims.map((claim: Record<string, unknown>, i: number) => (
        <div key={i} className="p-2 border rounded text-sm space-y-1">
          <div className="font-medium">{claim.claim as string}</div>
          <div className="text-xs text-muted-foreground">{claim.evidence as string}</div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {claim.source as string}
            </Badge>
            <ConfidenceBadge confidence={claim.confidence as string} />
          </div>
        </div>
      ))}
      {gaps.length > 0 && (
        <div className="p-2 bg-yellow-50 dark:bg-yellow-950 rounded text-sm">
          <div className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">Gaps</div>
          <ul className="list-disc list-inside text-xs space-y-0.5">
            {gaps.map((gap: string, i: number) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReviewerPacketDisplay({ data }: { data: Record<string, unknown> }) {
  const verdict = data.verdict as string;
  const verdictColors: Record<string, string> = {
    approve: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    revise: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    reject: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge className={verdictColors[verdict] || ""}>
          {verdict}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Confidence: {((data.confidence as number) * 100).toFixed(0)}%
        </span>
      </div>
      <div className="text-sm">{data.critique as string}</div>
      {Array.isArray(data.suggestions) && data.suggestions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Suggestions</div>
          <ul className="list-disc list-inside text-sm space-y-0.5">
            {(data.suggestions as string[]).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExecutionPlanDisplay({ data }: { data: Record<string, unknown> }) {
  const steps = Array.isArray(data.steps) ? data.steps : [];
  return (
    <div className="space-y-2">
      {steps.map((step: Record<string, unknown>, i: number) => (
        <div key={i} className="flex items-start gap-2 text-sm p-2 border rounded">
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
            {i + 1}
          </span>
          <div className="flex-1">
            <div className="font-medium">{String(step.label || step.description || "")}</div>
            {step.requiresApproval ? (
              <Badge variant="outline" className="text-[10px] mt-1">Needs Approval</Badge>
            ) : null}
          </div>
        </div>
      ))}
      {steps.length === 0 && (
        <pre className="text-xs bg-muted p-3 rounded overflow-auto">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

function StepResultDisplay({ data }: { data: Record<string, unknown> }) {
  const statusColors: Record<string, string> = {
    success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    failure: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    partial: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  };

  return (
    <div className="space-y-2">
      <Badge className={statusColors[data.status as string] || ""}>
        {data.status as string}
      </Badge>
      {Array.isArray(data.observations) && (
        <ul className="list-disc list-inside text-sm space-y-0.5">
          {(data.observations as string[]).map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
      {data.outputs != null && (
        <pre className="text-xs bg-muted p-2 rounded overflow-auto">
          {JSON.stringify(data.outputs, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors: Record<string, string> = {
    high: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    low: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <Badge className={colors[confidence] || ""} variant="outline">
      {confidence}
    </Badge>
  );
}

function MarkdownDisplay({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function CheckpointDisplay({ data }: { data: Record<string, unknown> }) {
  const title = data.title as string || "Checkpoint";
  const humanSummary = data.humanSummary as string || "";
  const currentFindings = data.currentFindings as string || "";
  const openQuestions = Array.isArray(data.openQuestions) ? data.openQuestions as string[] : [];
  const recommended = data.recommendedNextAction as string || "";
  const alternatives = Array.isArray(data.alternativeNextActions) ? data.alternativeNextActions as string[] : [];
  const phase = data.phase as string || "";
  const stepType = data.stepType as string || "";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm">{title}</span>
        {phase && <Badge variant="outline" className="text-[10px]">{phase}</Badge>}
        {stepType && <Badge variant="secondary" className="text-[10px]">{stepType}</Badge>}
      </div>

      {humanSummary && <div className="text-sm leading-relaxed">{humanSummary}</div>}

      {currentFindings && (
        <div className="text-xs p-2 bg-muted rounded">
          <div className="font-medium text-muted-foreground mb-1">Findings</div>
          {currentFindings}
        </div>
      )}

      {openQuestions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Open Questions</div>
          <ul className="list-disc list-inside text-xs space-y-0.5">
            {openQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}

      {recommended && (
        <div className="text-xs p-2 bg-green-50 dark:bg-green-950/50 rounded">
          <span className="font-medium text-green-800 dark:text-green-200">Recommended: </span>
          <span className="text-green-700 dark:text-green-300">{recommended}</span>
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Alternatives: </span>
          {alternatives.join(" · ")}
        </div>
      )}
    </div>
  );
}
