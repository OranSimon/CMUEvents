# Occurrence merge baseline audit

The public snapshot generated at `2026-10-26T16:50:55.999Z` contains 3,665 records from 318 retained sources. The audit read the published events, sources, status and manifest into `.cache/dedup-review`; no production database, parser, configuration or UI was changed. [Structured evidence](baseline-audit.json) records hashes, selected source fields and the matching criteria.

Grouping by punctuation-normalized title and exact start produces 262 candidate groups and 284 extra rows. These are **candidates, not a verified duplicate count**. An occurrence needs evidence beyond its title. All copying and matching rules must preserve the existing publisher policy: an official calendar's repost of a club-hosted activity remains eligible.

| Case | Published records | Evidence and boundary |
| --- | ---: | --- |
| CyLab Seminar / Rolfe Schmidt, October 26 | 3 | Same named speaker and 16:00Z start. CSD/SCS have matching 17:00Z ends and substantial shared abstract; wrappers differ. CyLab's older placeholder has no useful end and room CIC4501 rather than4105. A merge must retain that field conflict. |
| Grieving Together | 16 across8 starts | Each weekly date has two copies, with identical title/body/venue/clock and equivalent LiveWhale detail-ID routes. Merge within each date, keep all8 weekly occurrences. |
| Humanities Hang | 16 across8 starts | Same route-copy pattern and identical body/venue/clock. The short title currently misses the strict20-character copy rule. Keep all8 dates. |
| Spring Carnival | 2 | Identical April15–17 all-day range, short matching description and no venue. Shared CMU calendar source ID has two distinct original event URLs, both of which must survive merging. |
| AI Fluency Week: Preparing to (Vibe) Code, October26 | 3 | Same 21:00–22:00Z. Two library entries and TartanConnect give a rich description, a shortened shared paragraph and an empty description, with compatible Hunt/IDeATe venue wording. Missing prose alone is not a reason to preserve three cards. |
| AI Fluency Week: Vibe Code Sprint Halloween Party, October30 | 2 | Same 21:00Z start, but explicit ends differ:22:00Z and00:00Z the next day. Do not silently choose one duration. |
| Club Meeting, October26 | 2 | Different CampusGroups IDs, but same OrigamiClub organizer, clock, and substantive description except embedded event-link boilerplate. This is an ambiguous publisher duplicate, not a proven pair of different activities. Generic title alone is insufficient; different provider IDs alone are also insufficient to infer distinctness. |

The existing store already protects different occurrence starts in its keys and has a narrow date-only-to-timed upgrade. It still misses short titles, provider route aliases and copied descriptions with harmless formatting/wrappers. Its source-ID-only provenance union also drops additional event URLs carried by the same shared calendar.

A safe replacement should partition matching by occurrence start, require explicit source identity or multiple independent evidence signals, and keep all unique source/event/listing link claims. Date-only records can enrich only a unique same-local-day session; they must never connect two clocked sessions. Shared feed or calendar-viewer URLs are not unique event identities. Provider IDs require a provider scope. Transitive merges must preserve pairwise safeguards, and field conflicts need source-specific claims rather than first-record or longest-description precedence.

The audit examples are evidence and regression candidates. Their titles, IDs and dates must not become active content allowlists or hardcoded merge decisions.
