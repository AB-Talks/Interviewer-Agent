export type GeminiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
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
 * Calls Google Gemini Flash model expecting a JSON response.
 * Uses native fetch to avoid adding new SDK dependencies.
 */
export async function askGeminiJson<T>({
  system,
  user,
  maxTokens,
}: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<GeminiResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "Gemini API key is not configured." };
  }

  // gemini-2.0-flash has zero free-tier quota on some keys; 2.5-flash works.
  const model = process.env.INTERVIEW_GEMINI_MODEL ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${system}\n\nUSER INPUT:\n${user}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          // gemini-2.5-flash spends part of maxOutputTokens on invisible
          // "thinking" before writing the visible response -- for these
          // short extraction/generation tasks that reasoning is pure
          // overhead, and a tight token budget lets it eat the whole
          // response, leaving nothing (or a truncated object) behind.
          // Disabling it keeps the full budget for the actual JSON output.
          thinkingConfig: { thinkingBudget: 0 },
          ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[gemini] request failed", res.status, errText.slice(0, 500));
      return { ok: false, message: "Gemini API request failed." };
    }

    const responseJson = (await res.json()) as GeminiResponse;
    const text = responseJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonSlice = extractFirstJson(text);

    if (!jsonSlice) {
      console.error("[gemini] no JSON object in response", text);
      return { ok: false, message: "Gemini returned an unexpected response." };
    }

    return { ok: true, data: JSON.parse(jsonSlice) as T };
  } catch (e) {
    console.error("[gemini] call errored", e);
    return { ok: false, message: "Gemini request errored." };
  }
}
