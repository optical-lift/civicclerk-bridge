import { resolveMeeting } from '../src/civicclerk.mjs';
import {
  needsVisualFallback,
  readCivicClerkAttachment,
  selectAttachmentById,
  visualPageDescriptors,
} from '../src/document-reader.mjs';

export default async function handler(req, res) {
  const tenant = String(req.query?.tenant || 'mitchellsd');
  const body = String(req.query?.body || '');
  const date = String(req.query?.date || '');
  const attachmentId = Number(req.query?.attachmentId);

  if (!body || !date || !Number.isFinite(attachmentId)) {
    res.status(400).json({ error: 'body, date and numeric attachmentId query parameters are required' });
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

    const document = await readCivicClerkAttachment(attachment);
    const visualRequired = needsVisualFallback(document);
    const visual = {
      required: visualRequired,
      reason: visualRequired ? 'PDF has too little embedded text for reliable reading' : null,
      pages: visualRequired ? visualPageDescriptors({
        tenant,
        body,
        date,
        attachmentId,
        pageCount: document.pageCount,
      }) : [],
    };

    res.setHeader('cache-control', 'public, max-age=60, s-maxage=86400');
    res.status(200).json({
      tenant,
      meeting: {
        eventId: meeting.event.id,
        agendaId: meeting.event.agendaId,
        date: meeting.event.date,
        name: meeting.event.name,
        categoryName: meeting.event.categoryName,
      },
      document,
      visual,
      provenance: {
        agendaApi: meeting.provenance.agendaApi,
        retrievedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(error?.status || 502).json({
      error: error?.message || String(error),
      status: error?.status || null,
      url: error?.url || null,
    });
  }
}
