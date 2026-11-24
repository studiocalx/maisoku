let modelCache = null;\nlet modelCacheAt = 0;\n\nexport async function onRequestPost(context) {
  try {
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Cloudflareのシークレット GEMINI_API_KEY が見つかりません" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { imageBase64, mimeType = "image/jpeg" } = await context.request.json();
    if (!/^image\/(jpeg|png|webp)$/i.test(mimeType)) {
      return new Response(JSON.stringify({ error: "JPEG・PNG・WebP画像のみ対応しています" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "画像データが空です" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 利用可能モデル一覧を短時間キャッシュし、毎回の余分なAPI往復を抑える
    let supportedModels = modelCache && Date.now() - modelCacheAt < 10 * 60 * 1000 ? modelCache : null;
    if (!supportedModels) {
      const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const listRes = await fetch(listUrl);
      const listData = await listRes.json();
      if (!listRes.ok) {
        const msg = listData?.error?.message || JSON.stringify(listData);
        return new Response(JSON.stringify({ error: `モデル一覧の取得に失敗 (${listRes.status}): ${msg}` }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      supportedModels = (listData?.models || [])
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
      supportedModels.sort((a, b) => Number(!a.includes("flash")) - Number(!b.includes("flash")));
      modelCache = supportedModels;
      modelCacheAt = Date.now();
    }

    if (!listRes.ok) {
      const msg = listData?.error?.message || JSON.stringify(listData);
      return new Response(
        JSON.stringify({ error: `モデル一覧の取得に失敗 (${listRes.status}): ${msg}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (supportedModels.length === 0) {
      return new Response(
        JSON.stringify({ error: "このAPIキーで利用可能な generateContent モデルが見つかりません" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `あなたは不動産マイソク（物件チラシ）の解析アシスタントです。
画像から読み取れる情報をJSONのみで返してください（Markdownの\`\`\`は付けないこと）。
キーは以下の通り：
{
  "title": "物件名・特徴の要約",
  "rent_man": 数値またはnull（万円単位の賃料、例: 6.2）,
  "station": "最寄り駅・徒歩分数",
  "age_years": 数値またはnull（築年数）,
  "structure": "構造・階数（例: RC造 8階建/3階）",
  "layout": "間取り・面積",
  "notes": "設備・備考・懸念点（EV有無や再建築不可などの推測メモも簡潔に）"
}`;

    const payload = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
    });

    let lastStatus = 500;
    let lastMsg = "不明なエラー";

    for (const model of supportedModels.slice(0, 4)) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const data = await res.json();

      if (res.ok) {
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const cleaned = rawText.replace(/```json|```/g, "").trim();
        return new Response(cleaned, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      lastStatus = res.status;
      lastMsg = data?.error?.message || JSON.stringify(data);
      // 認証・利用上限・課金設定のエラーは別モデルでも直らないため即時終了
      if (res.status === 401 || res.status === 403 || res.status === 429) break;
    }

    return new Response(
      JSON.stringify({
        error: `Google側エラー (${lastStatus}): ${lastMsg} / 試行モデル: ${supportedModels.slice(0, 4).join(", ")}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `サーバーエラー: ${err.message || "不明"}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
