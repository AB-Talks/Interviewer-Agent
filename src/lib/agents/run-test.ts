import { parseJD } from "./jdParser";
import { parseResume } from "./resumeParser";
import { matchCandidate } from "./readinessMatcher";
import { redactForGeneration } from "./redact";

async function runTest() {
  console.log("=== Phase 2 Integration Test ===");

  console.log("\n1. Parsing Job Description (JD)...");
  const jd = await parseJD("Senior React Developer Raw Text");
  console.log("Parsed JD Title:", jd.title);
  console.log("Must Have Requirements:", jd.mustHave.map(r => r.key).join(", "));

  console.log("\n2. Parsing Candidate Resume...");
  const resume = await parseResume("path/to/resume.pdf");
  console.log("Parsed Resume Skills:", resume.skills.map(s => s.key).join(", "));
  console.log("Original Education (Unredacted):", JSON.stringify(resume.education, null, 2));

  console.log("\n3. Matching Candidate with JD...");
  const matchReport = await matchCandidate(resume, jd);
  console.log("Overall Match Score:", matchReport.overallMatch + "%");
  console.log("Identified Gaps:", matchReport.gaps.map(g => `${g.requirementKey} (${g.severity}): ${g.reason}`));

  console.log("\n4. Redacting Candidate Profile for LLM (Bias Prevention)...");
  const redactedProfile = redactForGeneration(resume);
  console.log("Redacted Profile:", JSON.stringify(redactedProfile, null, 2));
  
  console.log("\n=== Test Successful ===");
}

runTest().catch(console.error);
