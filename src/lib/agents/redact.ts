import { ParsedResume, GenerationProfile } from "./contracts";

/**
 * Redacts personal identifying information from a parsed resume profile 
 * before passing it to LLM prompts for question/probe generation.
 * This guarantees the generated questions remain unbiased.
 */
export function redactForGeneration(resume: ParsedResume): GenerationProfile {
  return {
    // Skills are safe, they are purely technical capabilities/evidence snippets
    skills: resume.skills.map(s => ({
      key: s.key,
      label: s.label,
      evidenceStrength: s.evidenceStrength,
      sourceSnippet: s.sourceSnippet
    })),
    // Remove companyName, keep details of roles
    roles: resume.experience.map(e => ({
      title: e.title,
      months: e.months,
      industry: e.industry,
      teamSize: e.teamSize,
      responsibilities: e.responsibilities
    })),
    // Projects are generally safe, but keep only key descriptive components
    projects: resume.projects.map(p => ({
      description: p.description,
      tools: p.tools,
      role: p.role
    }))
  };
}
