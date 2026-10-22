import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, plainText } from '../lib/normalize.mjs';

/**
 * Accept a reviewed announcement only while its selected public text is intact.
 * This supports a bounded human resolution of relative-date announcements;
 * changed text remains a review item rather than being silently reinterpreted.
 * @param {string} html Anonymous public announcement HTML.
 * @param {Object} plan Source options containing reviewedFragments.
 * @param {Object} context Collection window.
 * @return {Object} Accepted events and review diagnostics.
 */
export function parseReviewedFragments(html, plan, context) {
  const $ = cheerio.load(html);
  const events = [];
  const warnings = [];
  let recognized = 0;
  for (const annotation of plan.options.reviewedFragments || []) {
    const nodes = $(annotation.selector).toArray();
    const text = nodes.map(node => plainText($.html(node))).join('\n');
    if (nodes.length !== annotation.expectedCount || createHash('sha256').update(text).digest('hex') !== annotation.sha256) {
      warnings.push('Public announcement text changed or is missing; another visual date review is required');
      continue;
    }
    recognized++;
    for (const input of annotation.events || []) {
      const event = normalizeEvent(input, plan);
      if (!event) warnings.push('A reviewed announcement has invalid event fields');
      else if (inWindow(event, context)) events.push(event);
    }
  }
  return { events, warnings, recognized, partial: warnings.length > 0 };
}

/**
 * Publish visually reviewed poster fields only while the advertised bytes match.
 * A changed or missing poster needs another review; old source events are retained
 * by the refresher's partial-snapshot path instead of silently erased.
 * @param {string} html Public source page advertising the image.
 * @param {Object} plan Reviewed selectors and SHA-256-bound annotations.
 * @param {Object} context Safe binary fetch callback and date window.
 * @return {Promise<Object>} Accepted events and explicit review diagnostics.
 */
export async function fetchReviewedImages(html, plan, context) {
  const $ = cheerio.load(html);
  const events = [];
  const warnings = [];
  let recognized = 0;
  let partial = false;
  for (const annotation of plan.options.reviewedImages) {
    const matches = $(annotation.selector);
    if (matches.length !== 1) {
      partial = true;
      warnings.push(`Poster needs visual review: expected one image for ${annotation.selector}, found ${matches.length}`);
      continue;
    }
    const url = absoluteUrl(matches.attr('src'), plan.fetchUrl || plan.url);
    try {
      if (!url || !/^[a-f0-9]{64}$/.test(annotation.sha256)) throw new Error('Missing public image URL or reviewed SHA-256');
      const bytes = await context.fetchBytes(url);
      if (createHash('sha256').update(bytes).digest('hex') !== annotation.sha256) {
        partial = true;
        warnings.push(`Poster changed; visual review required before publishing updated fields (${url})`);
        continue;
      }
      recognized++;
      for (const input of annotation.events || []) {
        const event = normalizeEvent({ ...input, url: input.url || plan.url }, plan);
        if (!event) { partial = true; warnings.push(`Invalid reviewed poster event (${url})`); }
        else if (inWindow(event, context)) events.push(event);
      }
    } catch (error) { partial = true; warnings.push(`Poster could not be verified (${url}): ${error.message}`); }
  }
  return { events, warnings, recognized, partial };
}
