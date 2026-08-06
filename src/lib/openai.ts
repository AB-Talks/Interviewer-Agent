// Server-only: this file must never be imported from a "use client" component.
// No `server-only` package guard here (not a dependency of this repo, and
// unnecessary -- every import site is a Route Handler or another server module,
// same convention `src/lib/db.ts` already relies on).
//
// Text-generation counterpart to the OpenAI Realtime session in
// src/app/api/interviews/[token]/session/route.ts. That route uses the
// Realtime API for the live voice call; this one uses plain Chat Completions
// for the non-live steps (probe generation, post-interview evaluation) so the
// whole app needs only OPENAI_API_KEY, no second AI vendor.

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

type AskParams = {
  system: string;
  user: string;
  maxTokens?: number;
};

type VisionAskParams = {
  system: string;
  user: string;
  imageUrl: string;
  maxTokens?: number;
};

export type OpenAIJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

type ChatCompletionResponse = {
  choices?: { message?: { content?: string } }[];
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
 * Single-shot OpenAI chat call that expects a JSON object back. No retries.
 * Fails gracefully -- callers must handle `{ ok: false }`.
 */
export async function askOpenAIJson<T>({
  system,
  user,
  maxTokens = 1024,
}: AskParams): Promise<OpenAIJsonResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "AI is not configured (missing OPENAI_API_KEY)." };
  }
  const model = process.env.INTERVIEW_OPENAI_TEXT_MODEL ?? "gpt-5-mini";

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[openai] chat completion failed", res.status, errText.slice(0, 500));
      return { ok: false, message: "AI request failed." };
    }

    const json = (await res.json()) as ChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    const jsonSlice = extractFirstJson(text) ?? (text.trim() ? text : null);
    if (!jsonSlice) {
      console.error("[openai] no JSON object in response");
      return { ok: false, message: "AI returned an unexpected response." };
    }

    return { ok: true, data: JSON.parse(jsonSlice) as T };
  } catch (e) {
    console.error("[openai] call errored", e);
    return { ok: false, message: "AI request errored." };
  }
}

/**
 * Single-shot OpenAI chat call that expects a JSON object back from a vision prompt.
 */
export async function askOpenAIVisionJson<T>({
  system,
  user,
  imageUrl,
  maxTokens = 1024,
}: VisionAskParams): Promise<OpenAIJsonResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "AI is not configured (missing OPENAI_API_KEY)." };
  }
  const model = process.env.INTERVIEW_OPENAI_VISION_MODEL ?? "gpt-4o-mini";

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[openai] vision chat completion failed", res.status, errText.slice(0, 500));
      return { ok: false, message: "AI request failed." };
    }

    const json = (await res.json()) as ChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    const jsonSlice = extractFirstJson(text) ?? (text.trim() ? text : null);
    if (!jsonSlice) {
      console.error("[openai] no JSON object in vision response");
      return { ok: false, message: "AI returned an unexpected response." };
    }

    return { ok: true, data: JSON.parse(jsonSlice) as T };
  } catch (e) {
    console.error("[openai] vision call errored", e);
    return { ok: false, message: "AI request errored." };
  }
}
