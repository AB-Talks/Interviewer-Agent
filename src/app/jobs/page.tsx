"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

interface JobListing {
  id: string;
  title: string;
  invite_threshold: number;
  created_at: string;
}

export default function JobsListingPage() {
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/jobs?status=live");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load jobs.");
        setJobs(data.jobs ?? []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex-1 py-16 px-6 relative">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#7364E6]/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-4xl mx-auto space-y-10 relative z-10">
        <div className="text-center space-y-3">
          <h1 className="font-display text-4xl font-bold text-white">Open Roles</h1>
          <p className="text-white-70 text-sm max-w-xl mx-auto">
            Upload your resume against a role — we&apos;ll check your readiness instantly. If you meet the
            bar, you go straight to the live AI interview.
          </p>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <span className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div className="card-abtalks rounded-2xl p-8 text-center text-white-70 text-sm">
            No open roles right now — check back soon.
          </div>
        )}

        <div className="space-y-4">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}/apply`}
              className="card-abtalks rounded-2xl p-6 flex items-center justify-between gap-4 hover:border-[#7364E6] transition-all"
            >
              <div>
                <h2 className="text-white font-semibold text-lg">{job.title}</h2>
                <p className="text-xs text-white-50 mt-1">
                  Minimum readiness match: {job.invite_threshold}%
                </p>
              </div>
              <span className="px-4 py-2 rounded-[10px] btn-gradient text-white text-sm font-semibold shrink-0">
                Apply →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
