"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Job {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  live: "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400",
  questions_pending_review: "bg-amber-500/10 border border-amber-500/20 text-amber-400",
};

function statusLabel(status: string): string {
  if (status === "questions_pending_review") return "Pending Approval";
  return status;
}

export default function AdminDashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/jobs")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setJobs(data.jobs ?? []);
      })
      .catch((err) => setError(err.message ?? "Failed to load jobs."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 py-12 px-6">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2C1BA9]/50 pb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Recruiter Dashboard</h1>
            <p className="text-white-70 text-sm mt-1">
              Jobs, candidate eligibility, and interview status in one place.
            </p>
          </div>
          <Link
            href="/admin/jobs/new"
            className="px-6 py-2.5 rounded-[10px] btn-gradient text-white text-sm font-semibold shadow-lg text-center"
          >
            + New Job
          </Link>
        </div>

        {loading && <p className="text-white-70 text-sm">Loading jobs...</p>}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-sm">{error}</div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div className="card-abtalks rounded-2xl p-8 text-center text-white-70 text-sm">
            No jobs yet.{" "}
            <Link href="/admin/jobs/new" className="text-[#7364E6] font-medium">
              Create the first one
            </Link>
            .
          </div>
        )}

        <div className="space-y-3">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/admin/jobs/${job.id}`}
              className="card-abtalks rounded-2xl p-5 flex items-center justify-between hover:border-[#7364E6] transition-all block"
            >
              <div>
                <h2 className="text-white font-semibold">{job.title}</h2>
                <p className="text-xs text-white-50 mt-1">
                  Created {new Date(job.created_at).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                  STATUS_STYLES[job.status] ?? "bg-[#191B40] border border-[#2C1BA9]/50 text-white-70"
                }`}
              >
                {statusLabel(job.status)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
