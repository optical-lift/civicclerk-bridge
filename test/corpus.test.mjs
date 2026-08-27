import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCorpus } from '../src/corpus.mjs';

const corpus = {
  requestedCoverage: { from: '2023-01-01', to: '2026-12-31' },
  documents: [
    {
      id: '1540:attachment:11012',
      kind: 'attachment',
      meetingDate: '2026-08-18T14:00:00Z',
      meetingName: 'Sports & Events Authority Advisory Committee',
      body: 'Sports & Events Authority Advisory Committee',
      eventId: 1540,
      agendaId: 1509,
      fileId: null,
      attachmentId: 11012,
      agendaItemId: 10930,
      agendaItemName: 'Cornicupia 2026',
      fileName: 'Cornicupia 2026 Event Budget',
      status: 'text_extracted',
      pageCount: 1,
      characters: 191,
      sha256: 'a'.repeat(64),
      sourcePath: '/stream/MITCHELLSD/budget.pdf',
      text: 'Cornicupia 2026\nEstimated expenses\nReferees - $7500\nTrainers - $1200\n$13,200.00',
    },
    {
      id: '1400:attachment:9000',
      kind: 'attachment',
      meetingDate: '2025-09-11T14:00:00Z',
      meetingName: 'Sports & Events Authority Advisory Committee',
      body: 'Sports & Events Authority Advisory Committee',
      eventId: 1400,
      agendaId: 1300,
      attachmentId: 9000,
      agendaItemId: 8000,
      agendaItemName: 'Cornicupia 2025',
      fileName: 'Cornicupia 2025 Event Budget',
      status: 'text_extracted',
      pageCount: 1,
      characters: 120,
      sha256: 'b'.repeat(64),
      sourcePath: '/stream/MITCHELLSD/2025.pdf',
      text: 'Estimated expenses\nRefs - $5000\nField use - $495',
    },
    {
      id: '1540:attachment:10891',
      kind: 'attachment',
      meetingDate: '2026-08-18T14:00:00Z',
      meetingName: 'Sports & Events Authority Advisory Committee',
      body: 'Sports & Events Authority Advisory Committee',
      eventId: 1540,
      agendaId: 1509,
      attachmentId: 10891,
      agendaItemId: 10812,
      agendaItemName: 'Thank you card',
      fileName: '2026 MAC Area Events, Inc',
      status: 'visual_required',
      pageCount: 1,
      characters: 19,
      sha256: 'c'.repeat(64),
      sourcePath: '/stream/MITCHELLSD/card.pdf',
      text: '',
    },
  ],
};

test('search finds an expense inside attachment text and preserves source custody', () => {
  const results = searchCorpus(corpus, 'referees', { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(results.length, 1);
  assert.equal(results[0].attachmentId, 11012);
  assert.equal(results[0].eventId, 1540);
  assert.equal(results[0].agendaId, 1509);
  assert.match(results[0].snippet, /Referees - \$7500/i);
});

test('date filters prevent a later meeting from hiding historical matches', () => {
  const results = searchCorpus(corpus, 'Cornicupia', { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(results.length, 1);
  assert.equal(results[0].attachmentId, 9000);
});

test('visual-required documents remain discoverable by title and agenda metadata', () => {
  const results = searchCorpus(corpus, 'MAC Area Events');
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'visual_required');
  assert.equal(results[0].attachmentId, 10891);
});
