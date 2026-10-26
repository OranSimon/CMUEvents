# GitHub Pages deployment and maintenance

The frontend is a static Pages artifact. GitHub Actions performs collection and publication without depending on a laptop, a persistent web server, a paid model API or personal credentials. The source repository is public with the user's authorization; the license remains AGPL-3.0-only.

## Daily pipeline

`.github/workflows/daily-pages.yml` runs at 06:17 in `America/New_York`, including daylight saving time, and also on application changes or manual dispatch. GitHub's scheduler is best effort and may delay or drop scheduled jobs during high load. Only the default branch runs the schedule. GitHub can disable public-repository schedules after 60 days without repository activity; check the Actions page if a scheduled run stops. Successful runs commit updated crawler state, but the site's independent freshness warning remains necessary.

Each run installs locked npm dependencies, Chromium, Tesseract and Poppler on an Ubuntu runner using Node.js 24. It runs the offline tests and project checks, restores compatible last-good source snapshots from `codex/crawl-state`, fetches all automatic sources, validates the resulting dataset and uploads a Pages artifact. The final job deploys with GitHub's Pages OIDC flow. The built-in `GITHUB_TOKEN` writes only to this repository; no PAT, personal SSH key, mailbox account or LLM API secret is needed.

The repository's Pages publishing source must be **GitHub Actions**. The Pages deployment environment is `github-pages`. Workflow concurrency prevents overlapping builds from racing the state branch or deploying out of order. The crawler-state branch is separate from the source branch and is not a Pages publishing branch.

## Persistent state and failure behavior

Actions runners are disposable. `src/lib/crawl-state.mjs` exports normalized per-source occurrences and health metadata, without HTTP response caches, browser cookies or source-parser configuration. Each source snapshot carries an extraction-contract signature. Changed contracts, excluded sources and retired sources are invalidated instead of reviving old manual records. The current rolling window prunes expired occurrences, and rebuilding restores shared-source provenance and deduplication.

Validated state and a report are committed to `codex/crawl-state`. This is durable storage rather than a dependency on an expiring cache or workflow artifact. Raw OCR results use a separate disposable cache keyed by bytes and extractor version; a cache miss only causes OCR to run again. Source-health and publication-attempt reports are also uploaded as diagnostic artifacts with a 14-day retention period.

A source failure preserves its own previous compatible records and shows its last success and current diagnostic. Date conflicts and uncertain fields are never resolved by silently choosing a convenient value. Publication is blocked if:

- No current event occurrences remain, or the complete retained source directory is missing.
- The refresh did not finish or did not check every scheduled source.
- Fewer than 70% of source checks completed successfully.
- Event count falls below 70% of the previous compatible snapshot without an explicit manual override.

The last deployed website remains available on a blocked or failed publication. A valid snapshot is only installed in the browser when manifest, events, sources and status have the same generation. A newer packaging timestamp does not reset the successful data-update time. After 48 hours, the page warns that data may be out of date. These protections expose incomplete collection rather than equating a green deployment with exhaustive source coverage.

## Long-term extraction

All 318 retained sources continue to use public access only. Official and other retained publishers' club-hosted events stay included. The four subscriber-only sources and private email details are not ingested.

Machine-readable ICS, JSON and RSS remain preferred. HTML rules describe live structures such as date columns, semester headings, advertised links and pagination. They do not supply fixed occurrence dates. For Alumni, an isolated anonymous Chromium context reads visible public cards, follows the actual Next control and reads the original public Event Details section. It excludes hidden framework state and guest lists. Browser requests reject private/loopback network destinations and unrelated main-frame redirects.

Images and PDFs are discovered from the current source HTML. Accessible alt text and PDF text layers are used first; image-only content is read with Tesseract using positioned words, confidence values and alternate color treatments. A current printed year is required; dates are checked against printed weekdays, explicit time markers and current heading context. Date-only precision remains when clocks cannot be supported. Media-byte changes trigger new extraction automatically. Source diagnostics retain OCR disagreements, missing dates, bounded archive scans and unreadable assets.

Eleven source configurations were migrated from manual occurrence snapshots to these live paths. `npm run check` recursively rejects active `reviewedPublicEvents`, `reviewedImages` and `reviewedFragments` payloads, including nested detail and additional-endpoint options. Legacy parsers remain covered by historical fixtures; they cannot be enabled by current source plans unnoticed.

Some sources still lack a public dated schedule, expose contradictory dates or have discovery limits. Undated-resource fingerprints remain change detectors, not event records. They can raise a review diagnostic when a publisher adds new content. This upgrade does not claim a universal parser for arbitrary future layouts; see the live Our sources diagnostics and the [media extraction evidence](../research/automatic-media-2026-10-25/README.md).

## Local build and preview

```bash
npm ci
npx playwright install chromium
# Install Tesseract using your operating system's package manager.
CMUEVENTS_RENDER_PUBLIC=1 npm run build:static
npm run preview:static
```

Open `http://127.0.0.1:4175/CMUEvents/`. This serves only the generated `dist/` artifact; it has no API server or refresh mutation. The local build database defaults to `.cache/static-build/`, separate from `var/events.sqlite`. `CMUEVENTS_BUILD_DATA_DIR` changes the isolated build database directory. Generated output is limited to `dist/` or a dedicated directory within `.cache/`.

To restore a prior portable state when building locally:

```bash
CMUEVENTS_RENDER_PUBLIC=1 npm run build:static -- \
  --state-in=/absolute/path/to/state.json \
  --state-out=.cache/export/state.json
```

## Recovery

Open **Actions → Daily events and Pages** and inspect the failed step, its summary and the publication-attempt artifact. Correct a parser, upstream endpoint or runtime problem and rerun the workflow. If a decline is real and has been reviewed, manually dispatch with **Allow a reviewed event-count decrease greater than 30%**. That override does not bypass empty-data, source-directory or broad source-failure checks.

Do not remove the source directory or crawler-state branch to make a failed build appear healthy. If the state branch is missing, the workflow deliberately performs a fresh bootstrap; if state is corrupt, the build fails visibly rather than silently discarding it. The deployment remains available while the issue is repaired.

GitHub references: [Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Pages publishing configuration](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
