"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle,
  XCircle,
  RotateCcw,
  GitBranch,
  Square,
  ChevronDown,
  ChevronUp,
  FileText,
  HelpCircle,
  ArrowRight,
} from "lucide-react";
import type { DeepResearchArtifact } from "@/lib/deep-research/types";
import type { ConfirmationOutcome } from "@/lib/deep-research/types";

interface CheckpointData {
  title: string;
  humanSummary: string;
  currentFindings: string;
  openQuestions: string[];
  recommendedNextAction: string;
  alternativeNextActions: string[];
  artifactsToReview: string[];
  phase: string;
  stepType: string;
}

interface CheckpointReviewProps {
  checkpoint: CheckpointData;
  artifacts: DeepResearchArtifact[];
  onConfirm: (outcome: ConfirmationOutcome, feedback?: string) => Promise<void>;
}

export function CheckpointReview({ checkpoint, artifacts, onConfirm }: CheckpointReviewProps) {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showFindings, setShowFindings] = useState(false);

  const relatedArtifacts = artifacts.filter((a) =>
    checkpoint.artifactsToReview.includes(a.id)
  );

  const handleAction = async (outcome: ConfirmationOutcome) => {
    setSubmitting(true);
    try {
      await onConfirm(outcome, feedback.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-amber-300 dark:border-amber-700 rounded-lg bg-amber-50/50 dark:bg-amber-950/30 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
        <span className="text-sm font-semibold flex-1 text-amber-900 dark:text-amber-100">
          {checkpoint.title}
        </span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {checkpoint.phase}
        </Badge>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Summary */}
          <div className="text-sm text-foreground leading-relaxed">
            {checkpoint.humanSummary}
          </div>

          {/* Current findings (collapsible) */}
          {checkpoint.currentFindings && (
            <div>
              <button
                onClick={() => setShowFindings(!showFindings)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <FileText className="h-3 w-3" />
                Current findings
                {showFindings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showFindings && (
                <div className="mt-1 p-2 bg-background rounded text-xs leading-relaxed max-h-[200px] overflow-auto">
                  {checkpoint.currentFindings}
                </div>
              )}
            </div>
          )}

          {/* Open questions */}
          {checkpoint.openQuestions.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <HelpCircle className="h-3 w-3" />
                Open questions
              </div>
              <ul className="text-xs space-y-0.5 pl-4 list-disc text-muted-foreground">
                {checkpoint.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended action */}
          <div className="flex items-start gap-2 p-2 bg-green-50 dark:bg-green-950/50 rounded text-xs">
            <ArrowRight className="h-3 w-3 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-green-800 dark:text-green-200">Recommended: </span>
              <span className="text-green-700 dark:text-green-300">{checkpoint.recommendedNextAction}</span>
            </div>
          </div>

          {/* Alternative actions */}
          {checkpoint.alternativeNextActions.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Alternatives: </span>
              {checkpoint.alternativeNextActions.join(" · ")}
            </div>
          )}

          {/* Related artifacts */}
          {relatedArtifacts.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {relatedArtifacts.map((a) => (
                <Badge key={a.id} variant="secondary" className="text-[10px]">
                  {a.artifactType}: {a.title}
                </Badge>
              ))}
            </div>
          )}

          {/* Feedback input */}
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Optional: Add feedback, instructions, or corrections..."
            className="text-sm min-h-[60px] max-h-[120px] resize-none bg-background"
            rows={2}
          />

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-7 px-3 text-xs gap-1.5"
              onClick={() => handleAction("confirmed")}
              disabled={submitting}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Continue
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs gap-1.5"
              onClick={() => handleAction("revision_requested")}
              disabled={submitting}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Revise
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs gap-1.5"
              onClick={() => handleAction("branch_requested")}
              disabled={submitting}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Branch
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs gap-1.5 text-red-600"
              onClick={() => handleAction("rejected")}
              disabled={submitting}
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs gap-1.5 text-red-600"
              onClick={() => handleAction("stopped")}
              disabled={submitting}
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
