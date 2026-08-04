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
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
      {/* Decorative Blur */}
      <div className="absolute top-10 left-10 w-72 h-72 bg-[#7364E6]/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-[#ec4899]/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-2xl card-abtalks rounded-2xl p-8 md:p-10 shadow-2xl relative z-10">
        <h1 className="font-display text-3xl font-bold text-white mb-2">
          Create Job Screening
        </h1>
        <p className="text-sm text-white-70 mb-8">
          Upload or paste a Job Description. Our system will extract key competencies and generate core evaluation questions.
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white-50 mb-2">
              Job Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Frontend Engineer"
              className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white placeholder-white-50 focus:outline-none focus:border-[#7364E6] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white-50 mb-2">
              Seniority Level
            </label>
            <select
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white focus:outline-none focus:border-[#7364E6] transition-colors"
            >
              <option value="intern">Internship</option>
              <option value="junior">Junior Developer</option>
              <option value="mid">Mid-level Developer</option>
              <option value="senior">Senior Developer</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white-50 mb-2">
              Job Description (JD)
            </label>
            <textarea
              required
              rows={8}
              value={rawJD}
              onChange={(e) => setRawJD(e.target.value)}
              placeholder="Paste the full job description details, responsibilities, and requirements here..."
              className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white placeholder-white-50 focus:outline-none focus:border-[#7364E6] transition-colors resize-y"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-[10px] btn-gradient disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2"
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
