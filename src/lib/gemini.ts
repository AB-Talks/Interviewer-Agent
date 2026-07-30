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
}: {
  system: string;
  user: string;
}): Promise<GeminiResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, message: "Gemini API key is not configured." };
  }

  // We use the Gemini 2.0 Flash model which is fast and supports JSON mode
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

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
