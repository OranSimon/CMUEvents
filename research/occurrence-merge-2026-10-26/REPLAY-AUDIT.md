# Occurrence merge replay review

[Replay evidence](replay-audit.json) evaluates the latest saved `.cache/dedup-review/merged-events.json`, materialized using the new generic occurrence merge mechanism. It is an offline replay of saved raw source state, not a new public-site generation. The evidence records both implementation and replay SHA-256 values.

The replay has 3,470 published records. Across all1,128 merged groups, source-variant checks find **zero** different clocked starts, conflicting known clocked ends, conflicting date-range ends, or date-only source days inconsistent with the canonical occurrence in that source's timezone. This validates the timing boundaries; it is not a claim that every catalog-wide semantic match was manually reviewed.

| Representative case | Baseline cards → replay cards | Required preservation |
| --- | ---: | --- |
| Rolfe Schmidt seminar | 3 → 1 | One October26 start, all baseline source links, three source versions and visible CIC4501/4105 location conflict |
| Grieving Together | 16 → 8 | All8 different weekly starts remain; each date's copies merge |
| Humanities Hang | 16 → 8 | All8 different weekly starts remain; each date's copies merge |
| Spring Carnival | 2 → 1 | Published April15–17 range; both original event URLs survive under the same shared-calendar source ID |
| Preparing to (Vibe) Code | 3 → 1 | Same October26 21:00–22:00Z occurrence; rich, abbreviated and blank descriptions remain source-specific versions |
| Vibe Code Sprint Halloween Party | 2 → 2 | Explicit unequal source ends22:00Z and00:00Z remain separate; no silent duration selection |

Every representative case retains the complete set of baseline `(source ID, source listing URL, source event URL)` claims. Every distinct baseline occurrence start in these cases remains present. The repeated series therefore retain separate dates rather than collapsing into one series card.

Known ambiguous publisher duplicates and title-only coincidences are deliberately outside a universal-deduplication claim. In particular, independent provider IDs with weak/generic evidence do not become proof of one occurrence. Source scope and original source snapshots remain independent of the materialized merge view.
