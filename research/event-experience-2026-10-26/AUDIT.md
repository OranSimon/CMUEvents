# Event experience: source evidence audit

Baseline: published generation `2026-10-26T05:33:39.443Z`, 4,425 records. This audit uses anonymous official HTTP and CUA visible-page inspection. It does not edit ingestion code, source configuration or the local application database.

## Confirmed causes

1. **The old pagination does not mean one page per day.** With the real static query `from=2026-10-26, limit=24`, there are3,646 matches using the baseline `298dd17` query implementation. Pages2 and3 are still October26. `renderEvents` groups only that24-item slice, so Today/Ongoing headings imply completeness that the query never promised.
2. **The three old-start records in the default first slice are different semantic types.** Two are merchandise sale windows (ABA Sep4–Mar31 and BBA Oct20–Nov6); their dates agree with the official RSVP page, but they are not events continuously taking place. The third is the real Oct25–29 Launch and Lead multi-day camp. A date-age cutoff would discard valid programs while keeping inappropriate sales windows.
3. **CUPS source identity is wrong.** The configured `v6bl…` calendar advertises itself as CyLab Student Seminar. It is linked on CUPS's landing page only in the other-events section. Its daily `INTRA_CREATE` master starts in2019 with a HongKong timezone, was last modified in2022, and has no description, location or original URL. It alone produces395 of the published rows. The real CUPS Calendar link opens `cups-calendar.html`, whose advertised `bgb…` public feed is named CUPS calendar. Its149 records are historical (2012–2015) and produce0 current-window events. Preserve the provenance distinction; do not silently reassign one calendar's events to another.
4. **LiveWhale display ranges were treated as independent sessions.** `id32218` (CoE) has55 current API day clones with `repeats:null`, `is_all_day:1` and a Sep1–Dec18 parent range. The CUA page labels a two-day cohort and links to the actual training schedule. Posner exhibition `id26118` has67 current API day clones but is one continuous Dec2025–Dec2026 exhibit; Monday is closed. HR enrollment `id34750` has22 clones of one registration period. These are different from Admission closure `id34864`, whose API explicitly says `repeats:weekly`—and a closure is availability information rather than an invitation.
5. **Some calendar entries are scheduling placeholders with valid timestamps.** The current dataset contains29 titles beginning HOLD. The inspected MCC RSVP says not to schedule other events during its block, and points to a separate recruiting portal for actual details. These blocks should not appear as confirmed public activities.

## Apparent blank pages: do not repeat a false exclusion

- A public `.ics` link is a calendar download, not a readable event detail page. Prefer an advertised human calendar/detail link and label its type clearly.
- LiveWhale CoE/Posner initial HTML is an application shell. CUA resolves the real event description and range. SCS `/calendar/206882491` also initially exposes a shell, then shows its lecture, Oct26 17:00–18:30 EDT and room. These are not permanently blank pages.
- The Theory Lunch TitleTBD detail is small but contains a named speaker, Oct28 2026 and room. A missing clock/topic is different from no event evidence. Preserve date-only precision when the date is grounded.

No permanently empty HTML detail was confirmed in these sampled cases. The confirmed low-information bad-record example is the stale metadata-free CyLab daily template. Empty description alone is insufficient:696 baseline rows have empty descriptions, but many other records contain real date/clock/location fields in their calendar feed.

## Implementation handoff

- Preserve source recurrence metadata through normalization, storage and portable state; group recurring programs independently of one-off sessions.
- Merge provider display-range clones only when explicit parent-range fields support it. Do not infer daily or weekly sessions from a range.
- Detect scheduling holds, sales and enrollment periods semantically. Source eligibility remains publisher based; official reposts of real club-hosted events remain eligible.
- Quarantine an old unbounded template only with jointly weak evidence (no useful detail/venue/description, no current corroboration); avoid an event-title/UID blacklist or blanket removal of old recurring masters.
- Distinguish a reliable date with unknown clock from an ungrounded date. Do not invent clocks or drop a valid dated talk because its abstract is pending.

Structured evidence: [audit.json](audit.json). Public-field-only provider examples: [fixtures/livewhale-range-clones.json](fixtures/livewhale-range-clones.json). Full anonymous response bodies and transient CUA trees remain only in ignored `.cache/event-experience/`; API owner/contact/RSVP fields are not copied into the report.
