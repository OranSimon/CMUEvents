import { addDays, parseDate } from './normalize.mjs';

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const month = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\w*\\.?';

/** Read a bounded prose range; a printed year can belong to either endpoint. */
export function publishedDateRange(value) {
  const text = String(value || '').replace(/\s+/g, ' ');
  const pattern = new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\s*(?:to|[-–—])\\s*(?:${month}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])(?:,?\\s+(20\\d{2}))?`, 'i');
  const match = text.match(pattern);
  if (!match || (!match[3] && !match[6]) || /^\s*(?::|[ap]\.?m\.?)/i.test(text.slice(match.index + match[0].length))) return null;
  const firstMonth = months.indexOf(match[1].toLowerCase()) + 1;
  const lastMonth = match[4] ? months.indexOf(match[4].toLowerCase()) + 1 : firstMonth;
  if (lastMonth < firstMonth && (!match[3] || !match[6])) return null;
  const firstYear = +(match[3] || +match[6] - Number(lastMonth < firstMonth));
  const lastYear = +(match[6] || firstYear + Number(lastMonth < firstMonth));
  const date = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const start = date(firstYear, firstMonth, match[2]), lastDay = date(lastYear, lastMonth, match[5]);
  if (!parseDate(start) || !parseDate(lastDay) || lastDay < start || Date.parse(lastDay) - Date.parse(start) > 366 * 86400000) return null;
  return { start, end: addDays(lastDay), lastDay };
}

/** Read only the schedule explicitly carried by a publisher's calendar link. */
export function publishedCalendarSchedule(value, fallbackZone = 'America/New_York') {
  try {
    const url = new URL(value);
    if (!['calendar.google.com', 'www.google.com'].includes(url.hostname)
      || !/^\/calendar\/(?:u\/\d+\/)?(?:render|r\/eventedit)$/.test(url.pathname)
      || (url.searchParams.has('action') && url.searchParams.get('action') !== 'TEMPLATE')) return null;
    const dates = (url.searchParams.get('dates') || '').split('/');
    const read = value => {
      const m = value.match(/^(20\d{2})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
      return m ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5]}:${m[6] || '00'}${m[7] || ''}` : ''}` : null;
    };
    if (dates.length !== 2) return null;
    const start = read(dates[0]), end = read(dates[1]);
    const timeZone = url.searchParams.get('ctz') || fallbackZone;
    new Intl.DateTimeFormat('en', { timeZone });
    if (!start || !end || (start.length === 10) !== (end.length === 10)) return null;
    const parsedStart = parseDate(start, timeZone), parsedEnd = parseDate(end, timeZone);
    if (!parsedStart || !parsedEnd || parsedEnd <= parsedStart) return null;
    return { start, end, timeZone, allDay: start.length === 10,
      title: url.searchParams.get('text') || '', source: url.href };
  } catch { return null; }
}
