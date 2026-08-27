const TENANT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export class CivicClerkError extends Error {
  constructor(message, { status = null, url = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'CivicClerkError';
    this.status = status;
    this.url = url;
  }
}

export function baseUrl(tenant) {
  if (!TENANT_RE.test(tenant)) throw new Error(`Invalid CivicClerk tenant: ${tenant}`);
  return `https://${tenant}.api.civicclerk.com/v1`;
}

function stripHtml(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchChecked(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'CivicClerk-Bridge/0.1 (+read-only municipal records)',
        ...(options.headers || {})
      },
      ...options,
    });
  } catch (cause) {
    throw new CivicClerkError(`Network failure fetching ${url}`, { url, cause });
  }
  if (!response.ok) {
    throw new CivicClerkError(`CivicClerk returned HTTP ${response.status}`, {
      status: response.status,
      url,
    });
  }
  return response;
}

export async function getJson(url) {
  const response = await fetchChecked(url);
  try {
    return await response.json();
  } catch (cause) {
    throw new CivicClerkError(`CivicClerk response was not JSON`, { url, cause });
  }
}

export async function getEventCategories(tenant) {
  const payload = await getJson(`${baseUrl(tenant)}/EventCategories`);
  const values = Array.isArray(payload?.value) ? payload.value : [];
  return values.map((raw) => ({
    id: Number(raw.id),
    name: raw.categoryDesc ?? null,
    isPublic: raw.isPublic ?? null,
    raw,
  }));
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveCategory(categories, body) {
  const wanted = normalizeName(body);
  if (!wanted) throw new Error('Meeting body is required');
  const scored = categories.map((category) => {
    const name = normalizeName(category.name);
    let score = 0;
    if (name === wanted) score = 100;
    else if (name.includes(wanted) || wanted.includes(name)) score = 80;
    else {
      const wantedTokens = new Set(wanted.split(' '));
      const tokens = name.split(' ');
      const overlap = tokens.filter((t) => wantedTokens.has(t)).length;
      score = overlap / Math.max(tokens.length, wantedTokens.size, 1) * 60;
    }
    return { category, score };
  }).sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score < 30) {
    throw new CivicClerkError(`No CivicClerk category matched meeting body: ${body}`);
  }
  return scored[0].category;
}

function isoDayBounds(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date must be YYYY-MM-DD: ${date}`);
  return {
    start: `${date}T00:00:00Z`,
    end: `${date}T23:59:59Z`,
  };
}

export async function listEvents(tenant, { categoryId, date }) {
  const { start, end } = isoDayBounds(date);
  const params = new URLSearchParams();
  params.set('$orderby', 'eventDate asc');
  params.set('$filter', `categoryId eq ${Number(categoryId)} and eventDate ge ${start} and eventDate le ${end}`);
  let url = `${baseUrl(tenant)}/Events?${params.toString()}`;
  const results = [];
  while (url) {
    const payload = await getJson(url);
    const values = Array.isArray(payload?.value) ? payload.value : [];
    results.push(...values.map(parseEvent));
    url = typeof payload?.['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : null;
  }
  return results;
}

export function parseEvent(raw) {
  return {
    id: Number(raw.id),
    date: raw.eventDate ?? null,
    name: raw.eventName ?? null,
    description: raw.eventDescription ?? null,
    categoryId: raw.categoryId == null ? null : Number(raw.categoryId),
    categoryName: raw.categoryName ?? null,
    agendaId: Number(raw.agendaId || 0) || null,
    agendaName: raw.agendaName ?? null,
    location: raw.eventLocation ?? null,
    youtubeVideoId: raw.youtubeVideoId ?? null,
    mediaStreamPath: raw.mediaStreamPath ?? null,
    publishedFiles: (raw.publishedFiles || []).map((file) => ({
      fileId: Number(file.fileId),
      type: file.type ?? null,
      name: file.name ?? null,
      publishOn: file.publishOn ?? null,
      raw: file,
    })),
    raw,
  };
}

export function resolveEvent(events, { body = '', date = '' } = {}) {
  if (events.length === 1) return events[0];
  if (!events.length) throw new CivicClerkError(`No CivicClerk meeting found for ${body} on ${date}`);
  const wanted = normalizeName(body);
  const ranked = events.map((event) => {
    const name = normalizeName(`${event.categoryName ?? ''} ${event.name ?? ''}`);
    return { event, score: name.includes(wanted) ? 10 : 0 };
  }).sort((a, b) => b.score - a.score);
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    throw new CivicClerkError(`Multiple CivicClerk meetings matched ${body} on ${date}`);
  }
  return ranked[0].event;
}

function fileWords(file) {
  return normalizeName(`${file.type ?? ''} ${file.name ?? ''}`);
}

export function selectMinutesFile(files) {
  const candidates = files.map((file) => {
    const words = fileWords(file);
    let score = 0;
    if (/\bminutes\b/.test(words)) score += 100;
    if (/\bapproved\b|\badopted\b|\bsigned\b|\bfinal\b/.test(words)) score += 20;
    if (/\bdraft\b/.test(words)) score -= 10;
    if (/\bagenda\b|\bpacket\b/.test(words)) score -= 60;
    return { file, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return candidates[0]?.file ?? null;
}

export function classifyPublishedFiles(files) {
  return files.map((file) => {
    const words = fileWords(file);
    let kind = 'other';
    if (/\bminutes\b/.test(words)) kind = 'minutes';
    else if (/\bpacket\b/.test(words)) kind = 'packet';
    else if (/\bagenda\b/.test(words)) kind = 'agenda';
    return { ...file, kind };
  });
}

export function meetingFileUrl(tenant, fileId, { plainText = false } = {}) {
  return `${baseUrl(tenant)}/Meetings/GetMeetingFileStream(fileId=${Number(fileId)},plainText=${plainText ? 'true' : 'false'})`;
}

export async function getMeetingFileText(tenant, fileId) {
  const url = meetingFileUrl(tenant, fileId, { plainText: true });
  const response = await fetchChecked(url);
  const text = await response.text();
  return text.trim() || null;
}

export async function getAgenda(tenant, agendaId) {
  if (!agendaId) return null;
  const raw = await getJson(`${baseUrl(tenant)}/Meetings/${Number(agendaId)}`);
  if (!raw?.id) return null;
  const items = (raw.items || []).map(parseAgendaItem).sort(sortItems);
  return { id: Number(raw.id), items, raw };
}

function sortItems(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

export function parseAgendaItem(raw) {
  const children = (raw.childItems || []).map(parseAgendaItem).sort(sortItems);
  const attachments = (raw.attachmentsList || []).map((attachment) => ({
    id: Number(attachment.id),
    fileName: attachment.fileName ?? null,
    isLink: Boolean(attachment.isLink),
    downloadUrl: attachment.pdfVersionFullPath ?? null,
    raw: attachment,
  }));
  return {
    id: Number(raw.id),
    name: stripHtml(raw.agendaObjectItemName ?? null),
    isSection: Boolean(raw.isSection),
    sortOrder: raw.sortOrder == null ? null : Number(raw.sortOrder),
    attachments,
    children,
    raw,
  };
}

export function flattenAgenda(items) {
  const flat = [];
  const walk = (nodes, depth = 0) => {
    for (const item of nodes) {
      flat.push({ ...item, depth });
      walk(item.children || [], depth + 1);
    }
  };
  walk(items || []);
  return flat;
}

export async function resolveMeeting(tenant, { body, date }) {
  const categories = await getEventCategories(tenant);
  const category = resolveCategory(categories, body);
  const events = await listEvents(tenant, { categoryId: category.id, date });
  const event = resolveEvent(events, { body, date });
  const files = classifyPublishedFiles(event.publishedFiles);
  const minutesFile = selectMinutesFile(files);
  const agenda = event.agendaId ? await getAgenda(tenant, event.agendaId) : null;
  return {
    tenant,
    category,
    event: { ...event, publishedFiles: files },
    minutesFile,
    agenda,
    agendaItems: agenda ? flattenAgenda(agenda.items) : [],
    provenance: {
      eventsApi: `${baseUrl(tenant)}/Events`,
      agendaApi: event.agendaId ? `${baseUrl(tenant)}/Meetings/${event.agendaId}` : null,
      retrievedAt: new Date().toISOString(),
    },
  };
}

export async function meetingSnapshot(tenant, query) {
  const resolved = await resolveMeeting(tenant, query);
  let minutesText = null;
  if (resolved.minutesFile) {
    minutesText = await getMeetingFileText(tenant, resolved.minutesFile.fileId);
  }
  return {
    ...resolved,
    minutesText,
    attachments: resolved.agendaItems.flatMap((item) =>
      item.attachments.map((attachment) => ({
        agendaItemId: item.id,
        agendaItemName: item.name,
        ...attachment,
      }))
    ),
  };
}
