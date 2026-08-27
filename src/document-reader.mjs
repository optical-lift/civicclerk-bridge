import { createHash } from 'node:crypto';
import { PDFParse } from 'pdf-parse';

export const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024;

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

export async function fetchPdfBytes(downloadUrl, { maxBytes = DEFAULT_MAX_PDF_BYTES } = {}) {
  const url = assertCivicClerkAttachmentUrl(downloadUrl);
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'application/pdf,*/*;q=0.8',
      'user-agent': 'CivicClerk-Bridge/0.2 (+read-only municipal records)',
    },
  });

  if (!response.ok) throw new Error(`Attachment fetch failed: HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new Error(`Attachment exceeds ${maxBytes} byte extraction limit`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Attachment exceeds ${maxBytes} byte extraction limit`);
  if (!isPdfMagic(bytes)) throw new Error('Attachment is not a PDF');

  return {
    bytes,
    byteLength: bytes.length,
    contentType: response.headers.get('content-type') || 'application/pdf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceUrl: publicSourceUrl(downloadUrl),
  };
}

export async function extractPdfText(bytes) {
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
      status: characters >= 20 ? 'text_extracted' : 'no_usable_text',
      pageCount: Number(result.total || pages.length || 0),
      characters,
      text,
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

export async function readCivicClerkAttachment(attachment, options = {}) {
  if (!attachment?.downloadUrl) throw new Error('Attachment has no downloadable PDF URL');
  const fetched = await fetchPdfBytes(attachment.downloadUrl, options);
  const extracted = await extractPdfText(fetched.bytes);

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
  };
}
