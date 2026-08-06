"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Question {
  id: string;
  competency: string;
  text: string;
  ideal_answer: string;
  prep_seconds: number;
  answer_seconds: number;
}

interface Job {
  id: string;
  title: string;
  status: string;
  jd_raw: string;
  invite_threshold: number;
}

interface InterviewRow {
  id: string;
  access_token: string;
  status: string;
  core_score: number | null;
  integrity_score: number | null;
  recommendation: string | null;
  auto_qualified: boolean | null;
  candidate_name: string;
  candidate_email: string;
  overall_match: number | null;
}

export default function JobDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);

  const [job, setJob] = useState<Job | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [applyUrl, setApplyUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  async function loadJobData() {
    try {
      const res = await fetch(`/api/jobs/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load job details.");

      setJob(data.job);
      setQuestions(data.questions);
      setInterviews(data.interviews ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobData();
    if (typeof window !== "undefined") {
      setApplyUrl(`${window.location.origin}/jobs/${id}/apply`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard API unavailable -- link is still selectable text, no-op
    }
  };

  const handleQuestionChange = (index: number, field: keyof Question, value: any) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], [field]: value };
    setQuestions(updated);
  };

  const handleApprove = async () => {
    setSaving(true);
    setError("");
    setSuccess(false);

    try {
      const res = await fetch(`/api/jobs/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve questions.");

      setSuccess(true);
      if (job) setJob({ ...job, status: "live" });
      setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center">
        <span className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading interview schema...</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <p className="text-rose-400 mb-4">{error || "Job not found."}</p>
        <button
          onClick={() => router.push("/admin/jobs/new")}
          className="px-6 py-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800 transition-all text-sm"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 py-12 px-6 relative">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#7364E6]/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#ec4899]/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-4xl mx-auto space-y-8 relative z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2C1BA9]/50 pb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-white">
                {job.title}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                job.status === "live" 
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" 
                  : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
              }`}>
                {job.status === "questions_pending_review" ? "Pending Approval" : job.status}
              </span>
            </div>
            <p className="text-white-70 text-sm">
              Review and customize the core interview questions generated for this position.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="px-5 py-2.5 bg-[#191B40] border border-[#2C1BA9]/50 hover:border-[#7364E6] rounded-[10px] transition-all text-white-70 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={saving || job.status === "live"}
              className="px-6 py-2.5 rounded-[10px] btn-gradient disabled:opacity-50 text-white text-sm font-semibold shadow-lg"
            >
              {saving ? "Publishing..." : "Approve & Go Live"}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm">
            Interview schema approved! Publishing live. Redirecting to home...
          </div>
        )}

        {/* Questions Editor List */}
        <div className="space-y-8">
          {questions.map((q, idx) => (
            <div
              key={q.id}
              className="card-abtalks rounded-2xl p-6 md:p-8 space-y-6"
            >
              <div className="flex items-center justify-between border-b border-[#2C1BA9]/30 pb-4">
                <span className="text-xs font-bold uppercase tracking-widest text-[#7364E6]">
                  Question {idx + 1} &mdash; Competency: {q.competency}
                </span>
                <div className="flex items-center gap-4 text-xs text-white-50">
                  <div className="flex items-center gap-1.5">
                    <span>Prep:</span>
                    <input
                      type="number"
                      value={q.prep_seconds}
                      onChange={(e) => handleQuestionChange(idx, "prep_seconds", parseInt(e.target.value) || 0)}
                      className="w-12 bg-[#191B40] border border-[#2C1BA9]/50 rounded px-1.5 py-0.5 text-center text-white focus:outline-none focus:border-[#7364E6]"
                    />
                    <span>s</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>Answer:</span>
                    <input
                      type="number"
                      value={q.answer_seconds}
                      onChange={(e) => handleQuestionChange(idx, "answer_seconds", parseInt(e.target.value) || 0)}
                      className="w-12 bg-[#191B40] border border-[#2C1BA9]/50 rounded px-1.5 py-0.5 text-center text-white focus:outline-none focus:border-[#7364E6]"
                    />
                    <span>s</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white-50">
                  Question Prompt Text
                </label>
                <textarea
                  rows={3}
                  value={q.text}
                  onChange={(e) => handleQuestionChange(idx, "text", e.target.value)}
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 focus:border-[#7364E6] rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-[#7364E6]/30 transition-all resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white-50">
                  Ideal Answer Outline (For Grading)
                </label>
                <textarea
                  rows={3}
                  value={q.ideal_answer}
                  onChange={(e) => handleQuestionChange(idx, "ideal_answer", e.target.value)}
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 focus:border-[#7364E6] rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-[#7364E6]/30 transition-all text-sm leading-relaxed"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Applicants & Eligibility */}
        <div className="space-y-6 border-t border-[#2C1BA9]/50 pt-8">
          <div>
            <h2 className="text-xl font-bold text-white">Applicants &amp; Eligibility</h2>
            <p className="text-white-70 text-sm mt-1">
              Candidates apply themselves — they upload their resume and are matched against this job&apos;s
              requirements automatically (invite threshold: {job.invite_threshold}%). Anyone who clears the
              bar gets sent straight to the interview.
            </p>
          </div>

          {job.status !== "live" ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400 text-sm">
              Approve the core questions above to publish this role — the public apply link only works once
              the job is live.
            </div>
          ) : (
            <div className="card-abtalks rounded-2xl p-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-white-50">
                Public Apply Link
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  readOnly
                  value={applyUrl}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 bg-[#191B40] border border-[#2C1BA9]/50 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-5 py-2.5 rounded-[10px] bg-[#191B40] border border-[#2C1BA9]/50 hover:border-[#7364E6] transition-all text-white text-sm font-medium shrink-0"
                >
                  {linkCopied ? "Copied!" : "Copy Link"}
                </button>
              </div>
              <p className="text-[11px] text-white-50">
                Share this with candidates, or point them to the general <Link href="/jobs" className="underline hover:text-white">/jobs</Link> listing.
              </p>
            </div>
          )}

          {interviews.length > 0 && (
            <div className="space-y-2">
              {interviews.map((iv) => (
                <Link
                  key={iv.id}
                  href={iv.status === "scored" || iv.status === "submitted" ? `/admin/interviews/${iv.id}` : "#"}
                  className={`card-abtalks rounded-xl p-4 flex items-center justify-between gap-4 ${
                    iv.status === "scored" || iv.status === "submitted" ? "hover:border-[#7364E6] transition-all" : ""
                  }`}
                >
                  <div>
                    <p className="text-white font-medium text-sm">{iv.candidate_name}</p>
                    <p className="text-xs text-white-50">{iv.candidate_email}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {iv.overall_match !== null && (
                      <span className="text-white-70">Match: {iv.overall_match}%</span>
                    )}
                    {iv.core_score !== null && (
                      <span className="text-white-70">Score: {Math.round(iv.core_score)}/100</span>
                    )}
                    {iv.auto_qualified === true && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 uppercase tracking-wider font-semibold">
                        Auto-qualified
                      </span>
                    )}
                    <span className="px-2.5 py-0.5 rounded-full bg-[#191B40] border border-[#2C1BA9]/50 text-white-70 uppercase tracking-wider font-semibold">
                      {iv.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
