import type { Gap, SkillClaim, GenerationProfile } from "@/lib/agents/contracts";
// TEMPORARY: OPENAI_API_KEY has no billing attached yet, so probe generation
// is pointed at Gemini (lib/gemini.ts) for testing today. Swap back to
// `askOpenAIJson` from "@/lib/openai" once OpenAI billing is set up --
// CLAUDE.md's approved AI vendor is OpenAI only.
import { askGeminiJson } from "@/lib/gemini";

// Selection + generation of probe questions, per PLAN.md §6.2.
// Cap 2, priority: (1) highest-severity non-blocking gap, (2) highest-value
// owned_in_role claim. Blocking gaps are excluded — a candidate with a
// blocking gap should have failed the invite threshold already; interviewing
// them to reconfirm what disqualified them wastes everyone's time.

export interface ProbeSourceItem {
  type: "gap" | "claim";
  requirementKey?: string;
  claimKey?: string;
  label: string;
  reason?: string;
  evidenceStrength?: SkillClaim["evidenceStrength"];
}

export interface GeneratedProbe {
  text: string;
  rationale: string;
  sourceRef: ProbeSourceItem;
}

const SEVERITY_RANK: Record<Gap["severity"], number> = {
  blocking: 0,
  significant: 1,
  minor: 2,
};

function selectProbeItems(gaps: Gap[], claims: SkillClaim[]): ProbeSourceItem[] {
  const items: ProbeSourceItem[] = [];

  const [topGap] = gaps
    .filter((g) => g.severity !== "blocking")
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (topGap) {
    items.push({
      type: "gap",
      requirementKey: topGap.requirementKey,
      label: topGap.requirementKey,
      reason: topGap.reason,
    });
  }

  const [topClaim] = claims.filter((c) => c.evidenceStrength === "owned_in_role");
  if (topClaim) {
    items.push({
      type: "claim",
      claimKey: topClaim.key,
      label: topClaim.label,
      evidenceStrength: topClaim.evidenceStrength,
    });
  }

  return items.slice(0, 2);
}

const PROBE_SYSTEM_PROMPT = `You write ONE follow-up question for a recorded screening interview.

You are given a capability profile (identity has been removed) and one item to probe.

If the item is a GAP: write a question that gives the candidate a fair chance to
show relevant capability. Do not imply they lack it, do not mention their resume.
Neutral framing only.

If the item is a CLAIM: write a question that invites specifics about the work —
what they decided, what broke, what they'd change. A person who did the work can
answer in detail; a person who didn't will stay abstract. Do NOT write a
"gotcha" or ask them to prove anything.

The question must be answerable in 90 seconds and must not reference any company,
college, or person by name.

Return ONLY valid JSON: {"text":"...","rationale":"<one line, for the recruiter>"}`;

async function generateOneProbe(
  item: ProbeSourceItem,
  profile: GenerationProfile,
): Promise<GeneratedProbe | null> {
  const user = `ITEM TO PROBE:\n${JSON.stringify(item)}\n\nCANDIDATE CAPABILITY PROFILE (identity redacted):\n${JSON.stringify(profile)}`;

  const result = await askGeminiJson<{ text: string; rationale: string }>({
    system: PROBE_SYSTEM_PROMPT,
    user,
    maxTokens: 512,
  });
  if (!result.ok) return null;
  return { text: result.data.text, rationale: result.data.rationale, sourceRef: item };
}

export async function generateProbeQuestions(
  gaps: Gap[],
  claims: SkillClaim[],
  profile: GenerationProfile,
): Promise<GeneratedProbe[]> {
  const items = selectProbeItems(gaps, claims);
  const results: GeneratedProbe[] = [];
  for (const item of items) {
    const probe = await generateOneProbe(item, profile);
    if (probe) results.push(probe);
  }
  return results;
}
