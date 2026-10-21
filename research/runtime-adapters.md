# Runtime source adapter research

Inspected on October 20, 2026. `config/source-plans.json` assigns an extraction
contract to every row in `data/event_sources.json`. The plan is generated from
the catalog and the inspected exceptions in `config/source-overrides.json`.
Neither the number of planned sources nor a successful HTTP response proves
that all events on a source have been extracted. Runtime health and parsing
warnings are the authority for the current refresh.

| Family | Public contract and reuse | Important boundary |
| --- | --- | --- |
| iCalendar | Fetch the advertised `.ics`, `?ical=1`, Google public export, or PrestoSports `?print=ical`; use the common RFC 5545 parser. | Valid empty calendars must be refreshed. Feed counts include historical and cancelled events. Preserve calendar timezone, recurrence exceptions, UID and original URL. |
| CampusGroups | Prefer an equivalent organization-specific public ICS feed. Otherwise parse anonymous TartanConnect event cards and public RSVP details. | Do not interpret an empty organization page as an inactive organization. Do not log in or request private calendars. |
| LiveWhale unit calendar | Read the exact `livewhale.group_title` configured in the public calendar page. Query `/live/json/events/group/{encoded title}/response_fields/{fields}` and follow `links.next`. | The seemingly plausible `group_id` parameter is silently ignored. Unit names must be taken from public configuration, not guessed. |
| LiveWhale embedded widget | Read each `.lwcw` `data-options` widget ID and fetch `/live/widget/{id}/response_fields/{fields}@JSON`. | The widget can enforce series, group and tag constraints. Keep its scope rather than replacing it with the whole university calendar. Multiple widget IDs are additional fetch URLs on one plan. |
| LiveWhale iframe | Resolve an `events.cmu.edu/{unit}/...` iframe to the matching unit plan; preserve `/tags/{tag}` as the API tag filter. | A footer link to the main events calendar does not make the surrounding page an equivalent source. |
| SCS / Trumba | The official SCS calendar advertises `/calendar/export.ics` and `/calendar/feed/rss.xml`; prefer ICS. | The ICS producer is Trumba. Preserve its organization custom fields and source URLs. Publication timestamps in RSS are not event start times. |
| WordPress The Events Calendar | The public `/wp-json/tribe/events/v1/events` API supplies event dates, descriptions, venues, categories and `next_rest_url`. | Category IDs were verified using the categories endpoint: School of Art Exhibitions is `33`, Lectures is `34`. Qatar's REST endpoint returned 403, so its already verified ICS remains preferable. |
| Static / Drupal HTML | Prefer Event JSON-LD, microdata and semantic time values. Inspected selectors cover HCII rows, architecture cards, STUDIO thumbnails, CMU CMS event grids, Eberly items, seminar tables, SEI cards and LibCal cards. | Do not use article publication dates, generic footer years or undated archive titles as event dates. List dates and times may be less precise than the event detail page. |
| Slate admissions | Read the public page's `data-service` calendar endpoint, append `cmd=event_list`, and parse `.event[data-date]` HTML. | INI, undergraduate admission, MBA and MSCF all expose this same public contract. The initial page can contain no events while its advertised public endpoint has events. Local datetimes use the source timezone. |
| Tepper Seminar Tracker | The public `/Seminars?handler=Read` JSON response has `Data`, `Total`, event IDs, ISO datetimes, titles, abstracts and venues. | Whitelist event fields. Do not store incidental person, coordinator, travel or meeting-schedule objects returned by the upstream API. |
| Newsletter archives | Discover recent issue links, fetch each public HTML/PDF issue, and parse individually dated event sections. | OIE links relative PDF files. Swartz links public Emma HTML; graduate and postdoc issues use academic-year directories; Piper links public CMU newsletter views. The issue's publication day must never become an event's date. An explicitly stated issue year may resolve a missing year, with a diagnostic. |
| Mailing-list subscription | Preserve the public subscription URL as a source link. | A subscription form is not an anonymous event archive. No automatic subscription or private email ingestion is performed. |

## Representative verified endpoints

- Main LiveWhale JSON:
  `https://events.cmu.edu/live/json/events/response_fields/location,tags,summary,description,group_title,status`
- Scoped LiveWhale JSON:
  `https://events.cmu.edu/live/json/events/group/School%20of%20Music/response_fields/location,tags,summary,description,group_title,status`
- Embedded engineering widget:
  `https://events.cmu.edu/live/widget/614/response_fields/location,tags,summary,description,group_title,status@JSON`
- SCS calendar: `https://www.cs.cmu.edu/calendar/export.ics`
- Robotics Institute JSON:
  `https://www.ri.cmu.edu/wp-json/tribe/events/v1/events?per_page=2`
- School of Drama JSON:
  `https://drama.cmu.edu/wp-json/tribe/events/v1/events?per_page=1`
- Athletics ICS: `https://athletics.cmu.edu/composite?print=ical`
- Tepper seminar JSON:
  `https://seminartracker.tepper.cmu.edu/Seminars?handler=Read&pageSize=100&sortBy=Date&clientTimeZone=America%2FNew_York&viewType=1`
- OIE current archive:
  `https://www.cmu.edu/oie/community-connections/friday-email/index.html`

Google's newer embed URLs can base64-encode their `src` or `cid` calendar IDs.
Decoding the IDs explicitly advertised in the page yielded valid public exports
for RoboClub, Osher, ScottyLabs, CBDR, ICSD, STAMPS and ColorStack. These are
configured as feed endpoints on their existing catalog rows. The advertised
REAL and Steinbrenner Google export URLs returned 404; no event data is inferred
from that failure.

## Verification and remaining limits

The source plan generator checks that every catalog row has one stable source
ID, a nonempty strategy and a valid canonical reference. Exact matching feeds
and embedded endpoints are fetched once while all wrapper affiliations remain
attached to their events. Distinct calendar scopes are kept separate.

A cached-page parser audit after configuring the initial selectors found dated
records on 22 of 73 direct HTML pages, totaling 398 historical and future records
before the runtime date window. This audit checks parser compatibility with the
inspected HTML snapshot; it does not prove freshness, detail-page completeness,
pagination completeness, or extraction success on the other HTML pages. Some
sources expose only an empty upcoming list, an undated archive, a linked PDF,
or a changed layout. Runtime diagnostics must distinguish these cases rather
than report an HTTP 200 page as successfully covered.

The EWO seminar page currently lists slide downloads without event dates, so it
has an explicit unsupported plan. Mailing-list subscription pages are explicitly
subscription-only. Preserve source links and diagnostics for sources that cannot
currently yield reliable event records.
