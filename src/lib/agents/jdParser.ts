import { ParsedJD } from "./contracts";

/**
 * Adapter for the Job Description (JD) parser service.
 * Currently returns a mock parsed JD. In production, this would call your existing parser microservice or API.
 */
export async function parseJD(rawText: string): Promise<ParsedJD> {
  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 800));

  return {
    jobId: "mock-job-123",
    title: "Senior React Developer",
    seniority: "senior",
    mustHave: [
      { key: "react", label: "React fundamentals & hooks", weight: 0.9 },
      { key: "typescript", label: "TypeScript strict typing", weight: 0.8 },
      { key: "state_management", label: "Global state management (Redux/Zustand)", weight: 0.7 }
    ],
    niceToHave: [
      { key: "nextjs", label: "Next.js App Router experience", weight: 0.5 },
      { key: "tailwind", label: "Tailwind CSS styling", weight: 0.4 }
    ],
    responsibilities: [
      "Lead frontend development for candidate screening dashboards",
      "Collaborate with backend engineers to integrate third-party APIs",
      "Optimize application performance for web and mobile clients"
    ]
  };
}
