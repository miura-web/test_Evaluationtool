const MAX_TRANSCRIPT_LENGTH = 15000;

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
        'anthropic-version': '2023-06-01'
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
    const { transcript } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'Missing transcript' });
    }

    const trimmed = truncateText(transcript, MAX_TRANSCRIPT_LENGTH);

    const data = await callAnthropicWithRetry(apiKey, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `以下の面接・自己PR動画の書き起こしテキストを、採用評価に重要なポイントを中心に2000文字以内で要約してください。
自己紹介、志望動機、経験・スキル、強み・弱み、具体的なエピソードなどのポイントを押さえてください。

【書き起こしテキスト】
${trimmed}`
      }]
    });

    return res.status(200).json({ summary: data.content[0].text.trim() });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
