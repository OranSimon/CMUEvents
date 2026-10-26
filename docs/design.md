# CMU Events: project design

## Scope and principles

Provide one discovery interface over retained non-club publishing sources, delivered as a daily-updated GitHub Pages site or an optional local API application. Independent student-club websites and calendars are excluded at the source-registry level. University calendars, departments, offices, student governance and other publishers remain. Their activities are preserved irrespective of organizer; there is no event-level club filter. Users can search, combine date/Department/Org/topic/campus/mode filters, inspect a grounded event summary, and follow the original event URL. The local application uses one SQLite file; Actions uses an isolated temporary database and durable portable source snapshots.

Source availability, extraction support, successful empty responses and failed extraction are different states. Preserve the last good snapshot on failure. Never infer an event's start from a page publication date or invent descriptions, locations, attendance restrictions or missing years. HTTP parsers never evaluate publisher scripts. The optional production renderer executes a publisher's client application only inside an isolated anonymous browser and reads the visible public DOM.

## Folder responsibilities

| Folder or file | Owns | Must not own |
| --- | --- | --- |
| `data/` | Authoritative verified source CSV/JSON | Runtime event snapshots or crawler cache |
| `config/` | Full generated source plans, inspected endpoint/selector overrides, and explainable topic taxonomy | Runtime source health or credentials |
| `src/adapters/` | Reusable extraction by format/platform; explicit dates, recurrence and event normalization | HTTP server routes, UI rendering or database queries |
| `src/lib/` | Shared normalization, safe HTTP fetching/cache and SQLite persistence/search | Individual department-specific UI behavior |
| `src/classify.mjs` | Deterministic topic, campus and mode inference | Network calls or invented event facts |
| `src/config.mjs` | Runtime settings, root paths, source-plan loading and interface calendar zone | Application startup side effects beyond creating the data folder |
| `src/refresh.mjs` | Source scheduling, bounded work, adapter orchestration and snapshot publication | Browser interaction or individual source parsing |
| `src/server.mjs` | Local HTTP lifecycle, static assets and small REST API | Source-specific selectors |
| `web/` | Buildless HTML/CSS/JS, accessible interactions, filter URL state and source-grounded presentation | Crawling external sites or private application secrets |
| `scripts/` | One-shot refresh, complete plan generation, project checks and original catalog research/export tools | An independent always-running crawler service |
| `.github/workflows/` | Daily isolated collection, validation, durable snapshot commits and Pages deployment | Browser credentials or event facts |
| `tests/` | Offline format fixtures, recurrence edge cases, classification, deduplication, search/filter and API contracts | Live-site availability assertions or production seed data |
| `research/` | Auditable discovery evidence, exclusions, candidates and runtime endpoint investigation | Claims that old checks imply current extraction success |
| `docs/` | Reader-facing architecture and catalog maintenance documentation | Runtime state |
| `outputs/` | The original verified source workbook | Application dependencies, web build or transient screenshots |
| `var/` (ignored) | Local SQLite event/source/cache data and WAL files | Committed private or generated runtime records |
| `.cache/` (ignored) | Original research HTTP cache | Authoritative catalog changes |
| `node_modules/` (ignored) | Dependencies reproduced by `npm ci` | Authored project code |

New source-specific behavior should normally be a small option in `config/source-overrides.json` consumed by an existing adapter. Add an adapter only for a genuinely different format. New filters belong in the shared event contract and storage query before browser controls. All authored named JavaScript functions use English Doxygen-style `/** ... */` comments with parameters and return descriptions.

## Data flow

```mermaid
flowchart LR
  Catalog[data/event_sources.json] --> Plan[scripts/plan-sources.mjs]
  Overrides[config/source-overrides.json] --> Plan
  Plan --> Registry[config/source-plans.json]
  Registry --> Refresh[src/refresh.mjs]
  Refresh --> Fetch[Shared public HTTP client]
  Fetch --> Adapters[Format / platform adapters]
  Adapters --> Snapshots[Per-source SQLite snapshots]
  Snapshots --> Merge[Deduplicate + preserve aliases]
  Merge --> Classify[Topic / campus / mode rules]
  Classify --> Search[SQLite events + FTS5]
  Search --> API[Local HTTP API]
  API --> UI[web/ discovery interface]
  Search --> Export[Validated static export]
  Export --> Pages[GitHub Pages JSON + assets]
  Pages --> UI
```

## Source planning and extraction

Each source plan contains `id`, `department`, `org`, original `url`, `adapter`, `fetchUrl`, `status`, `canonicalSourceId`, `refreshHours`, `options`, `reason`, `strategy` and investigation evidence. IDs are stable URL hashes. There is exactly one plan per authoritative catalog row. The check command rejects missing URLs, duplicate IDs and invalid aliases.

| Source family | Shared implementation | Important semantics |
| --- | --- | --- |
| ICS, Google calendars, Trumba exports, CampusGroups feeds | `adapters/ics.mjs` with `ical.js` | RRULE/RDATE, EXDATE, recurrence exceptions, cancellations, declared/floating zones, exclusive all-day ends, bounded occurrence expansion; precise diagnostics distinguish proven historical anomalies from potentially current missing records |
| LiveWhale | `adapters/json.mjs` | Verified group/calendar/widget endpoints, advertised pagination, explicit source zone and all-day dates |
| WordPress The Events Calendar | `adapters/json.mjs` | REST pagination or advertised ICS; explicit UTC dates, venues and categories |
| Scoped Trumba JSON | `adapters/json.mjs` | Preserve the verified series filter, explicit offsets and public event identity; do not assume the ICS endpoint honors the same query |
| RSS/Atom | `adapters/rss.mjs` | Event start extensions or typed Event content; a publication timestamp alone is insufficient |
| HTML, CampusGroups pages, public Slate widgets | `adapters/html.mjs` | Event JSON-LD/microdata first, then inspected selectors and explicit date fields; scoped semester/detail follow-up, explicit heading-year context and narrow provider-specific empty states |
| Tepper seminar JSON | `adapters/tepper.mjs` | Whitelist event fields; do not copy unrelated travel/coordinator metadata |
| Newsletters and OIE PDFs | `adapters/newsletter.mjs` | Extract separate dated sections and inspected email layouts, grounded year context and relative issue links; bounded recent issues, `pdf-parse` for text PDFs and original embedded event links |
| Music preparatory recital PDF | `adapters/pdfschedule.mjs` | Discover the advertised PDF; require printed season-year and allowed recital sections; exclude colored class/cancellation grids |
| WRCT text calendars | `adapters/wrct.mjs` | Explicit date-group headers or event-local short dates with a printed year; preserve date-only precision when no clock is supplied |
| Reviewed resources without dated schedules | `adapters/reviewed-resources.mjs` | Fingerprint scoped text, links and media references; show `undated`, and raise a review diagnostic on changes |
| Dynamic Alumni public pages | `adapters/alumni.mjs` and `lib/public-render.mjs` | Anonymous visible cards, real pagination and original public Event Details; no fixed card allowlist or hidden framework data |
| Live text schedules | `adapters/text-schedules.mjs` | Current row fields and publisher defaults, new linked conference pages, explicit dates and unresolved conflict diagnostics |
| Current posters and PDF flyers | `adapters/automatic-media.mjs` and `lib/media-ocr.mjs` | Accessible text/PDF text first; bounded OCR with positions, confidence, printed years/weekdays and changed-byte re-extraction |
| Subscription-only or unsupported archives | No automatic event invention | Retain original source and explicit limitation |

Covered sources are fetched once through their canonical source, then their original department, organization and listing URL are attached as aliases. A source's plan status records the strategy at investigation time; `sources.state` records the latest runtime outcome. Unrecognized HTML with no reliable event structure produces a failed extraction diagnostic instead of erasing previous events. Recognized empty feeds remain ordinary successful zero-event snapshots.

`GET /api/sources` returns the complete retained directory, including covered aliases and sources without imported events. Our sources searches that full response before pagination and combines department, source-format category and coverage filters. Original source URLs remain visible outside optional diagnostics. Source-panel filters are independent of event filters; refresh completion invalidates the cached directory. Native dialogs keep keyboard focus contained and return it to the initiating control on close.

`config/source-subscriptions.json` supplies reviewed email-channel metadata by exact source ID, attached through `lib/source-subscriptions.mjs`. It records official subscription links, publisher requirements, evidence, and either `subscriber_only` or `public_plus_email`. Unknown eligibility stays unverified. The Email subscriptions panel explains that subscriber email content is not imported while preserving separately published public calendar events. This metadata does not change source eligibility, extraction, event snapshots or source health, and it never infers email restrictions from a source name or keyword.

HTML child links have two roles. A listing that already normalizes an explicit title, full date and public event URL establishes an occurrence; failed optional abstract or registration enrichment adds a warning. Explicitly selected discovery children and links without a grounded parent record remain required: their failures and traversal limits make the source partial. Grounded URLs are tracked before date-window filtering so a verified historical listing does not become an error merely because it has no current occurrences. Required children run before optional enrichment.

Listing pagination follows only advertised same-origin HTML links, with a bounded page limit. A reviewed undated archive can exclude its own detail links only while the selected text, media references and structured metadata match its approved fingerprint. Publisher date conflicts remain partial even when their resource bytes have not changed. Distinct filters on a shared endpoint use `upstreamScope` so that an online-only source cannot become an alias of an in-person calendar.

Alumni collection discovers current public cards through the visible Next control and follows only advertised CMU GiveCampus event links. It reads the visible Event Details and Details-tab text rather than guest lists, hidden framework state or broad event-list getters. Fresh browser contexts do not reuse user credentials; downloads, service workers, WebSockets and non-public network targets are blocked. Missing or ambiguous detail clocks retain current listing dates with explicit partial diagnostics.

An original public event page supplies the current printed time, zone and venue on every run. Explicit provider identities permit partial-source reconciliation by UID across local-day changes; unrelated records and recurring UID series retain the usual partial-snapshot behavior. The older reviewed-card/clock-query path remains only for historical regression fixtures and is absent from active source options.

Current media selectors describe structure rather than fixed event identities or approved asset hashes. Each discovered asset is downloaded again; accessible text, a PDF text layer or bounded Tesseract OCR supplies its fields. Raw extraction is cached by bytes and extractor version, while events are parsed afresh with current HTML context. Unknown years and disagreeing date/clock readings remain explicit. Media scans inspect every current candidate; proven portraits and historical assets have separate classifications. PDFs expose all text pages and resumable per-page OCR, and exhausted work budgets are internal incomplete inspections. Active plans cannot contain fixed reviewed event payloads; `npm run check` enforces that recursively.

The [October 21 review](../research/source-review-2026-10-21.md) checks every previously failing, unsupported and subscription-only entry. Evidence records distinguish upstream omissions and conflicting dates, authenticated archives, image-only schedules, remaining extractor gaps, repaired parsers and verified empty schedules. HTTP success and parser support are separate checks. A review snapshot does not guarantee that publishers will keep the same format.

## Event contract and identity

Adapters return `{ events, warnings, unsupported?, partial?, undated?, coverage? }`. Audited sources also return versioned `coverage` with `inspectionComplete`, separate `internalIssues`, `externalIssues`, `nonBlockingIssues` and per-candidate evidence. The coordinator timestamps and persists each current audit before classifying health; static source documents and portable daily state preserve it. The daily publication gate requires current complete inspection with zero internal omissions for the monitored source group. `undated` is separate from a calendar whose verified dated records fall outside the collection window. Each normalized occurrence contains:

```text
uid, title, description, summary, start, end, allDay, timePrecision,
timeZone, location, url, organizer, status, tags
```

Timed starts/ends are ISO UTC instants. Date-only values are `YYYY-MM-DD`; their end is exclusive. `timePrecision` distinguishes an explicitly all-day event from an entry with no published clock time. The UI displays timed events in America/New_York and preserves the source zone in details. `summary` is an extractive plain-text excerpt (up to 320 characters), not an AI-generated claim. Empty descriptions remain empty.

Canonical events add `id`, `departments[]`, `orgs[]`, primary `department`/`org`, `sources[]`, topic labels, `campus`, `mode`, `timezone` (UI alias), and `endExclusive`. Each provenance record retains the catalog URL and the original event URL. Covered-source associations participate in all filters.

Identity includes occurrence start plus source UID, with a secondary normalized URL/title/start key to merge cross-format copies. Identical syndicated copies with different IDs can also merge when a substantial description (at least 80 characters), title (at least 20 characters), start and physical venue all match; generic online/unknown locations cannot use this key. Tracking parameters are removed only for matching. Preserve the richest description, distinct provenance and cancellation markers. Equal titles and times on unrelated pages are insufficient to merge events. This conservative policy can leave duplicates when publishers change UIDs, links or wording.

## Persistence and search

The built-in `node:sqlite` database uses WAL mode and the following small schema:

- `sources`: plan JSON, latest attempt/success, state, count, warnings and error.
- `occurrences`: normalized successful snapshots keyed by source and occurrence identity.
- `events`: materialized merged/classified records with indexed first/last visible calendar days.
- `event_search`: FTS5 index of title, publishers, tags, location and description.
- `http_cache`: anonymous public response bytes, ETag and Last-Modified metadata. The Tepper adapter disables raw response caching so only whitelisted event fields are persisted.
- `metadata`: last successful publication and refresh progress.

When a current feed and a date-only record have the exact same canonical URL, title and source-local day, a single unique timed occurrence may upgrade that record while preserving source provenance. Explicit all-day records, multiday ranges, multiple unknown identities or multiple timed starts never acquire a guessed clock. Successful source replacements are transactional. Failed requests or unsupported extraction preserve prior rows. An adapter may separately declare `completeSnapshot` when every current inventory item is known despite failures in optional original details. That authoritative inventory replaces missing records transactionally while retaining its partial health and diagnostics, so removed Alumni cards do not survive indefinitely. Other incomplete results add valid records without deleting previous records; the source remains in error and its last complete success timestamp is retained. This can temporarily retain a stale occurrence until a complete refresh succeeds, which is preferable to silently deleting events after a partial upstream failure. Rebuild the small materialized event/search view after useful batches, then once at refresh completion and when source definitions are loaded. No historical-success data is silently converted into an empty result on network failure.

Search uses Unicode word tokens and quoted prefix terms joined with AND. All SQL values are parameterized; user text is never accepted as raw FTS syntax. FTS BM25 weights titles above publishers/tags/location and descriptions. Results are ranked by relevance for searches and ordered by start time otherwise; the browser groups each returned page chronologically. No external search service or model API is needed.

Occurrence merging is centralized in `src/lib/occurrence-merge.mjs`. Source storage identity includes UID, exact start/end, precision, URL and normalized title, so a reused UID cannot overwrite a distinct claim before matching. Cross-source matching scopes local UIDs to their publisher and normalizes supported provider detail routes. Calendar viewers, feeds and known catalog-listing URLs do not identify an individual event. Equal titles alone never establish a duplicate.

Every merge requires the same dated start and compatible precision. Date-only records require identical full ranges; known timed ends must agree. The existing exact-link/local-day enrichment remains limited to one unambiguous clock. After these temporal checks, matching uses a shared individual event link, a scoped UID, copied substantive prose, or a specific title with corroborating physical venue evidence. Missing or abbreviated descriptions can be supported by another copy; generic titles, conflicting substantive descriptions, different rooms with sparse evidence, and conflicting known ends remain separate. Joining groups checks every cross-group pair for contradictions, so a missing-end record cannot connect two incompatible sessions.

Merged provenance uses `(source.id, source.url, source.eventUrl)`, retaining multiple distinct original links from one shared publisher. The materialized record exposes `sourceVariants` with original dates, clocks, locations, status, descriptions and source IDs; identical canonical description bytes are referenced rather than duplicated. `sourceConflicts` flags supported differences, and the detail drawer exposes Source versions instead of silently discarding a shorter access note. The `eventMerges` publication report records group membership and matching reasons. Each rebuild recomputes groups from raw source occurrences, including after portable-state restoration. Matching remains deterministic and uses no activity-content allowlist or external model.

Dates use inclusive range overlap: include a multi-day event if any visible day intersects the requested range. A date-only exclusive end does not leak into the following day. The default is today onward. Facet counts use the current text/date candidates before categorical filtering, allowing users to change category without losing available choices. Multiple associations are counted once per event per facet label. Transport paging caps each request at100. The default Today view retrieves all matching response pages before presenting one complete list. Upcoming, Recurring and Ongoing are distinct views; Show more appends within the same view and date range rather than replacing it with an unexplained next page.

## Discovery labels

`config/taxonomy.json` defines 12 broad multi-label topics plus a Campus Life fallback. Rules match complete words/phrases in titles, original categories, descriptions and publisher metadata, giving the title more weight and retaining at most four suggestions. They are explainable and inexpensive; editing rules requires no data service.

Attendance mode prefers structured metadata and the actual location. A description mentioning an online recording does not turn a physical event into an online one. Campus labels require location or publisher evidence; unknown places remain `Other / unspecified`. These are discovery aids, not guaranteed official classifications. Avoid adding filters such as free/paid, open-to-all or accessibility unless explicit source fields support them consistently.

## Refresh policy

On startup, serve persisted events immediately and start a due-source refresh. Check again every 15 minutes while the server runs. Each plan controls its own refresh interval; failures retry after one hour. Manual refresh requests force all refreshable sources. Empty plans remain refreshable. Covered, subscription-only and unsupported plans are not separately fetched.

The rolling ingestion window is now minus 30 days through now plus 365 days. Broad public feeds are prioritized so a fresh installation becomes usable before the complete catalog finishes. The coordinator permits six concurrent source jobs by default; the HTTP client permits two requests per host with a 200 ms start gap. Ordinary requests have a 20 second timeout and a 12 MiB body cap; explicit media requests may use up to 128 MiB and a 60 second timeout. Distinct byte/time budgets never share an unsafe in-flight or cached result. Requests use conditional caching, safe redirect checks and one bounded retry for HTTP 429/5xx or transient connection timeouts/resets. TLS certificate verification remains enabled. Parser-specific pagination/detail/recurrence limits emit diagnostics where coverage may be truncated.

`lib/tls.mjs` can supply a reviewed missing intermediate for an exact host from `config/tls-intermediates.json`. The bundled public certificate must match the configured SHA-256 fingerprint, be a currently valid CA and verify directly against an existing Node trusted root. The dispatcher keeps certificate and hostname verification enabled; redirects choose the mapping for their destination host. The current entry repairs Eberly's incomplete server chain. Review its issuer, validity and fingerprint when that upstream chain changes.

Concurrent API refresh requests share one in-process job. The standalone CLI is for a stopped server or a separate data directory; running two writers against the same snapshots can overwrite each other's partial publication. Local background updates require that local process to stay running. The independent GitHub Actions workflow runs daily, restores compatible source state, fetches all automatic sources, and exports a validated Pages artifact. See [deployment](deployment.md) for scheduling, quality gates and failure recovery.

## HTTP interface

| Method and route | Contract |
| --- | --- |
| `GET /api/events` | `query`/`q`, `from`, `to`, `department`, `org`, `tag`, `campus`, `mode`, `page`, `limit`; returns events, total, page, pageSize, facets, lastUpdated and refreshing |
| `GET /api/events/:id` | Full canonical event including description, summary, original URL and provenance |
| `GET /api/status` | Total events, source-state counts, refresh progress and last successful publication |
| `GET /api/sources` | Full source strategies and per-source runtime warnings/errors |
| `POST /api/refresh` | Start/reuse a refresh job; same-origin mutation only; returns HTTP 202 |

Local static files come only from `web/`. The server binds to loopback by default. Source HTML becomes plain text and browser templates escape text. Public HTTP and rendered-page requests reject credentials and non-public network targets. The UI does not expose arbitrary URL fetching. The local API is not exposed by the hosted deployment.

`lib/static-site.mjs` publishes only frontend assets, license and public JSON documents for manifest/events/sources/status. Source-parser options, raw responses and SQLite files are not included. `web/data-client.js` uses the same query/facet/overlap contract in the browser, including source provenance and complete detail fields. All resources resolve relative to the repository subpath. A visitor's reload performs GETs for a coherent published generation; it does not invoke the crawler. Snapshot age uses the actual successful data-update timestamp, independently of packaging time.

## Verification and maintenance

Run `npm test` for meaningful offline edge cases and API contracts. Run `npm run check` for syntax, key documents and complete source-plan mapping. To verify a source change, fetch its exact advertised endpoint, inspect an original event against normalized title/date/zone/link, and check `/api/sources` for warnings. HTTP 200 alone is not proof that the event extractor works.

Before presenting a UI change, inspect desktop and narrow layouts, keyboard focus/escape behavior, date/filter/search combinations, detail content, source links, loading/empty/failure states and refresh progress with actual public data. Keep transient runtime artifacts out of Git; deliberately selected public evidence may be retained under research. Live event counts and source health are snapshots, not permanent guarantees.


## Activity semantics and browsing views

Event records distinguish `eventType: scheduled|recurring` and `scheduleKind: occurrence|continuous|registration-window|date-window`. Recurrence requires a real RRULE/RDATE, explicit provider flag, a published session list or a direct scheduling statement in the description. A weekly-looking title or observed cadence is insufficient. Occurrence instants remain separately published; no new dates are generated from prose. Series identity and evidence survive storage, deduplication and daily-state restoration.

LiveWhale display rows with no actual repeat rule but identical original range bounds are one source range, not daily appointments. Verified exhibitions remain continuous periods; enrollment, sales, administrative holds and program windows without session dates are excluded before topic classification. Missing descriptions or clock times alone do not exclude a valid dated event. Dynamic HTML shells are never evidence of an empty original page. Google public-feed fallback links use the official calendar viewer and are labeled accordingly.

Today contains nonrepeating activities whose published start day is today. Upcoming contains later starts in an explicit date window. Recurring contains independently dated repeating occurrences. Ongoing contains genuine published cross-day ranges still intersecting today; it does not assert that a venue is open at the current moment. The shared browser/server `event-semantics.js` applies these boundaries consistently, including exclusive ends and New York time.

Source exclusions are recorded separately from active events. Version two of the extraction signature invalidates older snapshots that lost recurrence/range semantics, so obsolete calendar clones cannot reappear after restore. Source eligibility still applies only to publishers; official reposts of student-club activities remain included.
