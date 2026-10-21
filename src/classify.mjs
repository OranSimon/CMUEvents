import { readFileSync } from 'node:fs';

export const taxonomy = JSON.parse(readFileSync(new URL('../config/taxonomy.json', import.meta.url), 'utf8'));
const patterns = new Map();

/**
 * Match whole words or phrases so short terms do not match unrelated words.
 * @param {string} text Lower-case searchable text.
 * @param {string} term Configured keyword or phrase.
 * @return {boolean} Whether the term occurs at word boundaries.
 */
function hasTerm(text, term) {
  if (!patterns.has(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.set(term, new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u'));
  }
  return patterns.get(term).test(text);
}

/**
 * Infer attendance mode from structured mode and the actual location first.
 * @param {Object} event Normalized source event.
 * @return {string} One of the configured attendance modes.
 */
export function inferMode(event) {
  const explicit = String(event.mode || '').toLowerCase();
  const location = String(event.location || '').toLowerCase();
  if (/hybrid|mixed/.test(explicit) || /hybrid/.test(location)) return 'Hybrid';
  if (/online|virtual|remote/.test(explicit)) return 'Online';
  if (/in.?person|offline/.test(explicit)) return 'In person';
  if (/zoom|https?:|online|virtual|webex|livestream|teams meeting/.test(location)) {
    return /(?:room|hall|auditorium|building|campus).*(?:and|\+|\/)|(?:and|\+).*zoom/.test(location) ? 'Hybrid' : 'Online';
  }
  return location && !/^(tba|tbd|to be announced|location tbd|n\/a)$/i.test(location) ? 'In person' : 'Unspecified';
}

/**
 * Infer a campus only when publisher metadata or location provides evidence.
 * @param {Object} event Normalized source event.
 * @param {Array<Object>} sources Source provenance and organization metadata.
 * @return {string} Campus label, retaining uncertainty for unknown places.
 */
export function inferCampus(event, sources) {
  const text = [event.campus, event.location, ...sources.flatMap(source => [source.department, source.org, source.url])].join(' ').toLowerCase();
  if (/qatar|doha|scotty\.qatar/.test(text)) return 'Qatar';
  if (/kigali|rwanda|cmu.?africa/.test(text)) return 'Africa';
  if (/silicon valley|mountain view|moffett|sv\.cmu/.test(text)) return 'Silicon Valley';
  if (/miami/.test(text)) return 'Miami';
  if (/pittsburgh|tartanconnect\.cmu\.edu|pa 152\d\d|5000 forbes|wean|gates|hillman|doherty|baker hall|porter hall|scott hall|purnell|tepper|cohon|rangos|merson|posner|hamerschlag|margaret morrison|hunt library|mellon institute/.test(text)) return 'Pittsburgh';
  return 'Other / unspecified';
}

/**
 * Add deterministic discovery tags and attendance/campus facets to an event.
 * @param {Object} event Normalized event and provenance.
 * @return {Object} Event with tags, mode and campus labels.
 */
export function classifyEvent(event) {
  const sources = event.sources || [];
  const title = `${event.title} ${(event.tags || []).join(' ')}`.toLowerCase();
  const body = String(event.description || '').slice(0, 18000).toLowerCase();
  const publisher = sources.map(source => `${source.department} ${source.org}`).join(' ').toLowerCase();
  const scored = taxonomy.tags.map((tag, index) => ({
    name: tag.name, index,
    score: tag.terms.reduce((score, term) => score + (hasTerm(title, term) ? 4 : 0)
      + (hasTerm(body, term) ? 1 : 0) + (hasTerm(publisher, term) ? 1 : 0), 0),
  })).filter(tag => tag.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return { ...event, tags: scored.length ? scored.slice(0, taxonomy.maxTags).map(tag => tag.name) : [taxonomy.fallback],
    mode: inferMode(event), campus: inferCampus(event, sources) };
}
