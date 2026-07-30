"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";

interface InterviewDetails {
  id: string;
  status: string;
  consent_at: string | null;
  job_title: string;
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
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center">
        <span className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-sm text-muted-foreground">Loading interview details...</p>
      </div>
    );
  }

  if (!interview) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md p-8 bg-card rounded-3xl border border-border shadow-xl">
          <p className="text-destructive mb-6 font-medium">{error || "Invalid or expired interview link."}</p>
          <p className="text-sm text-muted-foreground">
            Please contact the recruiter who shared the link to request a new invitation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-6 font-sans">
      <div className="w-full max-w-2xl bg-card border border-border rounded-3xl p-8 md:p-10 shadow-xl space-y-8">
        <div>
          <span className="text-xs font-bold tracking-widest text-primary uppercase">
            Invitation to Screen
          </span>
          <h1 className="font-display text-3xl md:text-4xl font-extrabold mt-2">
            Welcome, {interview.candidate_name}
          </h1>
          <p className="text-muted-foreground mt-2">
            You have been invited to complete a screening interview for the position of{" "}
            <span className="text-primary font-semibold">{interview.job_title}</span>.
          </p>
        </div>

        {/* Guidelines */}
        <div className="space-y-4 bg-secondary rounded-2xl p-6 border border-border">
          <h3 className="text-sm font-bold uppercase tracking-wider text-secondary-foreground">
            Interview Format & Guidelines
          </h3>
          <ul className="text-sm text-muted-foreground space-y-3 list-disc pl-5">
            <li>This is a <strong>live voice interview with an AI interviewer</strong> — it will ask you questions out loud and you answer by speaking, like a real call. It can ask genuine follow-ups based on what you say.</li>
            <li>Your webcam and microphone are recorded for the full call, for a human recruiter to review afterward.</li>
            <li>The browser logs tab switches, focus changes, and camera presence to support assessment integrity — these are advisory signals for a human reviewer, never an automatic decision.</li>
            <li>AI conducts the conversation and assists with scoring, but a human recruiter makes the final hiring decision.</li>
            <li><strong>DPDP Act Consent</strong>: Your video, audio, and personal data are stored securely for recruitment purposes only and retained for up to 90 days.</li>
          </ul>
        </div>

        {/* Consent Form */}
        <div className="space-y-6">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-border bg-background text-primary focus:ring-ring transition-colors"
            />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors select-none leading-relaxed">
              I consent to the recording of my webcam, microphone, and browser focus events for evaluation, including my conversation with the AI interviewer. I agree to the retention of this data for up to 90 days.
            </span>
          </label>

          <button
            onClick={handleConsent}
            disabled={!consent || submitting}
            className="w-full py-4 bg-primary hover:opacity-90 disabled:opacity-50 rounded-xl transition-all text-primary-foreground font-semibold shadow-lg flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Stamping Consent...
              </>
            ) : (
              "Proceed to System Check"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
