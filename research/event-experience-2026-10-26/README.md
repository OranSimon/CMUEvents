# Event evidence and browsing repair

The review responds to misleading ongoing activity, uninformative source links, repeated schedules mixed with independent events, and ambiguous global pagination. [Official evidence](AUDIT.md) and [structured source audit](audit.json) distinguish actual source problems from dynamically rendered pages and ICS downloads.

## Changes

- Today is the complete matching list; no global Previous/Next exists. Upcoming uses explicit date windows and appends Show more to the same list. Recurring and Ongoing have independent views.
- Recurrence is source-backed. Recurring instances retain dates, frequency and series evidence; regular titles or observed seven-day gaps do not invent schedules.
- The mislabeled CUPS alias now reads the actual current CUPS calendar iframe. The separately advertised CyLab Student Seminar retains its own identity; its stale, detail-free unbounded daily template is isolated generically.
- Provider range-display clones become one published range. Genuine exhibitions and short dated conferences/camps are retained; registration/enrollment windows, sales windows and calendar holds do not receive activity topics.
- Ongoing displays the real date range and warns that range membership is not proof of current opening hours. Posner remains a real exhibition, including its published Monday closure in the original details.
- Date-only events with named speakers remain available with Time not listed. Public Google calendars use readable viewers; JavaScript-loading detail pages are retained.
- The new semantics survive normalization, merging and portable-state restore. Old extraction contracts are invalidated before unattended refresh.

## Published verification

The first cloud run, [40348944501](https://github.com/OranSimon/CMUEvents/actions/runs/40348944501), passed all 323 tests, checked all 277 automatic sources, and published schema 2 with 3,659 distinct records from 318 sources. The retained count was 82.7% of the preceding snapshot, so the normal publication gate passed without an event-drop override. All ten previously monitored source-coverage checks passed with zero internal limitations.

Computer use confirmed Today renders all 67 matching cards, Upcoming appends 48 to 96 cards without removing its first activity or changing the selected date window, and Recurring has explicit published-frequency labels. Ongoing contains the Posner exhibition, Launch and Lead camp, and Annual Afretec Network Conference, with their actual full date ranges. The layout was inspected at desktop width and in a 390 × 844 frame using the downloaded, unmodified published artifact. The source directory still has 318 links and the email directory has six channels with its import exclusion statement. Evidence: [browser check](browser-check.json), [desktop screenshot](today-desktop.png), [mobile screenshot](today-mobile-390.png).

A Google Calendar original link was also opened in the browser: its public Schedule view displays the Walking Special Interest Group activity on October 26, 10–11:30am. This resolves the feed-download/blank-page navigation problem without fabricating a detail page. [Accessibility evidence](calendar-viewer-ax.txt).

The range refinement preserves four sparse but genuine multi-day conference, carnival and program records; a short description or missing venue cannot alone remove those activities. Their source-provided ranges remain single activities, without invented session dates. [Provider evidence](short-program-range-review.json), [deployed refinement](range-refinement-deployment.json), [final published range check](final-short-range-verification.json).

The final source-link refinement prefers an already recorded official web listing when an activity's primary URL is an ICS download. If no readable source page is known, the link says Download calendar feed. Original event URLs and Google calendar viewers keep priority. Computer use confirmed the CSD listing shows the original date, clock and detail links, and the deployed activity button now opens that listing. [Official listing](csd-readable-listing-ax.txt), [final live activity detail](final-feed-listing-live-ax.txt), [final live exhibition detail](final-period-live-ax.txt), [390px exhibition detail preview](period-detail-mobile-390.png).

The final [scheduled daily run 40362543224](https://github.com/OranSimon/CMUEvents/actions/runs/40362543224) succeeded at source commit `effa2fc185809275503e9a8be61ca347a437b2b5`. It restored all 277 compatible source snapshots (5,756 raw occurrences, no invalidated contracts), passed all 326 tests, checked all 277 automatic sources and published 3,665 records at `2026-10-26T16:50:55.999Z`. This also verifies unattended state restoration after the UI/parser repairs. Seven sources retain explicit publisher/access diagnostics; the ten monitored source coverage checks all pass with no internal limitations.

[Final deployed verification](final-deployment.json) checks exact deployed app/client/semantics hashes, one coherent schema-2 data generation, the unchanged publisher scope, 318 source links and six non-ingested email channels. At verification, Today has 69 matching activities, Upcoming 2,320, Recurring 535 and Ongoing three. The four views are mutually exclusive and cover all 2,927 current/future-overlap activities without omissions. Eighty notice/window records are excluded before activity classification; the stale template's 395 phantom instances remain absent. Counts are snapshot evidence rather than permanent guarantees. The final live Today page renders all 69 cards, and the exhibition detail shows its full published range plus opening/session guidance instead of All day.

Reproduce with `node research/event-experience-2026-10-26/verify-deployed.mjs --run-id=40362543224 --label=final`. No production local database is used for the audit.
