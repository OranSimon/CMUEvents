import { createHash } from 'node:crypto';

export const JEV_MODEL = 'jev-1.14.0';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

/** Build a typed TypeSafe Choice question. */
export function choice(instructions, criteria) {
  return { type: 'choice', instructions, criteria };
}

/** Keep model inputs short and strip links and contact information from public text. */
export function jevText(value) {
  return String(value || '').replace(/(?:https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/(?<!\d)(?:\+1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)/g, '[phone]')
    .trim();
}

/** Return a selected option only when the typed answer and its distribution agree. */
export function acceptedChoice(answer, question, threshold) {
  const options = Object.keys(question.criteria);
  const probabilities = answer?.probabilities;
  if (answer?.type !== 'choice' || !options.includes(answer.choice) || !probabilities) return null;
  const values = options.map(key => probabilities[key]);
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1)
    || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.01
    || probabilities[answer.choice] < threshold || probabilities[answer.choice] !== Math.max(...values)) return null;
  return answer.choice;
}

/**
 * Evaluate bounded requests on a build runner. Reuse identical in-flight and
 * successful requests within the build and report only counts, never payloads.
 * @param {Object} options API key, request limit and optional injected transport.
 * @return {Object} Bounded decision function and diagnostics.
 */
export function createJevClient({ apiKey, maxPerKind = 24, fetchImpl = fetch } = {}) {
  const stats = { model: JEV_MODEL, configured: Boolean(apiKey), inputTokens: 0,
    time: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
    merge: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, httpErrors: {} };
  const cache = new Map();
  let unavailable = false;
  async function request(body, counts) {
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
      });
      if (!response.ok) {
        stats.httpErrors[response.status] = (stats.httpErrors[response.status] || 0) + 1;
        if ([401, 402, 403, 429].includes(response.status)) unavailable = true;
        await response.body?.cancel();
        counts.failed++;
        return null;
      }
      const result = await response.json();
      if (result.model !== JEV_MODEL || !result.answers || typeof result.answers !== 'object') {
        counts.failed++;
        return null;
      }
      if (Number.isSafeInteger(result.usage?.input_tokens) && result.usage.input_tokens >= 0) {
        stats.inputTokens += result.usage.input_tokens;
      }
      counts.succeeded++;
      return result.answers;
    } catch {
      counts.failed++;
      return null;
    }
  }
  function ask(kind, state, questions) {
    const counts = stats[kind];
    if (!apiKey || unavailable) { counts.skipped++; return null; }
    const body = JSON.stringify({ model: JEV_MODEL, state, questions });
    const key = createHash('sha256').update(kind).update(body).digest('hex');
    if (cache.has(key)) return cache.get(key);
    if (counts.attempted >= maxPerKind || Buffer.byteLength(body) > 12_000) { counts.skipped++; return null; }
    counts.attempted++;
    const pending = request(body, counts).then(result => {
      if (!result) cache.delete(key);
      return result;
    });
    cache.set(key, pending);
    return pending;
  }
  return { ask, stats };
}
