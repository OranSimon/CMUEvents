import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { publicAddress } from './fetcher.mjs';

const LISTING = 'https://community.cmu.edu/s/events';
const CARD = '.cCommunity_Event_Tile';

/**
 * Validate the narrowly scoped public pages supported by the renderer.
 * @param {Object} request Requested public page and extraction kind.
 * @return {string} Canonical HTTPS URL without credentials.
 */
export function publicRenderUrl(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid public render URL');
  if (request.kind === 'alumni' && url.href === LISTING) return url.href;
  if (request.kind === 'event-detail' && ['www.givecampus.com', 'givecampus.com'].includes(url.hostname)
    && /^\/schools\/CarnegieMellonUniversity\/events\/[^/]+\/?$/.test(url.pathname) && !url.search) return url.href;
  throw new Error('Public rendering is restricted to the advertised Alumni listing and its public CMU event pages');
}

/**
 * Validate browser requests and redirect targets against public DNS addresses.
 * The per-render memo avoids repeated DNS work for scripts and stylesheet assets.
 * @param {Object} options Optional DNS resolver for deterministic boundary tests.
 * @return {Function} Async validator for anonymous HTTPS network destinations.
 */
export function createPublicNetworkGuard(options = {}) {
  const resolved = new Map();
  return async value => {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || host === 'localhost'
      || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Non-public browser destination rejected');
    if (!resolved.has(host)) resolved.set(host, isIP(host) ? Promise.resolve([{ address: host }])
      : (options.lookup || lookup)(host, { all: true }));
    const addresses = await resolved.get(host);
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Non-public browser destination rejected');
    return url;
  };
}

/**
 * Read all visible public Alumni cards through the actual Next control.
 * This uses rendered DOM text and links only, never framework state or APIs.
 * @param {Object} page Anonymous Playwright page on the public listing.
 * @param {Object} options Explicit pagination and card safety bounds.
 * @return {Promise<Object>} Current cards and transparent completeness state.
 */
export async function collectAlumniCards(page, options = {}) {
  const maxPages = Math.max(1, Math.min(100, Number(options.maxPages) || 30));
  const maxCards = Math.max(1, Math.min(2000, Number(options.maxCards) || 500));
  const rows = new Map();
  const warnings = [];
  const seen = new Set();
  for (let index = 0; index < maxPages; index++) {
    try {
      await page.waitForFunction(selector => {
        const cards = [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length);
        return (cards.length > 0 && cards.every(node => /\b20\d{2}\b/.test(node.querySelector('lightning-formatted-date-time')?.innerText || '')))
          || [...document.querySelectorAll('main, .cCommunity_Event_List')].some(node => /^No Events\.$/i.test(node.innerText.trim()));
      }, CARD, { timeout: 35000 });
    } catch (error) {
      if (!await page.locator(CARD).count()) throw error;
      warnings.push('Some public Alumni card dates did not finish rendering; valid visible cards are retained');
    }
    const current = await page.evaluate(selector => [...document.querySelectorAll(selector)]
      .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
      .map(node => ({ title: node.querySelector('a.evt_name')?.innerText?.trim() || '',
        url: node.querySelector('a.evt_name')?.href || '',
        dateText: node.querySelector('lightning-formatted-date-time')?.innerText?.trim() || '',
        text: node.innerText })), CARD);
    const signature = JSON.stringify(current.map(row => [row.url, row.dateText]));
    if (seen.has(signature)) { warnings.push('Public Alumni pagination repeated an unchanged page'); break; }
    seen.add(signature);
    for (const row of current) {
      rows.set(row.url, row);
      if (rows.size > maxCards) {
        warnings.push(`Public Alumni card limit ${maxCards} reached`);
        return { rows: [...rows.values()].slice(0, maxCards), partial: true, warnings };
      }
    }
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (!await next.count() || !await next.isVisible()) {
      if (current.length) warnings.push('Public Alumni pagination control is missing; completeness could not be verified');
      return { rows: [...rows.values()], partial: current.length > 0 || warnings.length > 0, warnings, pages: index + 1 };
    }
    if (!await next.isEnabled()) {
      return { rows: [...rows.values()], partial: warnings.length > 0, warnings, pages: index + 1 };
    }
    if (index === maxPages - 1) { warnings.push(`Public Alumni page limit ${maxPages} reached while Next remains enabled`); break; }
    await next.click();
    await page.waitForFunction(({ selector, previous }) => {
      const current = [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length)
        .map(node => [node.querySelector('a.evt_name')?.href || '', node.querySelector('lightning-formatted-date-time')?.innerText?.trim() || '']);
      return JSON.stringify(current) !== previous;
    }, { selector: CARD, previous: signature }, { timeout: 20000 });
  }
  return { rows: [...rows.values()], partial: true, warnings };
}

/**
 * Create a lazy, anonymous renderer for production public-DOM collection.
 * Tests inject renderPublic or launch; local research remains in CUA.
 * @param {Object} options Explicit enable flag and optional browser factory.
 * @return {Object} renderPublic(request) and async close() lifecycle methods.
 */
export function createPublicRenderer(options = {}) {
  let browserPromise;

  /**
   * Lazily launch the explicitly enabled anonymous production browser.
   * @return {Promise<Object>} Shared browser instance for isolated contexts.
   */
  async function browser() {
    if (options.enabled !== true) throw new Error('Public rendering is disabled; enable CMUEVENTS_RENDER_PUBLIC=1');
    browserPromise ||= (options.launch ? options.launch() : import('playwright').then(({ chromium }) => chromium.launch({ headless: true,
      args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] })));
    try { return await browserPromise; } catch (error) { browserPromise = undefined; throw error; }
  }

  /**
   * Render one allowlisted public page without stored cookies or credentials.
   * @param {Object} request Public URL, kind and optional collection bounds.
   * @return {Promise<Object>} Visible fields with no guest-list or hidden state.
   */
  async function renderPublic(request) {
    const url = publicRenderUrl(request);
    const context = await (await browser()).newContext({ locale: 'en-US', timezoneId: 'America/New_York',
      acceptDownloads: false, serviceWorkers: 'block' });
    let page;
    let response;
    try {
      page = await context.newPage();
      const publicNetwork = createPublicNetworkGuard({ lookup: options.lookup });
      await context.route('**/*', async route => {
        try {
          const requestObject = route.request();
          await publicNetwork(requestObject.url());
          if (requestObject.isNavigationRequest() && requestObject.frame() === page.mainFrame()) {
            publicRenderUrl({ ...request, url: requestObject.url() });
          }
          await route.continue();
        } catch { await route.abort('blockedbyclient'); }
      });
      if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
      page.setDefaultTimeout(30000);
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (request.kind === 'alumni') return { url, ...await collectAlumniCards(page, request) };
      const heading = page.getByRole('heading', { name: 'Event Details', exact: true });
      await heading.waitFor({ state: 'visible', timeout: 30000 });
      const detailText = await heading.evaluate(node => {
        const root = node.parentElement.parentElement;
        if ([...root.querySelectorAll('h1,h2,h3,h4')].some(heading => /guest list/i.test(heading.innerText))) {
          throw new Error('Original Event Details scope changed; guest-list content is excluded');
        }
        return root.innerText;
      });
      const title = await page.getByRole('heading', { level: 1 }).first().innerText();
      const description = await page.locator('#event-tabpanel').isVisible()
        ? await page.locator('#event-tabpanel').innerText() : '';
      return { url, title, detailText, description, partial: false };
    } catch (error) {
      const diagnostic = { httpStatus: response?.status() ?? null, finalUrl: url, title: null, firstVisibleH1: null };
      try {
        const final = new URL(page?.url() || url);
        diagnostic.finalUrl = `${final.origin}${final.pathname}`;
      } catch { /* Preserve the validated original URL if navigation is unavailable. */ }
      try { diagnostic.title = String(await page.title()).slice(0, 240); } catch { /* No document title was available. */ }
      try {
        const heading = page.locator('h1:visible').first();
        if (await heading.count()) diagnostic.firstVisibleH1 = (await heading.innerText({ timeout: 1500 })).slice(0, 240);
      } catch { /* Read neither body text nor hidden fallback state. */ }
      const failure = new Error(`${error.message}; public page diagnostic: ${JSON.stringify(diagnostic)}`, { cause: error });
      failure.publicRenderDiagnostic = diagnostic;
      throw failure;
    } finally { await context.close(); }
  }

  /**
   * Close the browser; the same renderer may lazily reopen on a later refresh.
   * @return {Promise<void>} Resolution when the browser is closed.
   */
  async function close() {
    if (!browserPromise) return;
    const pending = browserPromise;
    browserPromise = undefined;
    await (await pending).close();
  }
  return { renderPublic, close };
}
