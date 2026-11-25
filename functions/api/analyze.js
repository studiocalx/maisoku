const CACHE_TTL_SECONDS = 3600;
const CACHE_KEY_URL = "https://maisoku-cache.local/gemini-flash-models-v2";

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
  if (/(audio|live|embedding|image)/.test(lower)) return -1;
  if (/(preview|experimental|exp-)/.test(lower)) return -1;

  const version = lower.match(/gemini-(\d+)\.(\d+)-flash/);
  if (!version) return -1;

  const major = Number(version[1]);
  const minor = Number(version[2]);
  // 2.0 / 1.5以前の終了済み世代を候補から除外する。
  if (major < 2 || (major === 2 && minor < 5)) return -1;
  // Stable Flash models first; Lite is a useful lower-cost fallback.
  return major * 1000 + minor * 10 + (lower.includes("lite") ? 0 : 5);
}

async function getCandidateModels(apiKey, ctx) {
  const cache = caches.default;
  const cacheRequest = new Request(CACHE_KEY_URL, { method: "GET" });

  try {
    const cached = await cache.match(cacheRequest);
    if (cached) {
      const data = await cached.json();
      if (Array.isArray(data?.models) && data.models.length > 0) {
        const safeCached = data.models.filter((id) => scoreFlashModel(String(id)) > 0);
        if (safeCached.length) return safeCached;
      }
    }
  } catch {
    // キャッシュが読めない場合はモデル一覧を再取得
  }

  // APIのモデル一覧取得に失敗した場合のみ使用する保険候補。
  // 2.0 / 1.5系は終了済みのため候補に含めない。
  const fallbackDefaults = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ];

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(listUrl, { method: "GET" });
    if (!res.ok) return fallbackDefaults;

    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    const ranked = models
      .filter((m) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent")
      )
      .map((m) => ({
        id: String(m.name || "").replace(/^models\//, ""),
        score: scoreFlashModel(String(m.name || ""))
      }))
      .filter((m) => m.id && m.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.id);

    const uniqueModels = Array.from(new Set([...ranked, ...fallbackDefaults]))
      .filter((id) => scoreFlashModel(id) > 0)
      .slice(0, 5);
    const cacheRes = new Response(JSON.stringify({ models: uniqueModels }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`
      }
    });

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(cache.put(cacheRequest, cacheRes));
    } else {
      await cache.put(cacheRequest, cacheRes);
    }
    return uniqueModels;
  } catch {
    return fallbackDefaults;
  }
}

function diagnoseGeminiError(errorBody, httpStatus) {
  const apiError = errorBody?.error || {};
  const details = Array.isArray(apiError.details) ? apiError.details : [];
  const quotaFailure = details.find((item) =>
    String(item?.["@type"] || "").includes("QuotaFailure")
  );
  const violation = quotaFailure?.violations?.[0] || {};
  const retryInfo = details.find((item) =>
    String(item?.["@type"] || "").includes("RetryInfo")
  );

  const quotaId = String(violation.quotaId || "");
  const metric = String(violation.quotaMetric || "");
  const message = String(apiError.message || errorBody?.message || "詳細なエラー理由は返されませんでした。");
  const retryDelay = String(retryInfo?.retryDelay || "");

  let category = "原因特定不能";
  let explanation = "Gemini APIの利用枠または一時的な処理容量に達した可能性があります。";

  if (/RequestsPerMinute|requests_per_minute|RPM/i.test(quotaId + " " + metric)) {
    category = "RPM制限（1分あたりのリクエスト上限）";
    explanation = "短時間に送信できるリクエスト数の上限です。少し時間をおいて再試行してください。";
  } else if (/Tokens.*PerMinute|PerMinute.*Tokens|tokens_per_minute|TPM/i.test(quotaId + " " + metric)) {
    category = "TPM制限（1分あたりの処理トークン上限）";
    explanation = "短時間に処理できるトークン量の上限です。画像サイズや送信頻度を抑えて再試行してください。";
  } else if (/RequestsPerDay|requests_per_day|RPD/i.test(quotaId + " " + metric)) {
    category = "RPD制限（1日あたりのリクエスト上限）";
    explanation = "このモデルの1日あたりの利用上限です。別モデルの利用枠が残っていれば自動切替を試し、全候補で上限の場合はリセットを待つ必要があります。";
  } else if (/billing|payment|spend|cost/i.test(message + " " + quotaId + " " + metric)) {
    category = "課金・プロジェクト利用枠";
    explanation = "課金設定またはプロジェクト全体の利用枠を確認してください。別モデルへの切替だけでは解消しない場合があります。";
  } else if (/RESOURCE_EXHAUSTED/i.test(String(apiError.status || "")) || httpStatus === 429) {
    explanation = "Google側からRESOURCE_EXHAUSTEDが返されています。レスポンスに上限の種類が含まれていないため、AI StudioのRate limitsでプロジェクト・モデル別の使用量を確認してください。";
  }

  const retryText = retryDelay ? ` Google指定の再試行目安: ${retryDelay}.` : "";
  const quotaText = quotaId ? ` quotaId: ${quotaId}.` : "";
  return {
    category,
    summary: `${category}: ${explanation}${retryText}${quotaText}`,
    providerMessage: message,
    quotaId: quotaId || null,
    quotaMetric: metric || null,
    quotaValue: violation.quotaValue || null,
    retryDelay: retryDelay || null,
    providerStatus: apiError.status || null
  };
}

async function readGeminiError(response) {
  const raw = await response.text().catch(() => "");
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  return { body, raw, diagnostic: diagnoseGeminiError(body, response.status) };
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

  const attemptedModels = [];
  const rateLimitErrors = [];
  let lastError = null;

  for (const modelId of candidates) {
    attemptedModels.push(modelId);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    try {
      const geminiRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64Data } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        })
      });

      if (geminiRes.status === 403) {
        const errorInfo = await readGeminiError(geminiRes);
        return jsonResponse({
          ok: false,
          error: "Gemini APIの認証・権限エラー（403）です。APIキー、APIの有効化、プロジェクト設定を確認してください。",
          model: modelId,
          providerMessage: errorInfo.diagnostic.providerMessage
        }, 403);
      }

      if (geminiRes.status === 429) {
        const errorInfo = await readGeminiError(geminiRes);
        rateLimitErrors.push({ model: modelId, ...errorInfo.diagnostic });
        lastError = {
          status: 429,
          model: modelId,
          detail: errorInfo.diagnostic.providerMessage
        };
        // 429で即終了せず、モデルごとの利用枠が残っている可能性に賭けて次候補へ。
        continue;
      }

      if (!geminiRes.ok) {
        const errorInfo = await readGeminiError(geminiRes);
        lastError = {
          status: geminiRes.status,
          model: modelId,
          detail: errorInfo.diagnostic.providerMessage || errorInfo.raw.slice(0, 500)
        };
        if (geminiRes.status === 400 || geminiRes.status === 404 || geminiRes.status >= 500) {
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
          detail: "AI応答をJSONとして解釈できませんでした。"
        };
        continue;
      }

      return jsonResponse({
        ok: true,
        model: modelId,
        attemptedModels,
        data: parsed
      });
    } catch (err) {
      lastError = {
        status: 500,
        model: modelId,
        detail: err instanceof Error ? err.message : "通信エラーが発生しました。"
      };
      continue;
    }
  }

  if (rateLimitErrors.length > 0) {
    const latest = rateLimitErrors[rateLimitErrors.length - 1];
    const categories = Array.from(new Set(rateLimitErrors.map((item) => item.category)));
    const categoryText = categories.join(" / ");
    const allModels = attemptedModels.join(", ");
    const summary = rateLimitErrors.length === 1
      ? latest.summary
      : `試したモデルすべてで429になりました（${categoryText}）。${latest.summary}`;

    return jsonResponse({
      ok: false,
      error: `Gemini APIの利用上限（429）です。自動で別モデルへの切替を試しましたが、解析を完了できませんでした。${summary}`,
      diagnostic: {
        category: categoryText,
        summary,
        providerMessage: latest.providerMessage,
        quotaId: latest.quotaId,
        quotaMetric: latest.quotaMetric,
        quotaValue: latest.quotaValue,
        retryDelay: latest.retryDelay,
        modelsAttempted: attemptedModels
      },
      lastError,
      modelsAttempted: attemptedModels
    }, 429);
  }

  return jsonResponse({
    ok: false,
    error: "利用可能なGeminiモデルで解析を完了できませんでした。",
    lastError,
    modelsAttempted: attemptedModels
  }, 502);
}

export async function onRequestGet() {
  return jsonResponse({ ok: true, service: "maisoku-analyze", status: "ready" });
}
