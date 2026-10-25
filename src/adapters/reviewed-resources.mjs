import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { plainText } from '../lib/normalize.mjs';

/**
 * Fingerprint reviewed content, including advertised destinations and media.
 * Navigation/footer and volatile scripts can be excluded by the scoped selector.
 * @param {string} html Public page HTML.
 * @param {string} selector Reviewed content scope.
 * @return {Object} Selected element count and stable content digest.
 */
export function resourceFingerprint(html, selector) {
  const $ = cheerio.load(html);
  const nodes = $(selector).toArray();
  let content = nodes.map(node => {
    const root = $(node).clone();
    root.find('script,style,noscript').remove();
    const destinations = root.find('[href],[src],[datetime]').addBack('[href],[src],[datetime]')
      .toArray().map(element => ['href', 'src', 'datetime'].map(name => $(element).attr(name) || '').join('\t'));
    return [plainText($.html(root)), ...destinations].join('\n');
  }).join('\n');
  const structured = $('script[type="application/ld+json"]').toArray().map(node => $(node).text().trim()).filter(Boolean);
  if (structured.length) content += `\nStructured metadata:\n${structured.join('\n')}`;
  return { expectedCount: nodes.length, sha256: createHash('sha256').update(content).digest('hex') };
}

/**
 * Monitor an inspected resource that has no published occurrence schedule.
 * This never establishes that an organization has no events. Changed content
 * needs another review and cannot clear the last successful source snapshot.
 * @param {string} html Current anonymous public document.
 * @param {Object} plan Reviewed source annotations.
 * @return {Object} Recognition, undated-resource state and change diagnostics.
 */
export function parseReviewedResources(html, plan) {
  let recognized = 0;
  let unresolved = false;
  const warnings = [];
  for (const review of plan.options?.reviewedResources || []) {
    const actual = resourceFingerprint(html, review.selector);
    if (!review.reason || !review.kind || !review.expectedCount || !/^[a-f0-9]{64}$/.test(review.sha256)
      || actual.expectedCount !== review.expectedCount || actual.sha256 !== review.sha256) {
      warnings.push(`Reviewed resource changed or is missing; check for a newly published dated schedule (${plan.fetchUrl || plan.url})`);
      continue;
    }
    recognized++;
    unresolved ||= review.requiresReview === true;
    warnings.push(`${review.requiresReview ? 'Unresolved' : 'Monitored'} ${review.kind}: ${review.reason}`);
  }
  const total = plan.options?.reviewedResources?.length || 0;
  const partial = recognized !== total || unresolved;
  return { recognized, warnings, partial, undated: total > 0 && !partial
    && plan.options.reviewedResources.every(review => review.undated !== false) };
}

/**
 * Hash a resource or an explicit reviewed projection of public directory JSON.
 * Only documented transport metadata may be excluded through jsonFields.
 * @param {string} text Public response body.
 * @param {Object} review Optional ordered top-level jsonFields.
 * @return {string} SHA-256 of the monitored content.
 */
export function rawResourceFingerprint(text, review = {}) {
  if (review.jsonFields) {
    const value = JSON.parse(text);
    if (!Array.isArray(review.jsonFields) || !review.jsonFields.length
      || review.jsonFields.some(field => typeof field !== 'string' || !Object.hasOwn(value, field))) {
      throw new Error('Reviewed directory fields are missing.');
    }
    text = JSON.stringify(review.jsonFields.map(field => [field, value[field]]));
  }
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Monitor a publisher's linked discovery data without inventing occurrences.
 * This covers public JSON directories whose static HTML shell does not change.
 * @param {Object} plan Reviewed public data endpoint and raw-content digest.
 * @param {Object} context Shared anonymous fetch callback.
 * @return {Promise<Object>} Explicit resource state or a change-review diagnostic.
 */
export async function fetchReviewedRawResource(plan, context) {
  const review = plan.options?.reviewedRawResource;
  const text = await context.fetchText(plan.fetchUrl || plan.url);
  let unchanged = false;
  try {
    unchanged = review?.reason && review?.kind && /^[a-f0-9]{64}$/.test(review?.sha256)
      && rawResourceFingerprint(text, review) === review.sha256;
  } catch { /* A changed JSON schema requires a new review. */ }
  return { events: [], ...(unchanged ? { undated: true } : { partial: true }), warnings: [unchanged
    ? `Monitored ${review.kind}: ${review.reason}`
    : 'Public directory data changed; inspect new calendar links and dated announcements before accepting a new resource snapshot.'] };
}
