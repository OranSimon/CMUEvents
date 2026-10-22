import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'data/event_sources.json'), 'utf8'));
const overrides = JSON.parse(await readFile(path.join(root, 'config/source-overrides.json'), 'utf8')).sources;

/**
 * Return the stable identity of a catalog URL.
 * @param {string} url Original source URL.
 * @return {string} Deterministic source identifier.
 */
export function sourceId(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
}

/**
 * Normalize only presentation suffixes when matching a page to its public feed.
 * @param {string} name Catalog organization label.
 * @return {string} Case-insensitive organization name without source suffixes.
 */
export function organizationKey(name) {
  return name.replace(/\s+[—–]\s+(?:iCalendar|subscription|RSS|TartanConnect events|CMU calendar)$/i, '')
    .normalize('NFKC').toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Select an equivalent verified feed, without collapsing distinct calendar scopes.
 * @param {object} source Original catalog record.
 * @return {object|undefined} Preferred feed for this exact source or organization.
 */
function preferredFeed(source) {
  const feeds = catalog.filter((entry) => entry.source_kind === 'ical_feed');
  const direct = feeds.filter((entry) => entry.discovered_on === source.link);
  if (direct.length === 1) return direct[0];
  // Multiple linked feeds can have distinct scopes. Their HTML parent remains active.
  if (direct.length > 1) return undefined;
  const matches = feeds.filter((entry) => organizationKey(entry.Org) === organizationKey(source.Org));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Build one explicit extraction contract for a source in the public catalog.
 * @param {object} source Original catalog record, including research evidence.
 * @return {object} Adapter selection, health baseline, scheduling and provenance.
 */
function planSource(source) {
  const plan = {
    id: sourceId(source.link),
    department: source.Department,
    org: source.Org.replace(/\s+[—–]\s+(?:iCalendar|subscription|RSS|TartanConnect events|CMU calendar)$/i, ''),
    url: source.link,
    kind: source.source_kind,
    adapter: 'html',
    fetchUrl: source.link,
    status: 'active',
    canonicalSourceId: null,
    refreshHours: 6,
    options: { timezone: source.link.includes('qatar.cmu.edu') ? 'Asia/Qatar' : 'America/New_York' },
    strategy: '',
    reason: '',
    evidence: {
      checkedAt: source.checked_at,
      httpStatus: source.http_status,
      anonymousAccessVerified: source.anonymous_access_verified,
      ...(source.calendar_event_count !== undefined ? { eventCount: source.calendar_event_count } : {}),
    },
  };

  if (source.source_kind === 'ical_feed') {
    plan.adapter = source.link === 'https://www.cs.cmu.edu/calendar/export.ics' ? 'trumba' : 'ics';
    plan.strategy = 'Fetch the public iCalendar feed; unfold RFC 5545 fields, expand bounded recurrences, preserve UID, cancellation, local timezone and source URL.';
    if (source.calendar_event_count === 0) {
      plan.status = 'empty';
      plan.refreshHours = 12;
      plan.reason = 'The verified calendar was valid but contained no VEVENT records; continue refreshing it.';
    }
  } else if (source.source_kind === 'rss_feed') {
    plan.adapter = 'rss';
    plan.strategy = 'Parse the public event RSS XML and event-specific date fields; follow detail links if event dates or content are missing. Never use publication dates as event dates.';
    plan.options.detailLinks = true;
    plan.options.maxDetails = 12;
  } else if (source.source_kind === 'organization_listing') {
    plan.adapter = 'campusgroups';
    plan.strategy = 'Parse anonymously rendered CampusGroups event cards; use their RSVP event URL as identity and obtain the exact date/year from the public event detail when necessary.';
    plan.options = { ...plan.options, detailLinks: true, maxDetails: 12 };
    if (source.note.includes('currently displays no upcoming events')) {
      plan.status = 'empty';
      plan.refreshHours = 12;
      plan.reason = 'The anonymous organization page showed no upcoming events at verification; retain and refresh it.';
    }
  } else if (source.source_kind === 'mailing_list') {
    plan.adapter = 'manual';
    plan.status = 'subscription_only';
    plan.refreshHours = 168;
    plan.strategy = 'Keep the public subscription page discoverable. Do not subscribe, collect private mail, or interpret its subscription metadata as event content.';
    plan.reason = 'This URL offers mailing-list subscription, not a verified anonymous event archive.';
  }

  const override = overrides[source.link];
  if (override) {
    Object.assign(plan, override);
    plan.options = { timezone: 'America/New_York', ...override.options };
    plan.evidence = { anonymousAccessVerified: source.anonymous_access_verified, ...override.evidence };
  }

  if (source.source_kind === 'newsletter_archive') plan.refreshHours = 24;

  // Prefer a verified machine-readable equivalent over fetching its HTML wrapper.
  if (['event_listing', 'organization_listing', 'rss_feed'].includes(source.source_kind)
      && plan.options.preferFeed !== false) {
    const feed = preferredFeed(source);
    if (feed) {
      plan.status = 'covered';
      plan.canonicalSourceId = sourceId(feed.link);
      plan.reason = 'An equivalent public iCalendar source is fetched once; this source retains its department and organization attribution.';
      plan.strategy = `Reuse the verified ${feed.link} feed and merge this source into event provenance.`;
    }
  }

  if (!plan.strategy) throw new Error(`No strategy for ${source.link}`);
  return plan;
}

const plans = catalog.map(planSource);
// Identical embedded calendars should be fetched once even when their wrapper
// pages have different labels. Preserve each label as canonical provenance.
const upstreams = new Map();
for (const plan of [...plans].sort((left, right) =>
  Number(right.kind === 'ical_feed' || right.kind === 'university_calendar')
  - Number(left.kind === 'ical_feed' || left.kind === 'university_calendar'))) {
  if (!['active', 'empty'].includes(plan.status)) continue;
  const key = JSON.stringify([plan.adapter, plan.fetchUrl,
    [...(plan.options.additionalFetchUrls || [])].sort(), plan.options.additionalEndpoints || []]);
  const canonical = upstreams.get(key);
  if (canonical) {
    plan.status = 'covered';
    plan.canonicalSourceId = canonical.id;
    plan.reason = 'This page advertises exactly the same public upstream calendar as the canonical source; preserve both source associations and fetch it once.';
    plan.strategy = `Reuse the verified ${canonical.fetchUrl} endpoint and merge this source into event provenance.`;
  } else {
    upstreams.set(key, plan);
  }
}
const ids = new Set(plans.map((plan) => plan.id));
if (ids.size !== catalog.length) throw new Error('Source identifiers or catalog URLs are duplicated.');
for (const plan of plans) {
  if (plan.canonicalSourceId && !ids.has(plan.canonicalSourceId)) {
    throw new Error(`Missing canonical source for ${plan.url}`);
  }
}

/**
 * Count extraction contracts by a named field.
 * @param {string} field Plan field to summarize.
 * @return {object} Counts for each distinct value.
 */
function counts(field) {
  return Object.fromEntries([...new Set(plans.map((plan) => plan[field]))].sort()
    .map((value) => [value, plans.filter((plan) => plan[field] === value).length]));
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  catalogCount: catalog.length,
  statusDefinitions: {
    active: 'An implemented adapter is scheduled for automatic extraction.',
    covered: 'An equivalent canonical feed supplies events while preserving this source attribution.',
    empty: 'The last inspected source contained no events; automatic refresh remains enabled.',
    subscription_only: 'Public subscription metadata is available, but no anonymous event archive was verified.',
    blocked: 'Anonymous access failed; retain the reason and retry without bypassing access controls.',
    unsupported: 'The public source requires a verified extractor not currently implemented.',
  },
  summary: { adapters: counts('adapter'), statuses: counts('status') },
  plans,
};
await writeFile(path.join(root, 'config/source-plans.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`Planned ${plans.length} catalog sources: ${JSON.stringify(result.summary)}`);
