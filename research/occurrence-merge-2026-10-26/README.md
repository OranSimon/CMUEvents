# Same-occurrence merging

The repair follows the user's requirement: one activity occurrence syndicated by several publishers becomes one card, with all original event and source-listing links retained. Separate dates, separate clocks, incompatible known ends and incompatible date ranges remain distinct.

## Mechanism

`src/lib/occurrence-merge.mjs` owns matching and grouping. It compares exact normalized instants/ranges before any identity or text evidence. It then uses individual event links, publisher-scoped UIDs, copied substantive text, or a specific title corroborated by a physical venue. Shared calendar viewers, download endpoints and catalog listing URLs do not identify an individual event. A shortened headline is accepted through the same individual event link and compatible times; title prefixes alone do not establish identity.

Groups retain every `(source ID, source listing URL, source event URL)` claim. A shared calendar source can therefore retain multiple original event URLs. Original descriptions, dates, clocks, rooms, status and publisher attribution remain under **Source versions**. Genuine room disagreements are flagged without erasing either claim. Group joins check all cross-group pairs for temporal and substantive contradictions, so sparse records cannot connect incompatible sessions through a chain of otherwise plausible matches.

Raw normalized source snapshots remain independent. The materialized view is recomputed after source refresh and portable-state restore; no named-activity allowlist or hardcoded event content supplies the merge decisions. The daily publication report includes `eventMerges` with matching reasons and group provenance.

## Evidence

- [Baseline audit](AUDIT.md) and [structured baseline](baseline-audit.json): current public duplicates and false-positive risks.
- [Offline replay review](REPLAY-AUDIT.md) and [replay evidence](replay-audit.json): representative reductions and a global scan of source-version date/time boundaries, tied to saved data and implementation hashes. This is replay evidence, not a fresh crawl.
- [Preview source versions](preview-source-versions-ax.txt): all three seminar versions retain both room numbers.
- [390px preview](mobile-merge-preview.png): source-conflict notice and accessible details drawer.
- [Live verifier](verify-deployed.mjs): checks actual workflow success, coherent deployment, exact source hashes, all source-version temporal guards, original URLs, representative weekly dates, browsing-view coverage and immutable publication audit.

Local and cloud verification pass 349 tests, including 19 occurrence-merge regressions and 10 UI regressions. The cases cover UID reuse, multiple original links from one publisher, partial descriptions, shared calendars, same-day multiple sessions, different weekly dates, contradictory known ends, source-specific access notes, and state restoration.

## Published verification

[GitHub run 40417016595](https://github.com/OranSimon/CMUEvents/actions/runs/40417016595) successfully built and deployed commit `764ac24f0c8c9848f2fb8b121a280835e4e3a77b`. It restored all 277 compatible source snapshots without invalidation, passed all 349 tests and refreshed all 277 automatic sources. Publication used the normal quality gates without an event-count override. The ten monitored source coverage checks passed with zero internal issues; nine sources retain explicit publisher/access diagnostics.

[Final deployment evidence](final-deployment.json) matches the actual Pages generation `2026-10-26T23:06:28.462Z` (October 26, 7:06 PM EDT) to the successful run, exact application/source hashes and an immutable crawler-state report. The snapshot contains 3,483 published records. Across all 1,123 published merged groups and 1,459 original source versions, checks find zero start/time/range violations and retain every original variant URL. All four browsing views remain mutually exclusive and cover the complete current/future-overlap population. Snapshot counts can change on later crawls.

Live computer use confirms one Rolfe seminar card, three source versions, the explicit room-difference notice and all 11 distinct event/source URLs rendered in the detail drawer. The rendered URL set exactly matches the published record's complete source-link set. Both original room numbers remain visible when Source versions is expanded. [UI verification](live-ui-verification.json), [live detail accessibility evidence](live-merged-detail-ax.txt), [expanded source versions](live-source-versions-ax.txt), [live screenshot](live-merged-detail.png).

Reproduce the read-only deployment audit with `node research/occurrence-merge-2026-10-26/verify-deployed.mjs --run-id=40417016595 --label=final`. The implementation and all verification use source snapshots or isolated in-memory stores; the production local database is untouched.
