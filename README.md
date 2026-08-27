# CivicClerk Bridge

Read-only retrieval, document-reading and historical search service for CivicClerk public records, initially certified against Mitchell, South Dakota.

## What it does

Given a CivicClerk tenant, meeting body and date, the Bridge can resolve:

- meeting category
- exact event and event ID
- agenda ID
- published agenda / packet / minutes files
- selected minutes and readable minutes text
- structured agenda items
- every public agenda attachment with CivicClerk attachment ID
- individual PDF attachment text with per-page boundaries
- image rendering for scanned or image-only PDF pages
- OCR-derived search text for scan-only historical attachments
- source custody including source paths, event/agenda/file/attachment IDs and SHA-256 document fingerprints

For Mitchell Sports & Events Authority, the Bridge also maintains a versioned 2023-2026 historical corpus and exposes source-custodied full-text search.

## Reading and extraction strategy

The Bridge keeps source text and derived text distinct:

1. **CivicClerk/plain-text path** — use CivicClerk's published minutes text when it is usable.
2. **Embedded PDF text path** — download the exact published PDF and extract its text while preserving page boundaries and the PDF SHA-256.
3. **Visual path** — if embedded text is too sparse, classify the source as `visual_required` and render pages from the same PDF bytes.
4. **OCR indexing path** — during the scheduled GitHub corpus refresh only, render `visual_required` pages and pass those images through Tesseract. Searchable OCR records are marked `status: ocr_extracted`, `sourceTextStatus: visual_required`, and `textOrigin: ocr`.

OCR is explicitly derived evidence. The corpus retains the original PDF SHA-256 plus each rendered page's SHA-256, page number, OCR engine, language, page-segmentation mode and confidence metadata. Raw PDF/image bytes and expiring signed URLs are never persisted in the corpus.

Vercel does not perform OCR on user requests. Production search reads the already-generated corpus.

## Mitchell acceptance contracts

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

The historical refresh must also prove that a real search for `referees` finds attachment 11012 and preserves event 1540 / agenda 1509 custody.

Known scan acceptance target:

- Attachment 134 — `Mitchell Show Choir Classic Budget 2023`
- The source PDF has insufficient embedded text and must become searchable through the OCR-derived path while remaining marked as machine-derived.

## Historical corpus

The corpus is stored at:

`data/mitchellsd/sea-corpus.json`

It covers Mitchell Sports & Events Authority records from Jan. 1, 2023 through Dec. 31, 2026. A GitHub Actions workflow refreshes it daily and on relevant code changes. The workflow commits a new corpus only when source-derived content materially changes.

Each document is independently source-custodied as either a published minutes file or an individual agenda attachment. Search does not collapse applications, budgets, evaluations, minutes and P&Ls into one fact; callers must reconcile those source roles deliberately.

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

### Search the historical SEA corpus

`GET /api/search?q=referees&from=2023-01-01&to=2026-12-31&limit=20`

Returns ranked source-custodied documents. Each result identifies whether the searchable text came from CivicClerk/plain text, embedded PDF text or OCR-derived text.

## Tests

```bash
npm install
npm test
npm run probe:mitchell
```

The live corpus workflow additionally requires Tesseract and performs the full CivicClerk crawl, minutes fallback validation, scan OCR, source-custody checks and real referee-search acceptance before a build can be certified.
