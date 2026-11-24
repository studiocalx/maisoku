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
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "画像データが空です" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const googleMsg = data?.error?.message || JSON.stringify(data);
      return new Response(
        JSON.stringify({ error: `Google側エラー (${res.status}): ${googleMsg}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    return new Response(cleaned, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `サーバーエラー: ${err.message || "不明"}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
