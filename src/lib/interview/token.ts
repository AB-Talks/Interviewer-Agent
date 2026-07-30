import crypto from "crypto";

/**
 * Generates a secure, random access token for a candidate interview session.
 */
export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Calculates the expiration date based on the TTL in days.
 * Defaults to 7 days if not defined in the environment.
 */
export function getExpirationDate(): Date {
  const ttlDays = parseInt(process.env.INTERVIEW_LINK_TTL_DAYS || "7", 10);
  const expiration = new Date();
  expiration.setDate(expiration.getDate() + ttlDays);
  return expiration;
}
