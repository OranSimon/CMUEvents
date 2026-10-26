import { createDataClient, publicationFreshness } from "./data-client.js";

const DISPLAY_TIMEZONE = "America/New_York";
const PAGE_SIZE = 48;
const TODAY_REQUEST_SIZE = 100;
const EVENT_VIEWS = ["today", "upcoming", "recurring", "ongoing"];
const SOURCE_PAGE_SIZE = 30;
const INITIAL_TITLE = "CMU Events · Discover your campus";
const STATIC_MODE = document.documentElement.dataset.mode === "static";
const dataClient = createDataClient({ mode: STATIC_MODE ? "static" : "api", baseUrl: new URL("./", import.meta.url) });

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
 * Format event times with both zone abbreviations when a range crosses DST.
 * @param {Object} event Event record.
 * @return {string} Human-readable event time.
 */
function eventTime(event) {
  const start = event.start || event.startDate || event.date;
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
  let endDay = "";
  if (event.end) {
    endDay = eventDay({ ...event, start: event.end });
    if (event.allDay && event.endExclusive && endDay) endDay = shiftDate(endDay, -1);
  }
  return endDay && endDay > day ? `${label} – ${calendarLabel(endDay, { month: "long", day: "numeric", year: "numeric" })}` : label;
}

/**
 * Reduce a description to a deterministic source-text excerpt.
 * @param {Object} event Event record.
 * @return {string} Source summary or readable excerpt.
 */
function eventSummary(event) {
  const summary = plainText(event.summary);
  if (summary) return summary;
  const description = plainText(event.description).replace(/\s+/g, " ");
  if (!description) return "Open the original event listing for program details and registration information.";
  if (description.length <= 320) return description;
  return `${description.slice(0, 317).replace(/\s+\S*$/, "")}…`;
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
const state = {
  query: (urlState.get("query") || urlState.get("q") || "").slice(0, 200),
  eventView: EVENT_VIEWS.includes(urlState.get("eventView")) ? urlState.get("eventView")
    : (urlState.has("from") || urlState.has("to") || ["upcoming", "week", "month", "custom"].includes(urlState.get("preset")) ? "upcoming" : "today"),
  preset: ["upcoming", "week", "month", "custom"].includes(urlState.get("preset")) ? urlState.get("preset") : (urlState.has("from") || urlState.has("to") ? "custom" : "week"),
  from: validDate(urlState.get("from")),
  to: validDate(urlState.get("to")),
  department: urlState.get("department") || "",
  org: urlState.get("org") || "",
  tag: urlState.get("tag") || "",
  campus: urlState.get("campus") || "",
  mode: modeSlug(urlState.get("mode") || ""),
  page: 1,
  view: urlState.get("view") === "grid" ? "grid" : "list",
};
let currentData = null;
let statusData = null;
let eventMap = new Map();
let requestController = null;
let requestNumber = 0;
let searchTimer = null;
let statusTimer = null;
let toastTimer = null;
let previousFocus = null;
let filterPreviousFocus = null;
let refreshRequested = false;
let sourceData = null;
let sourceRequest = null;
let sourceLoadError = "";
const sourcePanelState = {
  sources: { query: "", department: "", category: "", coverage: "all", limit: SOURCE_PAGE_SIZE },
  subscriptions: { query: "", department: "", category: "", coverage: "all", limit: SOURCE_PAGE_SIZE },
};
const sourcePanelFocus = new Map();

/**
 * Advance relative date controls when an open page crosses a calendar day.
 * @return {void} No return value.
 */
function syncToday() {
  today = dateKey(new Date());
  element("today-month").textContent = calendarLabel(today, { month: "short" }).toUpperCase();
  element("today-number").textContent = calendarLabel(today, { day: "numeric" });
  element("today-weekday").textContent = calendarLabel(today, { weekday: "long" }).toUpperCase();
}

/**
 * Compute inclusive calendar boundaries for the selected date preset.
 * @return {{from:string,to:string}} Requested boundaries.
 */
function dateRange() {
  if (state.eventView === "today" || state.eventView === "ongoing") return { from: today, to: today };
  const first = state.eventView === "upcoming" ? shiftDate(today, 1) : today;
  if (state.preset === "week") return { from: first, to: shiftDate(first, 6) };
  if (state.preset === "month") return { from: first, to: shiftDate(first, 29) };
  if (state.preset === "custom") return { from: state.from, to: state.to };
  return { from: first, to: "" };
}

/**
 * Store active filters in the URL so searches can be bookmarked and shared.
 * @return {void}
 */
function updateUrl() {
  const params = new URLSearchParams();
  ["query", "department", "org", "tag", "campus", "mode"].forEach(key => { if (state[key]) params.set(key, state[key]); });
  if (state.eventView !== "today") params.set("eventView", state.eventView);
  if (["upcoming", "recurring"].includes(state.eventView) && state.preset !== "week") params.set("preset", state.preset);
  if (["upcoming", "recurring"].includes(state.eventView) && state.preset === "custom") {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
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
  element("date-from").value = state.from;
  element("date-to").value = state.to;
  element("date-window-filter").hidden = !["upcoming", "recurring"].includes(state.eventView);
  element("custom-dates").hidden = state.preset !== "custom";
  document.querySelectorAll("[data-event-view]").forEach(button => {
    const selected = button.dataset.eventView === state.eventView;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  element("events-panel").setAttribute("aria-labelledby", `event-view-${state.eventView}`);
  document.querySelectorAll("[data-preset]").forEach(button => {
    const selected = button.dataset.preset === state.preset;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  ["department", "org", "campus"].forEach(key => { element(`${key}-filter`).value = state[key]; });
  document.querySelectorAll("[data-mode]").forEach(button => {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-tag]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.tag === state.tag)));
  document.querySelectorAll("[data-view]").forEach(button => {
    const selected = button.dataset.view === state.view;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  element("event-results").classList.toggle("grid-view", state.view === "grid");
  renderActiveFilters();
}

/**
 * Render removable chips and contextual results headings.
 * @return {void}
 */
function renderActiveFilters() {
  const chips = [];
  if (state.query) chips.push(["query", `“${state.query}”`]);
  if (["upcoming", "recurring"].includes(state.eventView) && state.preset !== "week") {
    const presetLabels = { today: "Today", week: "Next 7 days", month: "Next 30 days" };
    const range = [state.from && calendarLabel(state.from, { month: "short", day: "numeric" }), state.to && calendarLabel(state.to, { month: "short", day: "numeric" })].filter(Boolean).join(" – ");
    chips.push(["preset", presetLabels[state.preset] || range || "Custom dates"]);
  }
  ["department", "org", "tag", "campus", "mode"].forEach(key => { if (state[key]) chips.push([key, key === "mode" ? modeLabel(state[key]) : state[key]]); });
  const container = element("active-filters");
  container.hidden = chips.length === 0;
  container.innerHTML = chips.map(([key, label]) => `<button class="filter-chip" type="button" data-remove="${key}" aria-label="Remove ${escapeHtml(label)} filter"><span>${escapeHtml(label)}</span><span aria-hidden="true">×</span></button>`).join("");
  const count = element("mobile-filter-count");
  count.hidden = chips.length === 0;
  count.textContent = String(chips.length);
  const headings = { today: "Today’s events", upcoming: "Upcoming events", recurring: "Recurring activities", ongoing: "Ongoing periods" };
  const periods = { today: calendarLabel(today, { weekday: "long", month: "long", day: "numeric" }).toUpperCase(), upcoming: "AFTER TODAY · BY DATE", recurring: "PUBLISHED REPEATING SCHEDULES", ongoing: "EXHIBITION & PROGRAM PERIODS" };
  const descriptions = {
    today: "Activities starting today, shown as one complete matching list. Repeating activities and periods that started earlier have separate views.",
    upcoming: "Activities starting after today, grouped by their published start date. Show more extends this same date sequence; repeating schedules have their own view.",
    recurring: "Activities with a repeating schedule published by the source. Each dated occurrence is shown here, separate from one-time events.",
    ongoing: "Exhibition and program periods spanning today. Check original opening and session times; a date range does not mean the venue is open now.",
  };
  element("results-title").firstChild.textContent = `${state.query ? `${headings[state.eventView]} · search` : headings[state.eventView]} `;
  element("results-period").textContent = periods[state.eventView];
  element("event-view-description").textContent = descriptions[state.eventView];
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
 * Render server facets with accessible topic toggle buttons.
 * @param {Object} facets Event facet payload.
 * @return {void}
 */
function renderFacets(facets = {}) {
  const focusedTag = document.activeElement?.dataset.tag;
  populateSelect("department", facets.departments, "All departments");
  populateSelect("org", facets.orgs || facets.organizations, "All organizations");
  populateSelect("campus", facets.campuses, "All campuses");
  const tags = normalizeFacets(facets.tags);
  if (state.tag && !tags.some(item => item.value === state.tag)) tags.unshift({ value: state.tag, count: null });
  element("topic-options").innerHTML = tags.length ? tags.map(item => `<button type="button" class="topic-option" data-tag="${escapeHtml(item.value)}" aria-label="${escapeHtml(item.value)}${item.count === null ? "" : ` (${item.count.toLocaleString()} events)`}" aria-pressed="${item.value === state.tag}"><span class="topic-label">${escapeHtml(item.value)}</span>${item.count === null ? "" : `<span class="facet-count">${item.count.toLocaleString()}</span>`}</button>`).join("") : '<span class="muted filter-placeholder">No topics available yet.</span>';
  if (focusedTag) [...element("topic-options").querySelectorAll("[data-tag]")].find(button => button.dataset.tag === focusedTag)?.focus({ preventScroll: true });
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
  const day = eventDay(event);
  const endDay = event.end ? eventDay({ ...event, start: event.end }) : "";
  const cardDay = state.eventView === "ongoing" && endDay ? (event.allDay && event.endExclusive ? shiftDate(endDay, -1) : endDay) : day;
  const title = plainText(event.title) || "Untitled event";
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const category = tags[0] || "Campus event";
  const org = event.org || event.organizer || event.department || "Carnegie Mellon University";
  const cancelled = /cancel/i.test(event.status || "");
  const status = cancelled ? "Cancelled" : /postpon/i.test(event.status || "") ? "Postponed" : event.eventType === "recurring" ? recurrenceLabel(event) : state.eventView === "ongoing" ? "Ongoing date range" : "";
  const mode = modeSlug(event.mode);
  const location = plainText(event.location?.name || event.location || "") || (mode === "online" ? "Online" : event.campus || "Location on original listing");
  return `<article class="event-card${cancelled ? " cancelled" : ""}">
    <div class="event-date" aria-hidden="true"><span>${state.eventView === "ongoing" ? "UNTIL " : ""}${cardDay ? calendarLabel(cardDay, { month: "short" }) : "TBA"}</span><strong>${cardDay ? calendarLabel(cardDay, { day: "numeric" }) : "—"}</strong><span class="event-weekday">${cardDay ? calendarLabel(cardDay, { weekday: "short" }) : ""}</span></div>
    <div class="event-card-body"><div class="event-card-topline"><span class="category-label" data-color="${tagColor(category)}">${escapeHtml(category)}</span>${status ? `<span class="event-status">${status}</span>` : ""}<span class="event-organizer" title="${escapeHtml(org)}">${escapeHtml(org)}</span></div>
    <h3 class="event-title"><button class="event-title-button" type="button" data-event="${escapeHtml(id)}">${escapeHtml(title)}</button></h3>
    <p class="event-summary">${escapeHtml(eventSummary(event))}</p>
    <div class="event-meta"><span class="event-meta-item">${icon("clock")}<span>${escapeHtml((state.eventView === "ongoing" || event.scheduleKind === "continuous") ? eventDateLabel(event) : eventTime(event))}</span></span><span class="event-meta-item">${icon(mode === "online" ? "screen" : "pin")}<span class="event-location" title="${escapeHtml(location)}">${escapeHtml(location)}</span></span>${mode === "hybrid" ? '<span class="event-meta-item">Hybrid</span>' : ""}</div></div><span class="event-arrow" aria-hidden="true">↗</span>
  </article>`;
}

/**
 * Render chronologically grouped events from the current API response.
 * @param {Object} data Paginated event payload.
 * @return {void}
 */
function renderEvents(data) {
  const events = Array.isArray(data.events) ? data.events : [];
  const total = Number.isFinite(data.total) ? data.total : events.length;
  eventMap = new Map(events.map((event, index) => [String(event.id || index), event]));
  const groups = new Map();
  events.forEach((event, index) => {
    const day = state.eventView === "ongoing" ? "ongoing" : eventDay(event);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(eventCard(event, index));
  });
  const orderedGroups = Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  element("event-results").innerHTML = orderedGroups.map(([day, cards]) => {
    const relative = day === today ? "Today" : day === shiftDate(today, 1) ? "Tomorrow" : "";
    const date = day === "ongoing" ? "Exhibition and program periods" : day ? calendarLabel(day, { weekday: "long", month: "long", day: "numeric", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) }) : "Published schedule";
    return `<section class="date-group" aria-label="${escapeHtml(date)}"><h3 class="date-group-heading">${escapeHtml(date)}${relative ? `<span class="relative-day">${relative}</span>` : ""}</h3><div class="date-group-events">${cards.join("")}</div></section>`;
  }).join("");
  element("empty-state").hidden = events.length > 0;
  element("empty-title").textContent = "No events match this view.";
  element("empty-message").textContent = ({
    today: "Try another topic or choose Upcoming or Recurring to explore a different schedule.",
    upcoming: "Try a wider date window, another topic, or a shorter search.",
    recurring: "Try a wider date window, or choose Today or Upcoming for one-time events.",
    ongoing: "Try another topic, or choose Today or Upcoming for events with a scheduled start.",
  })[state.eventView];
  element("event-count").textContent = total.toLocaleString();
  element("show-events").textContent = `Show ${total.toLocaleString()} ${total === 1 ? "event" : "events"}`;
  const more = state.eventView !== "today" && events.length < total;
  element("load-more").hidden = !more;
  element("load-more-label").textContent = `Showing ${events.length.toLocaleString()} of ${total.toLocaleString()} in this view.`;
  const next = Math.min(PAGE_SIZE, Math.max(0, total - events.length));
  element("show-more-events").textContent = `Show ${next.toLocaleString()} more ${state.eventView === "recurring" ? "occurrences" : "activities"}`;
  element("show-more-events").disabled = false;
  const scope = state.eventView === "today" ? "today’s complete matching list" : "this view";
  element("results-announcement").textContent = `${total.toLocaleString()} ${total === 1 ? "event" : "events"} in ${scope}. ${events.length ? `Showing ${events.length.toLocaleString()}${events.length < total ? ` of ${total.toLocaleString()}` : ""}.` : "Try changing your filters or choose another view."}`;
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
  element("event-results").innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>').join("");
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
  if (range.from && range.to && range.from > range.to) {
    element("date-error").hidden = false;
    element("date-to").setAttribute("aria-invalid", "true");
    return;
  }
  element("date-error").hidden = true;
  element("date-to").removeAttribute("aria-invalid");
  const todayView = state.eventView === "today";
  const params = new URLSearchParams({ eventView: state.eventView, page: String(append ? state.page : 1), limit: String(todayView ? TODAY_REQUEST_SIZE : PAGE_SIZE) });
  ["query", "department", "org", "tag", "campus"].forEach(key => { if (state[key]) params.set(key, state[key]); });
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
  if (scroll) element("results").scrollIntoView({ block: "start", behavior: "smooth" });
  try {
    let data = await dataClient.getEvents(params, { signal: controller.signal });
    if (!Array.isArray(data.events)) throw new Error("The event service returned an unexpected response.");
    if (requestId !== requestNumber) return;
    const previousIds = new Set((append ? currentData?.events || [] : []).map(event => String(event.id)));
    const collected = new Map((append ? currentData?.events || [] : []).map(event => [event.id, event]));
    for (const event of data.events) collected.set(event.id, event);
    if (todayView) {
      let page = 1;
      while (page * (data.pageSize || TODAY_REQUEST_SIZE) < data.total) {
        params.set("page", String(++page));
        const next = await dataClient.getEvents(params, { signal: controller.signal });
        if (requestId !== requestNumber) return;
        if (!Array.isArray(next.events) || !next.events.length) throw new Error("Today’s event list changed while loading. Reload to get the complete list.");
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
    element("error-message").textContent = `${error.message} ${STATIC_MODE ? "Reload the published data or try again shortly." : "Check that the local server is running, then try again."}`;
    if (!append) element("event-count").textContent = "—";
    element("results-announcement").textContent = "Events could not be loaded. Use Try again to retry.";
  } finally {
    if (requestId === requestNumber) {
      element("event-results").setAttribute("aria-busy", "false");
      element("show-more-events").disabled = false;
      if (append && currentData) {
        const more = Math.min(PAGE_SIZE, Math.max(0, currentData.total - currentData.events.length));
        element("show-more-events").textContent = `Show ${more.toLocaleString()} more ${state.eventView === "recurring" ? "occurrences" : "activities"}`;
      }
    }
  }
}

/**
 * Apply a filter change and reset pagination.
 * @param {string} key Filter state key.
 * @param {string} value New filter value.
 * @return {void}
 */
function changeFilter(key, value) {
  state[key] = value;
  state.page = 1;
  if (key === "department") state.org = "";
  if (key === "eventView" && value === "upcoming" && state.preset === "custom" && !state.from) state.from = shiftDate(today, 1);
  if (key === "preset" && value === "custom") {
    state.from ||= state.eventView === "upcoming" ? shiftDate(today, 1) : today;
    state.to ||= shiftDate(state.from, 6);
  }
  loadEvents();
}

/**
 * Reset search, dates, and all event facets.
 * @return {void}
 */
function resetFilters() {
  Object.assign(state, { query: "", eventView: "today", preset: "week", from: "", to: "", department: "", org: "", tag: "", campus: "", mode: "", page: 1 });
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
  if (!STATIC_MODE) return false;
  const { lastSuccessfulUpdate: lastSuccess, thresholdHours: threshold, known, stale } = publicationFreshness(data);
  element("snapshot-notice").hidden = false;
  element("snapshot-notice").classList.toggle("is-stale", stale);
  element("snapshot-title").textContent = stale ? "Published data may be out of date" : "Updated daily";
  element("snapshot-message").textContent = !known ? "The published data has no successful update time. Reload to check for a newer publication."
    : stale ? `Last successful update: ${updatedLabel(lastSuccess)}. The data is more than ${threshold} hours old; check original listings for changes.`
    : `Updates are published daily. Last successful update: ${updatedLabel(lastSuccess)}. Reload checks for newer published data.`;
  return stale;
}

/**
 * Reflect crawler health and refresh state in persistent interface elements.
 * @param {Object|null} data Current source status.
 * @return {void}
 */
function updateStatus(data) {
  if (!data) return;
  statusData = data;
  const sources = data.sources || {};
  const refreshing = !STATIC_MODE && Boolean(data.refreshing);
  const stale = updateSnapshotNotice(data);
  const total = sources.total;
  element("header-status").textContent = STATIC_MODE ? `${stale ? "Update overdue" : "Updated daily"}${total ? ` · ${total.toLocaleString()} sources` : ""}` : refreshing ? "Updating sources…" : total ? `${total.toLocaleString()} non-club sources` : "University events";
  const successfulUpdate = data.lastSuccessfulUpdate || data.lastUpdated;
  element("last-updated").textContent = STATIC_MODE ? successfulUpdate ? `Last successful update ${updatedLabel(successfulUpdate)}${stale ? " · may be out of date" : ""}` : "No successful update time published" : data.lastUpdated ? `Last updated ${updatedLabel(data.lastUpdated)}` : "Waiting for the first source refresh";
  element("refresh-button").classList.toggle("refreshing", refreshing || refreshRequested);
  element("refresh-button").disabled = refreshing || refreshRequested;
  const refreshLabel = STATIC_MODE ? refreshRequested ? "Reloading published events" : "Reload published events" : refreshing ? "Sources are refreshing" : "Refresh event sources";
  element("refresh-button").setAttribute("aria-label", refreshLabel);
  element("refresh-button").title = refreshLabel;
  element("refresh-notice").hidden = !refreshing;
  ["header-status-dot", "footer-status-dot"].forEach(id => element(id).classList.toggle("warning", stale || Number(sources.error || 0) + Number(sources.blocked || 0) > 0));
  clearTimeout(statusTimer);
  statusTimer = setTimeout(loadStatus, STATIC_MODE ? 15 * 60000 : refreshing ? 4000 : 30000);
}

/**
 * Poll source status and reload results when a refresh publishes a new snapshot.
 * @return {Promise<void>} Status request completion.
 */
async function loadStatus() {
  try {
    const data = await dataClient.getStatus();
    const changed = currentData && ((data.lastUpdated && currentData.lastUpdated !== data.lastUpdated)
      || (STATIC_MODE && data.generatedAt && currentData.generatedAt !== data.generatedAt));
    const firstBatchAvailable = currentData?.total === 0 && !currentData?.lastUpdated && data.totalEvents > 0;
    updateStatus(data);
    if (changed && (!data.refreshing || firstBatchAvailable)) {
      sourceData = null;
      if (sourcePanelsOpen()) loadSourceDirectory();
      if (!element("detail-dialog").open) loadEvents();
    }
  } catch {
    const lastSuccess = statusData?.lastSuccessfulUpdate || statusData?.lastUpdated;
    element("last-updated").textContent = STATIC_MODE ? lastSuccess ? `Last successful update ${updatedLabel(lastSuccess)} · update check unavailable` : "Published update status temporarily unavailable" : lastSuccess ? `Last updated ${updatedLabel(lastSuccess)} · status unavailable` : "Source status temporarily unavailable";
    if (STATIC_MODE) {
      element("snapshot-notice").hidden = false;
      element("snapshot-notice").classList.add("is-stale");
      element("snapshot-title").textContent = "Couldn’t check for published updates";
      element("snapshot-message").textContent = `${lastSuccess ? `Last successful update: ${updatedLabel(lastSuccess)}. ` : ""}Reload to try again; check original listings for the latest details.`;
    }
    element("footer-status-dot").classList.add("warning");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(loadStatus, STATIC_MODE ? 60000 : 30000);
  }
}

/**
 * Reload published JSON in static mode or request a local collection refresh.
 * @return {Promise<void>} Refresh request completion.
 */
async function refreshSources() {
  if (refreshRequested || (!STATIC_MODE && statusData?.refreshing)) return;
  refreshRequested = true;
  element("refresh-button").disabled = true;
  element("refresh-button").classList.add("refreshing");
  try {
    await dataClient.refresh();
    if (STATIC_MODE) sourceData = null;
    showToast(STATIC_MODE ? "Published data reloaded. New collections are published daily." : "Source refresh requested. You can keep exploring.");
    await loadStatus();
    if (STATIC_MODE || !statusData?.refreshing) await loadEvents();
    if (STATIC_MODE && sourcePanelsOpen()) await loadSourceDirectory();
  } catch (error) {
    showToast(`${STATIC_MODE ? "Couldn’t reload published data." : "Couldn’t start a refresh."} ${error.message}`);
  } finally {
    refreshRequested = false;
    element("refresh-button").disabled = !STATIC_MODE && Boolean(statusData?.refreshing);
    element("refresh-button").classList.toggle("refreshing", !STATIC_MODE && Boolean(statusData?.refreshing));
    if (statusData) updateStatus(statusData);
  }
}

/**
 * Show a short accessible status message.
 * @param {string} message Status text.
 * @return {void}
 */
function showToast(message) {
  clearTimeout(toastTimer);
  element("toast").textContent = message;
  element("toast").hidden = false;
  toastTimer = setTimeout(() => { element("toast").hidden = true; }, 6000);
}

/**
 * Collect distinct safe original event and source links.
 * @param {Object} event Event record.
 * @return {Array<{url:string,label:string}>} Safe source links.
 */
function originalLinks(event) {
  const links = [];
  const primary = safeUrl(event.url || event.originalUrl || event.link);
  if (primary) links.push({ url: primary, label: event.linkKind === "calendar-viewer" ? "Open published calendar" : event.linkKind === "source-page" ? "Open source listing" : "View original event" });
  (Array.isArray(event.sources) ? event.sources : []).forEach(source => {
    const url = safeUrl(typeof source === "string" ? source : source.eventUrl || source.url || source.link);
    if (url && !links.some(link => link.url === url)) links.push({ url, label: typeof source === "string" ? new URL(url).hostname : source.org || source.name || source.title || source.department || new URL(url).hostname });
  });
  return links;
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
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const links = originalLinks(event);
  const orgs = Array.isArray(event.orgs) && event.orgs.length ? event.orgs : [event.org || event.organizer || "Carnegie Mellon University"];
  const departments = Array.isArray(event.departments) && event.departments.length ? event.departments : [event.department].filter(Boolean);
  const location = plainText(event.location?.name || event.location || "") || "See the original listing for location details";
  const timezone = event.timeZone || event.timezone;
  const continuous = event.scheduleKind === "continuous";
  const status = /cancel|postpon/i.test(event.status || "") ? `<p class="notice"><strong>This event is ${escapeHtml(event.status.toLowerCase())}. Check the original listing for updates.</strong></p>` : "";
  element("dialog-eyebrow").textContent = "A CLOSER LOOK";
  element("detail-content").innerHTML = `<div class="detail-body"><div class="detail-tags">${tags.map(tag => `<span class="category-label" data-color="${tagColor(tag)}">${escapeHtml(tag)}</span>`).join("")}</div>
    <h2 class="detail-title" id="detail-title">${escapeHtml(title)}</h2><p class="detail-org">Hosted by ${escapeHtml(orgs.join(" · "))}${departments.length ? `<br>${escapeHtml(departments.join(" · "))}` : ""}</p>${status}${continuous ? '<p class="period-note">This is an exhibition or program date range. Check the original listing for opening days, session times, and closures.</p>' : ""}${event.eventType === "recurring" ? `<p class="recurrence-note">${escapeHtml(recurrenceLabel(event))}. This card represents the published occurrence on ${escapeHtml(eventDateLabel(event))}.</p>` : ""}
    <div class="detail-facts"><div class="detail-fact">${icon("calendar")}<div><strong>${escapeHtml(eventDateLabel(event))}</strong><small>${escapeHtml(eventTime(event))}${timezone && timezone !== DISPLAY_TIMEZONE && !event.allDay ? ` · Source time zone: ${escapeHtml(timezone)}` : ""}</small></div></div>
    <div class="detail-fact">${icon(modeSlug(event.mode) === "online" ? "screen" : "pin")}<div><strong>${escapeHtml(location)}</strong><small>${escapeHtml([event.campus, event.mode && modeLabel(event.mode)].filter(Boolean).join(" · "))}</small></div></div></div>
    <h3 class="detail-section-heading">At a glance</h3><p class="detail-summary">${escapeHtml(summary)}</p><p class="summary-note">${plainText(event.summary) || description ? 'A concise excerpt from the published event information.' : 'The source did not include an event description.'}</p>
    ${description && description !== summary ? `<details class="full-description"><summary>Read full event description</summary><div class="full-description-text">${escapeHtml(description)}</div></details>` : ""}
    ${links.length ? `<a class="button-primary detail-link" href="${escapeHtml(links[0].url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(links[0].label)}<span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a><p class="original-note">Registration, eligibility, tickets, and the latest changes live with the organizer.</p>` : '<p class="original-note">The source did not provide a public event link.</p>'}
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
 * @param {string} panel Directory key: sources or subscriptions.
 * @return {Array<Object>} Matching sources sorted by their displayed names.
 */
function matchingSources(panel) {
  const filters = sourcePanelState[panel];
  const terms = filters.query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return (sourceData || []).filter(source => {
    const subscription = sourceSubscription(source);
    if (panel === "subscriptions" && !subscription) return false;
    if (filters.department && source.department !== filters.department) return false;
    if (filters.category && sourceCategory(source) !== filters.category) return false;
    if (filters.coverage !== "all") {
      const matchesCoverage = ({
        imported: Number(source.eventCount) > 0,
        covered: source.state === "covered",
        zero: source.state === "empty",
        undated: source.state === "undated",
        attention: sourceNeedsAttention(source),
        email: subscription?.kind === "subscriber_only",
        public_email: subscription?.kind === "public_plus_email",
      })[filters.coverage];
      if (!matchesCoverage) return false;
    }
    const searchable = [source.org, source.department, source.url, source.fetchUrl, sourceCategory(source), subscription?.title, subscription?.url].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }).sort((left, right) => {
    const leftName = (panel === "subscriptions" && sourceSubscription(left)?.title) || left.org || "";
    const rightName = (panel === "subscriptions" && sourceSubscription(right)?.title) || right.org || "";
    return leftName.localeCompare(rightName) || String(left.id || left.url).localeCompare(String(right.id || right.url));
  });
}

/**
 * Resolve a readable label for the recorded source state.
 * @param {Object} source Source record containing its runtime state.
 * @return {string} Coverage or collection status label.
 */
function sourceStateLabel(source) {
  if (source.state === "ok" && Number(source.eventCount) === 0 && source.excludedCount > 0) return "Non-activity listings";
  if (source.state === "error" && source.coverage?.inspectionComplete && !source.coverage.internalIssues.length) return "Source limitation";
  return ({ error: "Needs review", blocked: "Access restricted", unsupported: "Integration needed", pending: "Not checked yet", subscription_only: "Email only", empty: "Zero imported in window", undated: "Undated · monitored", ok: "Events imported", covered: "Shared feed coverage" })[source.state] || "Status unavailable";
}

/**
 * Describe public coverage without inferring organization-wide emptiness.
 * @param {Object} source Source record with state, event count and optional subscription.
 * @return {string} Reader-facing summary of the current coverage boundary.
 */
function sourceSummary(source) {
  const subscription = sourceSubscription(source);
  if (subscription?.kind === "subscriber_only") return "Subscriber-only email announcements are not imported into the event calendar.";
  if (subscription?.kind === "public_plus_email") return "Public calendar events may be included. Subscriber email content is not imported.";
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
  return `<details class="source-card-review"><summary>Coverage notes &amp; diagnostics</summary>${currentAudit}${exclusionNote}${reason ? `<p>${escapeHtml(reason)}</p>` : ""}${warnings.length ? `<ul>${warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}<p>${escapeHtml(sourceSummary(source))}</p>${source.lastAttempt ? `<p>Last attempted check: ${escapeHtml(updatedLabel(source.lastAttempt))}.</p>` : ""}${reviewMarkup}</details>`;
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
 * Render a source card with its original link outside collapsed diagnostics.
 * @param {Object} source Catalogued source with coverage and optional email metadata.
 * @param {string} panel Directory key: sources or subscriptions.
 * @return {string} Escaped source or subscription card markup.
 */
function sourceCard(source, panel) {
  const subscription = panel === "subscriptions" ? sourceSubscription(source) : null;
  const title = plainText(subscription?.title || source.org || source.department || "CMU source");
  const url = safeUrl(source.url);
  const signupUrl = safeUrl(subscription?.url);
  const requirements = subscription ? subscriptionRequirements(subscription) : [];
  const label = subscription ? subscription.kind === "subscriber_only" ? "Email only" : "Public calendar + email" : sourceStateLabel(source);
  const summary = subscription ? plainText(subscription.reason) || sourceSummary(source) : sourceSummary(source);
  return `<article class="source-card${subscription ? " subscription-card" : ""}" data-source-id="${escapeHtml(source.id)}"><div class="source-card-topline"><span>${escapeHtml(sourceCategory(source))}</span><span class="source-card-state" data-state="${escapeHtml(subscription?.kind === "subscriber_only" ? "subscription_only" : source.state || "pending")}">${escapeHtml(label)}</span></div><h3 class="source-card-title" tabindex="-1">${escapeHtml(title)}</h3><p class="source-card-department">${escapeHtml(source.department || "Carnegie Mellon University")}${subscription && title !== plainText(source.org) ? ` · ${escapeHtml(source.org)}` : ""}</p>${url ? `<a class="source-card-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : '<p class="source-card-url">Original URL unavailable</p>'}<p class="source-card-summary">${escapeHtml(summary)}</p>${subscription ? `${requirements.length ? `<ul class="subscription-requirements">${requirements.map(requirement => `<li>${escapeHtml(requirement)}</li>`).join("")}</ul>` : ""}${subscription.nextStep ? `<p class="subscription-step"><strong>How to access:</strong> ${escapeHtml(plainText(subscription.nextStep))}</p>` : ""}<p class="source-card-meta subscription-status">Email announcements are not imported.</p>${signupUrl ? `<div class="subscription-actions"><a class="button-secondary" href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener noreferrer">View subscription instructions <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a></div>` : ""}` : `<p class="source-card-meta">${source.lastAttempt ? `Checked ${escapeHtml(updatedLabel(source.lastAttempt))}` : "Not refreshed yet"}</p>`}${sourceDiagnostics(source)}</article>`;
}

/**
 * Build the expandable explanation of calendar coverage.
 * @param {boolean} open Whether the explanation starts expanded.
 * @return {string} Calendar explanation markup.
 */
function howItWorksMarkup(open = false) {
  return `<details class="source-how-it-works source-card-review" id="sources-how-it-works"${open ? " open" : ""}><summary>How the calendar works</summary><div class="source-explanation"><h3>From across the university</h3><p>CMU Events follows university calendars, academic departments, research centers, offices, and other non-club publishers. Independent student-club websites and their own feeds are excluded. Activities published by retained sources are kept, including events hosted by student clubs.</p><h3>${STATIC_MODE ? "Published daily" : "Refreshed automatically"}</h3><p>${STATIC_MODE ? "New event collections are published daily. Reload checks for the latest published data; it does not start a new collection. The last successful update and any stale-data warning remain visible while you browse." : "The server checks public sources on its refresh schedule. The refresh button requests an update; existing events remain available while the next snapshot is collected."}</p><h3>What the collection window covers</h3><p>Each refresh imports occurrences from the previous 30 days through the next 365 days. Zero imported events describes that source and window. It does not mean the original page or organization has no activities. An automated check and a recorded visual review are identified separately in each source’s coverage notes.</p><h3>Useful context stays attached</h3><p>Department and organization come from the source catalogue. Topics are discovery aids based on published event text. Matching events from several calendars can be combined; summaries remain excerpts, and every event keeps its original public link.</p><h3>Check the original listing</h3><p>Registration, tickets, eligibility, audience requirements, and the latest updates belong to the organizer. Public calendar coverage can work while a separate member or email channel remains restricted.</p><h3>Email announcements</h3><p>Subscriber-only emails are not received or imported by CMU Events. The email directory lists reviewed subscription channels and their access instructions.</p><button class="text-button" type="button" data-open-subscriptions>Browse email subscriptions <span aria-hidden="true">↗</span></button></div></details>`;
}

/**
 * Build stable directory controls once per panel opening.
 * @param {string} panel Directory key: sources or subscriptions.
 * @param {boolean} showHowItWorks Whether to expand the calendar explanation.
 * @return {void} No return value.
 */
function renderSourcePanelShell(panel, showHowItWorks = false) {
  const email = panel === "subscriptions";
  const filters = sourcePanelState[panel];
  element(`${panel}-content`).innerHTML = `<div class="source-directory"><header class="source-directory-intro${email ? " subscription-intro" : ""}"><p class="eyebrow">${email ? "ANNOUNCEMENTS, DIRECT TO YOU" : "MANY SOURCES. ONE PLACE."}</p><h2 class="source-directory-title" id="${panel}-title">${email ? "Email subscriptions" : "Our sources"}</h2><p class="source-directory-lede">${email ? "Find university email channels and the publisher’s instructions for joining." : "Browse every retained source, from department pages to shared university calendars. Open any original link or explore its coverage notes."}</p><div class="source-directory-stats" id="${panel}-stats"></div></header>${email ? '<aside class="subscription-boundary" role="note"><h3>Email announcements are not in the event calendar.</h3><p>CMU Events does not receive or import subscriber-only emails. Some publishers also have public calendars; those public events may appear in Discover.</p></aside>' : ""}<div class="source-directory-controls" aria-label="${email ? "Filter subscription channels" : "Filter sources"}"><label class="source-search-field" for="${panel}-search">Search ${email ? "channels" : "sources"}<input id="${panel}-search" data-source-query="${panel}" type="search" placeholder="Organization, department, or URL" autocomplete="off" maxlength="200" value="${escapeHtml(filters.query)}"></label><label class="source-filter-field" for="${panel}-department">Department<select id="${panel}-department" data-source-filter="department" data-source-panel="${panel}"><option value="">All departments</option></select></label><label class="source-filter-field" for="${panel}-category">Category<select id="${panel}-category" data-source-filter="category" data-source-panel="${panel}"><option value="">All categories</option></select></label><label class="source-filter-field" for="${panel}-coverage">${email ? "Channel" : "Coverage"}<select id="${panel}-coverage" data-source-filter="coverage" data-source-panel="${panel}">${(email ? [["all", "All channels"], ["email", "Email only"], ["public_email", "Public calendar + email"]] : [["all", "All coverage"], ["imported", "With imported events"], ["covered", "Shared feed coverage"], ["zero", "Zero imported in window"], ["undated", "Undated · monitored"], ["attention", "Needs review"], ["email", "Email only"]]).map(([value, label]) => `<option value="${value}"${filters.coverage === value ? " selected" : ""}>${label}</option>`).join("")}</select></label></div><p class="source-directory-count" id="${panel}-count" role="status" aria-live="polite"></p><div id="${panel}-results" aria-busy="true"></div>${email ? "" : howItWorksMarkup(showHowItWorks)}<p class="source-time" id="${panel}-updated"></p></div>`;
}

/**
 * Populate source facets while retaining the current panel selections.
 * @param {string} panel Directory key: sources or subscriptions.
 * @return {void} No return value.
 */
function updateSourcePanelOptions(panel) {
  const pool = (sourceData || []).filter(source => panel !== "subscriptions" || sourceSubscription(source));
  const filters = sourcePanelState[panel];
  [["department", [...new Set(pool.map(source => source.department).filter(Boolean))], "All departments"], ["category", [...new Set(pool.map(sourceCategory))], "All categories"]].forEach(([key, values, placeholder]) => {
    if (filters[key] && !values.includes(filters[key])) values.push(filters[key]);
    const select = element(`${panel}-${key}`);
    const html = `<option value="">${placeholder}</option>${values.sort((a, b) => a.localeCompare(b)).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (select.innerHTML !== html) select.innerHTML = html;
    select.value = filters[key];
  });
}

/**
 * Render the selected panel with loading, error and pagination states.
 * @param {string} panel Directory key: sources or subscriptions.
 * @return {void} No return value.
 */
function renderSourcePanel(panel) {
  const container = element(`${panel}-results`);
  if (!container) return;
  const count = element(`${panel}-count`);
  container.setAttribute("aria-busy", String(Boolean(sourceRequest)));
  if (!sourceData) {
    element(`${panel}-stats`).textContent = "";
    count.textContent = sourceLoadError ? "Source directory unavailable" : "Loading source links…";
    container.innerHTML = sourceLoadError ? `<div class="source-empty-state"><h3>We couldn’t load the source directory.</h3><p>${escapeHtml(sourceLoadError)}</p><button type="button" class="button-secondary" data-source-retry>Try again</button></div>` : '<div class="source-empty-state" role="status"><span class="small-spinner" aria-hidden="true"></span><p>Loading the complete source directory…</p></div>';
    return;
  }
  updateSourcePanelOptions(panel);
  const filters = sourcePanelState[panel];
  const pool = sourceData.filter(source => panel !== "subscriptions" || sourceSubscription(source));
  const matching = matchingSources(panel);
  const visible = matching.slice(0, filters.limit);
  element(`${panel}-stats`).textContent = `${pool.length.toLocaleString()} ${panel === "subscriptions" ? "reviewed email channels" : "source links"} · ${new Set(pool.map(source => source.department).filter(Boolean)).size.toLocaleString()} departments`;
  count.textContent = `Showing ${visible.length.toLocaleString()} of ${matching.length.toLocaleString()} matching ${panel === "subscriptions" ? "channels" : "sources"}${matching.length !== pool.length ? ` · ${pool.length.toLocaleString()} total` : ""}.`;
  const reset = '<button class="text-button" type="button" data-source-reset>Clear directory filters</button>';
  if (!matching.length) container.innerHTML = `<div class="source-empty-state"><h3>${pool.length ? "No sources match these filters." : panel === "subscriptions" ? "No reviewed email channels are listed yet." : "No sources are listed yet."}</h3><p>${pool.length ? "Try another department, category, or search." : "Check back after the next source update."}</p>${pool.length ? reset : ""}</div>`;
  else {
    let cards;
    if (panel === "subscriptions") {
      cards = [["subscriber_only", "Email-only announcements", "These subscriber email announcements are not imported into Discover."], ["public_plus_email", "Public calendars with additional email updates", "Public calendar events may appear in Discover. Private or subscriber email content is not imported."]].map(([kind, heading, description]) => {
        const rows = visible.filter(source => sourceSubscription(source).kind === kind);
        const total = matching.filter(source => sourceSubscription(source).kind === kind).length;
        return total ? `<section class="subscription-section" aria-labelledby="subscription-section-${kind}"><div class="subscription-section-heading"><h3 id="subscription-section-${kind}">${heading} <span>${total.toLocaleString()}</span></h3><p>${description}</p></div><div class="source-card-grid">${rows.map(source => sourceCard(source, panel)).join("")}</div>${!rows.length ? '<p class="source-card-meta">More matching channels appear below when you load the next page.</p>' : ""}</section>` : "";
      }).join("");
    } else cards = `<div class="source-card-grid">${visible.map(source => sourceCard(source, panel)).join("")}</div>`;
    container.innerHTML = `${cards}${visible.length < matching.length ? `<div class="source-load-more"><button class="button-secondary" type="button" data-source-more>Show ${Math.min(SOURCE_PAGE_SIZE, matching.length - visible.length)} more ${panel === "subscriptions" ? "channels" : "sources"}</button><button class="text-button" type="button" data-source-all>Show all ${matching.length.toLocaleString()}</button></div>` : ""}`;
  }
  element(`${panel}-updated`).textContent = statusData?.lastUpdated ? `Last published refresh: ${updatedLabel(statusData.lastUpdated)}.` : "The first source refresh has not been published yet.";
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
  ["sources", "subscriptions"].forEach(renderSourcePanel);
  try { await sourceRequest; }
  catch (error) { sourceLoadError = error.message || "Please try again in a moment."; }
  finally {
    sourceRequest = null;
    ["sources", "subscriptions"].forEach(renderSourcePanel);
  }
}

/**
 * Open a source panel while preserving independent filters and focus.
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
  renderSourcePanelShell(panel, showHowItWorks);
  element(`${panel}-dialog`).showModal();
  syncDialogLock();
  element(`${panel}-dialog`).scrollTop = 0;
  element(`${panel}-search`).focus({ preventScroll: true });
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
  element("search-form").addEventListener("submit", event => { event.preventDefault(); clearTimeout(searchTimer); state.query = element("search-input").value.trim(); state.page = 1; loadEvents(); });
  element("search-input").addEventListener("input", event => {
    clearTimeout(searchTimer);
    element("search-clear").hidden = !event.target.value;
    searchTimer = setTimeout(() => { state.query = element("search-input").value.trim(); state.page = 1; loadEvents(); }, 300);
  });
  element("search-clear").addEventListener("click", () => { changeFilter("query", ""); element("search-input").focus(); });
  element("date-presets").addEventListener("click", event => { const button = event.target.closest("[data-preset]"); if (button) changeFilter("preset", button.dataset.preset); });
  ["from", "to"].forEach(key => element(`date-${key}`).addEventListener("change", event => { state[key] = validDate(event.target.value); state.page = 1; loadEvents(); }));
  ["department", "org", "campus"].forEach(key => element(`${key}-filter`).addEventListener("change", event => changeFilter(key, event.target.value)));
  element("mode-options").addEventListener("click", event => { const button = event.target.closest("[data-mode]"); if (button) changeFilter("mode", button.dataset.mode); });
  element("topic-options").addEventListener("click", event => { const button = event.target.closest("[data-tag]"); if (button) changeFilter("tag", state.tag === button.dataset.tag ? "" : button.dataset.tag); });
  element("active-filters").addEventListener("click", event => { const button = event.target.closest("[data-remove]"); if (button) changeFilter(button.dataset.remove, button.dataset.remove === "preset" ? "week" : ""); });
  ["reset-filters", "empty-reset"].forEach(id => element(id).addEventListener("click", resetFilters));
  element("retry-button").addEventListener("click", () => loadEvents());
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => { state.view = button.dataset.view; syncControls(); updateUrl(); }));
  element("event-results").addEventListener("click", event => { const button = event.target.closest("[data-event]"); if (button && eventMap.has(button.dataset.event)) openEvent(eventMap.get(button.dataset.event)); });
  element("show-more-events").addEventListener("click", () => { state.page += 1; loadEvents(false, true); });
  element("event-browser").addEventListener("click", event => {
    const button = event.target.closest("[data-event-view]");
    if (button) changeFilter("eventView", button.dataset.eventView);
  });
  element("event-browser").addEventListener("keydown", event => {
    const buttons = [...element("event-browser").querySelectorAll("[data-event-view]")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    changeFilter("eventView", buttons[next].dataset.eventView);
  });
  element("refresh-button").addEventListener("click", refreshSources);
  element("about-button").addEventListener("click", () => openSourceInfo());
  element("source-info-button").addEventListener("click", () => openSourceInfo(true));
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
    element(`${panel}-content`).addEventListener("input", event => {
      if (!event.target.matches("[data-source-query]")) return;
      sourcePanelState[panel].query = event.target.value;
      sourcePanelState[panel].limit = SOURCE_PAGE_SIZE;
      renderSourcePanel(panel);
    });
    element(`${panel}-content`).addEventListener("change", event => {
      const key = event.target.dataset.sourceFilter;
      if (!["department", "category", "coverage"].includes(key)) return;
      sourcePanelState[panel][key] = event.target.value;
      sourcePanelState[panel].limit = SOURCE_PAGE_SIZE;
      renderSourcePanel(panel);
    });
    element(`${panel}-content`).addEventListener("click", event => {
      if (event.target.closest("[data-open-subscriptions]")) return openSourcePanel("subscriptions");
      if (event.target.closest("[data-source-retry]")) return loadSourceDirectory(true);
      if (event.target.closest("[data-source-reset]")) {
        Object.assign(sourcePanelState[panel], { query: "", department: "", category: "", coverage: "all", limit: SOURCE_PAGE_SIZE });
        element(`${panel}-search`).value = "";
        element(`${panel}-coverage`).value = "all";
        renderSourcePanel(panel);
        element(`${panel}-search`).focus();
      }
      if (event.target.closest("[data-source-more], [data-source-all]")) {
        const existing = new Set([...element(`${panel}-results`).querySelectorAll("[data-source-id]")].map(card => card.dataset.sourceId));
        sourcePanelState[panel].limit = event.target.closest("[data-source-all]") ? matchingSources(panel).length : sourcePanelState[panel].limit + SOURCE_PAGE_SIZE;
        renderSourcePanel(panel);
        [...element(`${panel}-results`).querySelectorAll("[data-source-id]")].find(card => !existing.has(card.dataset.sourceId))?.querySelector(".source-card-title")?.focus();
      }
    });
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
  window.matchMedia("(min-width: 781px)").addEventListener("change", event => { if (event.matches) closeFilters(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadStatus(); });
}

/**
 * Initialize the calendar, controls, and live API requests.
 * @return {void}
 */
function initialize() {
  syncToday();
  element("display-timezone").textContent = DISPLAY_TIMEZONE;
  if (STATIC_MODE) {
    element("refresh-button").setAttribute("aria-label", "Reload published events");
    element("refresh-button").title = "Reload published events";
    element("snapshot-notice").hidden = false;
    element("snapshot-message").textContent = "Loading the latest published data. Updates are published daily.";
  }
  syncControls();
  bindEvents();
  loadEvents();
  loadStatus();
}

initialize();
