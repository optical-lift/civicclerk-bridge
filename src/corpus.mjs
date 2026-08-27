import {
  classifyPublishedFiles,
  flattenAgenda,
  getAgenda,
  getEventCategories,
  getMeetingFileText,
  resolveCategory,
  selectMinutesFile,
} from './civicclerk.mjs';
import { readCivicClerkAttachment, readCivicClerkMeetingFile } from './document-reader.mjs';
import { ocrPdfPages } from './ocr.mjs';
import { listEventsRange } from './event-range.mjs';

export const CORPUS_SCHEMA_VERSION = 2;
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

function minutesBase(tenant, event, file) {
  return {
    id: documentId(event.id, 'meeting-file', file.fileId),
    kind: 'minutes',
    tenant,
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
  };
}

async function indexMinutesFile(tenant, event, file) {
  const base = minutesBase(tenant, event, file);
  let plainTextError = null;
  try {
    const text = await getMeetingFileText(tenant, file.fileId);
    if (text) {
      return {
        ...base,
        sourcePath: `/v1/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=true)`,
        readMethod: 'civicclerk_plaintext',
        status: 'text_extracted',
        sourceTextStatus: 'text_extracted',
        textOrigin: 'civicclerk_plaintext',
        pageCount: null,
        characters: text.length,
        sha256: null,
        text,
        ocrStatus: null,
        ocr: null,
        ocrError: null,
        error: null,
        plainTextError: null,
      };
    }
  } catch (error) {
    plainTextError = compactError(error);
  }

  try {
    const parsed = await readCivicClerkMeetingFile(tenant, file);
    return {
      ...base,
      sourcePath: `/v1/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=false)`,
      readMethod: 'meeting_pdf',
      status: parsed.status,
      sourceTextStatus: parsed.status,
      textOrigin: parsed.status === 'text_extracted' ? 'embedded_pdf' : null,
      pageCount: parsed.pageCount,
      characters: parsed.characters,
      sha256: parsed.sha256,
      text: parsed.status === 'text_extracted' ? parsed.text : '',
      ocrStatus: null,
      ocr: null,
      ocrError: null,
      error: null,
      plainTextError,
    };
  } catch (error) {
    return {
      ...base,
      sourcePath: `/v1/Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=false)`,
      readMethod: 'meeting_pdf',
      status: 'read_failed',
      sourceTextStatus: 'read_failed',
      textOrigin: null,
      pageCount: null,
      characters: 0,
      sha256: null,
      text: '',
      ocrStatus: null,
      ocr: null,
      ocrError: null,
      error: compactError(error),
      plainTextError,
    };
  }
}

function attachmentBase(tenant, event, item, attachment) {
  return {
    id: documentId(event.id, 'attachment', attachment.id),
    kind: 'attachment',
    tenant,
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

function compactOcrMetadata(ocr) {
  return {
    engine: ocr.engine,
    language: ocr.language,
    psm: ocr.psm,
    renderWidth: ocr.renderWidth,
    pageCount: ocr.pageCount,
    usableCharacters: ocr.usableCharacters,
    meanConfidence: ocr.meanConfidence,
    pages: (ocr.pages || []).map((page) => ({
      page: page.page,
      width: page.width,
      height: page.height,
      imageSha256: page.imageSha256,
      characters: page.characters,
      words: page.words,
      lines: page.lines,
      meanConfidence: page.meanConfidence,
    })),
  };
}

async function indexAttachment(tenant, event, item, attachment, {
  ocrVisualDocuments = false,
  ocrOptions = {},
} = {}) {
  const base = attachmentBase(tenant, event, item, attachment);
  if (attachment.isLink) {
    return {
      ...base,
      sourcePath: null,
      readMethod: 'external_link',
      status: 'external_link',
      sourceTextStatus: null,
      textOrigin: null,
      pageCount: null,
      characters: 0,
      sha256: null,
      text: '',
      ocrStatus: null,
      ocr: null,
      ocrError: null,
      error: null,
    };
  }
  if (!attachment.downloadUrl) {
    return {
      ...base,
      sourcePath: null,
      readMethod: null,
      status: 'unavailable',
      sourceTextStatus: null,
      textOrigin: null,
      pageCount: null,
      characters: 0,
      sha256: null,
      text: '',
      ocrStatus: null,
      ocr: null,
      ocrError: null,
      error: 'No CivicClerk PDF URL exposed',
    };
  }
  try {
    const parsed = await readCivicClerkAttachment({
      agendaItemId: item.id,
      agendaItemName: item.name,
      ...attachment,
    }, { includeBytes: ocrVisualDocuments });
    const sourcePath = parsed.sourceUrl ? new URL(parsed.sourceUrl).pathname : null;

    if (parsed.status === 'visual_required' && ocrVisualDocuments) {
      try {
        const ocr = await ocrPdfPages(parsed.bytes, {
          pageCount: parsed.pageCount,
          ...ocrOptions,
        });
        const metadata = compactOcrMetadata(ocr);
        if (ocr.status === 'ocr_extracted') {
          return {
            ...base,
            sourcePath,
            readMethod: 'attachment_pdf+ocr',
            status: 'ocr_extracted',
            sourceTextStatus: 'visual_required',
            textOrigin: 'ocr',
            pageCount: parsed.pageCount,
            characters: ocr.characters,
            sha256: parsed.sha256,
            text: ocr.text,
            ocrStatus: 'ocr_extracted',
            ocr: metadata,
            ocrError: null,
            error: null,
          };
        }
        return {
          ...base,
          sourcePath,
          readMethod: 'attachment_pdf+ocr',
          status: 'visual_required',
          sourceTextStatus: 'visual_required',
          textOrigin: null,
          pageCount: parsed.pageCount,
          characters: 0,
          sha256: parsed.sha256,
          text: '',
          ocrStatus: 'ocr_no_text',
          ocr: metadata,
          ocrError: null,
          error: null,
        };
      } catch (error) {
        return {
          ...base,
          sourcePath,
          readMethod: 'attachment_pdf+ocr',
          status: 'visual_required',
          sourceTextStatus: 'visual_required',
          textOrigin: null,
          pageCount: parsed.pageCount,
          characters: 0,
          sha256: parsed.sha256,
          text: '',
          ocrStatus: 'ocr_failed',
          ocr: null,
          ocrError: compactError(error),
          error: null,
        };
      }
    }

    return {
      ...base,
      sourcePath,
      readMethod: 'attachment_pdf',
      status: parsed.status,
      sourceTextStatus: parsed.status,
      textOrigin: parsed.status === 'text_extracted' ? 'embedded_pdf' : null,
      pageCount: parsed.pageCount,
      characters: parsed.characters,
      sha256: parsed.sha256,
      text: parsed.status === 'text_extracted' ? parsed.text : '',
      ocrStatus: null,
      ocr: null,
      ocrError: null,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      sourcePath: null,
      readMethod: 'attachment_pdf',
      status: 'read_failed',
      sourceTextStatus: 'read_failed',
      textOrigin: null,
      pageCount: null,
      characters: 0,
      sha256: null,
      text: '',
      ocrStatus: null,
      ocr: null,
      ocrError: null,
      error: compactError(error),
    };
  }
}

function documentStats(documents) {
  const minutesDocuments = documents.filter((document) => document.kind === 'minutes');
  return {
    documents: documents.length,
    minutesDocuments: minutesDocuments.length,
    attachmentDocuments: documents.filter((document) => document.kind === 'attachment').length,
    textDocuments: documents.filter((document) => ['text_extracted', 'ocr_extracted'].includes(document.status)).length,
    embeddedTextDocuments: documents.filter((document) => document.status === 'text_extracted').length,
    ocrDocuments: documents.filter((document) => document.status === 'ocr_extracted').length,
    visualRequired: documents.filter((document) => document.status === 'visual_required').length,
    readFailed: documents.filter((document) => document.status === 'read_failed').length,
    ocrAttempted: documents.filter((document) => document.ocrStatus).length,
    ocrExtracted: documents.filter((document) => document.ocrStatus === 'ocr_extracted').length,
    ocrNoText: documents.filter((document) => document.ocrStatus === 'ocr_no_text').length,
    ocrFailed: documents.filter((document) => document.ocrStatus === 'ocr_failed').length,
    minutesTextExtracted: minutesDocuments.filter((document) => document.status === 'text_extracted').length,
    minutesVisualRequired: minutesDocuments.filter((document) => document.status === 'visual_required').length,
    minutesReadFailed: minutesDocuments.filter((document) => document.status === 'read_failed').length,
    minutesBinaryFallback: minutesDocuments.filter((document) => document.readMethod === 'meeting_pdf').length,
  };
}

export async function buildCivicClerkCorpus({
  tenant = 'mitchellsd',
  body = 'Sports & Events Authority',
  from = DEFAULT_CORPUS_FROM,
  to = DEFAULT_CORPUS_TO,
  attachmentConcurrency = 3,
  ocrVisualDocuments = false,
  ocrOptions = {},
} = {}) {
  const categories = await getEventCategories(tenant);
  const category = resolveCategory(categories, body);
  const events = await listEventsRange(tenant, { categoryId: category.id, from, to });
  const meetings = [];
  const documents = [];

  for (const event of events) {
    const files = classifyPublishedFiles(event.publishedFiles || []);
    const minutesFile = selectMinutesFile(files);
    let minutesDocument = null;
    if (minutesFile) {
      minutesDocument = await indexMinutesFile(tenant, event, minutesFile);
      documents.push(minutesDocument);
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
      ({ item, attachment }) => indexAttachment(tenant, event, item, attachment, { ocrVisualDocuments, ocrOptions }),
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
      minutesStatus: minutesDocument?.status || 'not_published',
      minutesReadMethod: minutesDocument?.readMethod || null,
      agendaError,
      minutesError: minutesDocument?.error || null,
    });
  }

  const years = {};
  for (const year of new Set([String(from).slice(0, 4), String(to).slice(0, 4), ...meetings.map((m) => yearOf(m.date))])) {
    const yearMeetings = meetings.filter((meeting) => yearOf(meeting.date) === year);
    const yearDocuments = documents.filter((document) => yearOf(document.meetingDate) === year);
    years[year] = {
      meetings: yearMeetings.length,
      ...documentStats(yearDocuments),
      minutesPublished: yearMeetings.filter((meeting) => meeting.minutesFileId).length,
    };
  }

  const stats = {
    meetings: meetings.length,
    ...documentStats(documents),
    years,
  };

  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    tenant,
    body: category.name,
    categoryId: category.id,
    requestedCoverage: { from, to },
    extraction: {
      ocrVisualDocuments: Boolean(ocrVisualDocuments),
      ocrEngine: ocrVisualDocuments ? 'tesseract' : null,
      ocrTextIsDerived: true,
    },
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
      readMethod: document.readMethod,
      sourceTextStatus: document.sourceTextStatus,
      textOrigin: document.textOrigin,
      pageCount: document.pageCount,
      characters: document.characters,
      sha256: document.sha256,
      sourcePath: document.sourcePath,
      ocrStatus: document.ocrStatus,
      ocrMeanConfidence: document.ocr?.meanConfidence ?? null,
      snippet: snippet(document.text, query),
    }));
}
