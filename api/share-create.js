module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'BLOB_NOT_CONFIGURED' });
  }

  try {
    const { results, fileUrls, title, date } = req.body;
    if (!results) {
      return res.status(400).json({ error: 'Missing results' });
    }

    const shareData = JSON.stringify({ results, fileUrls: fileUrls || {}, title, date });

    const blobRes = await fetch('https://blob.vercel-storage.com/share-data.json', {
      method: 'PUT',
      headers: {
        'authorization': `Bearer ${token}`,
        'x-api-version': '7',
        'x-content-type': 'application/json',
        'x-add-random-suffix': '1',
        'Content-Type': 'application/octet-stream',
      },
      body: shareData,
    });

    if (!blobRes.ok) {
      const err = await blobRes.text();
      throw new Error(`Blob upload failed: ${blobRes.status} ${err}`);
    }

    const blob = await blobRes.json();
    return res.status(200).json({ shareUrl: blob.url });
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
