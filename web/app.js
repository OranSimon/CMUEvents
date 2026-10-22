const DISPLAY_TIMEZONE = "America/New_York";
const PAGE_SIZE = 24;
const INITIAL_TITLE = "CMU Events · Discover your campus";

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
 * Format event times with an explicit interface time-zone abbreviation.
 * @param {Object} event Event record.
 * @return {string} Human-readable event time.
 */
function eventTime(event) {
  const start = event.start || event.startDate || event.date;
  if (event.timePrecision === "date") return "Time not listed";
  if (event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(start || "")) return "All day";
  const date = new Date(start);
  if (!start || Number.isNaN(date.valueOf())) return "Time to be announced";
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, hour: "numeric", minute: "2-digit" });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, timeZoneName: "short" }).formatToParts(date).find(part => part.type === "timeZoneName")?.value || "ET";
  let text = formatter.format(date);
  const end = event.end ? new Date(event.end) : null;
  if (end && !Number.isNaN(end.valueOf()) && end > date) {
    text += dateKey(end) === dateKey(date) ? ` – ${formatter.format(end)}` : ` – ${new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(end)}`;
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

const today = dateKey(new Date());
const urlState = new URLSearchParams(window.location.search);
const state = {
  query: (urlState.get("query") || urlState.get("q") || "").slice(0, 200),
  preset: ["upcoming", "today", "week", "month", "custom"].includes(urlState.get("preset")) ? urlState.get("preset") : (urlState.has("from") || urlState.has("to") ? "custom" : "upcoming"),
  from: validDate(urlState.get("from")),
  to: validDate(urlState.get("to")),
  department: urlState.get("department") || "",
  org: urlState.get("org") || "",
  tag: urlState.get("tag") || "",
  campus: urlState.get("campus") || "",
  mode: modeSlug(urlState.get("mode") || ""),
  page: Math.max(1, Number.parseInt(urlState.get("page"), 10) || 1),
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
let diagnosticsData = null;
let diagnosticsLimit = 30;
let diagnosticsView = "attention";
let diagnosticsQuery = "";

/**
 * Compute inclusive calendar boundaries for the selected date preset.
 * @return {{from:string,to:string}} Requested boundaries.
 */
function dateRange() {
  if (state.preset === "today") return { from: today, to: today };
  if (state.preset === "week") return { from: today, to: shiftDate(today, 6) };
  if (state.preset === "month") return { from: today, to: shiftDate(today, 29) };
  if (state.preset === "custom") return { from: state.from, to: state.to };
  return { from: today, to: "" };
}

/**
 * Store active filters in the URL so searches can be bookmarked and shared.
 * @return {void}
 */
function updateUrl() {
  const params = new URLSearchParams();
  ["query", "department", "org", "tag", "campus", "mode"].forEach(key => { if (state[key]) params.set(key, state[key]); });
  if (state.preset !== "upcoming") params.set("preset", state.preset);
  if (state.preset === "custom") {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
  if (state.page > 1) params.set("page", String(state.page));
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
  element("custom-dates").hidden = state.preset !== "custom";
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
  if (state.preset !== "upcoming") {
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
  const headings = { upcoming: "Upcoming events", today: "Today’s events", week: "The next 7 days", month: "The next 30 days", custom: "Your date range" };
  element("results-title").firstChild.textContent = `${state.query ? "Search results" : headings[state.preset]} `;
  element("results-period").textContent = state.query ? "BEST MATCHES · GROUPED BY DATE" : "YOUR CAMPUS, COMING UP";
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
 * Build one fully escaped event card.
 * @param {Object} event Normalized event record.
 * @param {number} index Current page index.
 * @return {string} Event card markup.
 */
function eventCard(event, index) {
  const id = String(event.id || index);
  const day = eventDay(event);
  const title = plainText(event.title) || "Untitled event";
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const category = tags[0] || "Campus event";
  const org = event.org || event.organizer || event.department || "Carnegie Mellon University";
  const cancelled = /cancel/i.test(event.status || "");
  const status = cancelled ? "Cancelled" : /postpon/i.test(event.status || "") ? "Postponed" : day && day < today ? "Started earlier" : "";
  const mode = modeSlug(event.mode);
  const location = plainText(event.location?.name || event.location || "") || (mode === "online" ? "Online" : event.campus || "Location on original listing");
  return `<article class="event-card${cancelled ? " cancelled" : ""}">
    <div class="event-date" aria-hidden="true"><span>${day ? calendarLabel(day, { month: "short" }) : "TBA"}</span><strong>${day ? calendarLabel(day, { day: "numeric" }) : "—"}</strong><span class="event-weekday">${day ? calendarLabel(day, { weekday: "short" }) : ""}</span></div>
    <div class="event-card-body"><div class="event-card-topline"><span class="category-label" data-color="${tagColor(category)}">${escapeHtml(category)}</span>${status ? `<span class="event-status">${status}</span>` : ""}<span class="event-organizer" title="${escapeHtml(org)}">${escapeHtml(org)}</span></div>
    <h3 class="event-title"><button class="event-title-button" type="button" data-event="${escapeHtml(id)}">${escapeHtml(title)}</button></h3>
    <p class="event-summary">${escapeHtml(eventSummary(event))}</p>
    <div class="event-meta"><span class="event-meta-item">${icon("clock")}<span>${escapeHtml(eventTime(event))}</span></span><span class="event-meta-item">${icon(mode === "online" ? "screen" : "pin")}<span class="event-location" title="${escapeHtml(location)}">${escapeHtml(location)}</span></span>${mode === "hybrid" ? '<span class="event-meta-item">Hybrid</span>' : ""}</div></div><span class="event-arrow" aria-hidden="true">↗</span>
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
    const day = eventDay(event);
    const groupKey = day && day < today && state.preset !== "custom" ? "ongoing" : day;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(eventCard(event, index));
  });
  const orderedGroups = Array.from(groups.entries()).sort(([left], [right]) => {
    if (left === "ongoing") return 1;
    if (right === "ongoing") return -1;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
  });
  element("event-results").innerHTML = orderedGroups.map(([day, cards]) => {
    const relative = day === today ? "Today" : day === shiftDate(today, 1) ? "Tomorrow" : "";
    const date = day === "ongoing" ? "Ongoing events" : day ? calendarLabel(day, { weekday: "long", month: "long", day: "numeric", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) }) : "Date to be announced";
    return `<section class="date-group" aria-label="${escapeHtml(date)}"><h3 class="date-group-heading">${escapeHtml(date)}${relative ? `<span class="relative-day">${relative}</span>` : ""}</h3><div class="date-group-events">${cards.join("")}</div></section>`;
  }).join("");
  element("empty-state").hidden = events.length > 0;
  element("event-count").textContent = total.toLocaleString();
  element("show-events").textContent = `Show ${total.toLocaleString()} ${total === 1 ? "event" : "events"}`;
  const pageSize = data.pageSize || data.limit || PAGE_SIZE;
  const page = data.page || state.page;
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min((page - 1) * pageSize + events.length, total);
  element("pagination").hidden = total <= pageSize;
  element("pagination-label").textContent = `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} events`;
  element("previous-page").disabled = page <= 1;
  element("next-page").disabled = end >= total;
  element("results-announcement").textContent = `${total.toLocaleString()} ${total === 1 ? "event" : "events"} found. ${events.length ? `Showing ${start} through ${end}.` : "Try changing your filters."}`;
}

/**
 * Show placeholders while awaiting a fresh query.
 * @return {void}
 */
function renderLoading() {
  element("event-results").setAttribute("aria-busy", "true");
  element("empty-state").hidden = true;
  element("pagination").hidden = true;
  element("error-notice").hidden = true;
  element("event-results").innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>').join("");
}

/**
 * Request fresh filtered results, cancelling any superseded request.
 * @param {boolean} scroll Whether to return keyboard and scroll focus to results.
 * @return {Promise<void>} Completion of the current request.
 */
async function loadEvents(scroll = false) {
  const requestId = ++requestNumber;
  requestController?.abort();
  requestController = new AbortController();
  const range = dateRange();
  if (range.from && range.to && range.from > range.to) {
    element("date-error").hidden = false;
    element("date-to").setAttribute("aria-invalid", "true");
    return;
  }
  element("date-error").hidden = true;
  element("date-to").removeAttribute("aria-invalid");
  const params = new URLSearchParams({ page: String(state.page), limit: String(PAGE_SIZE) });
  ["query", "department", "org", "tag", "campus"].forEach(key => { if (state[key]) params.set(key, state[key]); });
  if (state.mode) params.set("mode", modeLabel(state.mode));
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  updateUrl();
  syncControls();
  renderLoading();
  if (scroll) element("results").scrollIntoView({ block: "start", behavior: "smooth" });
  try {
    const response = await fetch(`/api/events?${params}`, { signal: requestController.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`The event service returned ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.events)) throw new Error("The event service returned an unexpected response.");
    if (requestId !== requestNumber) return;
    if (!data.events.length && data.total > 0 && state.page > 1) {
      state.page = 1;
      await loadEvents();
      return;
    }
    currentData = data;
    renderFacets(data.facets);
    renderEvents(data);
    syncControls();
    updateStatus({ ...statusData, lastUpdated: data.lastUpdated || statusData?.lastUpdated, refreshing: data.refreshing ?? statusData?.refreshing });
  } catch (error) {
    if (error.name === "AbortError" || requestId !== requestNumber) return;
    element("event-results").innerHTML = "";
    element("error-notice").hidden = false;
    element("error-title").textContent = "We couldn’t load events.";
    element("error-message").textContent = `${error.message} Check that the local server is running, then try again.`;
    element("event-count").textContent = "—";
    element("results-announcement").textContent = "Events could not be loaded. Use Try again to retry.";
  } finally {
    if (requestId === requestNumber) element("event-results").setAttribute("aria-busy", "false");
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
  if (key === "preset" && value === "custom") {
    state.from ||= today;
    state.to ||= shiftDate(today, 6);
  }
  loadEvents();
}

/**
 * Reset search, dates, and all event facets.
 * @return {void}
 */
function resetFilters() {
  Object.assign(state, { query: "", preset: "upcoming", from: "", to: "", department: "", org: "", tag: "", campus: "", mode: "", page: 1 });
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
 * Reflect crawler health and refresh state in persistent interface elements.
 * @param {Object|null} data Current source status.
 * @return {void}
 */
function updateStatus(data) {
  if (!data) return;
  statusData = data;
  const sources = data.sources || {};
  const refreshing = Boolean(data.refreshing);
  const total = sources.total;
  element("header-status").textContent = refreshing ? "Updating sources…" : total ? `${total.toLocaleString()} public sources` : "Public campus events";
  element("last-updated").textContent = data.lastUpdated ? `Last updated ${updatedLabel(data.lastUpdated)}` : "Waiting for the first source refresh";
  element("refresh-button").classList.toggle("refreshing", refreshing);
  element("refresh-button").disabled = refreshing || refreshRequested;
  element("refresh-button").setAttribute("aria-label", refreshing ? "Sources are refreshing" : "Refresh event sources");
  element("refresh-notice").hidden = !refreshing;
  ["header-status-dot", "footer-status-dot"].forEach(id => element(id).classList.toggle("warning", Number(sources.error || 0) + Number(sources.blocked || 0) > 0));
  clearTimeout(statusTimer);
  statusTimer = setTimeout(loadStatus, refreshing ? 4000 : 30000);
}

/**
 * Poll source status and reload results when a refresh publishes a new snapshot.
 * @return {Promise<void>} Status request completion.
 */
async function loadStatus() {
  try {
    const response = await fetch("/api/status", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Status unavailable");
    const data = await response.json();
    const changed = currentData && data.lastUpdated && currentData.lastUpdated !== data.lastUpdated;
    const firstBatchAvailable = currentData?.total === 0 && !currentData?.lastUpdated && data.totalEvents > 0;
    updateStatus(data);
    if (changed && (!data.refreshing || firstBatchAvailable)) {
      diagnosticsData = null;
      if (!element("detail-dialog").open) loadEvents();
    }
  } catch {
    element("last-updated").textContent = statusData?.lastUpdated ? `Last updated ${updatedLabel(statusData.lastUpdated)} · status unavailable` : "Source status temporarily unavailable";
    element("footer-status-dot").classList.add("warning");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(loadStatus, 30000);
  }
}

/**
 * Request a server-managed refresh without blocking event browsing.
 * @return {Promise<void>} Refresh request completion.
 */
async function refreshSources() {
  if (refreshRequested || statusData?.refreshing) return;
  refreshRequested = true;
  element("refresh-button").disabled = true;
  element("refresh-button").classList.add("refreshing");
  try {
    const response = await fetch("/api/refresh", { method: "POST", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`The refresh request returned ${response.status}.`);
    showToast("Source refresh requested. You can keep exploring.");
    await loadStatus();
    if (!statusData?.refreshing) await loadEvents();
  } catch (error) {
    showToast(`Couldn’t start a refresh. ${error.message}`);
  } finally {
    refreshRequested = false;
    element("refresh-button").disabled = Boolean(statusData?.refreshing);
    element("refresh-button").classList.toggle("refreshing", Boolean(statusData?.refreshing));
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
  if (primary) links.push({ url: primary, label: "View original event" });
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
  const status = /cancel|postpon/i.test(event.status || "") ? `<p class="notice"><strong>This event is ${escapeHtml(event.status.toLowerCase())}. Check the original listing for updates.</strong></p>` : "";
  element("dialog-eyebrow").textContent = "A CLOSER LOOK";
  element("detail-content").innerHTML = `<div class="detail-body"><div class="detail-tags">${tags.map(tag => `<span class="category-label" data-color="${tagColor(tag)}">${escapeHtml(tag)}</span>`).join("")}</div>
    <h2 class="detail-title" id="detail-title">${escapeHtml(title)}</h2><p class="detail-org">Hosted by ${escapeHtml(orgs.join(" · "))}${departments.length ? `<br>${escapeHtml(departments.join(" · "))}` : ""}</p>${status}
    <div class="detail-facts"><div class="detail-fact">${icon("calendar")}<div><strong>${escapeHtml(eventDateLabel(event))}</strong><small>${escapeHtml(eventTime(event))}${timezone && timezone !== DISPLAY_TIMEZONE && !event.allDay ? ` · Source time zone: ${escapeHtml(timezone)}` : ""}</small></div></div>
    <div class="detail-fact">${icon(modeSlug(event.mode) === "online" ? "screen" : "pin")}<div><strong>${escapeHtml(location)}</strong><small>${escapeHtml([event.campus, event.mode && modeLabel(event.mode)].filter(Boolean).join(" · "))}</small></div></div></div>
    <h3 class="detail-section-heading">At a glance</h3><p class="detail-summary">${escapeHtml(summary)}</p><p class="summary-note">${plainText(event.summary) || description ? 'A concise excerpt from the published event information.' : 'The source did not include an event description.'}</p>
    ${description && description !== summary ? `<details class="full-description"><summary>Read full event description</summary><div class="full-description-text">${escapeHtml(description)}</div></details>` : ""}
    ${links.length ? `<a class="button-primary detail-link" href="${escapeHtml(links[0].url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(links[0].label)}<span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a><p class="original-note">Registration, eligibility, tickets, and the latest changes live with the organizer.</p>` : '<p class="original-note">The source did not provide a public event link.</p>'}
    ${links.length > 1 ? `<section class="other-sources"><h3 class="detail-section-heading">Also listed by</h3>${links.slice(1).map(link => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`).join("")}</section>` : ""}</div>`;
  openDialog();
}

/**
 * Present the crawler coverage and known public-source limitations.
 * @return {void}
 */
function openSourceInfo() {
  const sources = statusData?.sources || {};
  const metrics = [[sources.total, "Catalogued sources"], [sources.ok, "Sources with imported events"], [sources.empty, "No imported events in window"], [sources.covered, "Covered by shared feeds"], [sources.error, "Need another check"], [sources.blocked, "Access restricted"], [sources.subscription_only, "Subscription only"], [sources.pending, "Awaiting a check"], [sources.unsupported, "Need a custom integration"]].filter(([value]) => Number.isFinite(value));
  element("dialog-eyebrow").textContent = "BEHIND THE CALENDAR";
  element("detail-content").innerHTML = `<div class="detail-body"><p class="eyebrow">MANY SOURCES. ONE PLACE.</p><h2 class="detail-title" id="detail-title">A wider view of campus.</h2><p class="source-explanation">CMU Events brings together public calendars, department listings, research centers, student organizations, and public newsletters.</p>
    ${metrics.length ? `<div class="source-metrics">${metrics.map(([value, label]) => `<div class="source-metric"><strong>${value.toLocaleString()}</strong><span>${label}</span></div>`).join("")}</div>` : ""}
    <details class="source-diagnostics" id="source-diagnostics"><summary>View source diagnostics</summary><div id="source-diagnostics-content"></div></details>
    <div class="source-explanation"><h3>Refreshed automatically</h3><p>The server checks public sources on its refresh schedule. You can also request an update with the refresh button. Existing events remain available while the next snapshot is collected.</p><h3>What the collection window covers</h3><p>Each refresh imports occurrences from the previous 30 days through the next 365 days. A source with zero imported events may still list older events or publish activities through another calendar. This count describes one collected source; it does not mean the whole organization has no events. A successful automated check also does not establish that the rendered page was visually reviewed.</p><h3>Useful context stays attached</h3><ul><li>Department and organization come from the source catalogue.</li><li>Topics are assigned from published event text. They are discovery aids and can be imperfect.</li><li>Events appearing in multiple calendars are combined when matching source evidence is available.</li><li>Summaries are deterministic excerpts of source text. Every event keeps its original public link.</li></ul><h3>A public listing is an invitation to check the details</h3><p>Some events require registration, tickets, university affiliation, or a specific audience. Check the organizer’s page before attending.</p><h3>Coverage is visible, and still evolving</h3><p>Shared calendar feeds can cover several source pages without fetching each page separately. Login-only pages, unavailable sites, and announcements without a verifiable event date may not appear in results. Source diagnostics include zero-record snapshots and any separately recorded visual review.</p></div><p class="source-time">${statusData?.lastUpdated ? `Last published refresh: ${escapeHtml(updatedLabel(statusData.lastUpdated))}.` : "The first refresh has not been published yet."}</p></div>`;
  element("source-diagnostics").addEventListener("toggle", event => { if (event.target.open) loadSourceDiagnostics(); });
  openDialog();
}

/**
 * Load source health records only when a reader opens the diagnostics section.
 * @return {Promise<void>} Completion of the diagnostics request.
 */
async function loadSourceDiagnostics() {
  const container = element("source-diagnostics-content");
  if (!container) return;
  container.innerHTML = '<p class="diagnostics-status" role="status">Checking source details…</p>';
  try {
    if (!diagnosticsData) {
      const response = await fetch("/api/sources", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Source details returned ${response.status}.`);
      const payload = await response.json();
      if (!Array.isArray(payload.sources)) throw new Error("Source details are temporarily unavailable.");
      diagnosticsData = payload.sources;
    }
    if (container.isConnected) renderSourceDiagnostics();
  } catch (error) {
    if (container.isConnected) container.innerHTML = `<p class="diagnostics-status">${escapeHtml(error.message)}</p><button type="button" class="text-button" data-diagnostics-retry>Try again</button>`;
  }
}

/**
 * Render only explicitly recorded visual evidence for a source.
 * @param {Object} source Source record with optional visual-review evidence.
 * @return {string} Escaped review markup, or an empty string without evidence.
 */
function sourceVisualReview(source) {
  const review = source.evidence?.visualReview;
  if (!review || typeof review !== "object") return "";
  const checked = review.checkedAt && Number.isFinite(Date.parse(review.checkedAt)) ? updatedLabel(review.checkedAt) : "";
  const outcome = plainText(review.outcome).replace(/_/g, " ");
  const note = plainText(review.note);
  const url = safeUrl(review.url);
  if (!checked && !outcome && !note && !url) return "";
  return `<div class="diagnostic-visual-review"><p><strong>Recorded visual review</strong>${checked ? ` · ${escapeHtml(checked)}` : ""}</p>${outcome ? `<p>${escapeHtml(outcome)}</p>` : ""}${note ? `<p>${escapeHtml(note)}</p>` : ""}${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Reviewed page <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : ""}</div>`;
}

/**
 * Show filtered source snapshots without claiming organization-wide emptiness.
 * @return {void}
 */
function renderSourceDiagnostics() {
  const container = element("source-diagnostics-content");
  if (!container || !diagnosticsData) return;
  const attentionStates = ["error", "blocked", "unsupported", "pending", "subscription_only"];
  const states = { error: "Needs a check", blocked: "Access restricted", unsupported: "Integration needed", pending: "Awaiting a check", subscription_only: "Subscription only", empty: "Zero imported in window", ok: "Has imported events", covered: "Covered by shared feed" };
  if (!element("source-diagnostics-results")) {
    container.innerHTML = `<div class="diagnostics-controls"><label for="diagnostics-view">Show sources<select id="diagnostics-view" data-diagnostics-view><option value="attention">Needs attention</option><option value="zero">Zero-record sources</option><option value="all">All</option></select></label><label for="diagnostics-search">Search sources<input id="diagnostics-search" data-diagnostics-search type="search" placeholder="Organization, department, or URL" autocomplete="off" value="${escapeHtml(diagnosticsQuery)}"></label></div><div id="source-diagnostics-results"></div>`;
    element("diagnostics-view").value = diagnosticsView;
  }
  const query = diagnosticsQuery.trim().toLocaleLowerCase();
  const matching = diagnosticsData.filter(source => {
    const matchesView = diagnosticsView === "all" || (diagnosticsView === "zero" ? source.state === "empty"
      : attentionStates.includes(source.state) || source.evidence?.visualReview?.requiresReview === true);
    return matchesView && (!query || `${source.org || ""} ${source.department || ""} ${source.url || ""} ${source.fetchUrl || ""}`.toLocaleLowerCase().includes(query));
  }).sort((left, right) => (left.org || "").localeCompare(right.org || ""));
  const visible = matching.slice(0, diagnosticsLimit);
  const results = element("source-diagnostics-results");
  results.innerHTML = `<p class="diagnostics-status" role="status" aria-live="polite">${matching.length ? `Showing ${visible.length} of ${matching.length.toLocaleString()} matching sources.` : "No sources match this view and search."}</p>${diagnosticsView === "zero" ? '<p class="diagnostics-status">Zero imported occurrences in the last successful snapshot’s collection window: 30 days back and 365 days ahead. The original page or another calendar may contain events.</p>' : ""}
    <div class="diagnostics-list">${visible.map(source => {
      const url = safeUrl(source.url);
      const fallback = source.state === "empty" ? "No occurrences were imported from this source in its collection window. This does not establish that the original page or organization has no events."
        : source.state === "ok" ? `${Number(source.eventCount || 0).toLocaleString()} occurrences imported from this source in its collection window.`
        : source.state === "covered" ? "This source is represented by a shared public feed."
        : "This source has not completed a successful check. See its original page for current information.";
      const reason = plainText(source.error || source.reason) || fallback;
      const retained = source.state === "error" && Number(source.eventCount) > 0 ? `<p>${Number(source.eventCount).toLocaleString()} imported occurrences remain available while this source needs review.</p>` : "";
      return `<details class="diagnostic-source"><summary><span>${escapeHtml(source.org || source.department || "CMU source")}</span><small>${escapeHtml(states[source.state] || "Status unavailable")}</small></summary>${retained}<p>${escapeHtml(reason)}</p><p class="diagnostic-department">${escapeHtml(source.department || "Carnegie Mellon University")}${source.lastAttempt ? ` · Checked ${escapeHtml(updatedLabel(source.lastAttempt))}` : ""}</p>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Visit original source <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : ""}${sourceVisualReview(source)}</details>`;
    }).join("")}</div>${visible.length < matching.length ? '<button type="button" class="button-secondary diagnostics-more" data-diagnostics-more>Show more sources</button>' : ""}`;
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
  element("active-filters").addEventListener("click", event => { const button = event.target.closest("[data-remove]"); if (button) changeFilter(button.dataset.remove, button.dataset.remove === "preset" ? "upcoming" : ""); });
  ["reset-filters", "empty-reset"].forEach(id => element(id).addEventListener("click", resetFilters));
  element("retry-button").addEventListener("click", () => loadEvents());
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => { state.view = button.dataset.view; syncControls(); updateUrl(); }));
  element("event-results").addEventListener("click", event => { const button = event.target.closest("[data-event]"); if (button && eventMap.has(button.dataset.event)) openEvent(eventMap.get(button.dataset.event)); });
  element("previous-page").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); loadEvents(true); });
  element("next-page").addEventListener("click", () => { state.page += 1; loadEvents(true); });
  element("refresh-button").addEventListener("click", refreshSources);
  ["about-button", "source-info-button"].forEach(id => element(id).addEventListener("click", openSourceInfo));
  element("dialog-close").addEventListener("click", () => element("detail-dialog").close());
  element("detail-dialog").addEventListener("close", () => { document.body.classList.remove("dialog-open"); previousFocus?.focus({ preventScroll: true }); });
  element("detail-dialog").addEventListener("click", event => { if (event.target === element("detail-dialog") && event.clientX < element("detail-dialog").getBoundingClientRect().left) element("detail-dialog").close(); });
  element("detail-content").addEventListener("click", event => {
    if (event.target.closest("[data-diagnostics-retry]")) loadSourceDiagnostics();
    if (event.target.closest("[data-diagnostics-more]")) { diagnosticsLimit += 30; renderSourceDiagnostics(); }
  });
  element("detail-content").addEventListener("change", event => {
    if (event.target.matches("[data-diagnostics-view]")) { diagnosticsView = event.target.value; diagnosticsLimit = 30; renderSourceDiagnostics(); }
  });
  element("detail-content").addEventListener("input", event => {
    if (event.target.matches("[data-diagnostics-search]")) { diagnosticsQuery = event.target.value; diagnosticsLimit = 30; renderSourceDiagnostics(); }
  });
  element("mobile-filter-button").addEventListener("click", openFilters);
  ["close-filters", "filter-backdrop", "show-events"].forEach(id => element(id).addEventListener("click", closeFilters));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeFilters();
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !element("detail-dialog").open && !document.body.classList.contains("filters-open")) { event.preventDefault(); element("search-input").focus(); }
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
  element("today-month").textContent = calendarLabel(today, { month: "short" }).toUpperCase();
  element("today-number").textContent = calendarLabel(today, { day: "numeric" });
  element("today-weekday").textContent = calendarLabel(today, { weekday: "long" }).toUpperCase();
  element("display-timezone").textContent = DISPLAY_TIMEZONE;
  syncControls();
  bindEvents();
  loadEvents();
  loadStatus();
}

initialize();
