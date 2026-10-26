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
- [Final media audit](media-coverage-final.json) and [media method/results](MEDIA-README.md) and [repeatable media check](verify-media.mjs).
- [Humanities detail-date evidence](humanities-detail-date-review.json): linked term/date evidence is separated from publication metadata and incidental years.
- [All 22 DSSC details and date-role regression](../dssc-date-semantics-2026-10-25/README.md).
- [Directory and REAL configuration/discovery evidence](../remaining-10-2026-10-26/).

## Actual GitHub Actions validation

Three real Ubuntu runs completed successfully with all monitored sources inspected and zero internal omissions. The final deployed artifact is generation `2026-10-26T05:33:39.443Z`, code `458efefa49b203c0fc25a0c07653d2c06853903e`: 4,425 distinct occurrences, 318 source links and six email channels. All 301 tests passed on Ubuntu, with zero failures or skips.

| Run | Code | Build | Deploy | Coverage |
| --- | --- | ---: | ---: | --- |
| [Cold bootstrap](https://github.com/OranSimon/CMUEvents/actions/runs/40270064151) | cccd090 | 19m49s | 11s | 10/10, zero internal omissions |
| [Unattended-state/cache restore](https://github.com/OranSimon/CMUEvents/actions/runs/40271808908) | cccd090 | 4m21s | 10s | 10/10, zero internal omissions |
| [Final precision/inventory fixes](https://github.com/OranSimon/CMUEvents/actions/runs/40274573174) | 458efef | 3m26s | 11s | 10/10, zero internal omissions |

The cold run explicitly missed the new OCR cache and invalidated all ten old extraction contracts. The next run restored the new cache and all compatible source snapshots on a fresh runner. The final run again restored that cache; EWO's source time fell from 982.829 seconds cold to 58.828 seconds. No event-drop override was used. These are measured run times, not a guarantee of future provider/network performance.

The [cold](cold-deployment.json), [first restored](warm-initial-deployment.json) and [final deployed](final-deployment.json) checks verify all four public JSON documents share one generation, the deployed application matches its exact source commit, the directory and subscription boundaries are complete, and all ten fresh coverage contracts pass. The repeatable check is [verify-deployed.mjs](verify-deployed.mjs).

## Final ten-source results

Counts describe the 30-day lookback and 365-day forward collection window. Zero means no confirmed occurrences in that window, not an empty website.

| Source | Window occurrences | Inspection | Remaining publisher limitation |
| --- | ---: | --- | --- |
| SCS Seminars directory | 107 | 26/26 series; 19 reuse catalog sources | None; directory metadata without dated announcements does not generate recurrence |
| Humanities Center | 0 | 134 detail/media candidates; linked official date evidence restores eight earlier false gaps | Eight old details still lack a uniquely grounded occurrence year |
| DSSC | 0 | All 22 linked details; 24 valid historical occurrences | Two genuine title/summary/agenda year conflicts |
| Socialist Studies | 2 | All 18 media candidates | None |
| REAL/LCS | 0 | Live semantic announcements, dated archive and advertised calendars | Manipulation public ICS returns404; LCS explicitly says next talk TBD |
| LTI Colloquium | 9 | Complete current table | Uncertain speaker metadata is nonblocking, with valid dates/times retained |
| EWO | 0 | All 123 PDF candidates; 122 accessible documents, 6,450 text pages | One advertised PDF returns404 |
| Alumni Online | 4 | Complete public pagination; all four eligible details attempted | Four original details return403 |
| Alumni and Community | 23 | Three public listing pages; all23 originals attempted | 22 originals return403; one currently parses; listing dates remain available |
| CAUSE | 0 | All38 media candidates; portraits and event prose handled separately | None |

## Precision, deletion and interface checks

Cross-source clock enrichment requires the exact canonical URL, title and local day, one unknown-time identity and one unique timed start. Explicit all-day records, multiday ranges and ambiguous same-day occurrences remain separate. [Independent immutable-state evidence](clock-reconciliation-audit.json) confirms three RI RSS date copies now merge with their corresponding WordPress clock records rather than disappearing as real activities. A late full-source check also upgraded two existing CPCB rows without changing their UID/title/URL; [all14 CPCB occurrences are now timed and unique](final-cpcb-clocks.json).

Alumni declares an authoritative inventory only when public pagination/card inspection is complete. It can then remove withdrawn cards transactionally even if optional original details return403; partial inventory discovery still preserves last-good cards. A production-shaped coordinator regression verifies both outcomes and renderer cleanup.

CUA verified the actual published site: SCS shows107, current coverage states zero internal gaps, obsolete earlier reviews are collapsed as historical, LTI's noncritical OCR notice does not enter Needs review, Humanities shows Source limitation rather than a successful empty calendar, and the email panel still lists six channels with its exclusion statement. See [visual capture](final-sources.png), [source accessibility capture](final-sources-ax.txt) and [interface checks](final-ui-checks.json).

The source policy still excludes the711 independent student-club publishers. Publicly syndicated SPS, GMWIP, RedRobot and NOVA events remain; source and event provenance checks show no excluded publisher returning. Validation used isolated stores and fresh Actions runners. The existing local application database was not used for these runs.
