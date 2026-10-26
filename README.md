# CMU Events

A public event discovery app with **318 non-club publishing sources**, a GitHub Pages frontend, and daily GitHub Actions collection. Independent student-club websites and their own calendar feeds are excluded. University calendars, academic departments, offices, student governance, and other publishers remain; every activity they publish is retained, including events hosted by student clubs.

## GitHub Pages and daily updates

[Open CMU Events](https://oransimon.github.io/CMUEvents/) · [View collection and deployment runs](https://github.com/OranSimon/CMUEvents/actions/workflows/daily-pages.yml)

The deployed site uses static HTML/CSS/JavaScript and versioned JSON snapshots. It needs no continuously running server. [Daily events and Pages](.github/workflows/daily-pages.yml) runs at **06:17 America/New_York**, on application changes, and on manual dispatch. GitHub may delay scheduled runs. See [deployment and maintenance](docs/deployment.md) for the full build, state recovery, source limitations and manual recovery process.

The workflow fetches every automatic source once, validates the result and deploys through GitHub Pages. Per-source last-good snapshots survive between runners on the dedicated `codex/crawl-state` branch. Individual failures remain visible; widespread collection failures, an empty dataset or an unexplained event-count decrease greater than 30% block publication and preserve the deployed site. The browser displays the actual successful data-update time and warns after 48 hours without a fresh update. Its reload button checks published data rather than starting a crawl from a visitor's browser.

No active source configuration contains fixed `reviewedPublicEvents`, `reviewedImages` or `reviewedFragments` event payloads. CI rejects their reintroduction. The public Alumni listing is collected from its current visible cards and pagination in a fresh anonymous Chromium context. Current seminar rows and linked conference pages are read structurally. Current images/PDFs use accessible text, a PDF text layer, or Tesseract OCR with explicit date/year and confidence checks. Historical reviews remain in research and regression fixtures; they do not supply unattended event records.

## Run locally

Use **Node.js 22.13 or newer** with npm. No API key, account, external database, build step, or Python installation is needed for the app.

```bash
npm ci
npm start
```

Open **http://127.0.0.1:3000**. If that port is occupied, use `PORT=4173 npm start`. SQLite may print an experimental-feature notice on some supported Node versions.

The first local launch starts fetching real public sources in the background. Results appear as batches finish; the source-health panel shows progress and extraction failures. Later launches reuse the local database immediately. Keep the local server running for its automatic updates. The deployed Pages site and its daily Actions workflow operate independently of this computer.

For local rendered-page collection, run `npx playwright install chromium`, then start with `CMUEVENTS_RENDER_PUBLIC=1 npm start`. Media OCR needs Tesseract on the command path. Without these optional local runtimes, affected sources show explicit diagnostics; the GitHub workflow installs both automatically.

## Discover events

- Search titles, descriptions, locations, departments, organizations and topic tags.
- Filter by upcoming/today/next 7 days/next 30 days or an inclusive custom date range.
- Combine **Department**, **Org**, topic, campus and attendance-mode filters.
- Switch between list and grid views, bookmark the current filters, and open an event for its source-text summary, description, time, location and provenance.
- Follow the original event link for current registration, eligibility and program details.
- Open **Our sources** for all 318 original source links. Search by organization, department or URL; combine Department, Category and Coverage filters; load more or show the entire directory. Shared-feed aliases remain visible.
- Open **Email subscriptions** for reviewed subscription channels, official signup instructions and access requirements. Subscriber-only emails are not imported. Four channels are email-only; two publishers also have tracked public calendars whose separately published events may appear in Discover.

Timed events are displayed in **America/New_York**; details retain the source timezone. Date-only entries retain date precision. Long-running events appear as ongoing. Broad tags are deterministic suggestions configured in [`config/taxonomy.json`](config/taxonomy.json), not official CMU labels or generated factual claims.

## Refresh and maintain

The server checks due sources every 15 minutes. Each plan has its own refresh interval; empty calendars remain eligible. The refresh button requests a full update. Concurrent refresh requests share one job.

```bash
npm run refresh                 # Refresh only due sources, then exit
npm run refresh -- --force      # Force a complete refresh
npm run refresh -- --source=ID  # Refresh a selected source ID from /api/sources
npm run plan                    # Regenerate the complete source strategy mapping
npm test                        # Offline adapter, storage, filter and API tests
npm run check                   # Syntax, configuration and active-catalog coverage checks
npm run build:static            # One fresh collection and validated Pages export to dist/
npm run preview:static          # Preview dist at http://127.0.0.1:4175/CMUEvents/
```

Do not run the standalone refresh command while the server is refreshing the same database. Stop the server first or use its refresh button. The normal app has one coordinator and one SQLite database; no queue service is required.

Optional environment variables are documented in [`.env.example`](.env.example). Set them in your shell; the app does not automatically load `.env` files. `CMUEVENTS_AUTO_REFRESH=0` serves existing local data without fetching; `CMUEVENTS_DATA_DIR` selects an alternate local data folder. `HOST` defaults to loopback. Static builds use a separate SQLite directory and do not modify the normal local app database.

## Source coverage and limitations

The current [source-only policy and access review](research/club-source-removal-2026-10-25/README.md) removes independent student-club publishers while retaining official and other non-club sources. Activities republished by those sources remain even when a student club hosts them. Earlier audits below describe the larger historical catalog.

The [19-source follow-up](research/remaining-19-2026-10-25/README.md) implements reusable extraction or monitoring paths for the four partial and fifteen unsupported sources from that snapshot, repairing the original four partial extractors. The subsequent [computer-use recheck](research/visual-recheck-2026-10-25/README.md) recovers linked Cryptography/Econ-CS seminars, recognizes a dated historical EWO PDF, and resolves Sydney's public event details. Unfinished source discovery, publisher date conflicts and anonymous-access limits remain explicit in diagnostics.

[`config/source-plans.json`](config/source-plans.json) maps **every catalog entry** to its adapter, endpoint, options, refresh interval, canonical alias, evidence and reason. [`research/runtime-adapters.md`](research/runtime-adapters.md) records the endpoint investigation.

ICS, LiveWhale, WordPress JSON, CampusGroups, scoped Trumba JSON, RSS/Atom, structured HTML, configured static selectors, public admission-calendar widgets, Tepper seminar JSON, text calendars, recital PDFs and bounded newsletter extraction reuse a small set of adapters. Equivalent webpages reuse a verified calendar feed while retaining their Department and Org associations.

Plan status and live health are separate. `active` means an implemented extraction strategy, not guaranteed complete or currently populated. Runtime `empty` means zero imported occurrences in the collection window and still refreshes; it does not establish that the original page or the whole organization has no events. `undated` identifies an inspected resource without a published occurrence schedule: scoped content and advertised links are monitored, and changes require review. `covered` reuses another source; `subscription_only` has no verified public archive; `unsupported` needs a reliable extractor. A live parser failure is visible and preserves the last successful snapshot. Incomplete extraction adds valid events and remains visibly flagged until a complete refresh succeeds; a unique exact-title/link/day match can enrich an older unknown-time record with its published clock. A successful, structurally verified empty feed replaces its old snapshot with zero events.

The app ingests a rolling window from 30 days ago through the next 365 days, expands recurring calendars within that window, and retains source cancellation markers. Newsletter issue dates are never used as event dates; contextual years are used only when stated by the issue. Media bytes are re-read and OCR is cached by bytes and extractor version; changed images are extracted again automatically. Ambiguous OCR, missing years, conflicting dates, inaccessible pages and bounded discovery remain explicit source diagnostics. No source is guaranteed exhaustive or permanently available.

The email directory uses explicit, reviewed entries in [`config/source-subscriptions.json`](config/source-subscriptions.json), with evidence and a distinction between email-only announcements and public calendars with additional private email content. Public newsletter archives, optional email reminders, and member-only pages without a verified email channel are not marked as subscription-only. The [source-directory UI verification](research/source-directory-ui-2026-10-25/README.md) records its search, filtering and accessibility checks.

The [October 21 source review](research/source-review-2026-10-21.md) records fresh checks of all 63 previously unsupported, subscription-only or failing entries and 17 more entries exposed by full validation, including exact remaining reasons and runtime results. A source page can remain unsupported even when another official calendar independently publishes some of its events. A historical schedule outside the ingestion window is a supported empty result when its dates can be verified.

The initial [visual review](research/visual-empty-review-2026-10-21.md) sampled 15 zero-record sources and checked the user-reported Tepper directory and a healthy control. The [remaining 436-source review](research/empty-source-followup-2026-10-21/README.md) is a historical snapshot. The [105-source follow-up](research/pending-source-resolution-2026-10-22/README.md) records newer public subpages, anonymous list APIs, calendar evidence, ingestion repairs, and concrete external next steps; it also corrects a stale Qatar filter result. The [automatic media upgrade](research/automatic-media-2026-10-25/README.md) and [dynamic source audit](research/long-term-dynamic-sources-2026-10-25/nonimage-audit.json) replace the live event snapshots used by those historical reviews. Source diagnostics distinguish collection windows, incomplete public discovery and optional private channels. Mailbox ingestion remains unimplemented; subscriber-only email content is excluded as explained in the email directory.

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
