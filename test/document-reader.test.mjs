import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPdfMagic,
  needsVisualFallback,
  normalizeRenderWidth,
  selectAttachmentById,
  visualPageDescriptors,
} from '../src/document-reader.mjs';

test('PDF magic detection accepts a real PDF header and rejects other bytes', () => {
  assert.equal(isPdfMagic(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), true);
  assert.equal(isPdfMagic(new Uint8Array([0x50, 0x4e, 0x47, 0x0d])), false);
});

test('attachment selection preserves agenda-item custody', () => {
  const items = [
    {
      id: 10930,
      name: 'Cornicupia 2026',
      attachments: [
        { id: 11012, fileName: 'Cornicupia 2026 Event Budget', downloadUrl: 'https://civicclerk.blob.core.windows.net/stream/MITCHELLSD/example.pdf' },
      ],
    },
  ];
  const attachment = selectAttachmentById(items, 11012);
  assert.equal(attachment.id, 11012);
  assert.equal(attachment.agendaItemId, 10930);
  assert.equal(attachment.agendaItemName, 'Cornicupia 2026');
  assert.equal(attachment.fileName, 'Cornicupia 2026 Event Budget');
});

test('visual fallback is required when embedded PDF text is too sparse', () => {
  assert.equal(needsVisualFallback({ status: 'visual_required', characters: 0 }), true);
  assert.equal(needsVisualFallback({ status: 'text_extracted', characters: 19 }), true);
  assert.equal(needsVisualFallback({ status: 'text_extracted', characters: 20 }), false);
});

test('visual page descriptors preserve meeting and attachment custody', () => {
  const pages = visualPageDescriptors({
    tenant: 'mitchellsd',
    body: 'Sports & Events Authority',
    date: '2026-08-18',
    attachmentId: 10891,
    pageCount: 2,
    width: 1600,
  });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].page, 1);
  assert.match(pages[0].path, /^\/api\/page\?/);
  const url = new URL(pages[0].path, 'https://bridge.example');
  assert.equal(url.searchParams.get('tenant'), 'mitchellsd');
  assert.equal(url.searchParams.get('body'), 'Sports & Events Authority');
  assert.equal(url.searchParams.get('date'), '2026-08-18');
  assert.equal(url.searchParams.get('attachmentId'), '10891');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('width'), '1600');
});

test('render width is clamped to safe serverless bounds', () => {
  assert.equal(normalizeRenderWidth(400), 600);
  assert.equal(normalizeRenderWidth(1600), 1600);
  assert.equal(normalizeRenderWidth(9999), 2400);
});
