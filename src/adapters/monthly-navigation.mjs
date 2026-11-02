import * as cheerio from 'cheerio';
import { absoluteUrl } from '../lib/normalize.mjs';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Read a printed month heading without borrowing the clock or URL's year.
 * @param {string} text Publisher's month and year label.
 * @return {number|null} Absolute month index, or null for another structure.
 */
function monthIndex(text) {
  const match = text.trim().toLowerCase().match(/^([a-z]+)\s+(20\d{2})$/);
  const month = MONTHS.indexOf(match?.[1]);
  return match && month >= 0 ? +match[2] * 12 + month : null;
}

/**
 * Inspect month navigation structurally and follow only advertised months in scope.
 * Unexpected content stays a parser gap, even if another card was recognized.
 * Navigation alone establishes an undated resource, never organization-wide zero.
 * @param {string} html Current publisher document.
 * @param {Object} plan Selectors and optional ancillary resource link identities.
 * @param {Object} context Rolling collection window.
 * @return {Object} Navigation candidates and auditable recognition diagnostics.
 */
export function inspectMonthlyNavigation(html, plan, context = {}) {
  const config = plan.options.monthlyNavigation;
  const $ = cheerio.load(html);
  const scopes = $(config.selector);
  const base = plan.fetchUrl || plan.url;
  const issues = [];
  const links = new Set();
  const headings = scopes.find(config.monthSelector);
  const month = headings.length === 1 ? monthIndex(headings.text()) : null;
  const navigation = scopes.find(config.navigationSelector);
  if (!scopes.length || month === null || navigation.length !== 1 || !navigation.find('a[href]').length) {
    issues.push(`Monthly calendar structure is missing or ambiguous (${base})`);
  } else {
    const boundary = value => value ? +value.slice(0, 4) * 12 + +value.slice(5, 7) - 1 : null;
    const start = boundary(context.windowStart);
    const end = boundary(context.windowEnd);
    navigation.find('a[href]').each((_, element) => {
      if (config.terminalSelector && config.terminalPattern && $(element).is(config.terminalSelector)
        && new RegExp(config.terminalPattern, 'i').test($(element).text().trim())
        && /^#?$/.test($(element).attr('href'))) return;
      const target = monthIndex($(element).text());
      const url = absoluteUrl($(element).attr('href'), base);
      if (target === null || Math.abs(target - month) !== 1 || !url || new URL(url).origin !== new URL(base).origin) {
        issues.push(`Unrecognized advertised monthly navigation (${base})`); return;
      }
      if ((start === null || target >= start) && (end === null || target <= end)) links.add(url);
    });
    const remaining = scopes.clone();
    remaining.find(config.monthSelector).remove();
    remaining.find(config.navigationSelector).remove();
    if (config.headingSelector) {
      if (remaining.find(config.headingSelector).length !== 1) issues.push(`Monthly calendar heading inventory changed (${base})`);
      else remaining.find(config.headingSelector).remove();
    }
    const allowed = new Set(config.ancillaryLinks || []);
    remaining.find('a[href]').each((_, element) => {
      if (allowed.has(absoluteUrl($(element).attr('href'), base))) $(element).remove();
    });
    if (remaining.text().trim() || remaining.find('a[href],img,iframe,object,embed,video,audio,time,script,template').length) {
      issues.push(`Monthly calendar contains content beyond recognized navigation; inspect current event structure (${base})`);
    }
  }
  return { recognized: !issues.length, partial: Boolean(issues.length), undated: !issues.length,
    paginationLinks: [...links], warnings: issues.length ? issues : [`Monitored monthly navigation without published occurrence records (${base})`],
    coverage: { version: 1, kind: 'monthly-navigation', inspectionComplete: !issues.length,
      internalIssues: issues, externalIssues: [], nonBlockingIssues: [],
      assets: [{ url: base, classification: issues.length ? 'unresolved-calendar-content' : 'navigation-only',
        monthLabel: headings.text().trim(), advertisedMonthsInWindow: [...links] }] } };
}
