export async function onRequestPost(context) {
  try {
    const apiKey = context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Cloudflareのシークレット GEMINI_API_KEY が見つかりません" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { imageBase64, mimeType = "image/jpeg" } = await context.request.json();
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(
        JSON.stringify({ error: "画像データが空です" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (imageBase64.length > 16 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: "画像サイズが上限を超えています（12MB以下にしてください）" }),
        { status: 413, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return new Response(
        JSON.stringify({ error: "対応画像形式はJPEG・PNG・WebPです" }),
        { status: 415, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. 今このAPIキーで利用でき、generateContent に対応しているモデル一覧を取得
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const listRes = await fetch(listUrl);
    const listData = await listRes.json();

    if (!listRes.ok) {
      const msg = listData?.error?.message || JSON.stringify(listData);
      return new Response(
        JSON.stringify({ error: `モデル一覧の取得に失敗 (${listRes.status}): ${msg}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const supportedModels = (listData?.models || [])
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));

    // flash系を優先して先頭に並べる
    supportedModels.sort((a, b) => {
      const aFlash = a.includes("flash") ? 0 : 1;
      const bFlash = b.includes("flash") ? 0 : 1;
      return aFlash - bFlash;
    });

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
  "title": "物件名・所在地の短い表記",
  "rent_man": 数値またはnull（万円単位の月額賃料）,
  "station": "駅名・路線名のみ。徒歩分数は含めない",
  "walk_min": 数値またはnull（駅徒歩分数）,
  "age_years": 数値またはnull（築年数）,
  "structure": "建物構造のみ（木造・鉄骨造・RC造など）",
  "floor_num": 数値またはnull（対象住戸の所在階）,
  "max_floor": 数値またはnull（建物の地上階数）,
  "layout": "間取りのみ（ワンルーム・1K・1DKなど）",
  "area_sqm": 数値またはnull（専有面積、平方メートル）,
  "notes": "設備・備考。画像に書かれていない情報は推測せず、未記載とする"
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
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
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
        try {
          const parsed = JSON.parse(cleaned);
          const numericOrNull = (value) => {
            if (value === null || value === undefined || value === "") return null;
            const number = Number(value);
            return Number.isFinite(number) && number >= 0 ? number : null;
          };
          const textOrEmpty = (value) => typeof value === "string" ? value.trim().slice(0, 500) : "";
          const result = {
            title: textOrEmpty(parsed.title),
            rent_man: numericOrNull(parsed.rent_man),
            station: textOrEmpty(parsed.station),
            walk_min: numericOrNull(parsed.walk_min),
            age_years: numericOrNull(parsed.age_years),
            structure: textOrEmpty(parsed.structure),
            floor_num: numericOrNull(parsed.floor_num),
            max_floor: numericOrNull(parsed.max_floor),
            layout: textOrEmpty(parsed.layout),
            area_sqm: numericOrNull(parsed.area_sqm),
            notes: textOrEmpty(parsed.notes)
          };
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        } catch (_) {
          return new Response(
            JSON.stringify({ error: "AIの返答を正しいJSONとして読み取れませんでした。画像を変えて再試行してください。" }),
            { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } }
          );
        }
      }

      lastStatus = res.status;
      lastMsg = data?.error?.message || JSON.stringify(data);
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
