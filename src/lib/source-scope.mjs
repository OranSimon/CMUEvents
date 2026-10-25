const compiledScopes = new WeakMap();

/**
 * Convert explicit source identity rules into trimmed string values.
 * @param {unknown} value Scalar or array of configured source identities.
 * @return {string[]} Nonempty source identity values.
 */
function strings(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .filter(item => typeof item === 'string' || typeof item === 'number')
    .map(item => String(item).trim()).filter(Boolean);
}

/**
 * Recognize shared CampusGroups hosts for conservative source-URL validation.
 * @param {string} hostname Parsed public source hostname.
 * @return {boolean} Whether the hostname belongs to the shared provider.
 */
function campusGroupsHost(hostname) {
  return ['tartanconnect.cmu.edu', 'scottyconnect.qatar.cmu.edu'].includes(hostname)
    || /(?:^|\.)campusgroups\.com$/i.test(hostname);
}

/**
 * Canonicalize a public source URL without losing its calendar or group identity.
 * @param {unknown} value Configured source URL.
 * @return {URL|null} Parsed HTTP(S) URL without fragment/tracking parameters.
 */
function publicUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url;
  } catch { return null; }
}

/**
 * Reject source rules that accidentally identify an entire shared portal.
 * Group/calendar identity in a URL is a source identity, never an event filter.
 * @param {URL} url Parsed exclusion rule.
 * @return {boolean} Whether the URL identifies a sufficiently specific source.
 */
function specificSourceUrl(url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const host = url.hostname;
  if (campusGroupsHost(host)) {
    if (/^\/ical(?:\/|$)/i.test(path)) return /\/ical_club_[1-9]\d*\.ics$/i.test(path)
      || [...url.searchParams].some(([key, value]) => /^club_?id$/i.test(key) && /^[1-9]\d*$/.test(value));
    if (/^\/(?:rsvp|rsvp_boot|club_signup|club_about|mobile_ws|events)(?:\/|$)/i.test(path) || path === '/') return [...url.searchParams]
      .some(([key, value]) => /^(?:id|r|club_?id|group_?ids?|filter2)$/i.test(key) && value && value !== '0');
  }
  if (/^(?:calendar|www)\.google\.com$/i.test(host)) {
    return /^\/calendar\/ical\/[^/]+\/(?:public|private)(?:\/|$)/i.test(path)
      || (/^\/calendar(?:\/|$)/i.test(path) && [...url.searchParams].some(([key, value]) => /^(?:src|cid|eid)$/i.test(key) && value));
  }
  if (host === 'events.cmu.edu' && /^\/live\/(?:json|ical|widget)/i.test(path)) {
    return /\/group\/[^/]+/i.test(path) || /\/widget\/[1-9]\d*(?:\/|@|$)/i.test(path);
  }
  if (/^\/wp-json\/(?:tribe\/events\/v\d+\/events|wp\/v\d+\/(?:events|posts))\/?$/i.test(path)) {
    return [...url.searchParams].some(([key, value]) => /^(?:categories|category|slug)$/i.test(key) && value);
  }
  if (/(?:^|\.)cmu\.edu$/i.test(host) && /^\/(?:all|events?|calendar)(?:\/)?$/i.test(path)) return false;
  return !(path === '/' && ['cmu.edu', 'www.cmu.edu', 'events.cmu.edu'].includes(host));
}

/**
 * Match an exact source path or bounded descendants with the same query identity.
 * @param {URL} candidate Registry display or fetch URL.
 * @param {URL} rule Explicit blocked source URL.
 * @return {boolean} Whether the candidate identifies the blocked source.
 */
function sourceUrlMatches(candidate, rule) {
  if (candidate.origin !== rule.origin) return false;
  const path = rule.pathname.replace(/\/+$/, '') || '/';
  const value = candidate.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' && value !== path && !value.startsWith(`${path}/`)) return false;
  for (const key of new Set(rule.searchParams.keys())) {
    const expected = rule.searchParams.getAll(key).sort();
    const actual = candidate.searchParams.getAll(key).sort();
    if (expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) return false;
  }
  return true;
}

/**
 * Compile registry-only exclusions without reading configuration or audit files.
 * Only blockedSourceIds and blockedSourceUrls are used. Event organizers, tags,
 * titles, descriptions, UIDs and event URLs have no role in source eligibility.
 * @param {Object} config Explicit blocked source IDs and source URLs.
 * @return {Object} Immutable policy handle with ignored-rule diagnostics.
 */
export function createSourceScope(config = {}) {
  const warnings = [];
  const sourceUrlsByOrigin = new Map();
  for (const value of [...new Set(strings(config.blockedSourceUrls))]) {
    const url = publicUrl(value);
    if (!url || !specificSourceUrl(url)) {
      warnings.push(`Ignored non-specific or invalid blocked source URL: ${value}`);
      continue;
    }
    if (!sourceUrlsByOrigin.has(url.origin)) sourceUrlsByOrigin.set(url.origin, []);
    sourceUrlsByOrigin.get(url.origin).push({ url, value });
  }
  const scope = Object.freeze({ warnings: Object.freeze(warnings) });
  compiledScopes.set(scope, { sourceUrlsByOrigin, sourceIds: new Set(strings(config.blockedSourceIds)) });
  return scope;
}

/**
 * Explain whether one source registry plan is excluded by explicit source rules.
 * Evaluate the originating source plan, never an event or its syndicated links.
 * @param {Object} plan Registry plan with id, url and optional fetchUrl.
 * @param {Object} scope Compiled scope handle or registry-only policy config.
 * @return {{allowed:boolean,reasons:Object[]}} Source eligibility and matched rules.
 */
export function evaluateSourceScope(plan = {}, scope = {}) {
  const prepared = compiledScopes.has(scope) ? scope : createSourceScope(scope);
  const policy = compiledScopes.get(prepared);
  const reasons = [];
  if (policy.sourceIds.has(String(plan.id))) reasons.push({ code: 'blocked_source_id', field: 'plan.id',
    value: plan.id, matched: String(plan.id) });
  for (const [field, value] of [['plan.url', plan.url], ['plan.fetchUrl', plan.fetchUrl]]) {
    const url = publicUrl(value);
    if (!url) continue;
    for (const rule of policy.sourceUrlsByOrigin.get(url.origin) || []) {
      if (sourceUrlMatches(url, rule.url)) reasons.push({ code: 'blocked_source_url', field, value, matched: rule.value });
    }
  }
  return { allowed: reasons.length === 0, reasons };
}

/**
 * Test registry membership without inspecting or filtering any source events.
 * @param {Object} plan Registry source plan.
 * @param {Object} scope Compiled policy handle or registry-only configuration.
 * @return {boolean} Whether this source is eligible for ingestion.
 */
export function sourceAllowed(plan, scope = {}) {
  return evaluateSourceScope(plan, scope).allowed;
}
