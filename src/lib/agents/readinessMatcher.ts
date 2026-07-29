import { ParsedResume, ParsedJD, MatchReport } from "./contracts";

/**
 * Adapter for the Readiness Matcher service.
 * Currently returns a mock MatchReport. In production, this would call your existing matcher service.
 */
export async function matchCandidate(
  resume: ParsedResume,
  jd: ParsedJD
): Promise<MatchReport> {
  // Simulate matcher evaluation latency
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // Find gaps (e.g. JD requires state_management, but resume lacks it)
  const gaps = [
    {
      requirementKey: "state_management",
      severity: "significant" as const,
      reason: "The JD requires experience with global state management (Redux/Zustand), but the resume does not specify concrete usage of these tools."
    }
  ];

  // Identify high-value claims to probe (e.g. owned_in_role React)
  const verifiableClaims = resume.skills.filter(
    (s) => s.evidenceStrength === "owned_in_role" || s.evidenceStrength === "used_in_project"
  );

  return {
    candidateId: "mock-candidate-789",
    jobId: jd.jobId,
    overallMatch: 78,
    dimensionScores: {
      react: 90,
      typescript: 85,
      state_management: 30,
      tailwind: 95
    },
    gaps,
    verifiableClaims
  };
}
