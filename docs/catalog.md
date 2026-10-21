# Source catalog and maintenance

The authoritative catalog was verified on **2026-10-20**. It contains **1,029 public source entries**, with exactly `Department`, `Org` and `link` in the CSV/workbook. One organization may publish a webpage, calendar and newsletter, so entries are not distinct organization counts.

`Department` is the academic or organizational umbrella; student organizations without a verified academic affiliation use the official organization category. `Org` names the publisher or source, with suffixes distinguishing feeds or subscriptions. `link` is a maintained listing, recurring series, calendar, public newsletter archive or subscription endpoint rather than a fixed one-time event detail.

| Original catalog kind | Entries |
| --- | ---: |
| Independent department, center and organization event listings | 159 |
| Official university unit calendars | 73 |
| iCalendar subscriptions | 422 |
| Public organization listings | 364 |
| Public mailing-list subscription pages | 4 |
| Newsletter archives | 5 |
| Event RSS feeds | 2 |
| Total | 1,029 |

The research covered all 73 entries in the official [CMU Calendar Directory](https://events.cmu.edu/directory/), 499 candidate TartanConnect organization pages, 576 advertised Pittsburgh/Qatar subscription links, and independent college, department, center and organization sites. Of the 576 platform feed links, 399 returned complete VCALENDAR bodies at that check. The final catalog also includes separately verified calendar feeds.

At catalog verification, 313 organization pages displayed no upcoming events in anonymous HTML and 122 valid platform ICS feeds contained no VEVENT records. Neither observation implies that the organization has stopped operating. `calendar_event_count` in catalog metadata counts raw records, potentially historical/cancelled; it is not the app's upcoming occurrence count. The runtime plans may find a better advertised endpoint than the original listing while preserving the original URL.

Coverage includes all seven colleges, research centers, libraries, student and staff services, alumni, and public international-campus sources. OIE Friday Greetings, Swartz Weekly Bulletin, The Piper, graduate/postdoctoral newsletters and the supplied HCII, RI, LTI, Swartz, music, drama, Activities Board and RoboClub sources are retained. Some inaccessible, image-only or undated sources remain extraction limitations. Liberty Magic is an external Pittsburgh institution and was not cataloged as a CMU organization.

The catalog is a systematic public-directory investigation, not a claim of permanent exhaustive coverage. New, unlinked, social-only and login-only announcements can be absent. Public readability does not imply that attendance is unrestricted. Historical access failures, login redirects, dead advertised feeds and excluded candidates are recorded in `research/unavailable-sources.json`; old checks should not be treated as current availability guarantees.

## Regenerate research and catalog

The following are original research tools, separate from normal application use. They require Python 3 and use a local HTTP cache. Set `CMUEVENTS_REFRESH=1` to re-fetch rather than reuse cached responses.

```bash
python3 scripts/discover_directories.py
python3 scripts/discover_hubs.py
python3 scripts/discover_centers.py
python3 scripts/discover_org_websites.py
python3 scripts/discover_feeds.py
python3 scripts/discover_additional_subscriptions.py
python3 scripts/build_catalog.py
npm run plan
npm run check
```

`research/manual-sources.tsv` retains curated independent candidates. The discovery JSON files preserve evidence and exclusions. Review proposed catalog changes rather than interpreting an access failure as an organization deletion.

`scripts/build_workbook.mjs` is the original export tool and requires the Codex bundled `@oai/artifact-tool` runtime, which is deliberately not an application dependency. `scripts/add_xlsx_hyperlinks.py` adds native workbook hyperlinks. Existing verified workbook output remains in `outputs/`. Normal `npm ci`, `npm start`, refresh and tests do not depend on that export runtime.
