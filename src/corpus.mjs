import {
  classifyPublishedFiles,
  flattenAgenda,
  getAgenda,
  getEventCategories,
  getMeetingFileText,
  resolveCategory,
  selectMinutesFile,
} from './civicclerk.mjs';
import { readCivicClerkAttachment } from './document-reader.mjs';
import { listEventsRange } from './event-range.mjs';

export const CORPUS_SCHEMA_VERSION = 1;
export const DEFAULT_CORPUS_FROM = '2023-01-01';
export const DEFAULT_CORPUS_TO = '2026-12-31';

function compactError(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 500);
}

function yearOf(date) {
  return String(date || '').slice(0, 4) || 'unknown';
}

function documentId(eventId, kind, sourceId) {
  return `${Number(eventId)}:${kind}:${Number(sourceId)}`;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(Number(limit) || 1, items.length || 1)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function sourceFileRecord(event, file, minutesText, error = null) {
  return {
    id: documentId(event.id, 'meeting-file', file.fileId),
    kind: 'minutes',
    tenant: 'mitchellsd',
    body: event.categoryName || null,
    meetingDate: event.date || null,
    meetingName: event.name || null,
    eventId: event.id,
    agendaId: event.agendaId,
    fileId: file.fileId,
    attachmentId: null,
    agendaItemId: null,
    agendaItemName: null,
    fileName: file.name || null,
    sourceType: file.type || null,
    sourcePath: `/v1/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=true)`,
    status: error ? 'read_failed' : (minutesText ? 'text_extracted' : 'no_usable_text'),
    pageCount: null,
    characters: minutesText?.length || 0,
    sha256: null,
    text: minutesText || '',
    error,
  };
}

function attachmentBase(event, item, attachment) {
  return {
    id: documentId(event.id, 'attachment', attachment.id),
    kind: 'attachment',
    tenant: 'mitchellsd',
    body: event.categoryName || null,
    meetingDate: event.date || null,
    meetingName: event.name || null,
    eventId: event.id,
    agendaId: event.agendaId,
    fileId: null,
    attachmentId: Number(attachment.id),
    agendaItemId: Number(item.id),
    agendaItemName: item.name || null,
    fileName: attachment.fileName || null,
    sourceType: attachment.isLink ? 'link' : 'agenda_attachment',
  };
}

async function indexAttachment(event, item, attachment) {
  const base = attachmentBase(event, item, attachment);
  if (attachment.isLink) {
    return { ...base, sourcePath: null, status: 'external_link', pageCount: null, characters: 0, sha256: null, text: '', error: null };
  }
  if (!attachment.downloadUrl) {
    return { ...base, sourcePath: null, status: 'unavailable', pageCount: null, characters: 0, sha256: null, text: '', error: 'No CivicClerk PDF URL exposed' };
  }
  try {
    const parsed = await readCivicClerkAttachment({
      agendaItemId: item.id,
      agendaItemName: item.name,
      ...attachment,
    });
    const sourcePath = parsed.sourceUrl ? new URL(parsed.sourceUrl).pathname : null;
    return {
      ...base,
      sourcePath,
      status: parsed.status,
      pageCount: parsed.pageCount,
      characters: parsed.characters,
      sha256: parsed.sha256,
      text: parsed.status === 'text_extracted' ? parsed.text : '',
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      sourcePath: null,
      status: 'read_failed',
      pageCount: null,
      characters: 0,
      sha256: null,
      text: '',
      error: compactError(error),
    };
  }
}

export async function buildCivicClerkCorpus({
  tenant = 'mitchellsd',
  body = 'Sports & Events Authority',
  from = DEFAULT_CORPUS_FROM,
  to = DEFAULT_CORPUS_TO,
  attachmentConcurrency = 3,
} = {}) {
  const categories = await getEventCategories(tenant);
  const category = resolveCategory(categories, body);
  const events = await listEventsRange(tenant, { categoryId: category.id, from, to });
  const meetings = [];
  const documents = [];

  for (const event of events) {
    const files = classifyPublishedFiles(event.publishedFiles || []);
    const minutesFile = selectMinutesFile(files);
    let minutesText = null;
    let minutesError = null;
    if (minutesFile) {
      try {
        minutesText = await getMeetingFileText(tenant, minutesFile.fileId);
      } catch (error) {
        minutesError = compactError(error);
      }
      documents.push(sourceFileRecord(event, minutesFile, minutesText, minutesError));
    }

    let agenda = null;
    let agendaError = null;
    if (event.agendaId) {
      try {
        agenda = await getAgenda(tenant, event.agendaId);
      } catch (error) {
        agendaError = compactError(error);
      }
    }
    const agendaItems = agenda ? flattenAgenda(agenda.items) : [];
    const attachmentJobs = agendaItems.flatMap((item) =>
      (item.attachments || []).map((attachment) => ({ item, attachment })),
    );
    const attachmentDocuments = await mapLimit(
      attachmentJobs,
      attachmentConcurrency,
      ({ item, attachment }) => indexAttachment(event, item, attachment),
    );
    documents.push(...attachmentDocuments);

    meetings.push({
      eventId: event.id,
      agendaId: event.agendaId,
      date: event.date,
      name: event.name,
      categoryId: event.categoryId,
      categoryName: event.categoryName,
      minutesFileId: minutesFile?.fileId || null,
      publishedFileIds: files.map((file) => file.fileId),
      agendaItemCount: agendaItems.length,
      attachmentCount: attachmentJobs.length,
      agendaStatus: agendaError ? 'read_failed' : (agenda ? 'available' : 'not_published'),
      minutesStatus: minutesFile ? (minutesError ? 'read_failed' : (minutesText ? 'text_extracted' : 'no_usable_text')) : 'not_published',
      agendaError,
      minutesError,
    });
  }

  const years = {};
  for (const year of new Set([String(from).slice(0, 4), String(to).slice(0, 4), ...meetings.map((m) => yearOf(m.date))])) {
    const yearMeetings = meetings.filter((meeting) => yearOf(meeting.date) === year);
    const yearDocuments = documents.filter((document) => yearOf(document.meetingDate) === year);
    years[year] = {
      meetings: yearMeetings.length,
      documents: yearDocuments.length,
      textDocuments: yearDocuments.filter((document) => document.status === 'text_extracted').length,
      visualRequired: yearDocuments.filter((document) => document.status === 'visual_required').length,
      readFailed: yearDocuments.filter((document) => document.status === 'read_failed').length,
      minutesPublished: yearMeetings.filter((meeting) => meeting.minutesFileId).length,
    };
  }

  const stats = {
    meetings: meetings.length,
    documents: documents.length,
    minutesDocuments: documents.filter((document) => document.kind === 'minutes').length,
    attachmentDocuments: documents.filter((document) => document.kind === 'attachment').length,
    textDocuments: documents.filter((document) => document.status === 'text_extracted').length,
    visualRequired: documents.filter((document) => document.status === 'visual_required').length,
    readFailed: documents.filter((document) => document.status === 'read_failed').length,
    years,
  };

  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    tenant,
    body: category.name,
    categoryId: category.id,
    requestedCoverage: { from, to },
    stats,
    meetings,
    documents,
  };
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9$.,%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(text, query, radius = 180) {
  const raw = String(text || '');
  if (!raw) return '';
  const q = normalize(query);
  const normalizedText = normalize(raw);
  let at = normalizedText.indexOf(q);
  if (at < 0) {
    const token = q.split(' ').find((part) => part.length >= 3);
    at = token ? normalizedText.indexOf(token) : -1;
  }
  if (at < 0) return raw.slice(0, radius * 2).trim();
  const start = Math.max(0, at - radius);
  const end = Math.min(raw.length, at + q.length + radius);
  return `${start > 0 ? '…' : ''}${raw.slice(start, end).trim()}${end < raw.length ? '…' : ''}`;
}

function scoreDocument(document, query) {
  const q = normalize(query);
  if (!q) return 0;
  const tokens = q.split(' ').filter(Boolean);
  const title = normalize(`${document.fileName || ''} ${document.agendaItemName || ''}`);
  const meeting = normalize(`${document.meetingName || ''} ${document.body || ''}`);
  const text = normalize(document.text || '');
  let score = 0;
  if (title.includes(q)) score += 80;
  if (meeting.includes(q)) score += 25;
  if (text.includes(q)) score += 50;
  for (const token of tokens) {
    if (title.includes(token)) score += 14;
    if (meeting.includes(token)) score += 4;
    const occurrences = text ? text.split(token).length - 1 : 0;
    score += Math.min(occurrences, 12) * 3;
  }
  return score;
}

export function searchCorpus(corpus, query, { from = null, to = null, limit = 20 } = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 20, 100));
  return (corpus?.documents || [])
    .filter((document) => !from || String(document.meetingDate || '').slice(0, 10) >= from)
    .filter((document) => !to || String(document.meetingDate || '').slice(0, 10) <= to)
    .map((document) => ({ document, score: scoreDocument(document, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(b.document.meetingDate).localeCompare(String(a.document.meetingDate)))
    .slice(0, max)
    .map(({ document, score }) => ({
      score,
      id: document.id,
      kind: document.kind,
      meetingDate: document.meetingDate,
      meetingName: document.meetingName,
      eventId: document.eventId,
      agendaId: document.agendaId,
      fileId: document.fileId,
      attachmentId: document.attachmentId,
      agendaItemId: document.agendaItemId,
      agendaItemName: document.agendaItemName,
      fileName: document.fileName,
      status: document.status,
      pageCount: document.pageCount,
      characters: document.characters,
      sha256: document.sha256,
      sourcePath: document.sourcePath,
      snippet: snippet(document.text, query),
    }));
}
