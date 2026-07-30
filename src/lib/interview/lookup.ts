import { sqlQuery } from "@/lib/db";

export interface InterviewRow {
  id: string;
  candidate_id: string;
  job_id: string;
  match_report_id: string | null;
  access_token: string;
  status: string;
  consent_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  expires_at: string | null;
  core_score: number | null;
  integrity_score: number | null;
  recommendation: string | null;
  device_info: unknown;
  transcript: unknown;
  video_segments: unknown;
  duration_seconds: number | null;
  video_finalized_at: string | null;
  evaluated_at: string | null;
  session_mint_count: number;
  job_title: string;
}

export async function getInterviewByToken(token: string): Promise<InterviewRow | null> {
  const res = await sqlQuery(
    `SELECT i.*, j.title AS job_title
     FROM interviews i
     JOIN jobs j ON j.id = i.job_id
     WHERE i.access_token = $1`,
    [token],
  );
  return (res.rows[0] as InterviewRow | undefined) ?? null;
}

export function isExpired(interview: InterviewRow): boolean {
  return Boolean(interview.expires_at && new Date(interview.expires_at) < new Date());
}
