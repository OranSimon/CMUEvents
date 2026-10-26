/**
 * Identify public records that describe notices or windows rather than occurrences.
 * Published dates are required; absent clocks alone never invalidate an event.
 * @param {Object} event Normalized source or published event.
 * @return {Object} Eligibility and an auditable reason for any exclusion.
 */
export function calendarEligibility(event) {
  const title = String(event.title || '');
  const body = String(event.description || '');
  const duration = Date.parse(event.end) - Date.parse(event.start);
  if (['registration-window', 'date-window'].includes(event.scheduleKind)) {
    return { eligible: false, code: event.scheduleKind, reason: 'The publisher supplies a registration/program window without independently scheduled occurrences.' };
  }
  if (/^\s*HOLD\b/i.test(title) && /do not schedule|reserved (?:time|block)|calendar (?:hold|block)/i.test(body)) {
    return { eligible: false, code: 'administrative-hold', reason: 'The publisher identifies an administrative calendar reservation, not a public activity.' };
  }
  if (/\b(?:welcome center|admission|office|library|campus|building|museum)\b.*\bclosed\b/i.test(title)
    && /closed on|no campus visits|tours are unavailable|opening hours|office hours|no appointments|closed for/i.test(body)) {
    return { eligible: false, code: 'availability-notice', reason: 'The publisher describes venue/office availability rather than an activity session.' };
  }
  if (duration > 2 * 86400000 && /\bmerch(?:andise)?\b/i.test(title)
    && /\b(?:order|sizing|sizes?|pickup|purchase|crewneck|quarter.zip|stickers?|store|RSVP)\b/i.test(`${title} ${body}`)) {
    return { eligible: false, code: 'sales-window', reason: 'This multi-day interval is a merchandise ordering/sales window, not an activity session.' };
  }
  return { eligible: true };
}

/**
 * Apply mutually exclusive browsing views to an already indexed event.
 * Legacy date queries without eventView retain their normal overlap behavior.
 * @param {Object} entry Event and New York startDay/endDay bounds.
 * @param {Object} filters Event view, date range and optional recurrence frequency.
 * @param {Object} context Current New York day and epoch instant.
 * @return {boolean} Whether this occurrence belongs in the selected view.
 */
export function matchesEventView(entry, filters = {}, context = {}) {
  const { event, startDay, endDay } = entry;
  if (!calendarEligibility(event).eligible) return false;
  const view = filters.eventView;
  if (!view) return true;
  if (!['today', 'upcoming', 'recurring', 'ongoing'].includes(view)) throw new Error('Unknown event browsing view');
  const recurring = event.eventType === 'recurring' && Boolean(event.recurrence);
  const today = context.today;
  if (view === 'recurring') return recurring && (!filters.recurrenceFrequency || event.recurrence.frequency === filters.recurrenceFrequency);
  if (recurring) return false;
  const period = event.scheduleKind === 'continuous';
  if (view === 'today') return startDay === today;
  if (view === 'upcoming') return startDay > today && (!filters.from || startDay >= filters.from);
  const now = context.now ?? Date.now();
  const notEnded = event.allDay ? endDay >= today : Date.parse(event.end) > now;
  const shortExplicitRange = !event.scheduleKind || event.scheduleKind === 'occurrence';
  const days = (Date.parse(event.end) - Date.parse(event.start)) / 86400000;
  return startDay < today && notEnded && (period || (shortExplicitRange && days <= 31 && days > 0));
}
