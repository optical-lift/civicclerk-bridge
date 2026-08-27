import test from 'node:test';
import assert from 'node:assert/strict';
import { isPdfMagic, selectAttachmentById } from '../src/document-reader.mjs';

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
