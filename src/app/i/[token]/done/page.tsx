import { getInterviewByToken } from "@/lib/interview/lookup";

// Thank-you only. No scores, no transcript, no core_score/integrity_score --
// candidates never see evaluation results (CLAUDE.md: proctoring/scoring are
// advisory to a human recruiter, never surfaced to or actioned on by the
// candidate themselves).
export default async function InterviewDonePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const interview = await getInterviewByToken(token);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-full max-w-lg bg-card border border-border rounded-3xl p-8 md:p-10 shadow-xl text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl">
          ✓
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold">
          Thank you{interview ? ` for completing your interview for ${interview.job_title}` : ""}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Your responses have been recorded and will be reviewed by the hiring team. A human
          recruiter makes the final decision — you&apos;ll hear back from them directly.
        </p>
        <p className="text-xs text-muted-foreground">
          You can safely close this window now.
        </p>
      </div>
    </div>
  );
}
