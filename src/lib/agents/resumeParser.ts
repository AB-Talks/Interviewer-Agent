import { ParsedResume } from "./contracts";

/**
 * Adapter for the Resume parser service.
 * Currently returns a mock parsed resume. In production, this would call your existing resume parser service.
 */
export async function parseResume(filePath: string): Promise<ParsedResume> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    resumeId: "mock-resume-456",
    skills: [
      {
        key: "react",
        label: "React",
        evidenceStrength: "owned_in_role",
        sourceSnippet: "Senior engineer leading React development for 3 core product pipelines."
      },
      {
        key: "typescript",
        label: "TypeScript",
        evidenceStrength: "used_in_project",
        sourceSnippet: "Migrated a legacy JS codebase of over 100k lines to strictly typed TypeScript."
      },
      {
        key: "tailwind",
        label: "Tailwind CSS",
        evidenceStrength: "stated",
        sourceSnippet: "Proficient in Tailwind CSS and modern web styling approaches."
      }
    ],
    experience: [
      {
        title: "Senior Software Engineer",
        companyName: "Acme Corp", // Will be redacted
        months: 36,
        industry: "SaaS / Fintech",
        teamSize: 8,
        responsibilities: [
          "Designed and built the user onboarding interface using React & Tailwind",
          "Managed a team of 3 junior developers and established code-review processes",
          "Improved dashboard rendering performance by 40%"
        ]
      }
    ],
    projects: [
      {
        description: "A collaborative real-time whiteboarding application using WebSockets",
        tools: ["React", "TypeScript", "Node.js", "WebSockets"],
        role: "Sole developer"
      }
    ],
    education: [
      {
        degree: "Bachelor of Technology",
        field: "Computer Science & Engineering",
        school: "IIT Bombay", // Will be redacted
        gradYear: 2021 // Will be redacted
      }
    ]
  };
}
