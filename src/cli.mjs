#!/usr/bin/env node
import { meetingSnapshot } from './civicclerk.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
  return pairs;
}, []));

const tenant = args.tenant || 'mitchellsd';
const body = args.body;
const date = args.date;
if (!body || !date) {
  console.error('Usage: node src/cli.mjs --tenant mitchellsd --body "Sports & Events Authority" --date 2026-08-18');
  process.exit(2);
}

try {
  const snapshot = await meetingSnapshot(tenant, { body, date });
  const compact = {
    tenant: snapshot.tenant,
    category: snapshot.category,
    event: {
      id: snapshot.event.id,
      date: snapshot.event.date,
      name: snapshot.event.name,
      categoryName: snapshot.event.categoryName,
      agendaId: snapshot.event.agendaId,
      publishedFiles: snapshot.event.publishedFiles,
    },
    minutesFile: snapshot.minutesFile,
    minutesText: snapshot.minutesText,
    agendaItems: snapshot.agendaItems.map(({ id, name, depth, isSection, attachments }) => ({
      id, name, depth, isSection,
      attachments: attachments.map(({ id, fileName, isLink, downloadUrl }) => ({ id, fileName, isLink, downloadUrl })),
    })),
    provenance: snapshot.provenance,
  };
  console.log(JSON.stringify(compact, null, 2));
} catch (error) {
  console.error(error?.stack || String(error));
  process.exit(1);
}
