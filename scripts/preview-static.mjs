import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.CMUEVENTS_PREVIEW_DIR || 'dist');
const port = Number(process.env.PORT || 4175);
const prefix = '/CMUEvents/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

/**
 * Preview a generated Pages artifact at its real repository subpath.
 * @param {http.IncomingMessage} request Local read-only preview request.
 * @param {http.ServerResponse} response Outgoing static response.
 * @return {Promise<void>} Response completion.
 */
async function handle(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/') { response.writeHead(302, { Location: prefix }).end(); return; }
  if (url.pathname === '/__responsive') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>CMU Events responsive preview</title><style>body{margin:0;background:#ddd;display:grid;place-items:start center}iframe{width:390px;height:844px;border:0;background:white}</style></head><body><iframe title="CMU Events at 390px" src="${prefix}"></iframe></body></html>`);
    return;
  }
  if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
  try {
    const asset = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const filename = path.resolve(root, asset);
    if (!filename.startsWith(`${root}${path.sep}`) || (!mime[path.extname(filename)] && asset !== 'LICENSE')) {
      response.writeHead(404).end(); return;
    }
    const content = await readFile(filename);
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404).end(); }
}

http.createServer(handle).listen(port, '127.0.0.1', () => console.log(`Static Pages preview: http://127.0.0.1:${port}${prefix}`));
