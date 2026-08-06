"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";

interface JobJDParsed {
  seniority?: string;
  responsibilities?: string[];
  mustHave?: { key: string; label: string; weight: number }[];
}

interface InterviewDetails {
  id: string;
  status: string;
  consent_at: string | null;
  job_title: string;
  job_jd_parsed?: JobJDParsed | null;
  candidate_name: string;
}

export default function CandidateLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const router = useRouter();
  const { token } = use(params);

  const [interview, setInterview] = useState<InterviewDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const interviewEstimate = "25-35 minutes";

  useEffect(() => {
    async function fetchDetails() {
      try {
        const res = await fetch(`/api/interviews/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load interview session.");
        const iv = data.interview as InterviewDetails;

        // Already progressed past this step -- send the candidate to the right place
        // instead of re-showing a consent form they've already completed.
        if (iv.status === "submitted" || iv.status === "scored") {
          router.replace(`/i/${token}/done`);
          return;
        }
        if (iv.status === "expired") {
          setError("This interview link has expired.");
          setLoading(false);
          return;
        }
        if (iv.consent_at) {
          router.replace(`/i/${token}/check`);
          return;
        }

        setInterview(iv);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchDetails();
  }, [token, router]);

  const handleConsent = async () => {
    if (!consent) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/interviews/${token}/consent`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to stamp consent.");

      // On success, proceed to camera/mic check page
      router.push(`/i/${token}/check`);
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <span className="w-8 h-8 border-4 border-[#7364E6]/30 border-t-[#7364E6] rounded-full animate-spin mb-4" />
        <p className="text-sm text-white-70">Loading interview details...</p>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md p-8 card-abtalks rounded-2xl">
          <p className="text-red-400 mb-6 font-medium">{error || "Invalid or expired interview link."}</p>
          <p className="text-sm text-white-50">
            Please contact the recruiter who shared the link to request a new invitation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-6">
      {/* Background glow */}
      <div className="fixed top-1/3 left-1/4 w-80 h-80 bg-[#7364E6]/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-3xl card-abtalks rounded-2xl p-8 md:p-10 space-y-8 relative z-10">
        <div className="rounded-3xl border border-[#2C1BA9]/50 bg-gradient-to-br from-[#191B40] via-[#191B40] to-[#0E102A] p-6 md:p-8 space-y-6 shadow-[0_24px_80px_rgba(10,10,30,0.35)]">
          <div className="space-y-3">
            <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.28em] text-emerald-300">
              Eligible for the AI Placement Interview
            </span>
            <h1 className="font-display text-3xl md:text-5xl font-extrabold text-white leading-tight">
              Congratulations, {interview.candidate_name}
            </h1>
            <p className="max-w-2xl text-white/75 text-base md:text-lg leading-relaxed">
              You are now eligible to begin the AI Placement Interview for{" "}
              <span className="text-[#B8B0FF] font-semibold">{interview.job_title}</span>
              {interview.job_jd_parsed?.seniority ? ` (${interview.job_jd_parsed.seniority} level)` : ""}. This interview helps us assess your readiness for real internship opportunities in a calm, structured format.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-[#2C1BA9]/50 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Estimated time</p>
              <p className="mt-2 font-display text-2xl font-bold text-white">{interviewEstimate}</p>
            </div>
            <div className="rounded-2xl border border-[#2C1BA9]/50 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Format</p>
              <p className="mt-2 font-display text-2xl font-bold text-white">Live AI interview</p>
            </div>
            <div className="rounded-2xl border border-[#2C1BA9]/50 bg-white/5 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">What to expect</p>
              <p className="mt-2 font-display text-2xl font-bold text-white">12-15 questions</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#2C1BA9]/50 bg-[#0F1230]/80 p-5 md:p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-white/45">Before you start</p>
            <p className="mt-2 text-white/70 leading-relaxed">
              Use a quiet room, keep your camera and microphone ready, and allow a few minutes for the setup checks before the interview begins.
            </p>
          </div>
        </div>

        {/* Role context -- what this interview is actually screening for */}
        {(interview.job_jd_parsed?.responsibilities?.length || interview.job_jd_parsed?.mustHave?.length) ? (
          <div className="space-y-3 bg-[#191B40]/80 rounded-xl p-6 border border-[#2C1BA9]/50">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white/80">About This Role</h3>
            {!!interview.job_jd_parsed?.responsibilities?.length && (
              <ul className="text-sm text-white-70 space-y-1.5 list-disc pl-5">
                {interview.job_jd_parsed.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {!!interview.job_jd_parsed?.mustHave?.length && (
              <div className="flex flex-wrap gap-2 pt-1">
                {interview.job_jd_parsed.mustHave.map((req) => (
                  <span
                    key={req.key}
                    className="px-2.5 py-1 rounded-full bg-[#7364E6]/10 border border-[#7364E6]/30 text-xs text-white-70"
                  >
                    {req.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Guidelines */}
        <div className="space-y-4 bg-[#191B40]/80 rounded-xl p-6 border border-[#2C1BA9]/50">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white/80">
            Interview Format &amp; Guidelines
          </h3>
          <ul className="text-sm text-white-70 space-y-3 list-disc pl-5">
            <li>This is a <strong className="text-white">live voice interview with an AI interviewer</strong> — it will ask you questions out loud and you answer by speaking, like a real call. It can ask genuine follow-ups based on what you say.</li>
            <li>Your webcam and microphone are recorded for the full call, for a human recruiter to review afterward.</li>
            <li>The browser logs tab switches, focus changes, and camera presence to support assessment integrity — these are advisory signals for a human reviewer, never an automatic decision.</li>
            <li>AI conducts the conversation and assists with scoring, but a human recruiter makes the final hiring decision.</li>
            <li><strong className="text-white">DPDP Act Consent</strong>: Your video, audio, and personal data are stored securely for recruitment purposes only and retained for up to 90 days.</li>
          </ul>
        </div>

        {/* Consent Form */}
        <div className="space-y-6">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-[#2C1BA9] bg-[#191B40] text-[#7364E6] focus:ring-[#7364E6] transition-colors accent-[#7364E6]"
            />
            <span className="text-sm text-white-70 group-hover:text-white transition-colors select-none leading-relaxed">
              I consent to the recording of my webcam, microphone, and browser focus events for evaluation, including my conversation with the AI interviewer. I agree to the retention of this data for up to 90 days.
            </span>
          </label>

          <button
            onClick={handleConsent}
            disabled={!consent || submitting}
            className="w-full py-4 rounded-[10px] btn-gradient disabled:opacity-50 transition-all font-semibold flex items-center justify-center gap-2 text-base"
          >
            {submitting ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Stamping Consent...
              </>
            ) : (
              "Start Your Interview Setup →"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
