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

The final review additionally checks sparse but genuine multi-day conference, carnival and program ranges, so a short description or missing venue cannot alone remove those activities. Final deployment verification follows this refinement. No production local database is used for the audit.
