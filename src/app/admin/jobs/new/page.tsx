"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [rawJD, setRawJD] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [minimumInterviewScore, setMinimumInterviewScore] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!rawJD.trim() && !jdFile) {
      setError("Paste the job description or upload a JD file.");
      setLoading(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("title", title);
      if (rawJD.trim()) formData.append("rawJD", rawJD.trim());
      if (jdFile) formData.append("jdFile", jdFile);
      if (minimumInterviewScore) formData.append("minimumInterviewScore", minimumInterviewScore);

      const res = await fetch("/api/jobs", { method: "POST", body: formData });

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
              Job Description (JD)
            </label>
            <textarea
              rows={8}
              value={rawJD}
              onChange={(e) => setRawJD(e.target.value)}
              placeholder="Paste the full job description details, responsibilities, and requirements here..."
              className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white placeholder-white-50 focus:outline-none focus:border-[#7364E6] transition-colors resize-y"
            />
            <p className="mt-2 text-xs text-white-50">
              Seniority and requirements are extracted automatically from the JD text — no need to set them
              by hand.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex-1 h-px bg-[#2C1BA9]/50" />
            <span className="text-xs text-white-50 uppercase tracking-wider">or</span>
            <span className="flex-1 h-px bg-[#2C1BA9]/50" />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white-50 mb-2">
              Upload JD File
            </label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-[#2C1BA9]/50 bg-[#191B40] px-3 py-2.5 text-sm text-white file:mr-4 file:rounded-lg file:border-0 file:bg-[#7364E6] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
            <p className="mt-2 text-[11px] text-white-50">
              Accepts PDF, Word, or TXT. Uploading a file takes priority over pasted text above.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white-50 mb-2">
              Minimum Interview Score (optional)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={minimumInterviewScore}
              onChange={(e) => setMinimumInterviewScore(e.target.value)}
              placeholder="e.g. 75 -- leave blank to require manual review for every candidate"
              className="w-full bg-[#191B40] border border-[#2C1BA9]/50 rounded-[10px] px-4 py-3 text-white placeholder-white-50 focus:outline-none focus:border-[#7364E6] transition-colors"
            />
            <p className="mt-2 text-xs text-white-50">
              Candidates scoring at or above this on the interview are flagged as auto-qualified for the recruiter
              — advisory only, a human still makes the advance/reject call.
            </p>
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
