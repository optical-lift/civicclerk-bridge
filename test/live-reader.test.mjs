import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPublishedFiles,
  flattenAgenda,
  meetingFileUrl,
  parseAgendaItem,
  parseEvent,
  resolveCategory,
  resolveEvent,
  selectMinutesFile,
} from '../src/civicclerk.mjs';

// Known Aug. 18, 2026 Mitchell SEA file IDs independently recovered from
// the official CivicClerk links exposed by the public meeting archive.
const aug18RawEvent = {
  id: 999999, // event ID intentionally fixture-only; live probe must resolve the real one
  eventDate: '2026-08-18T14:00:00Z',
  eventName: 'Regular Meeting',
  categoryId: 42,
  categoryName: 'Sports & Events Authority Advisory Committee',
  agendaId: 888888, // fixture-only; live probe must resolve the real one
  agendaName: 'Sports & Events Authority Advisory Committee Agenda',
  publishedFiles: [
    { fileId: 5344, type: 'Agenda', name: 'Agenda' },
    { fileId: 5346, type: 'Agenda Packet', name: 'Packet' },
    { fileId: 5349, type: 'Minutes', name: 'Minutes' },
  ],
};

test('Aug. 18 known file contract identifies minutes, agenda and packet without confusion', () => {
  const event = parseEvent(aug18RawEvent);
  const files = classifyPublishedFiles(event.publishedFiles);
  const minutes = selectMinutesFile(files);
  assert.equal(minutes.fileId, 5349);
  assert.equal(files.find((f) => f.kind === 'agenda').fileId, 5344);
  assert.equal(files.find((f) => f.kind === 'packet').fileId, 5346);
  assert.equal(meetingFileUrl('mitchellsd', minutes.fileId, { plainText: true }),
    'https://mitchellsd.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=5349,plainText=true)');
});

test('minutes selection prefers approved/final minutes and rejects agenda packet', () => {
  const files = [
    { fileId: 1, type: 'Agenda Packet', name: 'Agenda Packet' },
    { fileId: 2, type: 'Minutes', name: 'Draft Minutes' },
    { fileId: 3, type: 'Minutes', name: 'Approved Minutes' },
  ];
  assert.equal(selectMinutesFile(files).fileId, 3);
});

test('category resolver tolerates the short body name Marshall is likely to use', () => {
  const categories = [
    { id: 10, name: 'Planning Commission' },
    { id: 42, name: 'Sports & Events Authority Advisory Committee' },
  ];
  assert.equal(resolveCategory(categories, 'Sports & Events Authority').id, 42);
});

test('event resolver returns the only event on the requested date', () => {
  const event = parseEvent(aug18RawEvent);
  assert.equal(resolveEvent([event], { body: 'Sports & Events Authority', date: '2026-08-18' }).publishedFiles[2].fileId, 5349);
});

test('agenda parser preserves nested attachment custody', () => {
  const item = parseAgendaItem({
    id: 200,
    agendaObjectItemName: '<b>Presentation of Funding Applications</b>',
    isSection: false,
    sortOrder: 2,
    attachmentsList: [
      { id: 301, fileName: 'Cornicupia 2026 Grant Application', isLink: false, pdfVersionFullPath: 'https://files.example/301' },
    ],
    childItems: [
      { id: 201, agendaObjectItemName: 'Cornicupia 2026', isSection: false, sortOrder: 3, attachmentsList: [], childItems: [] },
    ],
  });
  const flat = flattenAgenda([item]);
  assert.equal(flat.length, 2);
  assert.equal(flat[0].name, 'Presentation of Funding Applications');
  assert.equal(flat[0].attachments[0].id, 301);
  assert.equal(flat[1].depth, 1);
});
