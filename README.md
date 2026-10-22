# CMU Events

A local, automatically refreshed discovery app for public Carnegie Mellon events. It builds on a verified catalog of **1,029 source entries** and keeps every event connected to its original publisher.

## Run locally

Use **Node.js 22.13 or newer** with npm. No API key, account, external database, build step, or Python installation is needed for the app.

```bash
npm ci
npm start
```

Open **http://127.0.0.1:3000**. If that port is occupied, use `PORT=4173 npm start`. SQLite may print an experimental-feature notice on some supported Node versions.

The first launch starts fetching real public sources in the background. Results appear as batches finish; the source-health panel shows progress and extraction failures. Later launches reuse the local database immediately. Keep the server running for automatic updates. Stopping it stops background updates; restarting catches up due sources.

## Discover events

- Search titles, descriptions, locations, departments, organizations and topic tags.
- Filter by upcoming/today/next 7 days/next 30 days or an inclusive custom date range.
- Combine **Department**, **Org**, topic, campus and attendance-mode filters.
- Switch between list and grid views, bookmark the current filters, and open an event for its source-text summary, description, time, location and provenance.
- Follow the original event link for current registration, eligibility and program details.

Timed events are displayed in **America/New_York**; details retain the source timezone. Date-only entries retain date precision. Long-running events appear as ongoing. Broad tags are deterministic suggestions configured in [`config/taxonomy.json`](config/taxonomy.json), not official CMU labels or generated factual claims.

## Refresh and maintain

The server checks due sources every 15 minutes. Each plan has its own refresh interval; empty calendars remain eligible. The refresh button requests a full update. Concurrent refresh requests share one job.

```bash
npm run refresh                 # Refresh only due sources, then exit
npm run refresh -- --force      # Force a complete refresh
npm run refresh -- --source=ID  # Refresh a selected source ID from /api/sources
npm run plan                    # Regenerate the complete source strategy mapping
npm test                        # Offline adapter, storage, filter and API tests
npm run check                   # Syntax, configuration and 1,029-source coverage checks
```

Do not run the standalone refresh command while the server is refreshing the same database. Stop the server first or use its refresh button. The normal app has one coordinator and one SQLite database; no queue service is required.

Optional environment variables are documented in [`.env.example`](.env.example). Set them in your shell; the app does not automatically load `.env` files. `CMUEVENTS_AUTO_REFRESH=0` serves existing data without fetching; `CMUEVENTS_DATA_DIR` selects an alternate data folder. `HOST` defaults to loopback. This delivery is a local application; it does not configure an online deployment.

## Source coverage and limitations

[`config/source-plans.json`](config/source-plans.json) maps **every catalog entry** to its adapter, endpoint, options, refresh interval, canonical alias, evidence and reason. [`research/runtime-adapters.md`](research/runtime-adapters.md) records the endpoint investigation.

ICS, LiveWhale, WordPress JSON, CampusGroups, scoped Trumba JSON, RSS/Atom, structured HTML, configured static selectors, public admission-calendar widgets, Tepper seminar JSON, text calendars, recital PDFs and bounded newsletter extraction reuse a small set of adapters. Equivalent webpages reuse a verified calendar feed while retaining their Department and Org associations.

Plan status and live health are separate. `active` means an implemented extraction strategy, not guaranteed complete or currently populated. Runtime `empty` means zero imported occurrences in the collection window and still refreshes; it does not establish that the original page or the whole organization has no events. `covered` reuses another source; `subscription_only` has no verified public archive; `unsupported` needs a reliable extractor. A live parser failure is visible and preserves the last successful snapshot. Incomplete extraction adds valid events and remains visibly flagged until a complete refresh succeeds; a unique exact-title/link/day match can enrich an older unknown-time record with its published clock. A successful, structurally verified empty feed replaces its old snapshot with zero events.

The app ingests a rolling window from 30 days ago through the next 365 days, expands recurring calendars within that window, and retains source cancellation markers. Newsletter issue dates are never used as event dates; contextual years are used only when stated by the issue. Visually reviewed posters can publish accepted fields only while their advertised image SHA-256 matches; changed images need review and preserve prior accepted records. Undated listings, inaccessible pages and private events still require source-specific verification. Some bounded pagination/detail limits can reduce coverage and are exposed as warnings. No source is guaranteed exhaustive or permanently available.

The [October 21 source review](research/source-review-2026-10-21.md) records fresh checks of all 63 previously unsupported, subscription-only or failing entries and 17 more entries exposed by full validation, including exact remaining reasons and runtime results. A source page can remain unsupported even when another official calendar independently publishes some of its events. A historical schedule outside the ingestion window is a supported empty result when its dates can be verified.

The initial [visual review](research/visual-empty-review-2026-10-21.md) sampled 15 zero-record sources and checked the user-reported Tepper directory and a healthy control. The [remaining 436-source review](research/empty-source-followup-2026-10-21/README.md) records page, subpage and embedded-calendar evidence, verified omissions, fixes and explicit access/date limitations. Source diagnostics can filter/search zero-record or all sources and display separately recorded visual evidence; unresolved visual findings also appear under Needs attention. The [poster and subscription-inbox design](docs/source-ingestion-next-steps.md) describes the next stages; production OCR and mailbox ingestion are not implemented.

The shared HTTP client verifies certificates and hostnames. Eberly's seminar host omits a required intermediate certificate; [`config/tls-intermediates.json`](config/tls-intermediates.json) supplies the reviewed public intermediate for that host. The client checks its fingerprint, validity and signature against Node's existing trusted roots. Review this mapping if the publisher changes its certificate chain; no private key or new independent trust root is included.

Source descriptions are rendered as plain text. Summaries are short source excerpts; missing content is identified rather than invented. Duplicate matching uses occurrence UID and normalized original link/title/start. Syndicated copies can also merge when their substantial descriptions, titles, start times and physical venues match exactly. Differently worded listings can still leave duplicates; equal titles alone never cause unrelated events to merge. Campus and topic inference can be imperfect, so source details remain authoritative.

## Project documents and catalog

- [Project design and folder responsibilities](docs/design.md)
- [Catalog scope, evidence and rebuilding](docs/catalog.md)
- [CSV: Department / Org / link](data/event_sources.csv)
- [Catalog JSON with verification metadata](data/event_sources.json)
- [Original source workbook](outputs/01a15b3a-aa11-79f0-96c7-fdcfed7eef2f/CMU_Event_Sources.xlsx)

The catalog's entry count is not an organization or upcoming-event count: one organization can publish several feeds and pages. Public sources require no login; event participation may still require registration or have restrictions.

Code is licensed under [GNU Affero General Public License v3.0](LICENSE), `AGPL-3.0-only`. Original event content remains attributable to its publishers.
