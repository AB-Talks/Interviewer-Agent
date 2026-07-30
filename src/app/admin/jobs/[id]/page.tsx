"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadJobData() {
      try {
        const res = await fetch(`/api/jobs/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load job details.");
        
        setJob(data.job);
        setQuestions(data.questions);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadJobData();
  }, [id]);

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
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-6 relative">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-4xl mx-auto space-y-8 relative z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-900 pb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-100 to-indigo-300 bg-clip-text text-transparent">
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
            <p className="text-slate-400 text-sm">
              Review and customize the core interview questions generated for this position.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="px-5 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition-all text-slate-400 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleApprove}
              disabled={saving || job.status === "live"}
              className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-slate-900 disabled:to-slate-900 disabled:text-slate-600 disabled:border-slate-800 disabled:border rounded-xl transition-all text-white text-sm font-semibold shadow-lg shadow-indigo-950/40"
            >
              {saving ? "Publishing..." : "Approve & Go Live"}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-sm">
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
              className="bg-slate-900/30 backdrop-blur-md border border-slate-900 rounded-2xl p-6 md:p-8 space-y-6"
            >
              <div className="flex items-center justify-between border-b border-slate-950 pb-4">
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">
                  Question {idx + 1} &mdash; Competency: {q.competency}
                </span>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <span>Prep:</span>
                    <input
                      type="number"
                      value={q.prep_seconds}
                      onChange={(e) => handleQuestionChange(idx, "prep_seconds", parseInt(e.target.value) || 0)}
                      className="w-12 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-center text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <span>s</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>Answer:</span>
                    <input
                      type="number"
                      value={q.answer_seconds}
                      onChange={(e) => handleQuestionChange(idx, "answer_seconds", parseInt(e.target.value) || 0)}
                      className="w-12 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-center text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <span>s</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Question Prompt Text
                </label>
                <textarea
                  rows={3}
                  value={q.text}
                  onChange={(e) => handleQuestionChange(idx, "text", e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 focus:border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Ideal Answer Outline (For Grading)
                </label>
                <textarea
                  rows={3}
                  value={q.ideal_answer}
                  onChange={(e) => handleQuestionChange(idx, "ideal_answer", e.target.value)}
                  className="w-full bg-slate-950 border border-slate-850 focus:border-slate-800 rounded-xl px-4 py-3 text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all text-sm leading-relaxed"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
