"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";

interface PublicJob {
  id: string;
  title: string;
  seniority: string | null;
  responsibilities: string[];
  mustHave: string[];
  niceToHave: string[];
  inviteThreshold: number;
}

export default function ApplyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [job, setJob] = useState<PublicJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [notEligible, setNotEligible] = useState<{ message: string; overallMatch?: number } | null>(null);
  const [success, setSuccess] = useState<{ url: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${id}/public`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "This role isn't open for applications.");
        setJob(data.job);
      } catch (err: any) {
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    setNotEligible(null);
    setSuccess(null);

    if (!resumeFile) {
      setSubmitError("Please upload your resume.");
      setSubmitting(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("jobId", id);
      formData.append("fullName", fullName);
      formData.append("email", email);
      if (phone.trim()) formData.append("phone", phone.trim());
      formData.append("resume", resumeFile);

      const res = await fetch("/api/interviews/create", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        if (res.status === 422) {
          setNotEligible({ message: data.message, overallMatch: data.overallMatch });
        } else {
          setSubmitError(data.message || "Something went wrong. Please try again.");
        }
        return;
      }

      setSuccess({ url: data.url });
    } catch (err: any) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <span className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <p className="text-sm text-white-50">Loading role...</p>
      </div>
    );
  }

  if (loadError || !job) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <p className="text-rose-400 mb-4">{loadError || "Role not found."}</p>
        <Link href="/jobs" className="px-6 py-2.5 bg-[#191B40] border border-[#2C1BA9]/50 rounded-xl hover:bg-[#241f5c] transition-all text-sm text-white">
          Browse open roles
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 py-16 px-6 relative">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#7364E6]/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-2xl mx-auto space-y-8 relative z-10">
        <div>
          <Link href="/jobs" className="text-xs text-white-50 hover:text-white transition-colors">
            ← All open roles
          </Link>
          <h1 className="font-display text-3xl font-bold text-white mt-3">{job.title}</h1>
          {job.seniority && (
            <p className="text-white-50 text-xs uppercase tracking-wider mt-1">{job.seniority}</p>
          )}
        </div>

        {(job.responsibilities.length > 0 || job.mustHave.length > 0) && (
          <div className="card-abtalks rounded-2xl p-6 space-y-4">
            {job.responsibilities.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white-50 mb-2">
                  What you&apos;ll do
                </h2>
                <ul className="list-disc list-inside space-y-1 text-sm text-white-70">
                  {job.responsibilities.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {job.mustHave.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white-50 mb-2">
                  Must have
                </h2>
                <div className="flex flex-wrap gap-2">
                  {job.mustHave.map((label, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-full bg-[#191B40] border border-[#2C1BA9]/50 text-xs text-white-70"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {success ? (
          <div className="card-abtalks rounded-2xl p-8 text-center space-y-4">
            <p className="text-emerald-400 font-semibold">You&apos;re eligible for the interview!</p>
            <p className="text-white-70 text-sm">
              Your resume matched this role&apos;s requirements. Continue to the interview link below —
              it&apos;s also valid if you close this tab.
            </p>
            <Link
              href={success.url}
              className="inline-block px-6 py-3 rounded-[10px] btn-gradient text-white text-sm font-semibold"
            >
              Start System Check →
            </Link>
          </div>
        ) : notEligible ? (
          <div className="card-abtalks rounded-2xl p-8 text-center space-y-3">
            <p className="text-amber-400 font-semibold">Not quite a match yet</p>
            {typeof notEligible.overallMatch === "number" && (
              <p className="text-white-70 text-sm">
                Your resume matched {notEligible.overallMatch}% of this role&apos;s requirements — this role
                needs {job.inviteThreshold}%+.
              </p>
            )}
            <p className="text-white-50 text-xs">
              You&apos;re welcome to update your resume and try again, or check out other open roles.
            </p>
            <Link
              href="/jobs"
              className="inline-block mt-2 px-5 py-2.5 rounded-[10px] bg-[#191B40] border border-[#2C1BA9]/50 hover:border-[#7364E6] transition-all text-white text-sm font-medium"
            >
              Browse other roles
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card-abtalks rounded-2xl p-6 space-y-4">
            <p className="text-white-70 text-sm">
              Upload your resume — we&apos;ll instantly check it against this role (minimum match:{" "}
              {job.inviteThreshold}%). If you&apos;re eligible, you go straight to the interview.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white-50">
                  Full Name
                </label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 focus:border-[#7364E6] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-[#7364E6]/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white-50">Email</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 focus:border-[#7364E6] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-[#7364E6]/30"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white-50">
                  Phone <span className="text-white-50 normal-case font-medium">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-[#191B40] border border-[#2C1BA9]/50 focus:border-[#7364E6] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-[#7364E6]/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white-50">
                  Resume File
                </label>
                <input
                  required
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-xl border border-[#2C1BA9]/50 bg-[#191B40] px-3 py-2.5 text-sm text-white file:mr-4 file:rounded-lg file:border-0 file:bg-[#7364E6] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
                <p className="text-[11px] text-white-50">Accepts PDF, Word, or TXT resumes.</p>
              </div>
            </div>

            {submitError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-[10px] btn-gradient disabled:opacity-50 text-white text-sm font-semibold"
            >
              {submitting ? "Checking your readiness..." : "Check Eligibility & Apply"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
