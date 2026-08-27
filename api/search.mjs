import fs from 'node:fs/promises';
import path from 'node:path';
import { searchCorpus } from '../src/corpus.mjs';

let cachedCorpus = null;
let cachedMtimeMs = null;

async function loadCorpus() {
  const file = path.join(process.cwd(), 'data', 'mitchellsd', 'sea-corpus.json');
  const stat = await fs.stat(file);
  if (!cachedCorpus || cachedMtimeMs !== stat.mtimeMs) {
    cachedCorpus = JSON.parse(await fs.readFile(file, 'utf8'));
    cachedMtimeMs = stat.mtimeMs;
  }
  return cachedCorpus;
}

export default async function handler(req, res) {
  const q = String(req.query?.q || '').trim();
  const from = req.query?.from ? String(req.query.from) : null;
  const to = req.query?.to ? String(req.query.to) : null;
  const limit = Number(req.query?.limit || 20);

  if (!q) {
    res.status(400).json({ error: 'q query parameter is required' });
    return;
  }

  try {
    const corpus = await loadCorpus();
    const results = searchCorpus(corpus, q, { from, to, limit });
    res.setHeader('cache-control', 'public, max-age=60, s-maxage=300');
    res.status(200).json({
      query: q,
      from,
      to,
      schemaVersion: corpus.schemaVersion,
      coverage: corpus.requestedCoverage,
      extraction: corpus.extraction || null,
      corpusStats: corpus.stats,
      resultCount: results.length,
      results,
    });
  } catch (error) {
    const missing = error?.code === 'ENOENT';
    res.status(missing ? 503 : 500).json({
      error: missing
        ? 'Mitchell SEA corpus has not been generated yet'
        : (error?.message || String(error)),
    });
  }
}
