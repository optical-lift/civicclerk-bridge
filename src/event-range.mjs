import { baseUrl, getJson, parseEvent } from './civicclerk.mjs';

function assertDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${label} must be YYYY-MM-DD: ${value}`);
  }
  return String(value);
}

export async function listEventsRange(tenant, { categoryId, from, to }) {
  const startDate = assertDate(from, 'from');
  const endDate = assertDate(to, 'to');
  if (startDate > endDate) throw new Error(`from must be on or before to: ${from} > ${to}`);

  const params = new URLSearchParams();
  params.set('$orderby', 'eventDate asc');
  params.set(
    '$filter',
    `categoryId eq ${Number(categoryId)} and eventDate ge ${startDate}T00:00:00Z and eventDate le ${endDate}T23:59:59Z`,
  );

  let url = `${baseUrl(tenant)}/Events?${params.toString()}`;
  const events = [];
  while (url) {
    const payload = await getJson(url);
    const values = Array.isArray(payload?.value) ? payload.value : [];
    events.push(...values.map(parseEvent));
    url = typeof payload?.['@odata.nextLink'] === 'string' ? payload['@odata.nextLink'] : null;
  }
  return events;
}
