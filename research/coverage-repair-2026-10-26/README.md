# Daily-run coverage repair for ten sources

This audit separates internal collection omissions from demonstrable publisher limitations. Source counts describe the rolling ingestion window (30 days back, 365 days forward), not whether an organization has activities. The official/retained-publisher policy continues to include student-club-hosted events advertised by those publishers.

## Reusable changes

- All currently advertised source candidates are accounted for. Explicit dates, current semester headings or visible document-cover periods may exclude historical assets. Filenames, publication timestamps and footers do not establish event dates.
- SCS directory rows reuse catalog feeds under verified series scope or live structural discovery. Directory weekdays never generate recurrence. REAL/LCS semantic parsing checks current announcements, advertised feeds and linked schedules without a whole-body hash approval.
- Linked conference pages distinguish primary event dates, multiday ranges, repeated occurrences, dated sessions, agenda days and auxiliary deadlines. Genuine year conflicts remain visible.
- Media processing distinguishes portraits from event assets, checks alternate OCR treatments and edge padding, and keeps reliable date/venue records when optional speaker text or clock fields are uncertain. All PDF text pages are read; scanned-page OCR is checkpointed by document bytes and extractor version.
- Alumni follows the actual public Next control until exhausted and attempts every eligible original detail. No consecutive-failure circuit permanently starves the tail. Separate source scopes share one refresh's current reads and retry on the next refresh.
- Each audited source returns a versioned coverage contract: `inspectionComplete`, `internalIssues`, `externalIssues`, `nonBlockingIssues` and candidate evidence. It is timestamped by the coordinator, exported to the public source directory and portable state, and invalidated when extraction contracts change.
- The daily build rejects missing/stale/incomplete coverage or any internal omissions for the monitored group. HTTP/access failures and real publisher date conflicts remain explicit. OCR progress is saved even when publication is blocked. A blocked build preserves the existing website.

## Evidence

- [Previous published baseline](baseline.json).
- [Media fresh-HTTP audit](media-real-validation.json) and [repeatable media check](verify-media.mjs).
- [Humanities detail-date evidence](humanities-detail-date-review.json): linked term/date evidence is separated from publication metadata and incidental years.
- [All 22 DSSC details and date-role regression](../dssc-date-semantics-2026-10-25/README.md).
- [Directory and REAL configuration/discovery evidence](../remaining-10-2026-10-26/).

Production validation and final source results are recorded below after actual GitHub Actions runs. The local application database is outside these validation paths; collection runs use isolated runner stores.
