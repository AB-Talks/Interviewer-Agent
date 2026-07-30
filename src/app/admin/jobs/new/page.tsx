"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [seniority, setSeniority] = useState("mid");
  const [rawJD, setRawJD] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, rawJD, seniority }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create job profile.");
      }

      router.push(`/admin/jobs/${data.jobId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 relative">
      {/* Decorative Blur */}
      <div className="absolute top-10 left-10 w-72 h-72 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-2xl bg-slate-900/40 backdrop-blur-xl border border-slate-900 rounded-3xl p-8 md:p-10 shadow-2xl relative z-10">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-100 to-indigo-300 bg-clip-text text-transparent mb-2">
          Create Job Screening
        </h1>
        <p className="text-sm text-slate-400 mb-8">
          Upload or paste a Job Description. Our system will extract key competencies and generate core evaluation questions.
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Job Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Frontend Engineer"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Seniority Level
            </label>
            <select
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value="intern">Internship</option>
              <option value="junior">Junior Developer</option>
              <option value="mid">Mid-level Developer</option>
              <option value="senior">Senior Developer</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Job Description (JD)
            </label>
            <textarea
              required
              rows={8}
              value={rawJD}
              onChange={(e) => setRawJD(e.target.value)}
              placeholder="Paste the full job description details, responsibilities, and requirements here..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors resize-y"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-indigo-800 disabled:to-indigo-900 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-900/30 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Parsing JD & Generating Questions...
              </>
            ) : (
              "Generate Interview Process"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
