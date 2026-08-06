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
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      {/* Background glow */}
      <div className="fixed top-1/3 left-1/4 w-80 h-80 bg-[#7364E6]/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-lg card-abtalks rounded-2xl p-8 md:p-10 text-center space-y-4 relative z-10">
        <div className="mx-auto w-14 h-14 rounded-full bg-gradient-to-br from-[#7364E6] to-[#ec4899] text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-[#7364E6]/20">
          ✓
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold text-white">
          Interview submitted successfully
        </h1>
        <p className="text-white-70 text-sm leading-relaxed">
          {interview ? `Your AI Placement Interview for ${interview.job_title} has been submitted.` : "Your interview has been submitted."} If you progress to the next stage, you&apos;ll be notified by email.
        </p>
        <p className="text-xs text-white-50">
          You can safely close this window now.
        </p>
      </div>
    </div>
  );
}
