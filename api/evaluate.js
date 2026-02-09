const MAX_TEXT_LENGTH = 3000;

function truncateText(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n...(以下省略)';
}

async function callAnthropicWithRetry(apiKey, body, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify(body)
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : (attempt + 1) * 10000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API Error (${response.status})`);
    }

    return response.json();
  }
  throw new Error('Rate limit exceeded after retries. Please try again later.');
}

module.exports = async function handler(req, res) {
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
    const { jobText, resumeText, criteria, videoFrames, videoTranscript, resumePDF } = req.body;

    if (!jobText || (!resumeText && !resumePDF)) {
      return res.status(400).json({ error: 'Missing jobText or resumeText' });
    }

    const trimmedJob = truncateText(jobText, MAX_TEXT_LENGTH);
    const trimmedResume = truncateText(resumeText, MAX_TEXT_LENGTH);

    // Build evaluation points from criteria
    let evaluationPoints;
    if (criteria && typeof criteria === 'object') {
      const sanitize = (arr) => {
        if (!Array.isArray(arr)) return [];
        return arr
          .filter(c => c && typeof c.label === 'string' && c.label.length <= 100)
          .slice(0, 12)
          .map(c => ({ label: c.label.trim(), weight: Math.max(1, Math.min(5, parseInt(c.weight) || 3)) }));
      };
      const allCriteria = [...sanitize(criteria.preset), ...sanitize(criteria.custom).slice(0, 5)];
      if (allCriteria.length > 0) {
        const weightDesc = { 1: '参考程度', 2: 'やや重視', 3: '標準的に重視', 4: '重視', 5: '最重視' };
        allCriteria.sort((a, b) => b.weight - a.weight);
        evaluationPoints = allCriteria.map((c, i) => `${i + 1}. ${c.label}（重要度: ${weightDesc[c.weight]}）`).join('\n');
      }
    }
    if (!evaluationPoints) {
      evaluationPoints = `1. 必須スキル・経験のマッチ度\n2. 歓迎スキル・経験の有無\n3. 職種・業界経験の関連性\n4. 応募者の強みと募集ポジションの適合性`;
    }

    const hasVideo = Array.isArray(videoFrames) && videoFrames.length > 0;
    const hasResumePDF = typeof resumePDF === 'string' && resumePDF.length > 0;
    const trimmedTranscript = videoTranscript ? truncateText(videoTranscript, 5000) : '';

    const videoSection = hasVideo ? `

【面接動画の情報】
${trimmedTranscript ? `[書き起こし]\n${trimmedTranscript}\n` : ''}
[動画フレーム]
以下の画像は面接/自己PR動画から等間隔で抽出したフレームです。

【動画評価ポイント】
動画から以下の点を追加で評価してください:
1. 外見・身だしなみの適切さ（清潔感、TPO）
2. 表情・態度（明るさ、誠実さ、自信）
3. コミュニケーション能力（話し方の明瞭さ、論理性）
4. 志望動機・自己PRの内容と説得力
5. 全体的な印象・ポテンシャル` : '';

    const videoOutputSchema = hasVideo ? `,
  "video_evaluation": {
    "appearance_score": 1-5の数値（身だしなみ・外見）,
    "communication_score": 1-5の数値（コミュニケーション力）,
    "attitude_score": 1-5の数値（態度・姿勢）,
    "content_score": 1-5の数値（発言内容の質）,
    "overall_impression": "動画からの全体的な印象（100文字以内）",
    "video_strengths": ["動画で確認できた強み1", "強み2"],
    "video_concerns": ["動画での懸念点1", "懸念点2"]
  }` : '';

    const prompt = `あなたは採用担当者のアシスタントです。
募集要項と応募者の書類を比較し、この応募者が募集要件にマッチしているかを評価してください。

【募集要項】
${trimmedJob}

【応募者の書類（テキスト抽出分）】
${trimmedResume || '（テキスト抽出不可）'}

${hasResumePDF ? '【重要】応募者の書類PDFも添付しています。テキスト抽出では一部のフォントが読み取れず内容が欠落している場合があります。必ず添付PDFから直接内容を読み取って評価してください。PDF内の氏名、学歴、職歴、資格、志望動機、自己PR等のすべての記載内容を確認してください。' : ''}

【注意事項】
- 応募者によっては履歴書のみで職務経歴書がない場合があります。履歴書内の情報から最大限評価してください。
- 「未記入」「情報不足」「白紙」「空白」と判定しないでください。PDFが添付されている場合はPDFから直接読み取って評価してください。
- テキストが少なくても、読み取れる情報から募集要件との適合性を判断してください。

【評価ポイント（重要度順）】
${evaluationPoints}

上記の評価ポイントの重要度に応じて、重み付けしてスコアとマッチ度を算出してください。
「最重視」の項目は評価への影響が最も大きく、「参考程度」の項目は軽微な影響としてください。
${videoSection}

【出力形式】
以下のJSON形式で出力してください。他の文章は不要です。
{
  "name": "応募者名（分からなければ「不明」）",
  "recommendation": "A / B / C / D",
  "score": 1-100の数値,
  "match_rate": 1-100の数値（募集要件とのマッチ度）,
  "experience_years": "関連経験年数（推定。不明な場合は「記載なし」）",
  "matching_skills": ["マッチしているスキル1", "スキル2"],
  "missing_skills": ["不足しているスキル1", "スキル2"],
  "qualifications": ["保有資格1", "資格2"],
  "strengths": ["この募集に対する強み1", "強み2"],
  "concerns": ["懸念点1", "懸念点2"],
  "summary": "50文字以内の一言評価（募集要件との適合性を中心に）"${videoOutputSchema}
}

【評価基準】
- A（強くおすすめ）: マッチ度80%以上、必須要件をほぼ満たす
- B（面談推奨）: マッチ度60-79%、主要な要件を満たす
- C（要検討）: マッチ度40-59%、一部要件を満たす
- D（見送り推奨）: マッチ度40%未満、要件との乖離が大きい`;

    // Build content array (text + optional PDF/images)
    const content = [];

    // Add resume PDF document for Claude to read directly
    if (hasResumePDF) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: resumePDF }
      });
    }

    content.push({ type: 'text', text: prompt });

    if (hasVideo) {
      const frames = videoFrames.slice(0, 5);
      for (const frame of frames) {
        const ts = frame.timestamp || 0;
        const min = Math.floor(ts / 60);
        const sec = Math.floor(ts % 60);
        content.push({ type: 'text', text: `[${min}:${String(sec).padStart(2, '0')}]` });
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: frame.data }
        });
      }
    }

    const useMultimodal = hasResumePDF || hasVideo;
    const data = await callAnthropicWithRetry(apiKey, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: (hasVideo || hasResumePDF) ? 2048 : 1024,
      messages: [{ role: 'user', content: useMultimodal ? content : prompt }]
    });

    const text = data.content[0].text;

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start !== -1 && end > start) {
      const result = JSON.parse(text.slice(start, end));
      result._debug = {
        hasResumePDF,
        resumePDFLength: resumePDF ? resumePDF.length : 0,
        resumeTextLength: resumeText ? resumeText.length : 0,
        contentBlocks: content.length,
        modelUsed: useMultimodal ? 'multimodal' : 'text-only'
      };
      return res.status(200).json(result);
    }

    return res.status(500).json({ error: 'Invalid response format' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
