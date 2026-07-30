// Server-only: this file must never be imported from a "use client" component.
// No `server-only` package guard here (not a dependency of this repo, and
// unnecessary — every import site is a Route Handler or another server module,
// same convention `src/lib/db.ts` already relies on).

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type AskParams = {
  system: string;
  user: string;
  maxTokens?: number;
};

export type AnthropicResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

type MessagesResponse = {
  content?: { type: string; text?: string }[];
};

/** Extract the first balanced top-level JSON object from a text blob. */
function extractFirstJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Single-shot Claude call that expects a JSON object back. No retries.
 * Fails gracefully — callers must handle `{ ok: false }`.
 */
export async function askClaudeJson<T>({
  system,
  user,
  maxTokens = 1024,
}: AskParams): Promise<AnthropicResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "AI is not configured (missing ANTHROPIC_API_KEY)." };
  }
  const model = process.env.INTERVIEW_ANTHROPIC_MODEL ?? "claude-sonnet-5";

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[anthropic] request failed", res.status, errText.slice(0, 500));
      return { ok: false, message: "AI request failed." };
    }

    const json = (await res.json()) as MessagesResponse;
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    const jsonSlice = extractFirstJson(text);
    if (!jsonSlice) {
      console.error("[anthropic] no JSON object in response");
      return { ok: false, message: "AI returned an unexpected response." };
    }

    return { ok: true, data: JSON.parse(jsonSlice) as T };
  } catch (e) {
    console.error("[anthropic] call errored", e);
    return { ok: false, message: "AI request errored." };
  }
}
