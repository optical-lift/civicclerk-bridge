import { createHash } from 'node:crypto';
import { PDFParse } from 'pdf-parse';
import { meetingFileUrl } from './civicclerk.mjs';

export const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MIN_TEXT_CHARACTERS = 20;
export const DEFAULT_RENDER_WIDTH = 1600;
export const MIN_RENDER_WIDTH = 600;
export const MAX_RENDER_WIDTH = 2400;

export function isPdfMagic(bytes) {
  return bytes?.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function selectAttachmentById(agendaItems, attachmentId) {
  const wanted = Number(attachmentId);
  if (!Number.isFinite(wanted)) return null;
  for (const item of agendaItems || []) {
    for (const attachment of item.attachments || []) {
      if (Number(attachment.id) === wanted) {
        return {
          agendaItemId: item.id,
          agendaItemName: item.name,
          ...attachment,
        };
      }
    }
  }
  return null;
}

function publicSourceUrl(downloadUrl) {
  const url = new URL(downloadUrl);
  return `${url.origin}${url.pathname}`;
}

function assertCivicClerkAttachmentUrl(downloadUrl) {
  const url = new URL(downloadUrl);
  if (url.protocol !== 'https:') throw new Error('CivicClerk attachment URL must use HTTPS');
  if (url.hostname !== 'civicclerk.blob.core.windows.net') {
    throw new Error(`Unsupported CivicClerk attachment host: ${url.hostname}`);
  }
  return url;
}

export function assertCivicClerkMeetingFileUrl(downloadUrl, tenant) {
  const url = new URL(downloadUrl);
  if (url.protocol !== 'https:') throw new Error('CivicClerk meeting file URL must use HTTPS');
  const expectedHost = `${String(tenant).toLowerCase()}.api.civicclerk.com`;
  if (url.hostname.toLowerCase() !== expectedHost) {
    throw new Error(`Unsupported CivicClerk meeting file host: ${url.hostname}`);
  }
  const match = url.pathname.match(/^\/v1\/Meetings\/GetMeetingFileStream\(fileId=(\d+),plainText=false\)$/);
  if (!match) {
    throw new Error(`Unsupported CivicClerk meeting file path: ${url.pathname}`);
  }
  if (url.search) throw new Error('CivicClerk meeting file URL must not contain query parameters');
  return { url, fileId: Number(match[1]) };
}

async function fetchPdfUrl(url, { maxBytes = DEFAULT_MAX_PDF_BYTES, label = 'PDF' } = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'application/pdf,*/*;q=0.8',
      'user-agent': 'CivicClerk-Bridge/0.6 (+read-only municipal records)',
    },
  });

  if (!response.ok) throw new Error(`${label} fetch failed: HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} byte extraction limit`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} byte extraction limit`);
  if (!isPdfMagic(bytes)) throw new Error(`${label} is not a PDF`);

  return {
    bytes,
    byteLength: bytes.length,
    contentType: response.headers.get('content-type') || 'application/pdf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function fetchPdfBytes(downloadUrl, { maxBytes = DEFAULT_MAX_PDF_BYTES } = {}) {
  const url = assertCivicClerkAttachmentUrl(downloadUrl);
  const fetched = await fetchPdfUrl(url, { maxBytes, label: 'Attachment' });
  return {
    ...fetched,
    sourceUrl: publicSourceUrl(downloadUrl),
  };
}

export function meetingFilePdfUrl(tenant, fileId) {
  return meetingFileUrl(tenant, fileId, { plainText: false });
}

export async function fetchMeetingPdfBytes(tenant, fileId, { maxBytes = DEFAULT_MAX_PDF_BYTES } = {}) {
  const sourceUrl = meetingFilePdfUrl(tenant, fileId);
  const validated = assertCivicClerkMeetingFileUrl(sourceUrl, tenant);
  if (validated.fileId !== Number(fileId)) {
    throw new Error(`CivicClerk meeting file ID mismatch: ${validated.fileId} != ${Number(fileId)}`);
  }
  const fetched = await fetchPdfUrl(validated.url, { maxBytes, label: 'Meeting file' });
  return {
    ...fetched,
    sourceUrl,
  };
}

export async function extractPdfText(bytes, { minTextCharacters = DEFAULT_MIN_TEXT_CHARACTERS } = {}) {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText({
      lineEnforce: true,
      cellSeparator: '\t',
      pageJoiner: '\n--- PAGE page_number OF total_number ---\n',
    });

    const pages = (result.pages || []).map((page) => ({
      page: Number(page.num),
      text: String(page.text || '').trim(),
    }));
    const text = String(result.text || '').trim();
    const characters = text.length;

    return {
      status: characters >= minTextCharacters ? 'text_extracted' : 'visual_required',
      pageCount: Number(result.total || pages.length || 0),
      characters,
      text,
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

export function needsVisualFallback(extracted, { minTextCharacters = DEFAULT_MIN_TEXT_CHARACTERS } = {}) {
  return !extracted || extracted.status === 'visual_required' || Number(extracted.characters || 0) < minTextCharacters;
}

export function normalizeRenderWidth(value = DEFAULT_RENDER_WIDTH) {
  const width = Number(value);
  if (!Number.isFinite(width)) return DEFAULT_RENDER_WIDTH;
  return Math.max(MIN_RENDER_WIDTH, Math.min(MAX_RENDER_WIDTH, Math.round(width)));
}

export async function renderPdfPage(bytes, { page = 1, width = DEFAULT_RENDER_WIDTH } = {}) {
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('PDF page must be a positive integer');
  const desiredWidth = normalizeRenderWidth(width);
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getScreenshot({
      partial: [pageNumber],
      desiredWidth,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const screenshot = (result.pages || []).find((candidate) => Number(candidate.pageNumber) === pageNumber) || result.pages?.[0];
    if (!screenshot?.data?.length) throw new Error(`PDF page ${pageNumber} did not render`);
    return {
      page: Number(screenshot.pageNumber || pageNumber),
      pageCount: Number(result.total || 0),
      width: Number(screenshot.width || desiredWidth),
      height: Number(screenshot.height || 0),
      scale: Number(screenshot.scale || 0),
      contentType: 'image/png',
      bytes: new Uint8Array(screenshot.data),
    };
  } finally {
    await parser.destroy();
  }
}

export function visualPageDescriptors({ tenant, body, date, attachmentId, pageCount, width = DEFAULT_RENDER_WIDTH }) {
  const safeWidth = normalizeRenderWidth(width);
  const count = Math.max(0, Number(pageCount || 0));
  return Array.from({ length: count }, (_, index) => {
    const page = index + 1;
    const params = new URLSearchParams({
      tenant: String(tenant),
      body: String(body),
      date: String(date),
      attachmentId: String(Number(attachmentId)),
      page: String(page),
      width: String(safeWidth),
    });
    return { page, path: `/api/page?${params.toString()}` };
  });
}

export async function readCivicClerkAttachment(attachment, options = {}) {
  if (!attachment?.downloadUrl) throw new Error('Attachment has no downloadable PDF URL');
  const { includeBytes = false, ...readerOptions } = options;
  const fetched = await fetchPdfBytes(attachment.downloadUrl, readerOptions);
  const extracted = await extractPdfText(fetched.bytes, readerOptions);

  return {
    attachmentId: Number(attachment.id),
    fileName: attachment.fileName || null,
    agendaItemId: attachment.agendaItemId == null ? null : Number(attachment.agendaItemId),
    agendaItemName: attachment.agendaItemName || null,
    sourceUrl: fetched.sourceUrl,
    byteLength: fetched.byteLength,
    contentType: fetched.contentType,
    sha256: fetched.sha256,
    ...extracted,
    ...(includeBytes ? { bytes: fetched.bytes } : {}),
  };
}

export async function readCivicClerkMeetingFile(tenant, file, options = {}) {
  const fileId = Number(file?.fileId ?? file?.id);
  if (!Number.isFinite(fileId)) throw new Error('Meeting file has no numeric fileId');
  const { includeBytes = false, ...readerOptions } = options;
  const fetched = await fetchMeetingPdfBytes(tenant, fileId, readerOptions);
  const extracted = await extractPdfText(fetched.bytes, readerOptions);
  return {
    fileId,
    fileName: file?.name || null,
    sourceType: file?.type || null,
    sourceUrl: fetched.sourceUrl,
    byteLength: fetched.byteLength,
    contentType: fetched.contentType,
    sha256: fetched.sha256,
    ...extracted,
    ...(includeBytes ? { bytes: fetched.bytes } : {}),
  };
}
