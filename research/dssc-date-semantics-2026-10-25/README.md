# DSSC date-role validation

Fresh anonymous HTTP validation: 2026-10-26T04:12:54.101Z. The directory and all 22 currently advertised same-origin detail links returned HTTP 200. No browser session, cached event fallback, credentials, fixed event list or production SQLite was used.

**Result:** 22/22 detail pages inspected; 20 parse consistently into 24 historical occurrences. Two real publisher year conflicts remain partial. The 2026-09-25–2027-10-25 ingestion window contains zero verified occurrences. Inspection is complete, internalIssues is empty, and the two externalIssues have explicit competing date evidence.

The reusable resolver now separates the synopsis after the title from dated agenda headers, separately advertised series sessions, hotel/registration cutoffs and transportation schedules. A multiday range produces one date-precision occurrence with an exclusive end. Repeated advertised clocks produce separate occurrences. A recurring date envelope does not generate unlisted sessions. Title and agenda years must agree with the explicit main date/range. Footer and related-news sections cannot provide a year or event date. All current directory links are inspected in batches of three; the obsolete maxDetails cap no longer truncates coverage.

| Advertised detail | Decision | Recognized | Published main date(s), inclusive |
| --- | --- | ---: | --- |
| [2026 DSSC Japan Technical Review.html](https://www.dssc.ece.cmu.edu/news/events1/2026%20DSSC%20Japan%20Technical%20Review.html) | conflict | 0 | 2025-06-30 |
| [2026 DSSC Spring Technical Review.html](https://www.dssc.ece.cmu.edu/news/events1/2026%20DSSC%20Spring%20Technical%20Review.html) | conflict | 0 | 2025-06-09 |
| [2025 DSSC Japan Technical Review.html](https://www.dssc.ece.cmu.edu/news/events1/2025%20DSSC%20Japan%20Technical%20Review.html) | single-occurrence | 1 | 2025-05-22 |
| [2025 DSSC Spring Technical Review.html](https://www.dssc.ece.cmu.edu/news/events1/2025%20DSSC%20Spring%20Technical%20Review.html) | single-occurrence | 1 | 2025-03-04 |
| [2023 DSSC Spring Technical Review.html](https://www.dssc.ece.cmu.edu/news/events1/2023%20DSSC%20Spring%20Technical%20Review.html) | single-occurrence | 1 | 2023-05-10 |
| [2022 Winter Review.html](https://www.dssc.ece.cmu.edu/news/events1/2022%20Winter%20Review.html) | single-occurrence | 1 | 2022-12-14 |
| [fall-review-2021.html](https://www.dssc.ece.cmu.edu/news/events1/fall-review-2021.html) | repeated-occurrences | 2 | 2021-11-17; 2021-12-02 |
| [west-coast-2022.html](https://www.dssc.ece.cmu.edu/news/events1/west-coast-2022.html) | multiday-range | 1 | 2022-05-18–2022-05-19 |
| [spring-review-2021.html](https://www.dssc.ece.cmu.edu/news/events1/spring-review-2021.html) | repeated-occurrences | 2 | 2021-05-20 |
| [spring-review-2020.html](https://www.dssc.ece.cmu.edu/news/events1/spring-review-2020.html) | explicit-series-sessions | 3 | 2020-05-19–2020-06-30 |
| [fall-review-2019.html](https://www.dssc.ece.cmu.edu/news/events1/fall-review-2019.html) | multiday-range | 1 | 2019-09-24–2019-09-25 |
| [west-coast-2019.html](https://www.dssc.ece.cmu.edu/news/events1/west-coast-2019.html) | multiday-range | 1 | 2019-03-12–2019-03-13 |
| [fall-review-2018.html](https://www.dssc.ece.cmu.edu/news/events1/fall-review-2018.html) | multiday-range | 1 | 2018-10-04–2018-10-05 |
| [west-coast-2018.html](https://www.dssc.ece.cmu.edu/news/events1/west-coast-2018.html) | multiday-range | 1 | 2018-03-13–2018-03-14 |
| [fall-review-2017.html](https://www.dssc.ece.cmu.edu/news/events1/fall-review-2017.html) | single-occurrence | 1 | 2017-11-06 |
| [west-coast-2017.html](https://www.dssc.ece.cmu.edu/news/events1/west-coast-2017.html) | single-occurrence | 1 | 2017-03-14 |
| [fall-review-2016.html](https://www.dssc.ece.cmu.edu/news/events1/fall-review-2016.html) | multiday-range | 1 | 2016-09-27–2016-09-28 |
| [west-coast-2016.html](https://www.dssc.ece.cmu.edu/news/events1/west-coast-2016.html) | single-occurrence | 1 | 2016-03-10 |
| [fall-review-2015.html](https://www.dssc.ece.cmu.edu/news/events1/fall-review-2015.html) | multiday-range | 1 | 2015-10-06–2015-10-07 |
| [west-coast-2015.html](https://www.dssc.ece.cmu.edu/news/events1/west-coast-2015.html) | single-occurrence | 1 | 2015-03-10 |
| [fall-review-2014.html](https://www.dssc.ece.cmu.edu/news/events1/fall-review-2014.html) | multiday-range | 1 | 2014-09-30–2014-10-01 |
| [west-coast-2014.html](https://www.dssc.ece.cmu.edu/news/events1/west-coast-2014.html) | single-occurrence | 1 | 2014-03-11 |

2021 Fall is two reviews (November 17, 13–15 EST; December 2, 20–22 EST). Spring 2021 is two reviews on May 20 (12–14 and 20–22 EDT). The 2020 series has three explicitly dated session headings, May 19, June 2 and June 16; the June 30 envelope endpoint is not silently promoted to a fourth event. Hotel cutoff October 15, 2017 and the September 24 transportation timetable on 2016/2018 pages no longer invalidate the main meeting dates.

Remaining external issues:

- The 2026 Spring title and agenda say 2026, while the main heading says June 9, 2025. No year is selected as authoritative.
- The 2026 Japan title says 2026, while the main date says June 30, 2025. No year is selected as authoritative.
- Nonblocking publisher typo: the 2018 second agenda header prints “Friday, Oct 4”, while October 4, 2018 was Thursday. The explicit October 4–5 event envelope is retained; the parser records the weekday mismatch and does not rewrite the day. The Japan weekday mismatch is similarly disclosed under its existing year conflict.

No remaining DSSC limitation comes from a deliberate scan count cap, whole-page date comparison or fixed activity contents. If a future page loses its summary date or changes structure, coverage will show an unresolved internal issue rather than a silent empty result. A future upstream fetch failure remains separate from a date conflict. This local verification is not a claim about GitHub runner execution; the integrated daily Actions run is the deployment acceptance check.

Validation: `node --test tests/date-semantics.test.mjs` passed 21/21 dedicated regression tests. Tests include current real multi-day, repeated-date, repeated-clock, explicit-series, cutoff, transportation and real-conflict structures, cross-year ranges, malformed dates, ambiguous yearless agenda dates, footer/related content, and 43 dynamically advertised details despite an obsolete maxDetails value of 2.

Artifacts: [live-validation.json](live-validation.json), [config patch](config-patch.json), [repeatable live check](validate-live.mjs). The main config is deliberately left for integration; apply deleteOptions and update the strategy/reason/evidence fields.
