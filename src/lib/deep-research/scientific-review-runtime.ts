import type {
  AntiPatternType,
  DeepResearchArtifact,
  ReviewDimension,
  ReviewIssue,
  ScientificReviewPacket,
  ScientificVerdict,
} from "./types";

export const ALL_DIMENSIONS: ReviewDimension[] = [
  "problem_definition",
  "literature_grounding",
  "mechanism_validity",
  "baseline_coverage",
  "falsifiability",
  "metric_design",
  "compute_feasibility",
  "data_feasibility",
  "engineering_readiness",
  "domain_mismatch_risk",
  "novelty_positioning",
  "reproducibility",
  "overclaiming_risk",
];

export const DIMENSION_LABELS: Record<ReviewDimension, string> = {
  problem_definition: "Problem Definition",
  literature_grounding: "Literature Grounding",
  mechanism_validity: "Mechanism Validity",
  baseline_coverage: "Baseline Coverage",
  falsifiability: "Falsifiability",
  metric_design: "Metric Design",
  compute_feasibility: "Compute Feasibility",
  data_feasibility: "Data Feasibility",
  engineering_readiness: "Engineering Readiness",
  domain_mismatch_risk: "Domain Mismatch Risk",
  novelty_positioning: "Novelty Positioning",
  reproducibility: "Reproducibility",
  overclaiming_risk: "Overclaiming Risk",
};

export const ALL_ANTI_PATTERNS: AntiPatternType[] = [
  "citation_hallucination",
  "benchmark_mismatch",
  "metric_cherry_picking",
  "unfounded_generalization",
  "missing_ablation",
  "dataset_contamination_risk",
  "p_hacking_risk",
  "survivorship_bias",
  "scope_creep",
  "circular_reasoning",
];

const PASS_RUBRIC = {
  minimumPerDimension: 3,
  minimumOverallAverage: 3.5,
  maxOpenMajorIssues: 2,
};

const MAX_CRITICAL_BLOCKERS_ROUND_1 = 5;
const MAX_NEW_CRITICAL_BLOCKERS_ROUND_2 = 1;

export function buildScientificReviewPrompt(
  role: "reviewer_a" | "reviewer_b",
  claimMapArtifacts: DeepResearchArtifact[],
  synthesisArtifacts: DeepResearchArtifact[],
  round: number,
  maxRounds: number,
  previousReviewPackets?: ScientificReviewPacket[],
  issueLedger?: ReviewIssue[],
): string {
  const roleLabel = role === "reviewer_a" ? "Reviewer A" : "Reviewer B";

  const artifactSection = [...claimMapArtifacts, ...synthesisArtifacts]
    .map(a => {
      const contentStr = JSON.stringify(a.content, null, 2);
      const preview = contentStr.length > 3000 ? contentStr.slice(0, 3000) + "\n... (truncated)" : contentStr;
      return `### ${a.title} (${a.artifactType})\n${preview}`;
    })
    .join("\n\n");

  let previousSection = "";
  if (previousReviewPackets && previousReviewPackets.length > 0) {
    const prevByRound = new Map<number, ScientificReviewPacket[]>();
    for (const p of previousReviewPackets) {
      const arr = prevByRound.get(p.round) ?? [];
      arr.push(p);
      prevByRound.set(p.round, arr);
    }

    const sections: string[] = [];
    for (const [r, packets] of prevByRound) {
      for (const p of packets) {
        sections.push(`#### Round ${r} - ${p.reviewerRole}\n` +
          `Verdict: ${p.verdict}, Score: ${p.overallScore}\n` +
          `Critical Blockers: ${p.criticalBlockers.length}\n` +
          `Major Issues: ${p.majorIssues.length}\n` +
          `Anti-Patterns: ${(p.antiPatternFlags ?? []).length}\n` +
          JSON.stringify(p, null, 2).slice(0, 1500));
      }
    }
    previousSection = `\n## Previous Review Rounds\n${sections.join("\n\n")}`;
  }

  let issueLedgerSection = "";
  if (issueLedger && issueLedger.length > 0) {
    const issueLines = issueLedger.map(i =>
      `- **${i.issueId}** [${i.status}] (${i.severity}) ${i.title} - raised round ${i.raisedInRound} by ${i.raisedBy}`
    );
    issueLedgerSection = `\n## Issue Ledger - Track These Issues\nEach issue has a persistent ID. Update status for each:\n${issueLines.join("\n")}\n\nFor each issue, assess: resolved / partially_resolved / open / deferred / blocked.`;
  }

  let roundInstructions: string;
  if (round === 1) {
    roundInstructions = `## Round 1 Instructions
This is the FIRST review round. Your job is to find ALL significant issues.
- Identify up to ${MAX_CRITICAL_BLOCKERS_ROUND_1} critical blockers (the most important ones)
- Identify major issues (no cap)
- For each blocker: specify issue, severity, why it matters, evidence, repair action, and pass condition
- Score all ${ALL_DIMENSIONS.length} dimensions on a 1-5 scale with justification
- Run the ANTI-PATTERN CHECKLIST below
- Choose verdict: pass / revise / experimental_pivot / reject`;
  } else if (round === 2) {
    roundInstructions = `## Round 2 Instructions - FOCUS ON PRIOR BLOCKERS
This is the SECOND review round. Your PRIMARY job is to verify whether Round 1 blockers were addressed.
- Check each prior issue in the ledger: was it fixed? partially fixed? not addressed?
- You may add at most ${MAX_NEW_CRITICAL_BLOCKERS_ROUND_2} NEW critical blocker (only if something truly critical was missed)
- Re-score all dimensions - note improvements or regressions
- Re-run the ANTI-PATTERN CHECKLIST
- If all prior critical blockers are resolved and scores improved -> consider "pass"
- If blockers remain but progress is clear -> "revise"
- If foundational issues prevent literature resolution but a pilot experiment is tractable -> "experimental_pivot"`;
  } else {
    roundInstructions = `## Round ${round} Instructions - FORCED DECISION
This is the FINAL review round (Round ${round} of ${maxRounds}).
You MUST choose one of: pass / experimental_pivot / reject
- "revise" is NOT allowed in the final round
- NO new blockers may be introduced
- Evaluate based on the current state of evidence and prior fixes
- Choose "experimental_pivot" if: foundational literature remains unresolved BUT construct validity can be tested via a tractable pilot experiment
- Choose "pass" if: all critical blockers are resolved and dimensions are acceptable
- Choose "reject" ONLY if: fundamental, irreparable flaws remain`;
  }

  const dimensionList = ALL_DIMENSIONS.map(d =>
    `- **${d}** (${DIMENSION_LABELS[d]}): Score 1-5, where 1=critical_failure, 2=major_weakness, 3=acceptable, 4=good, 5=excellent`
  ).join("\n");

  const antiPatternChecklist = ALL_ANTI_PATTERNS.map(p =>
    `- **${p}**: Check if synthesis exhibits this pattern`
  ).join("\n");

  const passRubricSection = `## Pass Rubric
A verdict of "pass" requires ALL of the following:
- Every dimension score >= ${PASS_RUBRIC.minimumPerDimension}
- Overall average >= ${PASS_RUBRIC.minimumOverallAverage}
- Zero open critical issues
- Zero critical anti-patterns
- At most ${PASS_RUBRIC.maxOpenMajorIssues} open major issues
If these criteria are not met, you MUST NOT verdict "pass".`;

  return `You are ${roleLabel} performing a structured scientific review (Round ${round} of ${maxRounds}).

## YOUR ROLE AND LIMITS
- You CRITIQUE the research synthesis using structured dimensions.
- You CANNOT dispatch workers, search papers, or run experiments.
- You MUST be specific - never say "evidence insufficient" without specifying WHAT is missing.
- You MUST distinguish:
  - retrieved_evidence: claims backed by sources in the synthesis
  - background_knowledge: general domain knowledge not from retrieved sources
  - assumptions: reasonable but unverified inferences
  - unsupported_claims: claims with no backing

## Artifacts to Review
${artifactSection}
${previousSection}
${issueLedgerSection}

${roundInstructions}

${passRubricSection}

## Review Dimensions
Score each dimension 1-5 with justification:
${dimensionList}

## Anti-Pattern Checklist
Flag any detected anti-patterns:
${antiPatternChecklist}

## Output Format
Respond with valid JSON:
{
  "reviewerRole": "${role}",
  "round": ${round},
  "dimensions": [
    {
      "dimension": "problem_definition",
      "score": 4,
      "justification": "Clear problem statement with well-defined scope...",
      "suggestedImprovement": "Could strengthen by..."
    }
  ],
  "overallScore": 3.5,
  "verdict": "pass|revise|experimental_pivot|reject",
  "criticalBlockers": [
    {
      "issue": "Specific description of the blocking issue",
      "severity": "critical",
      "whyItMatters": "Why this blocks scientific validity",
      "evidenceForIssue": "What in the synthesis shows this problem",
      "repairAction": "Concrete action to fix this",
      "passCondition": "What would make this blocker pass"
    }
  ],
  "majorIssues": [...],
  "minorSuggestions": ["Suggestion 1", "Suggestion 2"],
  "repairPaths": [
    {
      "blockerId": "b1",
      "action": "Concrete repair action",
      "estimatedEffort": "low|medium|high",
      "prerequisite": "optional dependency"
    }
  ],
  "passConditions": ["Condition 1 that would make this pass", "Condition 2"],
  "trackedIssues": [
    {
      "issueId": "ISS-001",
      "status": "open|partially_resolved|resolved|deferred|blocked",
      "note": "Assessment of this issue in the current round"
    }
  ],
  "antiPatternFlags": [
    {
      "pattern": "citation_hallucination",
      "location": "Claim c3",
      "description": "Cites Smith et al. 2023 but no such source in evidence cards",
      "severity": "critical",
      "suggestedFix": "Remove claim or find actual source"
    }
  ]
}

## CRITICAL RULES
1. Every blocker MUST have a repair action and pass condition
2. Never reject vaguely - always specify what is wrong and how to fix it
3. "experimental_pivot" means: literature gaps are real but a pilot experiment can test the core hypothesis
4. Distinguish retrieved evidence from assumptions in your justifications
5. ${round >= maxRounds ? "You MUST choose pass/experimental_pivot/reject. 'revise' is NOT allowed." : "Be thorough but constructive."}
6. Do NOT verdict "pass" unless the Pass Rubric is fully satisfied
7. Update tracked issue statuses accurately - do not mark as resolved unless genuinely fixed`;
}

export function parseScientificReviewPacket(
  text: string,
  role: "reviewer_a" | "reviewer_b",
  round: number,
): ScientificReviewPacket {
  const parsed = extractJsonFromText(text);
  if (!parsed) {
    return createFallbackPacket(role, round);
  }

  const dimensions = Array.isArray(parsed.dimensions)
    ? parsed.dimensions
        .filter((d): d is ScientificReviewPacket["dimensions"][number] => {
          return !!d && typeof d === "object" && typeof (d as { dimension?: unknown }).dimension === "string";
        })
        .map((d) => ({
          dimension: ((d as { dimension: ReviewDimension }).dimension),
          score: normalizeScore((d as { score?: unknown }).score),
          justification: String((d as { justification?: unknown }).justification ?? ""),
          suggestedImprovement: typeof (d as { suggestedImprovement?: unknown }).suggestedImprovement === "string"
            ? (d as { suggestedImprovement: string }).suggestedImprovement
            : undefined,
        }))
    : [];

  const byDimension = new Map(dimensions.map((d) => [d.dimension, d]));
  const normalizedDimensions = ALL_DIMENSIONS.map(dim =>
    byDimension.get(dim) ?? {
      dimension: dim,
      score: 3,
      justification: "No explicit assessment provided",
    }
  );

  const verdict = validateVerdict(parsed.verdict as string | undefined);
  const overallScoreRaw = typeof parsed.overallScore === "number"
    ? parsed.overallScore
    : normalizedDimensions.reduce((sum, dim) => sum + dim.score, 0) / Math.max(normalizedDimensions.length, 1);

  return {
    reviewerRole: role,
    round,
    dimensions: normalizedDimensions,
    overallScore: Number.isFinite(overallScoreRaw) ? overallScoreRaw : 3,
    verdict,
    criticalBlockers: ensureArray(parsed.criticalBlockers),
    majorIssues: ensureArray(parsed.majorIssues),
    minorSuggestions: ensureStringArray(parsed.minorSuggestions),
    repairPaths: ensureArray(parsed.repairPaths),
    passConditions: ensureStringArray(parsed.passConditions),
    trackedIssues: ensureArray(parsed.trackedIssues),
    antiPatternFlags: ensureArray(parsed.antiPatternFlags),
  };
}

function normalizeScore(raw: unknown): number {
  const value = typeof raw === "number" ? raw : 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function validateVerdict(raw: string | undefined): ScientificVerdict {
  const valid: ScientificVerdict[] = ["pass", "revise", "experimental_pivot", "reject"];
  if (raw && valid.includes(raw as ScientificVerdict)) return raw as ScientificVerdict;
  return "revise";
}

function createFallbackPacket(role: "reviewer_a" | "reviewer_b", round: number): ScientificReviewPacket {
  return {
    reviewerRole: role,
    round,
    dimensions: ALL_DIMENSIONS.map(dim => ({
      dimension: dim,
      score: 3,
      justification: "Review could not be completed - using neutral default",
    })),
    overallScore: 3.0,
    verdict: "revise",
    criticalBlockers: [],
    majorIssues: [],
    minorSuggestions: ["Review generation failed - manual review recommended"],
    repairPaths: [],
    passConditions: ["Complete manual scientific review"],
    antiPatternFlags: [],
  };
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function ensureStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function extractJsonFromText(text: string): Record<string, unknown> | null {
  try {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) return JSON.parse(fenceMatch[1].trim());

    const firstBrace = text.indexOf("{");
    if (firstBrace >= 0) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = firstBrace; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === "\"") { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) return JSON.parse(text.slice(firstBrace, i + 1));
        }
      }
    }
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}
