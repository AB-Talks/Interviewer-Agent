import { ParsedResume, SkillClaim, ExperienceItem, ProjectItem, EducationItem } from "./contracts";
import { askGeminiJson } from "@/lib/gemini";

// Adapter for the Resume parser service. Per CLAUDE.md this is meant to call
// an EXISTING service, not host parsing logic here -- the real implementation
// lives in `agent packages/AI-Agents/Resume Parser Agent/resume_agent.py`. That
// agent isn't reachable at runtime from this Next.js app, so this port
// reproduces its semantic-extraction approach in TypeScript against the same
// Gemini backend already used elsewhere (lib/gemini.ts). TEMPORARY: swap to
// OpenAI once billing is set up, same as probes.ts/evaluate.ts/jdParser.ts.
//
// There is no file-upload/PDF-text-extraction pipeline in this app (adding
// one means a new npm dependency, out of scope without asking) -- this takes
// resume text directly, the same way jdParser takes pasted JD text.

interface GeminiSkill {
  label?: string;
  evidenceStrength?: string;
  sourceSnippet?: string;
}
interface GeminiExperience {
  title?: string;
  companyName?: string;
  months?: number;
  industry?: string;
  teamSize?: number;
  responsibilities?: string[];
}
interface GeminiProject {
  description?: string;
  tools?: string[];
  role?: string;
}
interface GeminiEducation {
  degree?: string;
  field?: string;
  school?: string;
  gradYear?: number;
}
interface GeminiResumeResponse {
  skills?: GeminiSkill[];
  experience?: GeminiExperience[];
  projects?: GeminiProject[];
  education?: GeminiEducation[];
}

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "skill";
}

function normalizeEvidenceStrength(raw: string | undefined): SkillClaim["evidenceStrength"] {
  if (raw === "owned_in_role" || raw === "used_in_project" || raw === "stated") return raw;
  return "stated";
}

const RESUME_SYSTEM_PROMPT = `You are a resume intelligence parser. Extract structured, evidence-backed information from resume text.

For each skill/technology found, classify "evidenceStrength":
- "owned_in_role": the candidate led, owned, or built something significant with it in a professional role.
- "used_in_project": used it in a project or task, but didn't clearly own the outcome.
- "stated": only listed in a skills section with no supporting detail.
For each skill, "sourceSnippet" must be the exact (or near-exact) resume text that supports the claim -- never invent evidence.

Return ONLY JSON matching exactly this schema:
{"skills":[{"label":"","evidenceStrength":"","sourceSnippet":""}],
 "experience":[{"title":"","companyName":"","months":0,"industry":"","teamSize":0,"responsibilities":[]}],
 "projects":[{"description":"","tools":[],"role":""}],
 "education":[{"degree":"","field":"","school":"","gradYear":0}]}`;

export async function parseResume(rawText: string): Promise<ParsedResume> {
  const fallback: ParsedResume = {
    resumeId: "unparsed",
    skills: [],
    experience: [],
    projects: [],
    education: [],
  };

  if (!rawText?.trim()) return fallback;

  const result = await askGeminiJson<GeminiResumeResponse>({
    system: RESUME_SYSTEM_PROMPT,
    user: `Resume Raw Text:\n${rawText}`,
    maxTokens: 2048,
  });

  if (!result.ok) {
    console.error("[resumeParser] Gemini call failed, using empty fallback:", result.message);
    return fallback;
  }

  const data = result.data;

  const skills: SkillClaim[] = (data.skills ?? [])
    .filter((s): s is GeminiSkill & { label: string } => !!s.label)
    .map((s) => ({
      key: slugify(s.label),
      label: s.label,
      evidenceStrength: normalizeEvidenceStrength(s.evidenceStrength),
      sourceSnippet: s.sourceSnippet ?? "",
    }));

  const experience: ExperienceItem[] = (data.experience ?? []).map((e) => ({
    title: e.title ?? "",
    companyName: e.companyName ?? "",
    months: typeof e.months === "number" ? e.months : 0,
    industry: e.industry,
    teamSize: e.teamSize,
    responsibilities: e.responsibilities ?? [],
  }));

  const projects: ProjectItem[] = (data.projects ?? []).map((p) => ({
    description: p.description ?? "",
    tools: p.tools ?? [],
    role: p.role,
  }));

  const education: EducationItem[] = (data.education ?? []).map((ed) => ({
    degree: ed.degree ?? "",
    field: ed.field ?? "",
    school: ed.school ?? "",
    gradYear: ed.gradYear,
  }));

  return { resumeId: "parsed", skills, experience, projects, education };
}
