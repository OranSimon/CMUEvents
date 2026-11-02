export const EVENT_VIEWS = Object.freeze(['today', 'ongoing', 'day']);

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
  const deadlineTitle = /\b(?:applications?|proposals?|submissions?|abstracts?|nominations?)\s+(?:are\s+)?due(?:\s+(?:on|by|at)\b.*)?\s*$/i.test(title)
    || /\bdeadlines?(?:\s*$|\s*[:;]|\s+(?:to|for|on|at|is)\b)/i.test(title);
  const actionDeadline = /\b(?:application|proposal|submission|abstract|registration|nomination|RSVP)\s+deadlines?\b/i.test(title);
  const sessionTitle = /\b(?:workshop|clinic|seminar|webinar|information session|info session|office hours|panel|talk|performance|concert)(?:\s*[:–—-].*)?$/i.test(title);
  const deadlineInstructions = /\b(?:applications?|proposals?|submissions?|abstracts?|nominations?)\s+(?:are\s+)?due\b|\b(?:apply|register|submit|RSVP)\s+by\b|\blast day\b|\bdeadline\b|\b(?:register|submission|team members|application)[\s\S]{0,160}\bby\s+(?:\w+\s+)?\d/i.test(body);
  const sessionInstructions = /\b(?:join us|attend (?:a|the|this)|workshop|information session|panel discussion|concert|performance|seminar)\b/i.test(body);
  if (deadlineTitle && !sessionTitle && (actionDeadline || (deadlineInstructions && !sessionInstructions))) {
    return { eligible: false, code: actionDeadline ? 'application-deadline' : 'administrative-deadline',
      reason: 'The published title and instructions identify a submission, registration or administrative deadline rather than an activity session.' };
  }
  if (/^\s*HOLD\b/i.test(title) && /do not schedule|reserved (?:time|block)|calendar (?:hold|block)/i.test(body)) {
    return { eligible: false, code: 'administrative-hold', reason: 'The publisher identifies an administrative calendar reservation, not a public activity.' };
  }
  if (/\b(?:welcome center|admission|office|library|campus|building|museum)\b.*\bclosed\b/i.test(title)
    && /closed on|no campus visits|tours are unavailable|opening hours|office hours|no appointments|closed for/i.test(body)) {
    return { eligible: false, code: 'availability-notice', reason: 'The publisher describes venue/office availability rather than an activity session.' };
  }
  const merchandise = /\bmerch(?:andise)?\b/i.test(title)
    || (/\b(?:t[ -]?shirts?|hoodies?|crewnecks?|apparel|jackets?|quarter.zip|stickers?)\b/i.test(title)
      && /\b(?:reserve|choose|select)\s+(?:your\s+)?size|\bsizing\b|\bquantities\b/i.test(body)
      && /\b(?:claim|order|purchase|pickup|pick up)\b/i.test(body));
  if (duration > 2 * 86400000 && merchandise
    && /\b(?:order|sizing|sizes?|pickup|pick up|purchase|crewneck|quarter.zip|stickers?|store|RSVP)\b/i.test(`${title} ${body}`)) {
    return { eligible: false, code: 'sales-window', reason: 'This multi-day interval is a merchandise ordering/sales window, not an activity session.' };
  }
  return { eligible: true };
}

/** Flag a short publisher description that contradicts its explicit all-day feed. */
export function hasPublishedTimeConflict(event) {
  const description = String(event.description || '').replace(/https?:\/\/\S+/gi, '').trim();
  return event.timePrecision === 'all-day' && description.length <= 240
    && /\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?(?!\w)/i.test(description);
}

/**
 * Add a recurrence tag only when the publisher supplies an identified series.
 * @param {Object} event Normalized event with optional published recurrence.
 * @return {string[]} Distinct discovery tags without mutating the source record.
 */
export function discoveryTags(event) {
  const tags = Array.isArray(event.tags) ? event.tags : [];
  return [...new Set([...tags, ...(event.eventType === 'recurring' && event.recurrence?.seriesId ? ['Recurring'] : [])])];
}

/**
 * Apply date-based browsing views to an already indexed event.
 * Legacy date queries without eventView retain their normal overlap behavior.
 * @param {Object} entry Event and New York startDay/endDay bounds.
 * @param {Object} filters Event view and date range.
 * @param {Object} context Current New York day and epoch instant.
 * @return {boolean} Whether this occurrence belongs in the selected view.
 */
export function matchesEventView(entry, filters = {}, context = {}) {
  const { event, startDay, endDay } = entry;
  if (!calendarEligibility(event).eligible) return false;
  const view = filters.eventView;
  if (!view) return true;
  if (!EVENT_VIEWS.includes(view)) throw new Error('Unknown event browsing view');
  const today = context.today;
  const period = event.scheduleKind === 'continuous';
  if (view === 'today') return startDay === today;
  if (view === 'day') return startDay === filters.from;
  const now = context.now ?? Date.now();
  const notEnded = event.allDay ? endDay >= today : Date.parse(event.end) > now;
  const shortExplicitRange = !event.scheduleKind || event.scheduleKind === 'occurrence';
  const days = (Date.parse(event.end) - Date.parse(event.start)) / 86400000;
  return startDay < today && notEnded && (period || (shortExplicitRange && days <= 31 && days > 0));
}
