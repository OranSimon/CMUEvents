import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readConfig, loadPlans, localDay, ROOT } from './config.mjs';
import { openStore } from './lib/store.mjs';
import { createRefresher } from './refresh.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/**
 * Send a JSON API response with safe defaults.
 * @param {http.ServerResponse} response Outgoing response.
 * @param {number} status HTTP status code.
 * @param {Object} value Serializable response body.
 * @return {void}
 */
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

/**
 * Validate calendar-day query parameters before passing them into storage.
 * @param {string|null} value User date filter.
 * @return {string|undefined} Valid ISO day, undefined if absent.
 */
function validDay(value) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Dates must use a valid YYYY-MM-DD value.');
  return value;
}

/**
 * Create the local API and static web server without starting a second scheduler.
 * @param {Object} options Optional config, source plans and store overrides.
 * @return {Object} Server, storage and refresh coordinator for startup or tests.
 */
export function createApplication(options = {}) {
  const config = options.config || readConfig();
  const plans = options.plans || loadPlans();
  const store = options.store || openStore(config.databasePath);
  store.registerPlans(plans);
  store.rebuildEvents(plans);
  const refresher = options.refresher || createRefresher(store, plans, config);
  const webRoot = path.join(ROOT, 'web');

  /**
   * Route public read APIs, same-origin refresh requests and static assets.
   * @param {http.IncomingMessage} request Incoming local HTTP request.
   * @param {http.ServerResponse} response Outgoing response.
   * @return {Promise<void>} Resolution after the response has been sent.
   */
  async function handle(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/events') {
          const from = validDay(url.searchParams.get('from')) || localDay();
          const to = validDay(url.searchParams.get('to'));
          if (to && to < from) return json(response, 400, { error: 'The end date must be on or after the start date.' });
          const filters = Object.fromEntries(['department', 'org', 'tag', 'campus', 'mode', 'page', 'limit'].map(key => [key, (url.searchParams.get(key) || '').slice(0, 300)]));
          const modeAliases = { online: 'Online', virtual: 'Online', 'in-person': 'In person', 'in person': 'In person', hybrid: 'Hybrid', unspecified: 'Unspecified' };
          filters.mode = modeAliases[filters.mode.toLowerCase()] || filters.mode;
          return json(response, 200, { ...store.listEvents({ ...filters, from, to,
            query: (url.searchParams.get('query') || url.searchParams.get('q') || '').slice(0, 500) }), refreshing: refresher.isRunning() });
        }
        if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, refresher.status());
        if (request.method === 'GET' && url.pathname === '/api/sources') return json(response, 200, { sources: store.listSources() });
        if (request.method === 'GET' && url.pathname.startsWith('/api/events/')) {
          const event = store.getEvent(decodeURIComponent(url.pathname.slice('/api/events/'.length)));
          return json(response, event ? 200 : 404, event || { error: 'Event not found.' });
        }
        if (request.method === 'POST' && url.pathname === '/api/refresh') {
          const origin = request.headers.origin;
          const localOrigin = `http://${request.headers.host}`;
          if ((origin && origin !== localOrigin) || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Refresh requests must come from this application.' });
          const wasRunning = refresher.isRunning();
          void refresher.refresh({ force: true }).catch(error => console.error('[refresh]', error));
          return json(response, 202, { accepted: true, alreadyRunning: wasRunning, refreshing: true });
        }
        return json(response, 404, { error: 'API endpoint not found.' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed.' });
      const asset = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filename = path.resolve(webRoot, asset);
      if (!filename.startsWith(`${webRoot}${path.sep}`) || !MIME[path.extname(filename)]) return json(response, 404, { error: 'File not found.' });
      try {
        const content = await readFile(filename);
        response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)], 'Cache-Control': 'no-cache' });
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch (error) {
        if (error.code === 'ENOENT') return json(response, 404, { error: 'File not found.' });
        throw error;
      }
    } catch (error) {
      if (!response.headersSent) json(response, /date|YYYY|URI malformed/i.test(error.message) ? 400 : 500, { error: error.message });
      else response.end();
    }
  }
  return { server: http.createServer(handle), store, refresher, config };
}

/**
 * Start the local application, background refresh and graceful signal handling.
 * @return {Promise<Object>} Listening application and scheduler cleanup function.
 */
export async function startApplication() {
  const application = createApplication();
  const { server, refresher, store, config } = application;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  console.log(`CMU Events is ready at http://${config.host}:${server.address().port}`);
  let interval;
  if (config.autoRefresh) {
    void refresher.refresh().catch(error => console.error('[refresh]', error));
    interval = setInterval(() => { void refresher.refresh().catch(error => console.error('[refresh]', error)); }, config.refreshTickMs);
    interval.unref();
  }

  /**
   * Stop serving and release database resources on process termination.
   * @return {void}
   */
  function shutdown() {
    clearInterval(interval);
    refresher.stop();
    server.close();
    setTimeout(() => { store.close(); process.exit(0); }, 500).unref();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { ...application, shutdown };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startApplication().catch(error => { console.error(error.message); process.exitCode = 1; });
}
