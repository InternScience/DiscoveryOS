import { evidenceCardToMarkdown } from "./evidence-cards";
import type {
  ClaimMap,
  EvidenceCardCollection,
  RequirementState,
  ReviewRevisionRequest,
} from "./types";

export function buildSynthesizerPrompt(
  cards: EvidenceCardCollection,
  requirementState?: RequirementState | null,
): string {
  const cardsMarkdown = cards.cards.map(c => evidenceCardToMarkdown(c)).join("\n\n---\n\n");

  const requirementSection = requirementState
    ? `\n## Research Requirements\n- Goal: ${requirementState.currentApprovedGoal}\n- Active requirements: ${requirementState.requirements.filter(r => r.status === "active").map(r => r.text).join("; ")}`
    : "";

  return `You are the Synthesizer. Your job is to read evidence cards and produce a structured ClaimMap.

## STRICT RULES
1. Build claims ONLY from the evidence provided below. Do NOT fabricate.
2. For each claim, classify its strength: strong (multiple independent sources), moderate (1-2 sources), weak (single source with caveats), unsupported (no direct evidence).
3. Map each claim to its supporting source indices.
4. Identify contradictions between sources explicitly.
5. Identify evidence GAPS - topics where evidence is missing or insufficient.
6. For every claim, distinguish its knowledge type:
   - "retrieved_evidence": directly supported by a source below
   - "background_knowledge": general domain knowledge not from these sources
   - "assumption": reasonable assumption not directly evidenced
   - "speculation": forward-looking inference beyond the evidence

## Evidence Cards (${cards.totalSources} sources, ${cards.totalExcerpts} excerpts)

### Retrieval Summary
- Successful retrievals: ${cards.retrievalSummary.successful}
- Partial retrievals: ${cards.retrievalSummary.partial}
- Failed retrievals: ${cards.retrievalSummary.failed}
- Empty retrievals: ${cards.retrievalSummary.empty}

${cardsMarkdown}
${requirementSection}

## Output Format
Respond with valid JSON matching the ClaimMap schema:
{
  "claims": [
    {
      "id": "c1",
      "text": "Claim text",
      "strength": "strong|moderate|weak|unsupported",
      "supportingSources": [0, 2],
      "contradictingSources": [],
      "category": "topic category",
      "knowledgeType": "retrieved_evidence|background_knowledge|assumption|speculation"
    }
  ],
  "supportMatrix": { "c1": [0, 2], "c2": [1] },
  "contradictions": [
    { "claimAId": "c1", "claimBId": "c3", "description": "...", "possibleResolution": "..." }
  ],
  "gaps": [
    { "topic": "...", "description": "...", "suggestedQueries": ["..."], "priority": "high|medium|low" }
  ],
  "confidenceDistribution": { "strong": 3, "moderate": 5, "weak": 2, "unsupported": 1 }
}

Be thorough. Missing a contradiction or gap is worse than including a weak claim.`;
}

export function buildRevisionPrompt(
  existingClaimMap: ClaimMap,
  revisionRequest: ReviewRevisionRequest,
): string {
  const claimMapJson = JSON.stringify(existingClaimMap, null, 2);
  const truncatedMap = claimMapJson.length > 4000
    ? claimMapJson.slice(0, 4000) + "\n... (truncated)"
    : claimMapJson;

  const revisionPointsStr = revisionRequest.revisionPoints.map((rp, i) =>
    `${i + 1}. **${rp.target}** ${rp.issueId ? `[${rp.issueId}]` : ""}
   - Problem: ${rp.problem}
   - Expected outcome: ${rp.expectedOutcome}`
  ).join("\n");

  const antiPatternStr = revisionRequest.antiPatternsToFix.length > 0
    ? `\n## Anti-Patterns to Fix\n${revisionRequest.antiPatternsToFix.map(ap =>
      `- **${ap.pattern}** at ${ap.location}: ${ap.description}\n  Fix: ${ap.suggestedFix}`
    ).join("\n")}`
    : "";

  return `You are the Synthesizer performing a TARGETED REVISION of an existing ClaimMap.

## CONTEXT
The scientific reviewers have identified specific issues that must be fixed.
You must revise the ClaimMap to address EACH revision point below.

## STRICT RULES
1. Address EVERY revision point - do not skip any
2. Do NOT fabricate new evidence that wasn't in the original sources
3. You MAY: re-classify claim strength, add caveats, remove unsupported claims, fix contradictions, update gap analysis
4. You MAY NOT: invent new sources, hallucinate citations, add claims without evidence
5. Preserve claims that were NOT flagged - only modify what reviewers identified

## Existing ClaimMap
${truncatedMap}

## Revision Points (from reviewer round ${revisionRequest.fromRound})
${revisionPointsStr}
${antiPatternStr}

## Output Format
Respond with valid JSON matching the ClaimMap schema - the COMPLETE revised ClaimMap (not just changes).
Include ALL claims (modified and unmodified).`;
}

export function parseClaimMap(text: string): ClaimMap {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return validateClaimMap(parsed);
  } catch {
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
          if (depth === 0) {
            const parsed = JSON.parse(text.slice(firstBrace, i + 1));
            return validateClaimMap(parsed);
          }
        }
      }
    }
    throw new Error("Failed to parse ClaimMap from synthesizer output");
  }
}

function validateClaimMap(obj: Record<string, unknown>): ClaimMap {
  return {
    claims: Array.isArray(obj.claims) ? obj.claims : [],
    supportMatrix: (obj.supportMatrix as Record<string, number[]>) ?? {},
    contradictions: Array.isArray(obj.contradictions) ? obj.contradictions : [],
    gaps: Array.isArray(obj.gaps) ? obj.gaps : [],
    confidenceDistribution: (obj.confidenceDistribution as Record<string, number>) ?? {
      strong: 0,
      moderate: 0,
      weak: 0,
      unsupported: 0,
    },
  };
}
