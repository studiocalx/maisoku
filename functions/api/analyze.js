const CACHE_TTL_SECONDS = 3600;
const CACHE_KEY_URL = "https://maisoku-cache.local/gemini-flash-models";

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function scoreFlashModel(name) {
  const lower = name.toLowerCase();
  if (!lower.includes("flash")) return -1;
  if (lower.includes("audio") || lower.includes("live") || lower.includes("embedding")) {
    return -1;
  }
  let score = 10;
  if (lower.includes("2.5")) score += 50;
  else if (lower.includes("2.0")) score += 40;
  else if (lower.includes("1.5")) score += 30;

  if (!lower.includes("exp") && !lower.includes("preview") && !lower.includes("lite")) {
    score += 15;
  } else if (lower.includes("lite")) {
    score += 5;
  }
  return score;
}

async function getCandidateModels(apiKey, ctx) {
  const cache = caches.default;
  const cacheRequest = new Request(CACHE_KEY_URL, { method: "GET" });

  try {
    const cached = await cache.match(cacheRequest);
    if (cached) {
      const data = await cached.json();
      if (Array.isArray(data?.models) && data.models.length > 0) {
        return data.models;
      }
    }
  } catch {
    // キャッシュ読み取り失敗時はフォールバックへ進む
  }

  const fallbackDefaults = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(listUrl, { method: "GET" });
    if (!res.ok) {
      return fallbackDefaults;
    }

    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];

    const ranked = models
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => ({
        id: String(m.name || "").replace(/^models\//, ""),
        score: scoreFlashModel(String(m.name || "")),
      }))
      .filter((m) => m.id && m.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.id);

    const uniqueModels = Array.from(new Set([...ranked, ...fallbackDefaults])).slice(0, 4);

    if (uniqueModels.length > 0) {
      const cacheRes = new Response(JSON.stringify({ models: uniqueModels }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      });
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(cache.put(cacheRequest, cacheRes));
      } else {
        await cache.put(cacheRequest, cacheRes);
      }
    }

    return uniqueModels;
  } catch {
    return fallbackDefaults;
  }
}

function buildPrompt() {
  return [
    "あなたは日本の賃貸不動産マイソク（物件資料）を読み取る高精度OCR兼アナリストです。",
    "画像から読み取れる事実のみを抽出し、読み取れない項目は必ず null にしてください。推測や補完は禁止です。",
    "出力は必ず純粋なJSONオブジェクトのみを返してください（マークダウン記法 ```json は不要）。",
    "",
    "出力スキーマ:",
    "{",
    '  "title": string | null,',
    '  "rent_yen": number | null,',
    '  "management_fee_yen": number | null,',
    '  "deposit": string | null,',
    '  "key_money": string | null,',
    '  "station": string | null,',
    '  "walk_minutes": number | null,',
    '  "layout": string | null,',
    '  "area_sqm": number | null,',
    '  "built_year": number | null,',
    '  "structure": string | null,',
    '  "address": string | null,',
    '  "notes": string | null,',
    '  "confidence_note": string | null',
    "}",
    "",
    "数値ルール:",
    "- rent_yen / management_fee_yen は円単位の整数（例: 8.5万円 → 85000）。",
    "- walk_minutes は分単位の整数。複数駅ある場合は最も近い徒歩分数を優先。",
    "- area_sqm は㎡単位の数値（例: 25.4）。",
    "- built_year は西暦4桁の整数（例: 2018）。令和・平成表記があれば西暦に変換。",
  ].join("\n");
}

function extractJsonFromText(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env?.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { ok: false, error: "GEMINI_API_KEY が Cloudflare 環境変数に設定されていません。" },
      500
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "リクエストJSONの形式が不正です。" }, 400);
  }

  const base64Data = typeof body?.imageBase64 === "string" ? body.imageBase64.trim() : "";
  const mimeType = typeof body?.mimeType === "string" && body.mimeType.trim()
    ? body.mimeType.trim()
    : "image/jpeg";

  if (!base64Data) {
    return jsonResponse({ ok: false, error: "画像データ（imageBase64）が空です。" }, 400);
  }

  // 約12MB相当のBase64長上限チェック（12MB * 1.37 ≒ 16.4M文字）
  if (base64Data.length > 17_000_000) {
    return jsonResponse(
      { ok: false, error: "画像サイズが大きすぎます。少し解像度を下げて再試行してください。" },
      413
    );
  }

  const candidates = await getCandidateModels(apiKey, context);
  const prompt = buildPrompt();
  let lastError = null;

  for (const modelId of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const geminiRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      });

      if (geminiRes.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: "Gemini APIキーの認証または権限エラー（403）です。APIキーと課金・利用制限を確認してください。",
            model: modelId,
          },
          403
        );
      }

      if (geminiRes.status === 429) {
        return jsonResponse(
          {
            ok: false,
            error: "Gemini APIの利用制限（429）に達しました。時間をおいて再試行してください。",
            model: modelId,
          },
          429
        );
      }

      if (!geminiRes.ok) {
        const errText = await geminiRes.text().catch(() => "");
        lastError = {
          status: geminiRes.status,
          model: modelId,
          detail: errText.slice(0, 300),
        };
        // 404 やモデル未対応系は次候補へフォールバック
        if (geminiRes.status === 404 || geminiRes.status === 400 || geminiRes.status >= 500) {
          continue;
        }
        break;
      }

      const geminiJson = await geminiRes.json();
      const parts = geminiJson?.candidates?.[0]?.content?.parts || [];
      const textOut = parts.map((p) => p?.text || "").join("\n").trim();
      const parsed = extractJsonFromText(textOut);

      if (!parsed || typeof parsed !== "object") {
        lastError = {
          status: 502,
          model: modelId,
          detail: "AI応答をJSONとして解釈できませんでした。",
        };
        continue;
      }

      return jsonResponse({
        ok: true,
        model: modelId,
        data: parsed,
      });
    } catch (err) {
      lastError = {
        status: 500,
        model: modelId,
        detail: err instanceof Error ? err.message : "通信エラーが発生しました。",
      };
      continue;
    }
  }

  return jsonResponse(
    {
      ok: false,
      error: "利用可能なGeminiモデルで解析を完了できませんでした。",
      lastError,
    },
    502
  );
}

export async function onRequestGet() {
  return jsonResponse({ ok: true, service: "maisoku-analyze", status: "ready" });
}
