const KINDS = new Set(['subscriber_only', 'public_plus_email']);
const ACCESS_FIELDS = ['emailConfirmation', 'moderatorApproval', 'andrewOnly', 'loginRequired', 'captcha'];

/**
 * Compile reviewed email-channel metadata without inferring access from names.
 * Access flags describe subscription steps; null means the step is unverified.
 * No source or event is excluded, and public calendar coverage is preserved.
 * @param {Object} registry Explicit source-subscriptions.json content.
 * @return {Object} Pure lookup, attachment and retained-source listing helpers.
 */
export function createSourceSubscriptions(registry = { subscriptions: [] }) {
  if (!Array.isArray(registry.subscriptions)) throw new Error('Subscription registry requires a subscriptions array');
  const byId = new Map();
  for (const row of registry.subscriptions) {
    if (typeof row.sourceId !== 'string' || !row.sourceId.trim() || byId.has(row.sourceId)) {
      throw new Error('Subscription source IDs must be nonblank and unique');
    }
    let url;
    try { url = new URL(row.url); } catch { throw new Error(`Invalid subscription URL for ${row.sourceId}`); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`Invalid public subscription URL for ${row.sourceId}`);
    if (!KINDS.has(row.kind) || ['title', 'reason', 'nextStep'].some(field => typeof row[field] !== 'string' || !row[field].trim())
      || !Array.isArray(row.requirements) || row.requirements.some(item => typeof item !== 'string' || !item.trim())
      || row.emailEventsIngested !== false || typeof row.publicCalendarIncluded !== 'boolean'
      || row.publicCalendarIncluded !== (row.kind === 'public_plus_email')
      || !row.access || ACCESS_FIELDS.some(field => row.access[field] !== null && typeof row.access[field] !== 'boolean')) {
      throw new Error(`Invalid reviewed subscription metadata for ${row.sourceId}`);
    }
    byId.set(row.sourceId, structuredClone({
      kind: row.kind, title: row.title, url: url.href, reason: row.reason, nextStep: row.nextStep,
      requirements: row.requirements, access: Object.fromEntries(ACCESS_FIELDS.map(field => [field, row.access[field]])),
      emailEventsIngested: false, publicCalendarIncluded: row.publicCalendarIncluded,
    }));
  }

  /**
   * Return a detached metadata copy for an explicitly reviewed source ID.
   * @param {string} id Exact retained source ID.
   * @return {Object|null} Reviewed metadata, or null without a registry entry.
   */
  function forSource(id) { return byId.has(id) ? structuredClone(byId.get(id)) : null; }

  /**
   * Attach curated subscription details without changing source health or data.
   * Existing unreviewed subscription fields are discarded rather than trusted.
   * @param {Object} source Source descriptor with an exact id.
   * @return {Object} Detached descriptor with subscription only when reviewed.
   */
  function attach(source) {
    const { subscription: ignored, ...base } = source;
    const subscription = forSource(source.id);
    return subscription ? { ...base, subscription } : base;
  }

  /**
   * List reviewed email channels only within the supplied retained directory.
   * @param {Array<Object>} sources All current retained source descriptors.
   * @return {Array<Object>} Descriptors with their subscription metadata.
   */
  function list(sources) { return sources.map(attach).filter(source => source.subscription); }

  return { forSource, attach, list };
}
