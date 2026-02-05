module.exports = async function handler(req, res) {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { jobText, resumeText } = req.body;

    if (!jobText || !resumeText) {
      return res.status(400).json({ error: 'Missing jobText or resumeText' });
    }

    const prompt = `あなたは採用担当者のアシスタントです。
募集要項と応募者の書類を比較し、この応募者が募集要件にマッチしているかを評価してください。

【募集要項】
${jobText}

【応募者の書類（履歴書・職務経歴書）】
${resumeText}

【評価ポイント】
1. 必須スキル・経験のマッチ度
2. 歓迎スキル・経験の有無
3. 職種・業界経験の関連性
4. 応募者の強みと募集ポジションの適合性

【出力形式】
以下のJSON形式で出力してください。他の文章は不要です。
{
  "name": "応募者名（分からなければ「不明」）",
  "recommendation": "A / B / C / D",
  "score": 1-100の数値,
  "match_rate": 1-100の数値（募集要件とのマッチ度）,
  "experience_years": "関連経験年数（推定）",
  "matching_skills": ["マッチしているスキル1", "スキル2"],
  "missing_skills": ["不足しているスキル1", "スキル2"],
  "qualifications": ["保有資格1", "資格2"],
  "strengths": ["この募集に対する強み1", "強み2"],
  "concerns": ["懸念点1", "懸念点2"],
  "summary": "50文字以内の一言評価（募集要件との適合性を中心に）"
}

【評価基準】
- A（強くおすすめ）: マッチ度80%以上、必須要件をほぼ満たす
- B（面談推奨）: マッチ度60-79%、主要な要件を満たす
- C（要検討）: マッチ度40-59%、一部要件を満たす
- D（見送り推奨）: マッチ度40%未満、要件との乖離が大きい`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return res.status(response.status).json({ error: error.error?.message || 'API Error' });
    }

    const data = await response.json();
    const text = data.content[0].text;

    // Extract JSON
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start !== -1 && end > start) {
      const result = JSON.parse(text.slice(start, end));
      return res.status(200).json(result);
    }

    return res.status(500).json({ error: 'Invalid response format' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
