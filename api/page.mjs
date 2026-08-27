import { resolveMeeting } from '../src/civicclerk.mjs';
import {
  fetchPdfBytes,
  normalizeRenderWidth,
  renderPdfPage,
  selectAttachmentById,
} from '../src/document-reader.mjs';

export default async function handler(req, res) {
  const tenant = String(req.query?.tenant || 'mitchellsd');
  const body = String(req.query?.body || '');
  const date = String(req.query?.date || '');
  const attachmentId = Number(req.query?.attachmentId);
  const page = Number(req.query?.page || 1);
  const width = normalizeRenderWidth(req.query?.width);

  if (!body || !date || !Number.isFinite(attachmentId) || !Number.isInteger(page) || page < 1) {
    res.status(400).json({ error: 'body, date, numeric attachmentId and positive integer page query parameters are required' });
    return;
  }

  try {
    const meeting = await resolveMeeting(tenant, { body, date });
    const attachment = selectAttachmentById(meeting.agendaItems, attachmentId);
    if (!attachment) {
      res.status(404).json({
        error: `Attachment ${attachmentId} is not exposed by the resolved CivicClerk meeting`,
        eventId: meeting.event?.id || null,
        agendaId: meeting.event?.agendaId || null,
      });
      return;
    }

    const fetched = await fetchPdfBytes(attachment.downloadUrl);
    const rendered = await renderPdfPage(fetched.bytes, { page, width });
    if (rendered.pageCount && page > rendered.pageCount) {
      res.status(404).json({ error: `PDF page ${page} exceeds document page count ${rendered.pageCount}` });
      return;
    }

    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'public, max-age=60, s-maxage=86400');
    res.setHeader('x-civicclerk-event-id', String(meeting.event.id));
    res.setHeader('x-civicclerk-agenda-id', String(meeting.event.agendaId || ''));
    res.setHeader('x-civicclerk-attachment-id', String(attachmentId));
    res.setHeader('x-civicclerk-page', String(rendered.page));
    res.setHeader('x-civicclerk-source-sha256', fetched.sha256);
    res.status(200).send(Buffer.from(rendered.bytes));
  } catch (error) {
    res.status(error?.status || 502).json({
      error: error?.message || String(error),
      status: error?.status || null,
      url: error?.url || null,
    });
  }
}
