"use client";

import { PHASE_ORDER, type Phase, type BudgetUsage, type BudgetLimits, type SessionStatus } from "@/lib/deep-research/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2, PauseCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const PHASE_LABELS: Record<Phase, string> = {
  intake: "Intake",
  planning: "Planning",
  evidence_collection: "Evidence",
  structured_understanding: "Understand",
  reviewer_deliberation: "Review",
  decision: "Decision",
  execution_planning: "Exec Plan",
  execution: "Execution",
  review_correction: "Correction",
  final_report: "Report",
};

interface PhaseProgressProps {
  currentPhase: Phase;
  sessionStatus: SessionStatus;
  budget: BudgetUsage;
  budgetLimits: BudgetLimits;
}

export function PhaseProgress({ currentPhase, sessionStatus, budget, budgetLimits }: PhaseProgressProps) {
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  const budgetPercent = Math.min(
    100,
    Math.round((budget.totalTokens / budgetLimits.maxTotalTokens) * 100)
  );
  const isBlocked = sessionStatus === "awaiting_user_confirmation";

  return (
    <div className="space-y-2 px-3 py-2 border-b border-border/50">
      {/* Blocked indicator */}
      {isBlocked && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
          <PauseCircle className="h-3 w-3" />
          Halted — waiting for your confirmation
        </div>
      )}

      {/* Phase steps */}
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {PHASE_ORDER.map((phase, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex;

          return (
            <div
              key={phase}
              className={cn(
                "flex items-center gap-0.5 shrink-0",
                i < PHASE_ORDER.length - 1 && "after:content-[''] after:w-2 after:h-px after:bg-border"
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                  isCompleted && "text-green-600 dark:text-green-400",
                  isCurrent && !isBlocked && "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950",
                  isCurrent && isBlocked && "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950",
                  !isCompleted && !isCurrent && "text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : isCurrent && isBlocked ? (
                  <PauseCircle className="h-3 w-3" />
                ) : isCurrent ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
                <span className="hidden xl:inline">{PHASE_LABELS[phase]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Budget bar */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground shrink-0">Budget</span>
        <Progress value={budgetPercent} className="h-1.5 flex-1" />
        <span className="text-[10px] text-muted-foreground shrink-0">{budgetPercent}%</span>
      </div>
    </div>
  );
}
