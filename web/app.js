import { createDataClient, publicationFreshness } from "./data-client.js";
import { EVENT_VIEWS, discoveryTags, hasPublishedTimeConflict } from "./event-semantics.js";
import { normalizeEventFilters } from "./event-query.js";

const DISPLAY_TIMEZONE = "America/New_York";
const PAGE_SIZE = 48;
const DAY_REQUEST_SIZE = 100;
const SOURCE_PAGE_SIZE = 30;
const STRIP_DAYS = 14;
const COLLECTION_DAYS = 365;
const APP_VIEWS = ["all", ...EVENT_VIEWS];
const DAY_SECTIONS = { now: "Happening now", morning: "Morning", afternoon: "Afternoon", evening: "Evening", untimed: "No set time", past: "Earlier today" };
const PERIOD_SECTIONS = { "ends-today": "Ends today", "ends-week": "Ends within a week", "ends-month": "Ends within a month", "ends-later": "Running for a while" };
const INITIAL_TITLE = "CMU Events · Discover your campus";
const dataClient = createDataClient({ baseUrl: new URL("./", import.meta.url) });
const clockFormatter = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, hour: "numeric", minute: "2-digit" });
const hourFormatter = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, hour: "numeric", hourCycle: "h23" });

/**
 * Find a required interface element by its ID.
 * @param {string} id Element ID.
 * @return {HTMLElement} Matching element.
 */
function element(id) {
  return document.getElementById(id);
}

/**
 * Escape source text before inserting it in an HTML template.
 * @param {*} value Untrusted text.
 * @return {string} HTML-safe text.
 */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

/**
 * Remove source markup without executing it or rendering source HTML.
 * @param {*} value Plain text or source HTML.
 * @return {string} Normalized readable text.
 */
function plainText(value) {
  const text = String(value ?? "");
  if (!/<[a-z][\s\S]*>/i.test(text)) return text.trim();
  const parsed = new DOMParser().parseFromString(text, "text/html");
  parsed.querySelectorAll("script,style,noscript,iframe").forEach(node => node.remove());
  parsed.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  parsed.querySelectorAll("p,div,li,h1,h2,h3,h4").forEach(node => node.append("\n"));
  return parsed.body.textContent.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Permit only normal public web links in source-provided URLs.
 * @param {*} value Candidate URL.
 * @return {string} Safe URL, or an empty string.
 */
function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

/**
 * Format a Date as an ISO calendar date in the interface time zone.
 * @param {Date} date Date to format.
 * @return {string} YYYY-MM-DD calendar date.
 */
function dateKey(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Shift an ISO calendar date without daylight-saving-time arithmetic.
 * @param {string} value ISO calendar date.
 * @param {number} days Signed number of calendar days.
 * @return {string} Shifted ISO calendar date.
 */
function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Validate an ISO date read from a URL or form input.
 * @param {string|null} value Candidate date.
 * @return {string} Valid date, or an empty string.
 */
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? "" : value;
}

/**
 * Format a calendar date without converting it to another time zone.
 * @param {string} value ISO calendar date.
 * @param {Intl.DateTimeFormatOptions} options Date formatting options.
 * @return {string} Localized calendar label.
 */
function calendarLabel(value, options = { month: "long", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

/**
 * Return the common calendar date for a normalized event.
 * @param {Object} event Event record.
 * @return {string} ISO calendar date, or an empty string.
 */
function eventDay(event) {
  const start = event.start || event.startDate || event.date;
  if (!start) return "";
  if (event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(start)) return validDate(String(start).slice(0, 10));
  const parsed = new Date(start);
  return Number.isNaN(parsed.valueOf()) ? "" : dateKey(parsed);
}

/**
 * Return the last visible calendar day, respecting exclusive all-day ends.
 * @param {Object} event Event record.
 * @return {string} ISO calendar date, or an empty string without a published end.
 */
function eventLastDay(event) {
  if (!event.end) return "";
  const endDay = eventDay({ ...event, start: event.end });
  return endDay && event.allDay && event.endExclusive ? shiftDate(endDay, -1) : endDay;
}

/**
 * Tell whether an occurrence has a usable published clock time.
 * @param {Object} event Event record.
 * @return {boolean} Whether its start can be compared with the current time.
 */
function isTimed(event) {
  return !event.allDay && event.timePrecision !== "date" && event.scheduleKind !== "continuous"
    && !hasPublishedTimeConflict(event) && !/^\d{4}-\d{2}-\d{2}$/.test(event.start || "") && Number.isFinite(Date.parse(event.start));
}

/**
 * Compare a timed occurrence with the current clock.
 * Without a published end it can be past, but is never claimed as happening now.
 * @param {Object} event Event record.
 * @param {number} now Current epoch time in milliseconds.
 * @return {string} "now", "past", or an empty string.
 */
function eventPhase(event, now = Date.now()) {
  if (!isTimed(event)) return "";
  const start = Date.parse(event.start), end = Date.parse(event.end);
  if (start > now) return "";
  return end > start && end > now ? "now" : "past";
}

/**
 * Format the published clock for a result row without inventing an end.
 * @param {Object} event Event record.
 * @return {string[]} Leading time label and optional ending label.
 */
function eventClock(event) {
  if (hasPublishedTimeConflict(event)) return ["Check time", "Sources disagree"];
  if (event.scheduleKind === "continuous") return ["Hours vary", ""];
  const day = eventDay(event), lastDay = eventLastDay(event);
  const through = lastDay > day ? calendarLabel(lastDay, { month: "short", day: "numeric" }) : "";
  if (!isTimed(event)) return [event.timePrecision === "date" ? "Time not listed" : "All day", through ? `through ${through}` : ""];
  const start = new Date(event.start), end = new Date(event.end);
  const clock = clockFormatter.format(start);
  if (!(end > start)) return [clock, ""];
  return [clock, through && end - start >= 86400000 ? `to ${through}` : `to ${clockFormatter.format(end)}`];
}

/**
 * Count calendar days between two dates without daylight-saving arithmetic.
 * @param {string} from Earlier ISO calendar date.
 * @param {string} to Later ISO calendar date.
 * @return {number} Whole days from the first date to the second.
 */
function dayDifference(from, to) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

/**
 * Say how long a published period still runs.
 * @param {Object} event Event record.
 * @return {string} Time-left label.
 */
function periodLeft(event) {
  const lastDay = eventLastDay(event);
  if (!lastDay) return "Ongoing";
  const left = dayDifference(today, lastDay);
  if (left <= 0) return "Ends today";
  if (left === 1) return "Ends tomorrow";
  if (left < 14) return `${left} days left`;
  return left < 61 ? `${Math.round(left / 7)} weeks left` : `${Math.round(left / 30.44)} months left`;
}

/**
 * Show how far through its published period an occurrence is.
 * @param {Object} event Event record.
 * @return {string} Period bar markup, or an empty string without both dates.
 */
function periodBar(event) {
  const day = eventDay(event), lastDay = eventLastDay(event);
  if (!day || !lastDay) return "";
  const total = Math.max(1, dayDifference(day, lastDay));
  const passed = Math.min(total, Math.max(0, dayDifference(day, today)));
  const label = value => calendarLabel(value, { month: "short", day: "numeric", ...(value.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
  return `<div class="event-period"><span>${label(day)}</span><progress value="${passed}" max="${total}" aria-label="${passed.toLocaleString()} of ${total.toLocaleString()} days have passed"></progress><span>${label(lastDay)}</span></div>`;
}

/**
 * Choose what a row leads with: the clock on a day, the date where days mix.
 * @param {Object} event Event record.
 * @return {{main:string,sub:string}} Primary and secondary row labels.
 */
function eventWhen(event) {
  const day = eventDay(event), lastDay = eventLastDay(event);
  const short = value => calendarLabel(value, { month: "short", day: "numeric" });
  if (state.eventView === "ongoing") return { main: periodLeft(event), sub: "" };
  if (day < today) return { main: lastDay ? `Until ${short(lastDay)}` : "Ongoing", sub: day ? `Since ${short(day)}` : "" };
  const [clock, ending] = eventClock(event);
  if (state.eventView !== "all" || !state.query) return { main: clock, sub: ending };
  return { main: day ? calendarLabel(day, { weekday: "short", month: "short", day: "numeric", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) }) : "Date to be announced", sub: clock };
}

/**
 * Format event times with both zone abbreviations when a range crosses DST.
 * @param {Object} event Event record.
 * @return {string} Human-readable event time.
 */
function eventTime(event) {
  const start = event.start || event.startDate || event.date;
  if (hasPublishedTimeConflict(event)) return "Source times disagree · check original";
  if (event.scheduleKind === "continuous") return "Check original opening and session times";
  if (event.timePrecision === "date") return "Time not listed";
  if (event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(start || "")) return "All day";
  const date = new Date(start);
  if (!start || Number.isNaN(date.valueOf())) return "Time to be announced";
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, hour: "numeric", minute: "2-digit" });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, timeZoneName: "short" }).formatToParts(date).find(part => part.type === "timeZoneName")?.value || "ET";
  let text = formatter.format(date);
  const end = event.end ? new Date(event.end) : null;
  if (end && !Number.isNaN(end.valueOf()) && end > date) {
    const endText = dateKey(end) === dateKey(date) ? formatter.format(end) : new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(end);
    const endZone = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, timeZoneName: "short" }).formatToParts(end).find(part => part.type === "timeZoneName")?.value || zone;
    if (endZone !== zone) return `${text} ${zone} – ${endText} ${endZone}`;
    text += ` – ${endText}`;
  }
  return `${text} ${zone}`;
}

/**
 * Build a full event date label, respecting exclusive all-day end dates.
 * @param {Object} event Event record.
 * @return {string} Full calendar date or range.
 */
function eventDateLabel(event) {
  const day = eventDay(event);
  if (!day) return "Date to be announced";
  const label = calendarLabel(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const endDay = eventLastDay(event);
  return endDay && endDay > day ? `${label} – ${calendarLabel(endDay, { month: "long", day: "numeric", year: "numeric" })}` : label;
}

/**
 * Reduce a description to a deterministic source-text excerpt.
 * @param {Object} event Event record.
 * @return {string} Source summary or readable excerpt, empty when none was published.
 */
function eventExcerpt(event) {
  const summary = plainText(event.summary);
  if (summary) return summary;
  const description = plainText(event.description).replace(/\s+/g, " ");
  if (description.length <= 320) return description;
  return `${description.slice(0, 317).replace(/\s+\S*$/, "")}…`;
}

/**
 * Describe an event in its detail view, identifying missing content.
 * @param {Object} event Event record.
 * @return {string} Source excerpt or a pointer to the original listing.
 */
function eventSummary(event) {
  return eventExcerpt(event) || "Open the original event listing for program details and registration information.";
}

/**
 * Shorten a published location for scanning; details keep the full source text.
 * @param {Object} event Event record.
 * @return {string} Room or venue, or an empty string when the source names none.
 */
function eventPlace(event) {
  const location = plainText(event.location?.name || event.location || "");
  return /\bsign in to\b/i.test(location) ? "" : location.replace(/,\s*\d+\s+\p{L}.*$/u, "");
}

/**
 * Name the host for scanning, without feed descriptions kept in catalog names.
 * @param {Object} event Event record.
 * @return {string} Short organizer, organization or department label.
 */
function eventHost(event) {
  return plainText(event.organizer || event.org || event.department || "Carnegie Mellon University")
    .replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+[—–]\s+.*$/, "");
}

/**
 * Normalize arrays of facet strings or counted facet objects.
 * @param {Array} values Raw facet records.
 * @return {Array<{value:string,count:number|null}>} Normalized facets.
 */
function normalizeFacets(values) {
  return (Array.isArray(values) ? values : []).map(item => typeof item === "string" ? { value: item, count: null } : { value: String(item.value ?? item.name ?? item.label ?? ""), count: Number.isFinite(item.count) ? item.count : null }).filter(item => item.value);
}

/**
 * Assign restrained category colors consistently across cards and details.
 * @param {string} tag Topic label.
 * @return {string} CSS color token.
 */
function tagColor(tag) {
  if (/research|science|tech|academic|seminar|talk|comput|engineering/i.test(tag)) return "blue";
  if (/art|music|perform|culture|film/i.test(tag)) return "purple";
  if (/career|entrepreneur|business|network/i.test(tag)) return "orange";
  if (/community|social|student/i.test(tag)) return "red";
  if (/health|well|sport|recreation/i.test(tag)) return "teal";
  return "green";
}

/**
 * Return an inline decorative SVG for event metadata.
 * @param {string} kind Icon name.
 * @return {string} Trusted SVG markup.
 */
function icon(kind) {
  const paths = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    calendar: '<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v6M16 3v6M4 12h16"/>',
    screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.calendar}</svg>`;
}

let today = dateKey(new Date());
const urlState = new URLSearchParams(window.location.search);
const urlQuery = (urlState.get("query") || urlState.get("q") || "").slice(0, 200);
const urlDay = validDate(urlState.get("day"));
const state = {
  query: urlQuery,
  eventView: urlDay ? "day" : APP_VIEWS.includes(urlState.get("eventView")) && urlState.get("eventView") !== "day" ? urlState.get("eventView") : urlQuery ? "all" : "today",
  day: urlDay,
  department: urlState.get("department") || "",
  org: urlState.get("org") || "",
  tags: normalizeEventFilters(urlState).tags,
  campus: urlState.get("campus") || "",
  mode: modeSlug(urlState.get("mode") || ""),
  page: 1,
  view: urlState.get("view") === "grid" ? "grid" : "list",
};
let currentData = null;
let statusData = null;
let viewTotals = null;
let viewBeforeSearch = urlQuery && state.eventView === "all" ? { eventView: "today", day: "" } : null;
let selectedTab = "";
let emptyTarget = null;
let clockSignature = "";
let eventMap = new Map();
let requestController = null;
let requestNumber = 0;
let searchTimer = null;
let statusTimer = null;
let previousFocus = null;
let filterPreviousFocus = null;
let sourceData = null;
let sourceRequest = null;
let sourceLoadError = "";
const sourceFilters = { query: "", department: "", category: "", coverage: "all", limit: SOURCE_PAGE_SIZE };
const sourcePanelFocus = new Map();

/**
 * Advance relative date controls when an open page crosses a calendar day.
 * @return {void} No return value.
 */
function syncToday() {
  today = dateKey(new Date());
  element("today-number").textContent = calendarLabel(today, { day: "numeric" });
  element("day-picker").min = today;
  element("day-picker").max = shiftDate(today, COLLECTION_DAYS);
  if (state.eventView === "day" && state.day <= today) Object.assign(state, { eventView: "today", day: "" });
}

/**
 * Limit a date view to its day, or All to today onward.
 * @return {{from:string,to:string}} Requested boundaries.
 */
function dateRange() {
  if (state.eventView === "all") return { from: today, to: "" };
  const day = state.eventView === "day" ? state.day : today;
  return { from: day, to: day };
}

/**
 * List the strip's days after today, keeping a picked date visible beyond them.
 * @return {string[]} ISO calendar days.
 */
function stripDays() {
  const days = Array.from({ length: STRIP_DAYS - 1 }, (_, index) => shiftDate(today, index + 1));
  if (state.eventView === "day" && !days.includes(state.day)) days.push(state.day);
  return days;
}

/**
 * Build one date tab; counts are filled in place to preserve keyboard focus.
 * @param {string} day ISO calendar day.
 * @return {string} Tab markup.
 */
function dayTab(day) {
  const name = calendarLabel(day, { weekday: "short" });
  const date = calendarLabel(day, day.endsWith("-01") ? { month: "short", day: "numeric" } : { day: "numeric" });
  return `<button id="event-view-day-${day}" class="event-browser-tab" type="button" role="tab" data-event-view="day" data-day="${day}" aria-selected="false" aria-controls="events-panel" tabindex="-1"><span class="tab-name">${name}</span><span class="tab-date">${date}</span><span class="tab-count"></span></button>`;
}

/**
 * Read the current filtered count for one date tab.
 * @param {HTMLElement} tab Date tab.
 * @return {number|null} Matching events, or null before data arrives.
 */
function tabCount(tab) {
  if (!viewTotals) return null;
  const view = tab.dataset.eventView;
  if (view === "all" || view === "ongoing") return viewTotals[view];
  const day = view === "today" ? today : tab.dataset.day;
  return viewTotals.days.find(item => item.value === day)?.count ?? 0;
}

/**
 * Keep the date strip's days and filtered counts current.
 * @return {void}
 */
function renderDateStrip() {
  const days = stripDays();
  const container = element("event-days");
  if (container.dataset.days !== days.join()) {
    container.innerHTML = days.map(dayTab).join("");
    container.dataset.days = days.join();
  }
  document.querySelectorAll("[data-event-view]").forEach(tab => {
    const count = tabCount(tab);
    const view = tab.dataset.eventView;
    const name = view === "all" ? "All upcoming events" : view === "ongoing" ? "Ongoing events" : `${view === "today" ? "Today, " : ""}${calendarLabel(view === "today" ? today : tab.dataset.day, { weekday: "long", month: "long", day: "numeric" })}`;
    tab.querySelector(".tab-count").textContent = count === null ? "" : count.toLocaleString();
    tab.classList.toggle("is-empty", count === 0);
    tab.setAttribute("aria-label", count === null ? name : `${name}, ${count.toLocaleString()} ${count === 1 ? "event" : "events"}`);
  });
}

/**
 * Scroll a newly selected date tab into the strip without moving the page.
 * @return {void}
 */
function revealSelectedTab() {
  const strip = element("event-browser");
  const tab = strip.querySelector('[aria-selected="true"]');
  if (!tab || tab.id === selectedTab) return;
  selectedTab = tab.id;
  strip.scrollTo({ left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
}

/**
 * Store active filters in the URL so searches can be bookmarked and shared.
 * @return {void}
 */
function updateUrl() {
  const params = new URLSearchParams();
  ["query", "department", "org", "campus", "mode"].forEach(key => { if (state[key]) params.set(key, state[key]); });
  state.tags.forEach(tag => params.append("tag", tag));
  if (state.eventView === "day") params.set("day", state.day);
  else if (state.eventView !== (state.query ? "all" : "today")) params.set("eventView", state.eventView);
  if (state.view === "grid") params.set("view", state.view);
  const query = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  document.title = state.query ? `${state.query} · CMU Events` : INITIAL_TITLE;
}

/**
 * Synchronize visible filter controls with the current state.
 * @return {void}
 */
function syncControls() {
  element("search-input").value = state.query;
  element("search-clear").hidden = !state.query;
  renderDateStrip();
  document.querySelectorAll("[data-event-view]").forEach(button => {
    const selected = button.dataset.eventView === state.eventView && (state.eventView !== "day" || button.dataset.day === state.day);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  revealSelectedTab();
  element("events-panel").setAttribute("aria-labelledby", `event-view-${state.eventView === "day" ? `day-${state.day}` : state.eventView}`);
  element("day-picker").value = state.day;
  ["department", "org", "campus"].forEach(key => { element(`${key}-filter`).value = state[key]; });
  document.querySelectorAll("[data-mode]").forEach(button => {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-tag]").forEach(button => button.setAttribute("aria-pressed", String(state.tags.includes(button.dataset.tag))));
  document.querySelectorAll("[data-view]").forEach(button => {
    const selected = button.dataset.view === state.view;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  element("event-results").classList.toggle("grid-view", state.view === "grid");
  renderActiveFilters();
}

/**
 * Render removable chips and the contextual results heading.
 * @return {void}
 */
function renderActiveFilters() {
  const chips = [];
  ["department", "org", "campus", "mode"].forEach(key => { if (state[key]) chips.push([key, key === "mode" ? modeLabel(state[key]) : state[key]]); });
  state.tags.forEach(tag => chips.push(["tag", tag]));
  const container = element("active-filters");
  container.hidden = chips.length === 0;
  container.innerHTML = chips.map(([key, label]) => `<button class="filter-chip" type="button" data-remove="${key}" data-value="${escapeHtml(label)}" aria-label="Remove ${escapeHtml(label)} filter"><span>${escapeHtml(label)}</span><span aria-hidden="true">×</span></button>`).join("");
  const count = element("mobile-filter-count");
  count.hidden = chips.length === 0;
  count.textContent = String(chips.length);
  element("results-title").textContent = viewTitle();
  element("reset-filters").hidden = !hasActiveFilters();
}

/**
 * Tell whether a search or filter is narrowing the list.
 * @return {boolean} Whether anything can be cleared.
 */
function hasActiveFilters() {
  return Boolean(state.query || state.department || state.org || state.campus || state.mode || state.tags.length);
}

/**
 * Name the current date view for the results heading.
 * @return {string} Heading text.
 */
function viewTitle() {
  if (state.eventView === "all") return state.query ? `“${state.query}”` : "All upcoming";
  if (state.eventView === "ongoing") return state.query ? `“${state.query}” · ongoing` : "Ongoing";
  const day = state.eventView === "day" ? state.day : today;
  const label = day === today ? `Today, ${calendarLabel(day)}` : day === shiftDate(today, 1) ? `Tomorrow, ${calendarLabel(day)}` : calendarLabel(day, { weekday: "long", month: "long", day: "numeric" });
  return state.query ? `“${state.query}” · ${label}` : label;
}

/**
 * Summarize the current list in one plain sentence.
 * @param {number} total Matching events.
 * @param {Object[]} events Loaded events.
 * @return {string} Result summary.
 */
function viewSummary(total, events) {
  const count = `${total.toLocaleString()} ${state.query ? total === 1 ? "match" : "matches" : total === 1 ? "event" : "events"}`;
  if (state.eventView === "all") return `${count} from today onward${state.query && total > 1 ? ", best match first" : ""}`;
  if (state.eventView === "ongoing") return `${total === 1 ? "1 activity" : `${total.toLocaleString()} activities`} running over several days. Check the original listing for opening and session times.`;
  if (state.eventView === "day") return count;
  const now = Date.now();
  const timed = events.filter(event => isTimed(event) && Date.parse(event.start) > now).sort(byStart);
  const live = events.filter(event => eventPhase(event, now) === "now").length;
  return [count, live ? `${live.toLocaleString()} happening now` : "", timed.length ? `next at ${clockFormatter.format(new Date(timed[0].start))}` : ""].filter(Boolean).join(" · ");
}

/**
 * Order rows by published clock, keeping untimed entries after timed ones.
 * @param {Object} left Event record.
 * @param {Object} right Event record.
 * @return {number} Sort order.
 */
function byStart(left, right) {
  return Number(isTimed(right)) - Number(isTimed(left)) || Date.parse(left.start) - Date.parse(right.start);
}

/**
 * Return a readable format label while preserving unknown source values.
 * @param {string} value Event format.
 * @return {string} Display label.
 */
function modeLabel(value) {
  return ({ "in-person": "In person", in_person: "In person", online: "Online", virtual: "Online", hybrid: "Hybrid", unspecified: "Unspecified", unknown: "Unspecified" })[value] || value;
}

/**
 * Normalize the source's attendance label for consistent interface comparisons.
 * @param {string} value Source mode or URL parameter.
 * @return {string} Lowercase attendance token.
 */
function modeSlug(value) {
  return String(value || "").toLowerCase().replace(/[ _]/g, "-").replace(/^virtual$/, "online");
}

/**
 * Populate a select while retaining an active value outside the response facets.
 * @param {string} key State key and control prefix.
 * @param {Array} facets Available values.
 * @param {string} placeholder Unfiltered option label.
 * @return {void}
 */
function populateSelect(key, facets, placeholder) {
  const values = normalizeFacets(facets);
  if (state[key] && !values.some(item => item.value === state[key])) values.unshift({ value: state[key], count: null });
  element(`${key}-filter`).innerHTML = `<option value="">${placeholder}</option>${values.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.value)}${item.count === null ? "" : ` (${item.count.toLocaleString()})`}</option>`).join("")}`;
  element(`${key}-filter`).value = state[key];
}

/**
 * Build one sidebar toggle for a topic or the Recurring condition.
 * @param {{value:string,count:number|null}} item Facet value and count.
 * @param {string} className Toggle style.
 * @param {string} label Visible label.
 * @return {string} Escaped toggle markup.
 */
function tagToggle(item, className, label = item.value) {
  const selected = state.tags.includes(item.value);
  return `<button type="button" class="${className}" data-tag="${escapeHtml(item.value)}" data-color="${tagColor(item.value)}" aria-label="${escapeHtml(label)}${item.count === null ? "" : ` (${item.count.toLocaleString()} events)`}" aria-pressed="${selected}"${item.count === 0 && !selected ? " disabled" : ""}><span class="topic-label">${escapeHtml(label)}</span>${item.count === null ? "" : `<span class="facet-count">${item.count.toLocaleString()}</span>`}</button>`;
}

/**
 * Render facets, topic toggles and the date strip's filtered counts.
 * @param {Object} facets Event facet payload.
 * @return {void}
 */
function renderFacets(facets = {}) {
  const focused = document.activeElement?.closest?.("[data-tag]");
  const focusedRegion = focused?.parentElement?.id;
  viewTotals = facets.views || viewTotals;
  renderDateStrip();
  populateSelect("department", facets.departments, "All departments");
  populateSelect("org", facets.orgs || facets.organizations, "All organizations");
  populateSelect("campus", facets.campuses, "All campuses");
  const tags = normalizeFacets(facets.tags);
  state.tags.forEach(tag => { if (!tags.some(item => item.value === tag)) tags.unshift({ value: tag, count: 0 }); });
  const topics = tags.filter(item => item.value !== "Recurring");
  const recurring = tags.find(item => item.value === "Recurring") || { value: "Recurring", count: 0 };
  element("topic-options").innerHTML = topics.length ? topics.map(item => tagToggle(item, "topic-option")).join("") : '<span class="muted filter-placeholder">No topics in this view.</span>';
  element("recurring-option").innerHTML = tagToggle(recurring, "topic-option recurring-toggle", "Recurring only");
  element("quick-topics").innerHTML = topics.filter(item => item.count > 0 || state.tags.includes(item.value))
    .sort((left, right) => Number(state.tags.includes(right.value)) - Number(state.tags.includes(left.value)) || right.count - left.count)
    .map(item => tagToggle(item, "quick-topic")).join("");
  if (focused) [...(element(focusedRegion)?.querySelectorAll("[data-tag]") || [])].find(button => button.dataset.tag === focused.dataset.tag)?.focus({ preventScroll: true });
}

/**
 * Explain a recurrence supplied by the publisher without inferring it from a title.
 * @param {Object} event Normalized occurrence with explicit recurrence metadata.
 * @return {string} Short recurrence label.
 */
function recurrenceLabel(event) {
  const frequency = String(event.recurrence?.frequency || "").toLowerCase();
  const interval = Math.max(1, Number(event.recurrence?.interval) || 1);
  if (frequency === "weekly") return interval === 1 ? "Repeats weekly" : `Repeats every ${interval} weeks`;
  if (frequency === "daily") return interval === 1 ? "Repeats daily" : `Repeats every ${interval} days`;
  if (frequency === "monthly") return interval === 1 ? "Repeats monthly" : `Repeats every ${interval} months`;
  if (frequency === "yearly") return interval === 1 ? "Repeats yearly" : `Repeats every ${interval} years`;
  return "Repeating activity";
}

/**
 * Build one fully escaped event card.
 * @param {Object} event Normalized event record.
 * @param {number} index Current page index.
 * @return {string} Event card markup.
 */
function eventCard(event, index) {
  const id = String(event.id || index);
  const title = plainText(event.title) || "Untitled event";
  const tags = discoveryTags(event);
  const category = tags.find(tag => tag !== "Recurring") || "Campus event";
  const cancelled = /cancel/i.test(event.status || "");
  const status = cancelled ? "Cancelled" : /postpon/i.test(event.status || "") ? "Postponed" : "";
  const recurringTag = tags.includes("Recurring") ? `<button type="button" class="event-tag" data-tag="Recurring" aria-pressed="${state.tags.includes("Recurring")}" aria-label="Filter by Recurring">Recurring</button>` : "";
  const mode = modeSlug(event.mode);
  const place = eventPlace(event) || (mode === "online" ? "Online" : "");
  const host = eventHost(event);
  const excerpt = eventExcerpt(event);
  const phase = eventDay(event) === today ? eventPhase(event) : "";
  const when = eventWhen(event);
  return `<article class="event-card${cancelled ? " cancelled" : ""}${phase ? ` is-${phase}` : ""}">
    <div class="event-when"><span class="event-when-main">${escapeHtml(when.main)}</span>${when.sub ? `<span class="event-when-sub">${escapeHtml(when.sub)}</span>` : ""}</div>
    <div class="event-card-body"><h3 class="event-title"><button class="event-title-button" type="button" data-event="${escapeHtml(id)}">${escapeHtml(title)}</button></h3>
    <p class="event-meta">${place ? `<span class="event-location">${escapeHtml(place)}</span>` : ""}<span class="event-organizer">${escapeHtml(host)}</span></p>
    ${state.eventView === "ongoing" ? periodBar(event) : ""}${excerpt ? `<p class="event-summary">${escapeHtml(excerpt)}</p>` : ""}
    <div class="event-card-tags">${phase === "now" && state.eventView !== "today" ? '<span class="event-live">Happening now</span>' : ""}${status ? `<span class="event-status">${status}</span>` : ""}<span class="category-label" data-color="${tagColor(category)}">${escapeHtml(category)}</span>${recurringTag}${mode === "hybrid" ? '<span class="category-label">Hybrid</span>' : ""}</div></div>
  </article>`;
}

/**
 * Place one occurrence within its day's reading order.
 * @param {Object} event Event record.
 * @param {number} now Current epoch time in milliseconds.
 * @return {string} DAY_SECTIONS key.
 */
function daySection(event, now) {
  if (!isTimed(event)) return "untimed";
  const phase = eventDay(event) === today ? eventPhase(event, now) : "";
  if (phase) return phase;
  const hour = Number(hourFormatter.format(new Date(event.start)));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/**
 * Sort a running activity by how soon its published period ends.
 * @param {Object} event Event record.
 * @return {string} PERIOD_SECTIONS key.
 */
function periodSection(event) {
  const lastDay = eventLastDay(event);
  const left = lastDay ? dayDifference(today, lastDay) : Infinity;
  return left <= 0 ? "ends-today" : left <= 7 ? "ends-week" : left <= 31 ? "ends-month" : "ends-later";
}

/**
 * Split loaded events into the sections the current view reads in.
 * @param {Object[]} events Loaded events.
 * @return {Array<{key:string,label:string,events:Object[]}>} Ordered sections.
 */
function eventSections(events) {
  if (state.eventView === "all" && state.query) return [{ key: "flat", label: "", events }];
  const groups = new Map();
  const add = (key, event) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(event); };
  if (state.eventView === "ongoing") {
    events.forEach(event => add(periodSection(event), event));
    return Object.keys(PERIOD_SECTIONS).filter(key => groups.has(key)).map(key => ({ key, label: PERIOD_SECTIONS[key],
      events: groups.get(key).sort((left, right) => eventLastDay(left).localeCompare(eventLastDay(right))) }));
  }
  if (state.eventView === "all") {
    events.forEach(event => add(eventDay(event) > today ? eventDay(event) : today, event));
    return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([day, rows]) => ({ key: "day", events: rows.sort(byStart),
      label: day === today ? "Today" : calendarLabel(day, { weekday: "long", month: "long", day: "numeric", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) }) }));
  }
  const now = Date.now();
  events.forEach(event => add(daySection(event, now), event));
  return Object.keys(DAY_SECTIONS).filter(key => groups.has(key)).map(key => ({ key, label: DAY_SECTIONS[key], events: groups.get(key).sort(byStart) }));
}

/**
 * Offer a useful next step when the selected date has no matches.
 * @param {Object|null} views Filtered date-navigation counts.
 * @return {Object|null} Target view, day and button label.
 */
function nextMatch(views) {
  if (!views || state.eventView === "all") return null;
  const from = state.eventView === "day" ? state.day : today;
  const day = views.days.find(item => item.value > from && item.count > 0);
  if (day) return { view: "day", day: day.value, label: `See ${calendarLabel(day.value, { weekday: "short", month: "short", day: "numeric" })} (${day.count.toLocaleString()})` };
  return views.all > 0 ? { view: "all", day: "", label: `See all ${views.all.toLocaleString()} upcoming` } : null;
}

/**
 * Render the current response in its date view's reading order.
 * @param {Object} data Paginated event payload.
 * @return {void}
 */
function renderEvents(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const total = Number.isFinite(data.total) ? data.total : events.length;
  const dayView = ["today", "day"].includes(state.eventView);
  const filtered = hasActiveFilters();
  const indexes = new Map(events.map((event, index) => [event, index]));
  eventMap = new Map(events.map((event, index) => [String(event.id || index), event]));
  clockSignature = events.map(event => eventPhase(event)).join();
  const sections = eventSections(events);
  const jumps = dayView && sections.length > 1 ? `<nav class="section-jumps" aria-label="Jump to a time of day">${sections.map(section => `<button type="button" class="section-jump" data-section="${section.key}">${escapeHtml(section.label)} <span>${section.events.length.toLocaleString()}</span></button>`).join("")}</nav>` : "";
  element("event-results").innerHTML = jumps + sections.map(section => {
    const cards = `<div class="date-group-events">${section.events.map(event => eventCard(event, indexes.get(event))).join("")}</div>`;
    const count = section.key === "day" ? "" : `<span class="date-group-count">${section.events.length.toLocaleString()}</span>`;
    const anchor = dayView ? ` id="section-${section.key}" tabindex="-1"` : "";
    if (section.key === "past") return `<details class="date-group earlier-group"${anchor}${sections.length === 1 ? " open" : ""}><summary class="date-group-heading">${section.label} ${count}</summary>${cards}</details>`;
    return `<section class="date-group group-${section.key}"${anchor}${section.label ? ` aria-label="${escapeHtml(section.label)}"` : ""}>${section.label ? `<h3 class="date-group-heading">${escapeHtml(section.label)} ${count}</h3>` : ""}${cards}</section>`;
  }).join("");
  emptyTarget = nextMatch(data.facets?.views || null);
  element("empty-state").hidden = events.length > 0;
  element("empty-title").textContent = filtered ? "No events match this view." : "Nothing is listed here yet.";
  element("empty-message").textContent = emptyTarget ? "Other dates have matches." : filtered ? "Try another topic or a shorter search." : "Choose another date from the strip above.";
  element("empty-next").hidden = !emptyTarget;
  element("empty-next").textContent = emptyTarget?.label || "";
  element("empty-reset").hidden = !filtered;
  element("event-view-description").textContent = viewSummary(total, events);
  element("show-events").textContent = `Show ${total.toLocaleString()} ${total === 1 ? "event" : "events"}`;
  const more = !dayView && events.length < total;
  element("load-more").hidden = !more;
  element("load-more-label").textContent = `Showing ${events.length.toLocaleString()} of ${total.toLocaleString()} in this view.`;
  const next = Math.min(PAGE_SIZE, Math.max(0, total - events.length));
  element("show-more-events").textContent = `Show ${next.toLocaleString()} more events`;
  element("show-more-events").disabled = false;
  const scope = state.eventView === "today" ? "today’s complete matching list" : dayView ? "this day’s complete matching list" : "this view";
  element("results-announcement").textContent = `${total.toLocaleString()} ${total === 1 ? "event" : "events"} in ${scope}. ${events.length ? `Showing ${events.length.toLocaleString()}${events.length < total ? ` of ${total.toLocaleString()}` : ""}.` : "Try changing your filters or choose another view."}`;
}

/**
 * Jump to one section of a day, however far down a long list it sits.
 * @param {string} key DAY_SECTIONS key.
 * @return {void}
 */
function jumpToSection(key) {
  const section = element(`section-${key}`);
  if (!section) return;
  if (section.tagName === "DETAILS") section.open = true;
  section.scrollIntoView({ block: "start" });
  section.focus({ preventScroll: true });
}

/**
 * Move Today's rows between sections as their published times pass.
 * @return {void}
 */
function refreshClockStates() {
  if (!currentData || state.eventView !== "today" || document.hidden) return;
  if (currentData.events.map(event => eventPhase(event)).join() === clockSignature) return;
  const results = element("event-results");
  const focused = document.activeElement?.dataset?.event;
  const earlierOpen = results.querySelector(".earlier-group")?.open;
  renderEvents(currentData);
  if (earlierOpen && results.querySelector(".earlier-group")) results.querySelector(".earlier-group").open = true;
  if (focused) [...results.querySelectorAll("[data-event]")].find(button => button.dataset.event === focused)?.focus({ preventScroll: true });
}

/**
 * Show placeholders while awaiting a fresh query.
 * @return {void}
 */
function renderLoading() {
  element("event-results").setAttribute("aria-busy", "true");
  element("empty-state").hidden = true;
  element("load-more").hidden = true;
  element("error-notice").hidden = true;
  element("event-results").innerHTML = `<div class="date-group-events">${'<div class="skeleton-card" aria-hidden="true"><div class="skeleton-line"></div><div><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>'.repeat(6)}</div>`;
}

/**
 * Request fresh filtered results, cancelling any superseded request.
 * @param {boolean} scroll Whether to return keyboard and scroll focus to results.
 * @return {Promise<void>} Completion of the current request.
 */
async function loadEvents(scroll = false, append = false) {
  syncToday();
  const requestId = ++requestNumber;
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  const range = dateRange();
  const dayView = ["today", "day"].includes(state.eventView);
  const params = new URLSearchParams({ page: String(append ? state.page : 1), limit: String(dayView ? DAY_REQUEST_SIZE : PAGE_SIZE) });
  if (state.eventView !== "all") params.set("eventView", state.eventView);
  ["query", "department", "org", "campus"].forEach(key => { if (state[key]) params.set(key, state[key]); });
  state.tags.forEach(tag => params.append("tag", tag));
  if (state.mode) params.set("mode", modeLabel(state.mode));
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  updateUrl();
  syncControls();
  if (append) {
    element("error-notice").hidden = true;
    element("show-more-events").disabled = true;
    element("show-more-events").textContent = "Loading more…";
    element("event-results").setAttribute("aria-busy", "true");
  } else {
    state.page = 1;
    renderLoading();
  }
  if (scroll) {
    element("results").scrollIntoView({ block: "start", behavior: "smooth" });
    element("results").focus({ preventScroll: true });
  }
  try {
    let data = await dataClient.getEvents(params, { signal: controller.signal });
    if (!Array.isArray(data.events)) throw new Error("The event service returned an unexpected response.");
    if (requestId !== requestNumber) return;
    const previousIds = new Set((append ? currentData?.events || [] : []).map(event => String(event.id)));
    const collected = new Map((append ? currentData?.events || [] : []).map(event => [event.id, event]));
    for (const event of data.events) collected.set(event.id, event);
    if (dayView) {
      let page = 1;
      while (page * (data.pageSize || DAY_REQUEST_SIZE) < data.total) {
        params.set("page", String(++page));
        const next = await dataClient.getEvents(params, { signal: controller.signal });
        if (requestId !== requestNumber) return;
        if (!Array.isArray(next.events) || !next.events.length) throw new Error("The event list changed while loading. Refresh this page to get the complete list.");
        for (const event of next.events) collected.set(event.id, event);
        data = { ...next, facets: data.facets };
      }
    }
    if (requestId !== requestNumber) return;
    currentData = { ...data, events: [...collected.values()] };
    renderFacets(data.facets);
    renderEvents(currentData);
    if (append) {
      const firstNew = [...element("event-results").querySelectorAll("[data-event]")].find(button => !previousIds.has(button.dataset.event));
      firstNew?.focus({ preventScroll: true });
      firstNew?.closest(".event-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    syncControls();
    updateStatus({ ...statusData, lastUpdated: data.lastUpdated || statusData?.lastUpdated, refreshing: data.refreshing ?? statusData?.refreshing });
  } catch (error) {
    if (error.name === "AbortError" || requestId !== requestNumber) return;
    if (!append) element("event-results").innerHTML = "";
    else state.page = Math.max(1, state.page - 1);
    element("error-notice").hidden = false;
    element("error-title").textContent = append ? "We couldn’t load more events." : "We couldn’t load events.";
    element("error-message").textContent = `${error.message} Please try again shortly.`;
    if (!append) element("event-view-description").textContent = "";
    if (!currentData) element("topic-options").innerHTML = '<span class="muted filter-placeholder">Topics are unavailable.</span>';
    element("results-announcement").textContent = "Events could not be loaded. Use Try again to retry.";
  } finally {
    if (requestId === requestNumber) {
      element("event-results").setAttribute("aria-busy", "false");
      element("show-more-events").disabled = false;
      if (append && currentData) {
        const more = Math.min(PAGE_SIZE, Math.max(0, currentData.total - currentData.events.length));
        element("show-more-events").textContent = `Show ${more.toLocaleString()} more events`;
      }
    }
  }
}

/** Toggle one selected tag while retaining all other topics and conditions. */
function toggleTag(tag, scroll = false) {
  changeFilter("tags", state.tags.includes(tag) ? state.tags.filter(value => value !== tag) : [...state.tags, tag], scroll);
}

/**
 * Apply a filter change and reset pagination.
 * @param {string} key Filter state key.
 * @param {string} value New filter value.
 * @param {boolean} scroll Whether to focus the refreshed results after a card action.
 * @return {void}
 */
function changeFilter(key, value, scroll = false) {
  state[key] = value;
  state.page = 1;
  if (key === "department") state.org = "";
  loadEvents(scroll);
}

/**
 * Search every upcoming date, returning to the browsed view once cleared.
 * @param {string} value Search text.
 * @return {void}
 */
function applySearch(value) {
  const query = value.trim();
  if (query === state.query) return;
  if (query && !state.query) { viewBeforeSearch = { eventView: state.eventView, day: state.day }; state.eventView = "all"; state.day = ""; }
  if (!query) restoreBrowsedView();
  state.query = query;
  state.page = 1;
  loadEvents();
}

/**
 * Return to the date view that a search widened.
 * @return {void}
 */
function restoreBrowsedView() {
  if (viewBeforeSearch) Object.assign(state, viewBeforeSearch);
  viewBeforeSearch = null;
}

/**
 * Switch date view while keeping search and filters, then return to the list top.
 * @param {string} view All, Today, Ongoing or day view.
 * @param {string} day ISO calendar day for a day view.
 * @return {void}
 */
function selectView(view, day = "") {
  const eventView = view === "day" && day <= today ? "today" : view;
  if (eventView === state.eventView && (eventView !== "day" || day === state.day)) return;
  viewBeforeSearch = null;
  Object.assign(state, { eventView, day: eventView === "day" ? day : "", page: 1 });
  loadEvents();
  const results = element("results");
  if (results.getBoundingClientRect().top < document.querySelector(".date-rail").getBoundingClientRect().bottom) results.scrollIntoView({ block: "start" });
}

/**
 * Reset search and all event facets, keeping the date view.
 * @return {void}
 */
function resetFilters() {
  restoreBrowsedView();
  Object.assign(state, { query: "", department: "", org: "", tags: [], campus: "", mode: "", page: 1 });
  clearTimeout(searchTimer);
  loadEvents();
}

/**
 * Format a status timestamp without exposing invalid dates.
 * @param {string} value API timestamp.
 * @return {string} Readable timestamp.
 */
function updatedLabel(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date) : "Not refreshed yet";
}

/**
 * Explain publication age using the successful collection time, not build time.
 * @param {Object} data Published status and optional freshness threshold.
 * @return {boolean} Whether the successful collection time is missing or stale.
 */
function updateSnapshotNotice(data) {
  const { lastSuccessfulUpdate: lastSuccess, thresholdHours: threshold, known, stale } = publicationFreshness(data);
  element("snapshot-notice").hidden = !stale;
  element("snapshot-notice").classList.toggle("is-stale", stale);
  element("snapshot-title").textContent = "Published data may be out of date";
  element("snapshot-message").textContent = !known ? "The published data has no successful update time. Refresh this page to check for a newer publication."
    : stale ? `Last successful update: ${updatedLabel(lastSuccess)}. The data is more than ${threshold} hours old; check original listings for changes.`
    : "";
  return stale;
}

/** Keep the last successful update visible and warn when it is stale. */
function updateStatus(data) {
  if (!data) return;
  statusData = data;
  const stale = updateSnapshotNotice(data);
  const successfulUpdate = data.lastSuccessfulUpdate || data.lastUpdated;
  element("last-updated").textContent = successfulUpdate ? `Last successful update ${updatedLabel(successfulUpdate)}${stale ? " · may be out of date" : ""}` : "No successful update time published";
  clearTimeout(statusTimer);
  statusTimer = setTimeout(loadStatus, 15 * 60000);
}

/** Check for a new generation and recompute date views when an open page ages. */
async function loadStatus() {
  try {
    const data = await dataClient.getStatus();
    const changed = currentData && (currentData.lastUpdated !== data.lastUpdated || currentData.generatedAt !== data.generatedAt);
    const dateChanged = today !== dateKey(new Date());
    updateStatus(data);
    if (changed) {
      sourceData = null;
      if (sourcePanelsOpen()) loadSourceDirectory();
    }
    if ((changed || dateChanged || state.eventView === "ongoing") && !element("detail-dialog").open) loadEvents();
  } catch {
    const lastSuccess = statusData?.lastSuccessfulUpdate || statusData?.lastUpdated;
    element("last-updated").textContent = lastSuccess ? `Last successful update ${updatedLabel(lastSuccess)} · update check unavailable` : "Published update status temporarily unavailable";
    element("snapshot-notice").hidden = false;
    element("snapshot-notice").classList.add("is-stale");
    element("snapshot-title").textContent = "Couldn’t check for published updates";
    element("snapshot-message").textContent = `${lastSuccess ? `Last successful update: ${updatedLabel(lastSuccess)}. ` : ""}Refresh this page to try again; check original listings for the latest details.`;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(loadStatus, 60000);
  }
}

/**
 * Collect distinct safe original event and source links.
 * @param {Object} event Event record.
 * @return {Array<{url:string,label:string}>} Safe source links.
 */
function originalLinks(event) {
  const sources = Array.isArray(event.sources) ? event.sources : [];
  const records = new Map();
  const download = url => {
    const parsed = new URL(url);
    return /\.ics$/i.test(parsed.pathname) || /\/calendar\/ical\//i.test(parsed.pathname)
      || ["format", "output"].some(key => /^(?:ics|ical|icalendar)$/i.test(parsed.searchParams.get(key) || ""));
  };
  const add = (value, kind, owner = "") => {
    const url = safeUrl(value);
    if (!url || records.has(url)) return;
    records.set(url, { url, kind: download(url) ? "calendar-download" : kind, owner });
  };
  const primaryKind = event.linkKind === "calendar-viewer" ? "calendar-viewer" : event.linkKind === "source-page" ? "source-page" : "event-detail";
  [event.url, event.originalUrl, event.link].forEach(url => add(url, primaryKind));
  sources.forEach(source => {
    if (typeof source === "string") { add(source, "source-page"); return; }
    if (!source || typeof source !== "object") return;
    const owner = String(source.org || source.name || source.title || source.department || "").trim();
    const eventUrl = safeUrl(source.eventUrl);
    const listings = [source.url, source.link].map(safeUrl).filter(Boolean);
    add(eventUrl, listings.includes(eventUrl) ? "source-page" : "event-detail", owner);
    listings.forEach(url => add(url, "source-page", owner));
  });
  // Keep every original source URL. Related-page evidence can also contain its
  // slash-normalized form; that inferred alias does not need a second UI link.
  (Array.isArray(event.relatedEventUrls) ? event.relatedEventUrls : []).forEach(url => {
    const key = safeUrl(url).replace(/\/$/, "");
    if (![...records.keys()].some(original => original.replace(/\/$/, "") === key)) add(url, "event-detail");
  });
  const links = [...records.values()];
  let primary = links[0];
  if (primary?.kind === "calendar-download") primary = links.find(link => link.kind === "event-detail")
    || links.find(link => link.kind === "calendar-viewer") || links.find(link => link.kind !== "calendar-download") || primary;
  const primaryLabels = { "event-detail": "View original event", "source-page": "Open source listing", "calendar-viewer": "Open published calendar", "calendar-download": "Download calendar feed" };
  const sourceLabels = { "event-detail": "Event details", "source-page": "Source listing", "calendar-viewer": "Published calendar", "calendar-download": "Calendar feed (download)" };
  return primary ? [primary, ...links.filter(link => link !== primary)].map((link, index) => ({ url: link.url,
    label: index === 0 ? primaryLabels[link.kind] : `${link.owner || new URL(link.url).hostname} · ${sourceLabels[link.kind]}` })) : [];
}

/**
 * Open the accessible details drawer after its content has been rendered.
 * @return {void}
 */
function openDialog() {
  closeFilters();
  previousFocus = document.activeElement;
  document.body.classList.add("dialog-open");
  element("detail-dialog").showModal();
  element("detail-dialog").scrollTop = 0;
  element("dialog-close").focus({ preventScroll: true });
}

/**
 * Render a source-preserving event detail drawer.
 * @param {Object} event Selected event.
 * @return {void}
 */
function openEvent(event) {
  const title = plainText(event.title) || "Untitled event";
  const description = plainText(event.description);
  const summary = eventSummary(event);
  const tags = discoveryTags(event);
  const links = originalLinks(event);
  const orgs = Array.isArray(event.orgs) && event.orgs.length ? event.orgs : [event.org || event.organizer || "Carnegie Mellon University"];
  const departments = Array.isArray(event.departments) && event.departments.length ? event.departments : [event.department].filter(Boolean);
  const location = plainText(event.location?.name || event.location || "") || "See the original listing for location details";
  const timezone = event.timeZone || event.timezone;
  const continuous = event.scheduleKind === "continuous";
  const status = /cancel|postpon/i.test(event.status || "") ? `<p class="notice"><strong>This event is ${escapeHtml(event.status.toLowerCase())}. Check the original listing for updates.</strong></p>` : "";
  const variants = Array.isArray(event.sourceVariants) ? event.sourceVariants.filter(variant => variant && typeof variant === "object") : [];
  const conflictLabels = { location: "location", end: "end time", status: "event status", title: "event title" };
  const conflicts = [...new Set((Array.isArray(event.sourceConflicts) ? event.sourceConflicts : []).map(field => conflictLabels[field]).filter(Boolean))];
  const sourceNotice = conflicts.length ? `<p class="notice"><strong>Source listings differ on ${escapeHtml(conflicts.join(", "))}.</strong> Compare source versions and confirm current details with the organizer.</p>` : "";
  const sourceVersions = variants.length ? `<details class="full-description source-versions"><summary>Source versions (${variants.length})</summary><div class="full-description-text">${variants.map(variant => {
    const sourceIds = new Set(Array.isArray(variant.sourceIds) ? variant.sourceIds : []);
    const publishers = [...new Set((Array.isArray(event.sources) ? event.sources : []).filter(source => source && sourceIds.has(source.id))
      .map(source => source.org || source.name || source.title || source.department).filter(Boolean))];
    const version = { ...variant, endExclusive: variant.endExclusive ?? Boolean(variant.allDay) };
    const versionDescription = typeof variant.description === "string" ? variant.description : variant.descriptionMatchesCanonical === true ? description : "";
    const versionStatus = ({ scheduled: "Scheduled", cancelled: "Cancelled", postponed: "Postponed" })[variant.status] || variant.status || "Not listed";
    return `<section class="source-version"><p><strong>${escapeHtml(variant.title || title)}</strong><br>${escapeHtml(publishers.join(" · ") || "Original source")}</p><p>${escapeHtml(eventDateLabel(version))}<br>${escapeHtml(eventTime(version))}${variant.timeZone ? `<br>Source time zone: ${escapeHtml(variant.timeZone)}` : ""}<br>Location: ${escapeHtml(variant.location?.name || variant.location || "Not listed")}<br>Status: ${escapeHtml(versionStatus)}${variant.organizer ? `<br>Organizer: ${escapeHtml(variant.organizer)}` : ""}</p>${versionDescription ? `<p>${escapeHtml(versionDescription)}</p>` : '<p>The source did not include an event description.</p>'}</section>`;
  }).join("")}</div></details>` : "";
  element("detail-content").innerHTML = `<div class="detail-body"><div class="detail-tags">${tags.map(tag => `<span class="category-label" data-color="${tagColor(tag)}">${escapeHtml(tag)}</span>`).join("")}</div>
    <h2 class="detail-title" id="detail-title">${escapeHtml(title)}</h2>${status}${sourceNotice}
    <div class="detail-facts"><div class="detail-fact">${icon("calendar")}<div><strong>${escapeHtml(eventDateLabel(event))}</strong><small>${escapeHtml(eventTime(event))}${timezone && timezone !== DISPLAY_TIMEZONE && !event.allDay ? ` · Source time zone: ${escapeHtml(timezone)}` : ""}</small></div></div>
    <div class="detail-fact">${icon(modeSlug(event.mode) === "online" ? "screen" : "pin")}<div><strong>${escapeHtml(location)}</strong><small>${escapeHtml([event.campus, event.mode && modeLabel(event.mode)].filter(Boolean).join(" · "))}</small></div></div></div>
    ${continuous ? '<p class="period-note">Check the original listing for opening days, session times, and closures.</p>' : ""}${tags.includes("Recurring") ? `<p class="recurrence-note">${escapeHtml(recurrenceLabel(event))}.</p>` : ""}
    ${links.length ? `<a class="button-primary detail-link" href="${escapeHtml(links[0].url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(links[0].label)}<span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a><p class="original-note">Registration, eligibility, tickets, and the latest changes live with the organizer.</p>` : '<p class="original-note">The source did not provide a public event link.</p>'}
    <p class="detail-summary">${escapeHtml(summary)}</p>
    ${description && description !== summary ? `<details class="full-description"><summary>Read full event description</summary><div class="full-description-text">${escapeHtml(description)}</div></details>` : ""}
    ${sourceVersions}
    <p class="detail-org">Published via ${escapeHtml(orgs.join(" · "))}${event.organizer ? `<br>Hosted by ${escapeHtml(plainText(event.organizer))}` : ""}${departments.length ? `<br>${escapeHtml(departments.join(" · "))}` : ""}</p>
    ${links.length > 1 ? `<section class="other-sources"><h3 class="detail-section-heading">Also listed by</h3>${links.slice(1).map(link => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`).join("")}</section>` : ""}</div>`;
  openDialog();
}

/**
 * Return whether a source directory panel is open.
 * @return {boolean} Whether the sources or subscriptions dialog is open.
 */
function sourcePanelsOpen() {
  return ["sources", "subscriptions"].some(panel => element(`${panel}-dialog`).open);
}

/**
 * Keep background scrolling locked while any modal is open.
 * @return {void} No return value.
 */
function syncDialogLock() {
  document.body.classList.toggle("dialog-open", Boolean(document.querySelector("dialog[open]")));
}

/**
 * Resolve a readable category from the published source metadata.
 * @param {Object} source Catalogued source with an optional category and kind.
 * @return {string} Category label for the source directory.
 */
function sourceCategory(source) {
  const category = typeof source.category === "string" ? plainText(source.category) : "";
  if (category) return category;
  return ({ event_listing: "Event pages", university_calendar: "University calendars", ical_feed: "Calendar feeds", organization_listing: "Directories", mailing_list: "Mailing lists", newsletter_archive: "Newsletter archives", rss_feed: "News feeds" })[source.kind] || "Other sources";
}

/**
 * Read the curated email channel metadata for a source.
 * @param {Object} source Catalogued source with optional subscription metadata.
 * @return {Object|null} Recognized subscription metadata, or null when absent.
 */
function sourceSubscription(source) {
  const subscription = source.subscription;
  return subscription && ["subscriber_only", "public_plus_email"].includes(subscription.kind) ? subscription : null;
}

/**
 * Find the newest recorded review without treating it as a current crawl result.
 * @param {Object} source Runtime source with optional historical evidence.
 * @return {number} Latest valid review timestamp, or zero.
 */
function latestSourceReviewAt(source) {
  return Math.max(0, ...["accessReview", "visualReview", "followupResolution"]
    .map(key => Date.parse(source.evidence?.[key]?.checkedAt)).filter(Number.isFinite));
}

/**
 * Check recorded collection health and review flags.
 * @param {Object} source Source record with runtime state and review evidence.
 * @return {boolean} Whether this source needs another check.
 */
function sourceNeedsAttention(source) {
  if (["error", "blocked", "unsupported", "pending"].includes(source.state)) return true;
  if (source.coverage?.version === 1 && source.coverage.inspectionComplete === true
    && Date.parse(source.coverage.checkedAt) >= latestSourceReviewAt(source)) {
    return source.coverage.internalIssues.length > 0 || source.coverage.externalIssues.length > 0;
  }
  return source.evidence?.visualReview?.requiresReview === true
    || source.evidence?.accessReview?.attention === true;
}

/**
 * Filter the complete source response before applying display limits.
 * @return {Array<Object>} Matching sources in department and name order.
 */
function matchingSources() {
  const terms = sourceFilters.query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return (sourceData || []).filter(source => {
    const subscription = sourceSubscription(source);
    if (sourceFilters.department && source.department !== sourceFilters.department) return false;
    if (sourceFilters.category && sourceCategory(source) !== sourceFilters.category) return false;
    if (sourceFilters.coverage !== "all") {
      const matchesCoverage = ({
        imported: Number(source.eventCount) > 0,
        covered: source.state === "covered",
        zero: source.state === "empty",
        undated: source.state === "undated",
        attention: sourceNeedsAttention(source),
        email: subscription?.kind === "subscriber_only",
      })[sourceFilters.coverage];
      if (!matchesCoverage) return false;
    }
    const searchable = [source.org, source.department, source.url, source.fetchUrl, sourceCategory(source), subscription?.title, subscription?.url].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }).sort((left, right) => String(left.department || "").localeCompare(String(right.department || ""))
    || String(left.org || "").localeCompare(String(right.org || "")) || String(left.id || left.url).localeCompare(String(right.id || right.url)));
}

/**
 * Say in plain words what a visitor gets from a source.
 * @param {Object} source Source record containing its runtime state.
 * @return {string} Event count or short status.
 */
function sourceStateLabel(source) {
  const count = Number(source.eventCount || 0);
  if (count > 0) return `${count.toLocaleString()} ${count === 1 ? "event" : "events"}`;
  if (source.state === "ok" && source.excludedCount > 0) return "No activities listed";
  if (source.state === "error" && source.coverage?.inspectionComplete && !source.coverage.internalIssues.length) return "Source limitation";
  return ({ error: "Needs review", blocked: "Access restricted", unsupported: "Not supported yet", pending: "Not checked yet", subscription_only: "Mailing list only", empty: "No events right now", undated: "No dated schedule", ok: "No events right now", covered: "Shared feed" })[source.state] || "Status unavailable";
}

/**
 * Describe public coverage without inferring organization-wide emptiness.
 * @param {Object} source Source record with state, event count and optional subscription.
 * @return {string} Reader-facing summary of the current coverage boundary.
 */
function sourceSummary(source) {
  const subscription = sourceSubscription(source);
  if (subscription?.kind === "subscriber_only") return "This group’s mailing list announcements are not imported into the event calendar.";
  if (subscription?.kind === "public_plus_email") return "Public calendar events may be included. Mailing list content is not imported.";
  const count = Number(source.eventCount || 0).toLocaleString();
  if (source.state === "ok" && Number(source.eventCount) === 0 && source.excludedCount > 0) return "This window contains notices or date ranges without activity sessions; those records are excluded from the activity calendar.";
  if (source.state === "error" && source.coverage?.inspectionComplete && !source.coverage.internalIssues.length) {
    return Number(source.eventCount) > 0 ? `${count} imported occurrences are available; some publisher details remain unresolved.`
      : "No verified occurrences were imported in this collection window. Publisher date or access limitations remain in the coverage notes.";
  }
  if (source.state === "error" && Number(source.eventCount) > 0) return `${count} imported occurrences remain available while the latest check needs review.`;
  return ({
    ok: `${count} occurrences imported within the collection window.`,
    covered: "Included through a shared public feed, with this source kept in the event attribution.",
    empty: "No occurrences imported in this source’s collection window. The publisher may list events elsewhere.",
    undated: "A public resource without a verified dated schedule. Changes are monitored for review.",
    blocked: "This source has an access restriction. Open the original page and the coverage notes for details.",
    unsupported: "The original source is catalogued; its event format still needs an integration.",
    pending: "This source has not completed its first check.",
    error: "The latest collection could not be completed. See the original source for current information.",
  })[source.state] || "Open the original source for its current announcements and event details.";
}

/**
 * Render access checks separately from recorded visual evidence.
 * @param {Object} source Source record with optional access and visual review evidence.
 * @return {string} Escaped review markup, or an empty string without evidence.
 */
function sourceVisualReview(source) {
  const access = source.evidence?.accessReview;
  const review = source.evidence?.visualReview;
  const resolution = source.evidence?.followupResolution;
  const paragraphs = [];
  if (access) paragraphs.push(`<div class="diagnostic-visual-review"><p><strong>Recorded access check</strong>${access.checkedAt ? ` · ${escapeHtml(updatedLabel(access.checkedAt))}` : ""}</p>${access.reason ? `<p>${escapeHtml(plainText(access.reason))}</p>` : ""}${access.nextStep ? `<p><strong>Next step:</strong> ${escapeHtml(plainText(access.nextStep))}</p>` : ""}</div>`);
  if (review && typeof review === "object") {
    const url = safeUrl(review.url);
    paragraphs.push(`<div class="diagnostic-visual-review"><p><strong>Recorded visual review</strong>${review.checkedAt ? ` · ${escapeHtml(updatedLabel(review.checkedAt))}` : ""}</p>${review.note ? `<p>${escapeHtml(plainText(review.note))}</p>` : ""}${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Reviewed page <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : ""}</div>`);
  }
  if (resolution) {
    if (resolution.reason) paragraphs.push(`<p><strong>Review finding:</strong> ${escapeHtml(plainText(resolution.reason))}</p>`);
    if (resolution.nextStep) paragraphs.push(`<p><strong>Next step:</strong> ${escapeHtml(plainText(resolution.nextStep))}</p>`);
    if (Array.isArray(resolution.accessRestrictions)) paragraphs.push(...resolution.accessRestrictions.map(item => `<p><strong>${item.requiredForPublicCoverage === false ? "Additional channel" : "Access needed"}:</strong> ${escapeHtml(plainText(item.reason))}${item.nextStep ? ` ${escapeHtml(plainText(item.nextStep))}` : ""}</p>`));
  }
  return paragraphs.join("");
}

/**
 * Render collapsible coverage notes for one source.
 * @param {Object} source Source record with collection results and review evidence.
 * @return {string} Escaped diagnostics details markup.
 */
function sourceDiagnostics(source) {
  const reason = plainText(source.error || source.reason);
  const warnings = (Array.isArray(source.warnings) ? source.warnings : []).map(plainText).filter(Boolean);
  const audit = source.coverage;
  const currentAudit = audit ? `<p><strong>Latest automated inspection${audit.checkedAt ? ` · ${escapeHtml(updatedLabel(audit.checkedAt))}` : ""}</strong><br>${audit.inspectionComplete ? "All discovered candidates were checked." : "Some discovered candidates still need collection work."} ${audit.internalIssues.length} collection gap(s); ${audit.externalIssues.length} publisher issue(s). Any field uncertainty appears in the notes below.</p>` : "";
  const exclusionNote = source.excludedCount > 0 ? `<p>${Number(source.excludedCount).toLocaleString()} notice, registration/sales window, or non-activity record(s) were excluded from the activity calendar.</p>` : "";
  const review = sourceVisualReview(source);
  const reviewMarkup = review && audit && Date.parse(audit.checkedAt) > latestSourceReviewAt(source)
    ? `<details class="source-card-review"><summary>Earlier review notes · historical</summary><p>These records predate the latest automated inspection and may describe limitations that have since been resolved.</p>${review}</details>` : review;
  return `<details class="source-card-review"><summary>Details</summary>${currentAudit}${exclusionNote}${reason ? `<p>${escapeHtml(reason)}</p>` : ""}${warnings.length ? `<ul>${warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}<p>${escapeHtml(sourceSummary(source))}</p>${source.lastAttempt ? `<p>Last attempted check: ${escapeHtml(updatedLabel(source.lastAttempt))}.</p>` : ""}${reviewMarkup}</details>`;
}

/**
 * Prefer curated subscription requirements over derived access labels.
 * @param {Object} subscription Curated requirements and optional access flags.
 * @return {Array<string>} Distinct readable requirements, using flags only as a fallback.
 */
function subscriptionRequirements(subscription) {
  const requirements = (Array.isArray(subscription.requirements) ? subscription.requirements : []).map(plainText).filter(Boolean);
  if (requirements.length) return [...new Set(requirements)];
  const labels = { emailConfirmation: "Email confirmation required", moderatorApproval: "Moderator approval required", andrewOnly: "Andrew email required", loginRequired: "Login required", captcha: "CAPTCHA required" };
  Object.entries(labels).forEach(([key, label]) => {
    if (subscription.access?.[key] === true && !requirements.some(value => value.toLocaleLowerCase().includes(label.toLocaleLowerCase()))) requirements.push(label);
  });
  return [...new Set(requirements)];
}

/**
 * Render one source for browsing, with its notes tucked away.
 * @param {Object} source Catalogued source with coverage metadata.
 * @return {string} Escaped source row markup.
 */
function sourceRow(source) {
  const title = plainText(source.org || source.department || "CMU source");
  const url = safeUrl(source.url);
  const state = source.state === "subscription_only" ? `<button class="source-card-state" type="button" data-state="subscription_only" data-open-subscriptions>${escapeHtml(sourceStateLabel(source))}</button>`
    : `<span class="source-card-state" data-state="${escapeHtml(Number(source.eventCount) > 0 ? "ok" : source.state || "pending")}">${escapeHtml(sourceStateLabel(source))}</span>`;
  const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url.replace(/^https?:\/\//, "").replace(/\/$/, ""))} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : "Original URL unavailable";
  return `<article class="source-row" data-source-id="${escapeHtml(source.id)}"><div class="source-row-main"><h4 class="source-card-title" tabindex="-1">${escapeHtml(title)}</h4><p class="source-card-meta">${escapeHtml(sourceCategory(source))} · ${link}</p></div>${state}${sourceDiagnostics(source)}</article>`;
}

/**
 * Render one mailing list as a way to find more events.
 * @param {Object} source Catalogued source with subscription metadata.
 * @return {string} Escaped subscription card markup.
 */
function subscriptionCard(source) {
  const subscription = sourceSubscription(source);
  const signupUrl = safeUrl(subscription.url);
  const requirements = subscriptionRequirements(subscription);
  return `<article class="source-card subscription-card"><h4 class="source-card-title">${escapeHtml(plainText(subscription.title || source.org || "CMU mailing list"))}</h4><p class="source-card-department">${escapeHtml(source.department || "Carnegie Mellon University")}</p>${requirements.length ? `<p class="subscription-steps-title">To join</p><ul class="subscription-requirements">${requirements.map(requirement => `<li>${escapeHtml(requirement)}</li>`).join("")}</ul>` : ""}${signupUrl ? `<a class="button-primary subscription-link" href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener noreferrer">Join this list <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : ""}</article>`;
}

/**
 * Build the expandable explanation of calendar coverage.
 * @param {boolean} open Whether the explanation starts expanded.
 * @return {string} Calendar explanation markup.
 */
function howItWorksMarkup(open = false) {
  return `<details class="source-how-it-works source-card-review" id="sources-how-it-works"${open ? " open" : ""}><summary>How the calendar works</summary><div class="source-explanation"><h3>From across the university</h3><p>CMU Events follows university calendars, academic departments, research centers, offices, and other non-club publishers. Independent student-club websites and their own feeds are excluded. Activities published by retained sources are kept, including events hosted by student clubs.</p><h3>Published daily</h3><p>New event collections are published daily, and open pages pick them up on their own. The last successful update and any stale-data warning remain visible while you browse.</p><h3>What the collection window covers</h3><p>Each refresh imports occurrences from the previous 30 days through the next 365 days. Zero imported events describes that source and window. It does not mean the original page or organization has no activities. An automated check and a recorded visual review are identified separately in each source’s coverage notes.</p><h3>Useful context stays attached</h3><p>Department and organization come from the source catalogue. Topics are discovery aids based on published event text. Matching events from several calendars can be combined; summaries remain excerpts, and every event keeps its original public link.</p><h3>Check the original listing</h3><p>Registration, tickets, eligibility, audience requirements, and the latest updates belong to the organizer. Public calendar coverage can work while a separate member or email channel remains restricted.</p><h3>Events on mailing lists</h3><p>Some groups announce events only on their mailing lists, and this website can’t show those yet. The Mailing lists page shows how to join them.</p><button class="text-button" type="button" data-open-subscriptions>Browse mailing lists</button></div></details>`;
}

/**
 * Build the source directory's stable controls once per opening.
 * @param {boolean} showHowItWorks Whether to expand the calendar explanation.
 * @return {void} No return value.
 */
function renderSourcesShell(showHowItWorks = false) {
  element("sources-content").innerHTML = `<div class="source-directory"><header class="source-directory-intro"><h2 class="source-directory-title" id="sources-title">Our sources</h2><p class="source-directory-lede">Every calendar, department page and feed we collect events from. Open any of them to see the original.</p><p class="source-directory-stats" id="sources-stats"></p></header><div class="source-directory-controls" role="group" aria-label="Filter sources"><label class="source-search-field" for="sources-search">Search sources<input id="sources-search" data-source-query type="search" placeholder="Organization, department, or URL" autocomplete="off" maxlength="200" value="${escapeHtml(sourceFilters.query)}"></label><label class="source-filter-field" for="sources-department">Department<select id="sources-department" data-source-filter="department"><option value="">All departments</option></select></label><label class="source-filter-field" for="sources-category">Category<select id="sources-category" data-source-filter="category"><option value="">All categories</option></select></label><label class="source-filter-field" for="sources-coverage">Coverage<select id="sources-coverage" data-source-filter="coverage">${[["all", "All coverage"], ["imported", "Has events"], ["covered", "Shared feed"], ["zero", "No events right now"], ["undated", "No dated schedule"], ["attention", "Needs review"], ["email", "Mailing list only"]].map(([value, label]) => `<option value="${value}"${sourceFilters.coverage === value ? " selected" : ""}>${label}</option>`).join("")}</select></label></div><p class="source-directory-count" id="sources-count" role="status" aria-live="polite"></p><div id="sources-results" aria-busy="true"></div>${howItWorksMarkup(showHowItWorks)}<p class="source-time" id="sources-updated"></p></div>`;
}

/**
 * Build the Mailing lists page, which points people to events this site can't show yet.
 * @return {void} No return value.
 */
function renderSubscriptionsShell() {
  element("subscriptions-content").innerHTML = '<div class="source-directory"><header class="source-directory-intro"><h2 class="source-directory-title" id="subscriptions-title">More events on mailing lists</h2><p class="source-directory-lede">Some groups share events through their own mailing lists, and this website can’t show those events yet. Join a list to hear from that group directly.</p></header><div id="subscriptions-results" aria-busy="true"></div></div>';
}

/**
 * Populate source facets while retaining the current selections.
 * @return {void} No return value.
 */
function updateSourceOptions() {
  [["department", [...new Set(sourceData.map(source => source.department).filter(Boolean))], "All departments"], ["category", [...new Set(sourceData.map(sourceCategory))], "All categories"]].forEach(([key, values, placeholder]) => {
    if (sourceFilters[key] && !values.includes(sourceFilters[key])) values.push(sourceFilters[key]);
    const select = element(`sources-${key}`);
    const html = `<option value="">${placeholder}</option>${values.sort((a, b) => a.localeCompare(b)).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (select.innerHTML !== html) select.innerHTML = html;
    select.value = sourceFilters[key];
  });
}

/**
 * Show the shared loading or failure state for either directory.
 * @param {HTMLElement} container Directory results element.
 * @return {boolean} Whether source data is ready to render.
 */
function renderDirectoryState(container) {
  container.setAttribute("aria-busy", String(Boolean(sourceRequest)));
  if (sourceData) return true;
  container.innerHTML = sourceLoadError ? `<div class="source-empty-state"><h3>We couldn’t load this list.</h3><p>${escapeHtml(sourceLoadError)}</p><button type="button" class="button-secondary" data-source-retry>Try again</button></div>` : '<div class="source-empty-state" role="status"><span class="small-spinner" aria-hidden="true"></span><p>Loading…</p></div>';
  return false;
}

/**
 * Render the source directory, grouped by department.
 * @return {void} No return value.
 */
function renderSourcesPanel() {
  const container = element("sources-results");
  if (!container) return;
  const count = element("sources-count");
  if (!renderDirectoryState(container)) {
    element("sources-stats").textContent = "";
    count.textContent = sourceLoadError ? "Source directory unavailable" : "Loading sources…";
    return;
  }
  updateSourceOptions();
  const matching = matchingSources();
  const visible = matching.slice(0, sourceFilters.limit);
  element("sources-stats").textContent = `${sourceData.length.toLocaleString()} sources · ${new Set(sourceData.map(source => source.department).filter(Boolean)).size.toLocaleString()} departments`;
  count.textContent = `Showing ${visible.length.toLocaleString()} of ${matching.length.toLocaleString()} matching sources${matching.length !== sourceData.length ? ` · ${sourceData.length.toLocaleString()} total` : ""}.`;
  if (!matching.length) container.innerHTML = `<div class="source-empty-state"><h3>${sourceData.length ? "No sources match these filters." : "No sources are listed yet."}</h3><p>${sourceData.length ? "Try another department, category, or search." : "Check back after the next source update."}</p>${sourceData.length ? '<button class="text-button" type="button" data-source-reset>Clear directory filters</button>' : ""}</div>`;
  else {
    const groups = new Map();
    visible.forEach(source => { const department = source.department || "Carnegie Mellon University"; if (!groups.has(department)) groups.set(department, []); groups.get(department).push(source); });
    container.innerHTML = `${[...groups].map(([department, rows]) => `<section class="source-group" aria-label="${escapeHtml(department)}"><h3 class="source-group-heading">${escapeHtml(department)}</h3><div class="source-list">${rows.map(sourceRow).join("")}</div></section>`).join("")}${visible.length < matching.length ? `<div class="source-load-more"><button class="button-secondary" type="button" data-source-more>Show ${Math.min(SOURCE_PAGE_SIZE, matching.length - visible.length)} more sources</button><button class="text-button" type="button" data-source-all>Show all ${matching.length.toLocaleString()}</button></div>` : ""}`;
  }
  element("sources-updated").textContent = statusData?.lastUpdated ? `Last published refresh: ${updatedLabel(statusData.lastUpdated)}.` : "The first source refresh has not been published yet.";
}

/**
 * Render the mailing lists, separating email-only groups from those adding to a public calendar.
 * @return {void} No return value.
 */
function renderSubscriptionsPanel() {
  const container = element("subscriptions-results");
  if (!container || !renderDirectoryState(container)) return;
  const channels = sourceData.filter(sourceSubscription).sort((left, right) => plainText(sourceSubscription(left).title || left.org).localeCompare(plainText(sourceSubscription(right).title || right.org)));
  const sections = [["subscriber_only", "Only on mailing lists", "These groups’ list announcements don’t appear on this website."], ["public_plus_email", "Extra events on mailing lists", "We show these groups’ public calendars. Their mailing lists add more, such as short-notice announcements."]];
  container.innerHTML = channels.length ? sections.map(([kind, heading, description]) => {
    const rows = channels.filter(source => sourceSubscription(source).kind === kind);
    return rows.length ? `<section class="subscription-section" aria-labelledby="subscription-section-${kind}"><div class="subscription-section-heading"><h3 id="subscription-section-${kind}">${heading} <span>${rows.length.toLocaleString()}</span></h3><p>${description}</p></div><div class="source-card-grid">${rows.map(subscriptionCard).join("")}</div></section>` : "";
  }).join("") : '<div class="source-empty-state"><h3>No mailing lists are listed yet.</h3><p>Check back after the next source update.</p></div>';
}

/**
 * Refresh whichever directory is open.
 * @return {void} No return value.
 */
function renderDirectories() {
  renderSourcesPanel();
  renderSubscriptionsPanel();
}

/**
 * Share one complete source request between both directory panels.
 * @param {boolean} force Whether to discard cached source data before loading.
 * @return {Promise<void>} Resolves after the source request and panel updates finish.
 */
async function loadSourceDirectory(force = false) {
  if (force) { sourceData = null; sourceLoadError = ""; }
  if (!sourceData && !sourceRequest) {
    sourceLoadError = "";
    sourceRequest = (async () => {
      const payload = await dataClient.getSources();
      if (!Array.isArray(payload.sources)) throw new Error("The server did not return a source directory.");
      sourceData = payload.sources.filter(source => source && typeof source === "object");
    })();
  }
  renderDirectories();
  try { await sourceRequest; }
  catch (error) { sourceLoadError = error.message || "Please try again in a moment."; }
  finally {
    sourceRequest = null;
    renderDirectories();
  }
}

/**
 * Open a directory panel while preserving filters and focus.
 * @param {string} panel Directory key: sources or subscriptions.
 * @param {boolean} showHowItWorks Whether to expand and focus the calendar explanation.
 * @return {void} No return value.
 */
function openSourcePanel(panel, showHowItWorks = false) {
  closeFilters();
  const anotherPanelOpen = Boolean(document.querySelector("dialog[open]"));
  const origin = anotherPanelOpen ? element(panel === "sources" ? "about-button" : "subscriptions-button") : document.activeElement;
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  sourcePanelFocus.set(panel, origin);
  if (panel === "sources") renderSourcesShell(showHowItWorks);
  else renderSubscriptionsShell();
  element(`${panel}-dialog`).showModal();
  syncDialogLock();
  element(`${panel}-dialog`).scrollTop = 0;
  element(panel === "sources" ? "sources-search" : "subscriptions-close").focus({ preventScroll: true });
  const loaded = loadSourceDirectory();
  if (showHowItWorks) {
    const summary = element("sources-how-it-works").querySelector("summary");
    summary.focus();
    loaded.then(() => { if (element("sources-dialog").open && document.activeElement === summary) element("sources-how-it-works").scrollIntoView({ block: "start" }); });
  }
}

/**
 * Open the complete source directory and optional calendar explanation.
 * @param {boolean} showHowItWorks Whether to expand and focus the explanation.
 * @return {void} No return value.
 */
function openSourceInfo(showHowItWorks = false) {
  openSourcePanel("sources", showHowItWorks);
}

/**
 * Open the mobile filter panel and move focus into it.
 * @return {void}
 */
function openFilters() {
  filterPreviousFocus = document.activeElement;
  document.body.classList.add("filters-open");
  element("filters").setAttribute("role", "dialog");
  element("filters").setAttribute("aria-modal", "true");
  element("filter-backdrop").hidden = false;
  element("mobile-filter-button").setAttribute("aria-expanded", "true");
  element("close-filters").focus();
}

/**
 * Close the mobile filter panel and restore the initiating focus.
 * @return {void}
 */
function closeFilters() {
  if (!document.body.classList.contains("filters-open")) return;
  document.body.classList.remove("filters-open");
  element("filters").removeAttribute("role");
  element("filters").removeAttribute("aria-modal");
  element("filter-backdrop").hidden = true;
  element("mobile-filter-button").setAttribute("aria-expanded", "false");
  filterPreviousFocus?.focus({ preventScroll: true });
}

/**
 * Wire native control interactions and keyboard navigation.
 * @return {void}
 */
function bindEvents() {
  element("search-form").addEventListener("submit", event => { event.preventDefault(); clearTimeout(searchTimer); applySearch(element("search-input").value); });
  element("search-input").addEventListener("input", event => {
    clearTimeout(searchTimer);
    element("search-clear").hidden = !event.target.value;
    searchTimer = setTimeout(() => applySearch(element("search-input").value), 300);
  });
  element("search-clear").addEventListener("click", () => { clearTimeout(searchTimer); applySearch(""); element("search-input").focus(); });
  ["department", "org", "campus"].forEach(key => element(`${key}-filter`).addEventListener("change", event => changeFilter(key, event.target.value)));
  element("mode-options").addEventListener("click", event => { const button = event.target.closest("[data-mode]"); if (button) changeFilter("mode", button.dataset.mode); });
  ["topic-options", "recurring-option", "quick-topics"].forEach(id => element(id).addEventListener("click", event => { const button = event.target.closest("[data-tag]"); if (button) toggleTag(button.dataset.tag); }));
  element("active-filters").addEventListener("click", event => { const button = event.target.closest("[data-remove]"); if (button) { if (button.dataset.remove === "tag") toggleTag(button.dataset.value); else changeFilter(button.dataset.remove, ""); } });
  ["reset-filters", "empty-reset"].forEach(id => element(id).addEventListener("click", resetFilters));
  element("empty-next").addEventListener("click", () => { if (emptyTarget) selectView(emptyTarget.view, emptyTarget.day); });
  element("day-picker").addEventListener("change", event => { if (validDate(event.target.value)) selectView("day", event.target.value); });
  element("retry-button").addEventListener("click", () => dataClient.refresh().catch(() => {}).finally(() => loadEvents()));
  element("more-by-email").addEventListener("click", () => openSourcePanel("subscriptions"));
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => { state.view = button.dataset.view; syncControls(); updateUrl(); }));
  element("event-results").addEventListener("click", event => {
    const jump = event.target.closest("[data-section]");
    if (jump) return jumpToSection(jump.dataset.section);
    const tag = event.target.closest("[data-tag]");
    if (tag) return toggleTag(tag.dataset.tag, true);
    const button = event.target.closest("[data-event]");
    if (button && eventMap.has(button.dataset.event)) openEvent(eventMap.get(button.dataset.event));
  });
  element("show-more-events").addEventListener("click", () => { state.page += 1; loadEvents(false, true); });
  element("event-browser").addEventListener("click", event => {
    const button = event.target.closest("[data-event-view]");
    if (button) selectView(button.dataset.eventView, button.dataset.day);
  });
  element("event-browser").addEventListener("keydown", event => {
    const buttons = [...element("event-browser").querySelectorAll("[data-event-view]")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    selectView(buttons[next].dataset.eventView, buttons[next].dataset.day);
  });
  element("event-browser").addEventListener("wheel", event => {
    const strip = event.currentTarget;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || strip.scrollWidth <= strip.clientWidth) return;
    event.preventDefault();
    strip.scrollLeft += event.deltaY;
  }, { passive: false });
  element("about-button").addEventListener("click", () => openSourceInfo());
  element("subscriptions-button").addEventListener("click", () => openSourcePanel("subscriptions"));
  element("dialog-close").addEventListener("click", () => element("detail-dialog").close());
  element("detail-dialog").addEventListener("close", () => { syncDialogLock(); if (!document.querySelector("dialog[open]")) previousFocus?.focus({ preventScroll: true }); });
  element("detail-dialog").addEventListener("click", event => { if (event.target === element("detail-dialog") && event.clientX < element("detail-dialog").getBoundingClientRect().left) element("detail-dialog").close(); });
  ["sources", "subscriptions"].forEach(panel => {
    const dialog = element(`${panel}-dialog`);
    element(`${panel}-close`).addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { syncDialogLock(); if (!document.querySelector("dialog[open]")) sourcePanelFocus.get(panel)?.focus({ preventScroll: true }); });
    dialog.addEventListener("click", event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    element(`${panel}-content`).addEventListener("click", event => {
      if (event.target.closest("[data-open-subscriptions]")) return openSourcePanel("subscriptions");
      if (event.target.closest("[data-source-retry]")) return loadSourceDirectory(true);
      if (event.target.closest("[data-source-reset]")) {
        Object.assign(sourceFilters, { query: "", department: "", category: "", coverage: "all", limit: SOURCE_PAGE_SIZE });
        element("sources-search").value = "";
        element("sources-coverage").value = "all";
        renderSourcesPanel();
        element("sources-search").focus();
      }
      if (event.target.closest("[data-source-more], [data-source-all]")) {
        const existing = new Set([...element("sources-results").querySelectorAll("[data-source-id]")].map(row => row.dataset.sourceId));
        sourceFilters.limit = event.target.closest("[data-source-all]") ? matchingSources().length : sourceFilters.limit + SOURCE_PAGE_SIZE;
        renderSourcesPanel();
        [...element("sources-results").querySelectorAll("[data-source-id]")].find(row => !existing.has(row.dataset.sourceId))?.querySelector(".source-card-title")?.focus();
      }
    });
  });
  element("sources-content").addEventListener("input", event => {
    if (!event.target.matches("[data-source-query]")) return;
    sourceFilters.query = event.target.value;
    sourceFilters.limit = SOURCE_PAGE_SIZE;
    renderSourcesPanel();
  });
  element("sources-content").addEventListener("change", event => {
    const key = event.target.dataset.sourceFilter;
    if (!["department", "category", "coverage"].includes(key)) return;
    sourceFilters[key] = event.target.value;
    sourceFilters.limit = SOURCE_PAGE_SIZE;
    renderSourcesPanel();
  });
  element("mobile-filter-button").addEventListener("click", openFilters);
  ["close-filters", "filter-backdrop", "show-events"].forEach(id => element(id).addEventListener("click", closeFilters));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeFilters();
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !document.querySelector("dialog[open]") && !document.body.classList.contains("filters-open")) { event.preventDefault(); element("search-input").focus(); }
    if (event.key === "Tab" && document.body.classList.contains("filters-open")) {
      const controls = [...element("filters").querySelectorAll('button:not(:disabled),input,select,a[href]')].filter(control => control.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!element("filters").contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.matchMedia("(min-width: 960px)").addEventListener("change", event => { if (event.matches) closeFilters(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadStatus(); refreshClockStates(); } });
  setInterval(refreshClockStates, 60000);
}

/**
 * Initialize the calendar, controls, and published data requests.
 * @return {void}
 */
function initialize() {
  syncToday();
  element("display-timezone").textContent = DISPLAY_TIMEZONE;
  syncControls();
  bindEvents();
  loadEvents();
  loadStatus();
}

initialize();
