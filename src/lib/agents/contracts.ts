export interface Requirement {
  key: string;                  // e.g. 'react', 'system_design', 'stakeholder_comms'
  label: string;
  weight: number;               // 0-1
}

export interface ParsedJD {
  jobId: string;
  title: string;
  mustHave: Requirement[];      // hard requirements
  niceToHave: Requirement[];
  responsibilities: string[];
  seniority: 'intern' | 'junior' | 'mid' | 'senior';
}

export interface SkillClaim {
  key: string;
  label: string;
  evidenceStrength: 'stated' | 'used_in_project' | 'owned_in_role';
  sourceSnippet: string;        // the exact resume text — cited to the recruiter
}

export interface ExperienceItem {
  title: string;
  months: number;
  industry?: string;
  teamSize?: number;
  responsibilities: string[];
  companyName: string;          // Will be redacted for prompt generation
}

export interface ProjectItem {
  description: string;
  tools: string[];
  role?: string;
}

export interface EducationItem {
  degree: string;
  field: string;
  school: string;               // Will be redacted for prompt generation
  gradYear?: number;            // Will be redacted for prompt generation
}

export interface ParsedResume {
  resumeId: string;
  skills: SkillClaim[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];
}

export interface Gap {
  requirementKey: string;
  severity: 'blocking' | 'significant' | 'minor';
  reason: string;
}

export interface MatchReport {
  candidateId: string;
  jobId: string;
  overallMatch: number;                // 0-100
  dimensionScores: Record<string, number>;
  gaps: Gap[];                         // JD requires it, resume is silent or weak
  verifiableClaims: SkillClaim[];      // high-value claims worth probing
}

// Redacted version of candidate profile passed to LLM for generating probes
export interface GenerationProfile {
  skills: SkillClaim[];
  roles: Array<{
    title: string;
    months: number;
    industry?: string;
    teamSize?: number;
    responsibilities: string[];
  }>;
  projects: Array<{
    description: string;
    tools: string[];
    role?: string;
  }>;
}
