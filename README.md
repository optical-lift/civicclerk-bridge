# CivicClerk Bridge — Step 1 live reader kernel

Read-only, dependency-free proof-of-concept for Mitchell CivicClerk retrieval.

## Goal

Given only a CivicClerk tenant, meeting body, and date, return:

- matched meeting category
- exact event + event ID
- agenda ID
- all published meeting files classified as agenda / packet / minutes / other
- the selected minutes file and CivicClerk plain-text minutes
- structured agenda items
- every public agenda attachment with its CivicClerk attachment ID and signed download URL
- provenance URLs and retrieval timestamp

## Mitchell probe

```bash
npm test
npm run probe:mitchell
```

The live probe requires outbound HTTPS access to `mitchellsd.api.civicclerk.com`.

## Known Aug. 18, 2026 contract

The public meeting record independently exposes these official CivicClerk file IDs:

- Agenda: 5344
- Agenda Packet: 5346
- Minutes: 5349

The contract test ensures the reader selects 5349 as minutes rather than confusing the agenda or packet with the final-action source.

## Vercel endpoint

After deployment:

`GET /api/meeting?tenant=mitchellsd&body=Sports%20%26%20Events%20Authority&date=2026-08-18`

No credentials are required. This service is read-only and uses CivicClerk's public API.

## Important upstream behavior

CivicClerk's `plainText=true` file endpoint is best-effort. An empty response does **not** prove the file has no readable text. The next implementation step is binary file retrieval + PDF/DOCX extraction fallback for minutes where upstream text extraction is empty.
