# CivicClerk Bridge

Read-only retrieval and document-reading service for CivicClerk public records, initially certified against Mitchell, South Dakota.

## What it does

Given a CivicClerk tenant, meeting body, and date, the Bridge can resolve:

- meeting category
- exact event and event ID
- agenda ID
- published agenda / packet / minutes files
- selected minutes and readable minutes text
- structured agenda items
- every public agenda attachment with CivicClerk attachment ID
- individual PDF attachment text with per-page boundaries
- image rendering for scanned or image-only PDF pages
- source custody including source URLs, attachment IDs, retrieval time and SHA-256 document fingerprints

## Reading strategy

The Bridge uses two PDF reading paths without confusing them:

1. **Text path** — extract the PDF's embedded text, preserving page boundaries.
2. **Visual path** — when embedded text is too sparse for reliable reading, mark the document `visual_required` and expose guarded page-render routes that return PNG images from the same PDF bytes.

The visual route never accepts an arbitrary external URL. It first resolves the requested CivicClerk meeting, verifies the attachment ID belongs to that meeting, fetches that CivicClerk attachment, and renders only the requested page.

## Mitchell acceptance contract

Certified meeting: Sports & Events Authority Advisory Committee, Aug. 18, 2026.

Known meeting custody:

- Event ID: 1540
- Agenda ID: 1509
- Agenda file: 5344
- Agenda Packet file: 5346
- Minutes file: 5349

Certified text attachment:

- Attachment 11012 — `Cornicupia 2026 Event Budget`
- Extracted referee expense: $7,500
- Extracted total estimated expenses: $13,200

Certified visual-only attachment:

- Attachment 10891 — `2026 MAC Area Events, Inc`
- Embedded text is insufficient, so the Bridge classifies it `visual_required`
- Page 1 has been successfully rendered to PNG while retaining the same source SHA-256 custody

## API routes

### Meeting snapshot

`GET /api/meeting?tenant=mitchellsd&body=Sports%20%26%20Events%20Authority&date=2026-08-18`

Returns the meeting, minutes, structured agenda and attachment inventory.

### Read one attachment

`GET /api/document?tenant=mitchellsd&body=Sports%20%26%20Events%20Authority&date=2026-08-18&attachmentId=11012`

For text-readable PDFs, returns extracted text and per-page text. For scanned/image-only PDFs, returns `visual.required=true` and guarded page paths.

### Render one PDF page

`GET /api/page?tenant=mitchellsd&body=Sports%20%26%20Events%20Authority&date=2026-08-18&attachmentId=10891&page=1&width=1600`

Returns `image/png`. The response includes CivicClerk event, agenda, attachment, page and SHA-256 custody headers.

## Tests

```bash
npm install
npm test
npm run probe:mitchell
```

The GitHub Actions live acceptance probe also calls the live Mitchell CivicClerk system, reads the known text budget, renders a known visual-only attachment and fails if those contracts stop working.

## Current boundary

This version covers CivicClerk meeting discovery, minutes, structured attachments, PDF text extraction and PDF page rendering. It does **not** yet build a historical search index or persist CivicClerk records in a database.
