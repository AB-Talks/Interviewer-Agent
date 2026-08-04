import { ParsedJD, Requirement } from "./contracts";
import { askGeminiJson } from "@/lib/gemini";

// Adapter for the Job Description (JD) parser service. Per CLAUDE.md this is
// meant to call an EXISTING service, not host parsing logic here -- the real
// implementation lives in `agent packages/AI-Agents/JD Parser Agent/jd_agent.py`
// (a Python/Gemini agent). That agent isn't reachable at runtime from this
// Next.js app, so this port reproduces its prompt/approach in TypeScript
// against the same Gemini backend already used elsewhere in this app
// (lib/gemini.ts), rather than reintroducing a second copy of hand-written
// heuristic parsing logic. TEMPORARY note applies here too: swap to OpenAI
// once billing is set up, same as probes.ts/evaluate.ts.

type SeniorityRaw = string | undefined | null;

function normalizeSeniority(raw: SeniorityRaw): ParsedJD["seniority"] {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("intern")) return "intern";
  if (s.includes("junior") || s.includes("jr")) return "junior";
  if (s.includes("senior") || s.includes("sr") || s.includes("lead") || s.includes("principal") || s.includes("director"))
    return "senior";
  return "mid";
}

interface GeminiJDResponse {
  title?: string;
  required_skills?: string[];
  preferred_skills?: string[];
  seniority?: string;
  responsibilities?: string[];
}

function toRequirements(skills: string[] | undefined, baseWeight: number): Requirement[] {
  if (!skills?.length) return [];
  return skills.slice(0, 6).map((label, i) => ({
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `skill_${i}`,
    label,
    // Slight descending weight within the tier so the first-listed (most
    // emphasized) skills carry a bit more than later ones.
    weight: Math.max(0.3, baseWeight - i * 0.05),
  }));
}

const JD_SYSTEM_PROMPT = `You are an expert recruiter parsing a Job Description. Extract:
- title
- required_skills (must-have, ordered by importance)
- preferred_skills (nice-to-have)
- seniority (Intern, Junior, Mid, Senior, Lead, Director)
- responsibilities (3-5 concise bullet points)

Return ONLY JSON matching exactly this schema:
{"title":"","required_skills":[],"preferred_skills":[],"seniority":"","responsibilities":[]}`;

export async function parseJD(rawText: string): Promise<ParsedJD> {
  const fallback: ParsedJD = {
    jobId: "unknown-job",
    title: "Software Engineer",
    seniority: "mid",
    mustHave: [{ key: "core_skills", label: "Core role requirements", weight: 0.7 }],
    niceToHave: [],
    responsibilities: [],
  };

  const result = await askGeminiJson<GeminiJDResponse>({
    system: JD_SYSTEM_PROMPT,
    user: `Job Description Raw Text:\n${rawText}`,
    maxTokens: 1024,
  });

  if (!result.ok) {
    console.error("[jdParser] Gemini call failed, using fallback:", result.message);
    return fallback;
  }

  const data = result.data;
  const mustHave = toRequirements(data.required_skills, 0.9);
  return {
    jobId: "unknown-job",
    title: data.title || "Software Engineer",
    seniority: normalizeSeniority(data.seniority),
    mustHave: mustHave.length ? mustHave : fallback.mustHave,
    niceToHave: toRequirements(data.preferred_skills, 0.5),
    responsibilities: data.responsibilities?.slice(0, 5) ?? [],
  };
}
