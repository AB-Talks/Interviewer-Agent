import { ParsedResume, ParsedJD, MatchReport, Gap, Requirement, SkillClaim } from "./contracts";

// Adapter for the Readiness Matcher service. Per CLAUDE.md this is meant to
// call an EXISTING service -- the real implementation lives in
// `agent packages/AI-Agents/Readiness Match Agent/match_agent.py`, which is
// explicitly a DETERMINISTIC, no-LLM skill-set comparison (reproducible and
// explainable, matching this app's "defensible decisions" positioning). This
// ports that same deterministic approach to TypeScript rather than a Gemini
// call -- no rate limits, no truncation risk, same result every time for the
// same inputs.
//
// Scoring: requiredCoverage * 80 + preferredCoverage * 20 (the Python agent's
// domain-alignment 10% is dropped -- our ParsedResume schema has no domain
// field to compare against, so its weight is folded into required/preferred).

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Crude singular/plural tolerance (e.g. "apis" -> "api") -- good enough for
// matching JD/resume vocabulary that rarely uses the exact same word form.
function singularize(word: string): string {
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A single text blob covering everything that could count as evidence:
// discrete skill entries (key/label/citation snippet), experience titles and
// free-text responsibilities, and project descriptions/tools. Free text
// matters -- a requirement like "database migrations" is often only ever
// described in a bullet point, never listed as a standalone "skill".
function buildResumeCorpus(resume: ParsedResume): string {
  const parts: string[] = [];
  for (const s of resume.skills) parts.push(s.key, s.label, s.sourceSnippet);
  for (const e of resume.experience) parts.push(e.title, ...e.responsibilities);
  for (const p of resume.projects) parts.push(p.description, ...p.tools);
  return normalizeText(parts.join(" "));
}

// Word-boundary match against the whole corpus, not strict key equality --
// tolerates plural/singular and compound-term variance ("AWS" found within
// "AWS ECS", "REST APIs" found via "REST API") while still avoiding naive
// substring false positives (e.g. "SQL" won't match inside "NoSQL").
function isMatched(requirement: Requirement, corpus: string): boolean {
  const label = normalizeText(requirement.label);
  if (!label) return false;
  const variants = new Set([label, label.split(" ").map(singularize).join(" ")]);
  for (const variant of variants) {
    if (variant && new RegExp(`\\b${escapeRegExp(variant)}\\b`).test(corpus)) return true;
  }
  return false;
}

function severityForWeight(weight: number): Gap["severity"] {
  if (weight >= 0.8) return "blocking";
  if (weight >= 0.5) return "significant";
  return "minor";
}

export async function matchCandidate(resume: ParsedResume, jd: ParsedJD): Promise<MatchReport> {
  const corpus = buildResumeCorpus(resume);
  const required = jd.mustHave;
  const preferred = jd.niceToHave;

  const matchedRequired = required.filter((r) => isMatched(r, corpus));
  const matchedPreferred = preferred.filter((r) => isMatched(r, corpus));
  const missingRequired = required.filter((r) => !matchedRequired.includes(r));

  const requiredScore = required.length ? (matchedRequired.length / required.length) * 80 : 80;
  const preferredScore = preferred.length ? (matchedPreferred.length / preferred.length) * 20 : 20;
  const overallMatch = Math.min(100, Math.round(requiredScore + preferredScore));

  const dimensionScores: Record<string, number> = {};
  for (const req of required) {
    dimensionScores[req.key] = matchedRequired.includes(req) ? 100 : 0;
  }
  for (const req of preferred) {
    dimensionScores[req.key] = matchedPreferred.includes(req) ? 100 : 40;
  }

  const gaps: Gap[] = missingRequired.map((req) => ({
    requirementKey: req.key,
    severity: severityForWeight(req.weight),
    reason: `The JD requires "${req.label}", but this wasn't found among the candidate's listed skills, project tools, or experience.`,
  }));

  // Every claim the candidate can actually back up with role/project
  // ownership -- not gated to JD-relevance here, so probes.ts still has
  // something to work with even when a candidate's strongest evidenced
  // claims sit outside the JD's own vocabulary.
  const verifiableClaims: SkillClaim[] = resume.skills.filter(
    (s) => s.evidenceStrength === "owned_in_role" || s.evidenceStrength === "used_in_project",
  );

  return {
    candidateId: "computed",
    jobId: jd.jobId,
    overallMatch,
    dimensionScores,
    gaps,
    verifiableClaims,
  };
}
