import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCivicClerkCorpus, DEFAULT_CORPUS_FROM, DEFAULT_CORPUS_TO } from '../src/corpus.mjs';

function args(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    result[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return result;
}

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

const options = args(process.argv);
const output = options.output || 'data/mitchellsd/sea-corpus.json';
const corpus = await buildCivicClerkCorpus({
  tenant: options.tenant || 'mitchellsd',
  body: options.body || 'Sports & Events Authority',
  from: options.from || DEFAULT_CORPUS_FROM,
  to: options.to || DEFAULT_CORPUS_TO,
  attachmentConcurrency: Number(options.concurrency || 3),
  ocrVisualDocuments: enabled(options.ocr),
  ocrOptions: {
    renderWidth: Number(options['ocr-render-width'] || 2000),
    language: options['ocr-language'] || 'eng',
    psm: Number(options['ocr-psm'] || 6),
  },
});

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  output,
  tenant: corpus.tenant,
  body: corpus.body,
  categoryId: corpus.categoryId,
  requestedCoverage: corpus.requestedCoverage,
  extraction: corpus.extraction,
  stats: corpus.stats,
}, null, 2));
