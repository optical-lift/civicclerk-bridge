import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTesseractTsv } from '../src/ocr.mjs';

const sample = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t10\t10\t80\t20\t96.0\tReferees',
  '5\t1\t1\t1\t1\t2\t100\t10\t20\t20\t94.0\t-',
  '5\t1\t1\t1\t1\t3\t130\t10\t90\t20\t95.0\t$7500',
  '5\t1\t1\t1\t2\t1\t10\t40\t80\t20\t90.0\tTrainers',
  '5\t1\t1\t1\t2\t2\t100\t40\t90\t20\t92.0\t$1200',
].join('\n');

test('Tesseract TSV reconstruction preserves financial lines and confidence', () => {
  const parsed = parseTesseractTsv(sample);
  assert.equal(parsed.text, 'Referees - $7500\nTrainers $1200');
  assert.equal(parsed.words, 5);
  assert.equal(parsed.lines, 2);
  assert.equal(parsed.meanConfidence, 93.4);
});

test('Tesseract TSV parser rejects output without custody columns', () => {
  assert.throws(() => parseTesseractTsv('text\nhello'), /missing level/i);
});
