import { meetingSnapshot } from '../src/civicclerk.mjs';
import { readCivicClerkAttachment } from '../src/document-reader.mjs';
import { ocrPdfPages } from '../src/ocr.mjs';

const meeting = await meetingSnapshot('mitchellsd', {
  body: 'Sports & Events Authority',
  date: '2026-08-18',
});
const attachment = (meeting.attachments || []).find((candidate) => Number(candidate.id) === 10891);
if (!attachment) throw new Error('Known scan attachment 10891 was not exposed by the Aug. 18 SEA meeting');
const parsed = await readCivicClerkAttachment(attachment, { includeBytes: true });
if (parsed.status !== 'visual_required') {
  throw new Error(`Expected attachment 10891 to exercise scan fallback, got ${parsed.status}`);
}
const ocr = await ocrPdfPages(parsed.bytes, {
  pageCount: parsed.pageCount,
  renderWidth: 2000,
  psm: 3,
  language: 'eng',
});
console.log(JSON.stringify({
  eventId: meeting.event.id,
  agendaId: meeting.event.agendaId,
  attachmentId: attachment.id,
  fileName: attachment.fileName,
  sourceSha256: parsed.sha256,
  sourceTextStatus: parsed.status,
  ocrStatus: ocr.status,
  ocrCharacters: ocr.characters,
  usableCharacters: ocr.usableCharacters,
  meanConfidence: ocr.meanConfidence,
  pages: ocr.pages.map((page) => ({
    page: page.page,
    width: page.width,
    height: page.height,
    imageSha256: page.imageSha256,
    characters: page.characters,
    meanConfidence: page.meanConfidence,
    preview: page.text.slice(0, 300),
  })),
}, null, 2));
