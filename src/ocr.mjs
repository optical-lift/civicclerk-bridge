import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { renderPdfPage } from './document-reader.mjs';

export const DEFAULT_OCR_RENDER_WIDTH = 2000;
export const DEFAULT_OCR_LANGUAGE = 'eng';
export const DEFAULT_OCR_PSM = 6;
export const DEFAULT_OCR_TIMEOUT_MS = 60_000;
export const DEFAULT_MIN_OCR_CHARACTERS = 12;

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseTesseractTsv(tsv) {
  const rows = String(tsv || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!rows.length) return { text: '', characters: 0, meanConfidence: null, words: 0, lines: 0 };
  const header = rows.shift().split('\t');
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const required = ['level', 'block_num', 'par_num', 'line_num', 'word_num', 'conf', 'text'];
  for (const key of required) {
    if (index[key] == null) throw new Error(`Tesseract TSV is missing ${key}`);
  }

  const lines = new Map();
  const confidences = [];
  let wordCount = 0;
  for (const row of rows) {
    if (!row) continue;
    const columns = row.split('\t');
    if (Number(columns[index.level]) !== 5) continue;
    const word = String(columns[index.text] || '').trim();
    if (!word) continue;
    const key = [columns[index.block_num], columns[index.par_num], columns[index.line_num]].join(':');
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
    const confidence = parseNumber(columns[index.conf]);
    if (confidence != null && confidence >= 0) confidences.push(confidence);
    wordCount += 1;
  }

  const text = [...lines.values()].map((words) => words.join(' ')).join('\n').trim();
  const meanConfidence = confidences.length
    ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100
    : null;
  return {
    text,
    characters: text.length,
    meanConfidence,
    words: wordCount,
    lines: lines.size,
  };
}

export async function runTesseractPng(bytes, {
  command = 'tesseract',
  language = DEFAULT_OCR_LANGUAGE,
  psm = DEFAULT_OCR_PSM,
  timeoutMs = DEFAULT_OCR_TIMEOUT_MS,
  maxOutputBytes = 20 * 1024 * 1024,
} = {}) {
  if (!bytes?.length) throw new Error('OCR input image is empty');
  return await new Promise((resolve, reject) => {
    const child = spawn(command, ['stdin', 'stdout', '-l', String(language), '--psm', String(psm), 'tsv'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`Tesseract OCR exceeded ${timeoutMs}ms page timeout`));
    }, timeoutMs);

    child.on('error', (error) => finish(new Error(`Unable to start Tesseract OCR: ${error.message}`)));
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(new Error(`Tesseract OCR output exceeded ${maxOutputBytes} bytes`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 1024 * 1024) stderr.push(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        finish(new Error(`Tesseract OCR failed with exit ${code}${diagnostic ? `: ${diagnostic.slice(0, 500)}` : ''}`));
        return;
      }
      const tsv = Buffer.concat(stdout).toString('utf8');
      finish(null, { ...parseTesseractTsv(tsv), diagnostic: diagnostic || null });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(bytes));
  });
}

export async function ocrPdfPages(bytes, {
  pageCount,
  renderWidth = DEFAULT_OCR_RENDER_WIDTH,
  minCharacters = DEFAULT_MIN_OCR_CHARACTERS,
  language = DEFAULT_OCR_LANGUAGE,
  psm = DEFAULT_OCR_PSM,
  command = 'tesseract',
} = {}) {
  const count = Number(pageCount || 0);
  if (!Number.isInteger(count) || count < 1) throw new Error('OCR requires a positive PDF page count');
  const pages = [];
  for (let page = 1; page <= count; page += 1) {
    const rendered = await renderPdfPage(bytes, { page, width: renderWidth });
    const ocr = await runTesseractPng(rendered.bytes, { command, language, psm });
    pages.push({
      page,
      width: rendered.width,
      height: rendered.height,
      imageSha256: createHash('sha256').update(rendered.bytes).digest('hex'),
      characters: ocr.characters,
      words: ocr.words,
      lines: ocr.lines,
      meanConfidence: ocr.meanConfidence,
      text: ocr.text,
    });
  }
  const text = pages
    .map((page) => `--- OCR PAGE ${page.page} OF ${count} ---\n${page.text}`)
    .join('\n')
    .trim();
  const usableCharacters = pages.reduce((sum, page) => sum + page.characters, 0);
  const confidenceValues = pages.map((page) => page.meanConfidence).filter((value) => Number.isFinite(value));
  const meanConfidence = confidenceValues.length
    ? Math.round((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) * 100) / 100
    : null;
  return {
    status: usableCharacters >= minCharacters ? 'ocr_extracted' : 'ocr_no_text',
    engine: 'tesseract',
    language,
    psm: Number(psm),
    renderWidth: Number(renderWidth),
    pageCount: count,
    characters: text.length,
    usableCharacters,
    meanConfidence,
    text,
    pages,
  };
}
