import { meetingSnapshot } from '../src/civicclerk.mjs';

export default async function handler(req, res) {
  const tenant = String(req.query?.tenant || 'mitchellsd');
  const body = String(req.query?.body || '');
  const date = String(req.query?.date || '');
  if (!body || !date) {
    res.status(400).json({ error: 'body and date query parameters are required' });
    return;
  }
  try {
    const snapshot = await meetingSnapshot(tenant, { body, date });
    res.setHeader('cache-control', 'public, max-age=60, s-maxage=300');
    res.status(200).json(snapshot);
  } catch (error) {
    res.status(error?.status || 502).json({
      error: error?.message || String(error),
      status: error?.status || null,
      url: error?.url || null,
    });
  }
}
