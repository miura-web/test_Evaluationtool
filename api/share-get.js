module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'BLOB_NOT_CONFIGURED' });
  }

  const { id } = req.query;
  if (!id || !/^[a-f0-9]{8}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid share ID' });
  }

  try {
    const listRes = await fetch(`https://blob.vercel-storage.com?prefix=s/${id}.json&limit=1`, {
      headers: {
        'authorization': `Bearer ${token}`,
        'x-api-version': '7',
      },
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Blob list failed: ${listRes.status} ${err}`);
    }

    const listData = await listRes.json();
    if (!listData.blobs || listData.blobs.length === 0) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const blobUrl = listData.blobs[0].url;
    const dataRes = await fetch(blobUrl);
    if (!dataRes.ok) {
      throw new Error(`Failed to fetch share data: ${dataRes.status}`);
    }

    const shareData = await dataRes.json();
    return res.status(200).json(shareData);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
