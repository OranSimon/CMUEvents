import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { addDays } from '../lib/normalize.mjs';
import { parseIcs } from './ics.mjs';

/**
 * Reproduce a reviewed publisher-created ICS download without executing scripts.
 * The exact selected generator must still match its reviewed hash. Only its
 * explicit weekly rule is reproduced, starting on the publisher's next weekday.
 * @param {string} html Public page containing the advertised download button.
 * @param {Object} plan Reviewed button, generator fingerprint and event fields.
 * @param {Object} context Current instant and bounded collection window.
 * @return {Object} Normalized publisher calendar or a partial review diagnostic.
 */
export function parseGeneratedCalendar(html, plan, context) {
  const $ = cheerio.load(html);
  const config = plan.options.generatedCalendar;
  const scripts = $('script:not([src])').toArray().map(node => $(node).text());
  const blocks = scripts.map(script => {
    const start = script.indexOf(config.blockStart);
    const end = start < 0 ? -1 : script.indexOf(config.blockEnd, start + config.blockStart.length);
    return start >= 0 && end > start ? script.slice(start, end).trim() : null;
  }).filter(Boolean);
  const fail = reason => ({ events: [], recognized: false, partial: true,
    warnings: [`Publisher calendar needs review: ${reason}`] });
  if ($(config.buttonSelector).length !== 1 || blocks.length !== 1) return fail('advertised download button or generator is missing/ambiguous');
  if (createHash('sha256').update(blocks[0]).digest('hex') !== config.sha256) return fail('the calendar generator changed');
  const fields = config.event;
  if (!Number.isInteger(fields.weekday) || fields.weekday < 0 || fields.weekday > 6
    || !/^\d{6}$/.test(fields.clock) || !/^PT\d+[HM]$/.test(fields.duration)
    || !/^FREQ=WEEKLY;BYDAY=(?:SU|MO|TU|WE|TH|FR|SA)$/.test(fields.rrule)) return fail('invalid reviewed weekly rule');
  if (fields.rrule.split('BYDAY=')[1] !== ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][fields.weekday]) return fail('weekday and recurrence disagree');
  const zone = plan.options.timezone || 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(context.now || Date.now()));
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const date = addDays(today, (fields.weekday - weekday + 7) % 7).replaceAll('-', '');
  const text = value => String(value || '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;').replaceAll('\r', '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    `UID:${fields.uidPrefix}${date}${fields.uidSuffix}`,
    `DTSTART;TZID=${zone}:${date}T${fields.clock}`, `DURATION:${fields.duration}`, `RRULE:${fields.rrule}`,
    `SUMMARY:${text(fields.title)}`, `LOCATION:${text(fields.location)}`, `DESCRIPTION:${text(fields.description)}`,
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return { ...parseIcs(ics, plan, context), recognized: true };
}
