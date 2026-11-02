import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFParse } from 'pdf-parse';

const VERSION = 'tesseract-eng-psm11-invert-pages-v3';
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_PIXELS = 28_000_000;
const OCR_TIMEOUT_MS = 90_000;
const MAX_OCR_PROCESSES = 2;
let cacheSequence = 0;
let activeOcrProcesses = 0;
const ocrWaiters = [];

/**
 * Reserve one process-wide OCR slot across all concurrently collected sources.
 * @return {Promise<Function>} Release callback for the reserved slot.
 */
async function reserveOcrProcess() {
  if (activeOcrProcesses >= MAX_OCR_PROCESSES) await new Promise(resolve => ocrWaiters.push(resolve));
  else activeOcrProcesses++;
  return () => {
    const next = ocrWaiters.shift();
    if (next) next();
    else activeOcrProcesses--;
  };
}

/**
 * Run one bounded single-threaded Tesseract process with safe failure evidence.
 * The parent controls timeout kills explicitly so diagnostics do not infer a
 * timeout merely from an ordinary nonzero exit or from Tesseract's stderr.
 * @param {string} input Public media's temporary image path.
 * @param {string} output Temporary output basename for text and TSV files.
 * @param {Object} options Optional executable and shorter diagnostic-test limit.
 * @return {Promise<Object>} Elapsed/queue timing for the completed invocation.
 */
export async function runTesseract(input, output, options = {}) {
  const queuedAt = performance.now();
  const release = await reserveOcrProcess();
  const startedAt = performance.now();
  const timeoutMs = Math.min(OCR_TIMEOUT_MS, Math.max(1, Number(options.timeoutMs) || OCR_TIMEOUT_MS));
  try {
    return await new Promise((resolve, reject) => {
      let timedOut = false;
      let timer;
      const child = execFile(options.executable || process.env.CMU_TESSERACT_PATH || 'tesseract',
        [input, output, '-l', 'eng', '--psm', '11', 'txt', 'tsv'],
        { env: { ...process.env, OMP_THREAD_LIMIT: '1' }, maxBuffer: 2 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          clearTimeout(timer);
          const diagnostics = { elapsedMs: Math.round(performance.now() - startedAt), queueMs: Math.round(startedAt - queuedAt), timeoutMs,
            timedOut, killed: Boolean(child.killed || error?.killed), signal: error?.signal || null,
            exitCode: typeof error?.code === 'number' ? error.code : error ? null : 0, code: error?.code ?? null };
          if (!error) { resolve(diagnostics); return; }
          // Do not echo a shell command, executable path, environment, or input
          // contents into the public source diagnostics.
          const detail = String(stderr || '').replaceAll(input, '[input]').replaceAll(output, '[output]')
            .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(-600);
          const failure = new Error(`Tesseract CLI failed (${Object.entries(diagnostics).map(([key, value]) => `${key}=${value ?? 'none'}`).join(', ')})${detail ? `: ${detail}` : ''}`);
          failure.name = 'OcrProcessError';
          failure.diagnostics = diagnostics;
          reject(failure);
        });
      // SIGKILL also bounds a wedged child that ignores the normal SIGTERM.
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      timer.unref();
    });
  } finally { release(); }
}

/**
 * Check common raster dimensions before allocating a decoded image buffer.
 * @param {Uint8Array} bytes Public raster bytes.
 * @return {void} Throws when advertised dimensions exceed the OCR budget.
 */
function checkRasterDimensions(bytes) {
  const input = Buffer.from(bytes);
  let width; let height;
  if (input.length >= 24 && input.subarray(1, 4).toString() === 'PNG') {
    width = input.readUInt32BE(16); height = input.readUInt32BE(20);
  } else if (input.length >= 10 && input.subarray(0, 3).toString() === 'GIF') {
    width = input.readUInt16LE(6); height = input.readUInt16LE(8);
  } else if (input[0] === 0xff && input[1] === 0xd8) {
    for (let offset = 2; offset + 8 < input.length;) {
      if (input[offset] !== 0xff) break;
      const marker = input[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = input.readUInt16BE(offset + 5); width = input.readUInt16BE(offset + 7); break;
      }
      const size = input.readUInt16BE(offset + 2);
      if (size < 2) break;
      offset += size + 2;
    }
  } else if (input.length >= 30 && input.subarray(12, 16).toString() === 'VP8X') {
    width = input.readUIntLE(24, 3) + 1; height = input.readUIntLE(27, 3) + 1;
  }
  if (width !== undefined && (!(width > 0 && height > 0) || width * height > MAX_PIXELS)) throw new Error('Media dimensions exceed the OCR limit');
}

/**
 * Convert Tesseract TSV into words with their original positions and confidence.
 * @param {string} tsv Tesseract's tab-separated output.
 * @return {Object[]} Nonempty word boxes.
 */
export function parseOcrTsv(tsv) {
  return String(tsv).split(/\r?\n/).slice(1).flatMap(line => {
    const cells = line.split('\t');
    if (cells[0] !== '5' || !cells[11]?.trim()) return [];
    const word = { text: cells.slice(11).join('\t').trim(), left: +cells[6], top: +cells[7], width: +cells[8], height: +cells[9], confidence: +cells[10], line: cells.slice(1, 5).join(':') };
    return Object.values(word).some(value => typeof value === 'number' && !Number.isFinite(value)) ? [] : [word];
  });
}

/**
 * Group OCR words without discarding geometry or merging unrelated columns.
 * @param {Object[]} words Positioned OCR words.
 * @return {Object[]} Positioned text lines, ordered from top to bottom.
 */
export function ocrLines(words) {
  const groups = new Map();
  for (const word of words) {
    if (!groups.has(word.line)) groups.set(word.line, []);
    groups.get(word.line).push(word);
  }
  return [...groups.values()].map(group => {
    group.sort((a, b) => a.left - b.left);
    return { text: group.map(word => word.text).join(' '), words: group,
      left: Math.min(...group.map(word => word.left)), top: Math.min(...group.map(word => word.top)),
      right: Math.max(...group.map(word => word.left + word.width)), bottom: Math.max(...group.map(word => word.top + word.height)),
      height: Math.max(...group.map(word => word.height)), confidence: Math.min(...group.map(word => word.confidence)) };
  }).sort((a, b) => a.top - b.top || a.left - b.left);
}

/**
 * OCR one image using two independent color treatments and bounded CLI work.
 * @param {Uint8Array} bytes Current image bytes.
 * @return {Promise<Object>} Raw text and positioned OCR variants.
 */
async function recognizeImage(bytes) {
  checkRasterDimensions(bytes);
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(Buffer.from(bytes));
  if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new Error('Media dimensions exceed the OCR limit');
  const folder = await mkdtemp(join(tmpdir(), 'cmu-event-ocr-'));
  try {
    // A quiet border keeps edge-aligned poster dates from being discarded as
    // page-edge noise. Preserve it as white in both color treatments.
    const border = 48;
    const canvas = createCanvas(image.width + border * 2, image.height + border * 2);
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = 'white';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(image, border, border);
    const original = join(folder, 'original.png');
    await writeFile(original, canvas.toBuffer('image/png'));
    const pixels = drawing.getImageData(border, border, image.width, image.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const grey = 255 - Math.round(.299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2]);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = grey;
      pixels.data[i + 3] = 255;
    }
    drawing.putImageData(pixels, border, border);
    const inverted = join(folder, 'inverted.png');
    await writeFile(inverted, canvas.toBuffer('image/png'));
    const naturalCanvas = createCanvas(image.width, image.height);
    const naturalDrawing = naturalCanvas.getContext('2d');
    naturalDrawing.drawImage(image, 0, 0);
    const natural = join(folder, 'natural.png');
    await writeFile(natural, naturalCanvas.toBuffer('image/png'));
    naturalDrawing.putImageData(pixels, 0, 0);
    const naturalInverted = join(folder, 'natural-inverted.png');
    await writeFile(naturalInverted, naturalCanvas.toBuffer('image/png'));
    const variants = [];
    // Sequential work avoids running several memory-heavy OCR processes per source.
    for (const [name, file] of [['original', natural], ['inverted', naturalInverted], ['inverted-border', inverted]]) {
      const output = join(folder, name);
      await runTesseract(file, output);
      variants.push({ text: await readFile(`${output}.txt`, 'utf8'), words: parseOcrTsv(await readFile(`${output}.tsv`, 'utf8')) });
    }
    return { kind: 'image', width: image.width, height: image.height, variants };
  } finally { await rm(folder, { recursive: true, force: true }); }
}

/**
 * Save resumable raw extraction atomically; failed OCR never approves an event.
 * @param {string|null} file Cache destination, or null to disable persistence.
 * @param {Object} value Raw text, page OCR and extraction progress.
 * @return {Promise<void>} Completion after replacing the cache file.
 */
async function saveMediaCache(file, value) {
  if (!file) return;
  await mkdir(file.slice(0, file.lastIndexOf('/')) || '.', { recursive: true });
  const temporary = `${file}.${process.pid}.${++cacheSequence}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}

/**
 * Read every PDF text page and resume OCR of scanned pages within a time budget.
 * Cached progress is tied only to document bytes and extractor version. A later
 * run continues pending pages rather than repeating a permanently fixed prefix.
 * @param {Uint8Array} bytes Current PDF bytes.
 * @param {Object|null} previous Compatible cached extraction progress.
 * @param {Object} options OCR time budget and optional extra page OCR requests.
 * @param {Function} persist Callback for durable raw-page checkpoints.
 * @return {Promise<Object>} All text pages, OCR results and auditable progress.
 */
async function extractPdfPages(bytes, previous, options, persist) {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const text = previous?.pages?.length ? null : await parser.getText();
    const pages = previous?.pages?.map(page => ({ ...page })) || text.pages.map(page => ({ number: page.num, text: page.text, variants: [] }));
    const budgetMs = Math.max(0, options.ocrBudgetMs ?? Infinity);
    const deadline = performance.now() + budgetMs;
    const forced = new Set(options.ocrPages || []);
    const pending = pages.filter(page => (!page.text || page.text.replace(/\s/g, '').length < 40 || forced.has(page.number)) && !page.ocrDone)
      .sort((first, second) => (first.ocrAttempts || 0) - (second.ocrAttempts || 0) || first.number - second.number);
    const state = { kind: 'pdf', text: pages[0]?.text || '', variants: pages[0]?.variants || [], pages,
      totalPages: previous?.totalPages || text?.total || pages.length, complete: pending.length === 0,
      pendingPages: pending.map(page => page.number), pageErrors: [] };
    await persist(state);
    for (const page of pending) {
      if (performance.now() >= deadline) break;
      page.ocrAttempts = (page.ocrAttempts || 0) + 1;
      try {
        const rendered = await parser.getScreenshot({ partial: [page.number], desiredWidth: 1800, imageDataUrl: false });
        if (!rendered.pages?.[0]?.data) throw new Error(`PDF page ${page.number} could not be rendered`);
        const ocr = await recognizeImage(rendered.pages[0].data);
        Object.assign(page, { variants: ocr.variants, width: ocr.width, height: ocr.height, ocrDone: true });
        delete page.ocrError;
      } catch (error) {
        page.ocrError = error.message;
        state.pageErrors.push({ page: page.number, error: error.message });
      }
      state.pendingPages = pending.filter(candidate => !candidate.ocrDone).map(candidate => candidate.number);
      state.complete = state.pendingPages.length === 0;
      state.variants = pages[0]?.variants || [];
      await persist(state);
      if (options.stopOcrWhen?.(state)) break;
    }
    state.pendingPages = pending.filter(page => !page.ocrDone).map(page => page.number);
    state.complete = state.pendingPages.length === 0;
    state.ocrPagesCompleted = pages.filter(page => page.ocrDone).length;
    return state;
  } finally { await parser.destroy(); }
}

/**
 * Read current public media with resumable all-page PDF coverage and raw caching.
 * No date is derived from a filename, metadata or previously approved fields.
 * @param {Uint8Array} bytes Downloaded media bytes, up to the download budget.
 * @param {Object} options Cache directory, OCR budget and optional page requests.
 * @return {Promise<Object>} Raw text/OCR plus complete or pending page progress.
 */
export async function extractMedia(bytes, options = {}) {
  if (!bytes?.length || bytes.length > MAX_BYTES) throw new Error('Media bytes are missing or exceed the 128 MiB resource limit');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const folder = options.cacheDir === false ? null : options.cacheDir || process.env.CMU_MEDIA_CACHE_DIR || '.cache/media-ocr';
  const cacheFile = folder && join(folder, `${VERSION}-${digest}.json`);
  let cached;
  if (cacheFile) {
    try {
      const candidate = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (candidate.version === VERSION && candidate.sha256 === digest && Array.isArray(candidate.variants)) cached = candidate;
    } catch { /* Missing, older or partial writes cannot approve cached events. */ }
  }
  const extraPages = options.ocrPages || [];
  if (cached && cached.complete !== false && extraPages.every(number => cached.pages?.some(page => page.number === number && page.ocrDone))) return cached;
  const persist = value => saveMediaCache(cacheFile, { ...value, version: VERSION, sha256: digest });
  let result;
  if (Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-') {
    result = await extractPdfPages(bytes, cached, options, persist);
  } else {
    const magic = Buffer.from(bytes).subarray(0, 12);
    if (!(magic[0] === 0x89 && magic.subarray(1, 4).toString() === 'PNG') && !(magic[0] === 0xff && magic[1] === 0xd8) && magic.subarray(0, 3).toString() !== 'GIF' && magic.subarray(8, 12).toString() !== 'WEBP') throw new Error('Unsupported image signature');
    result = { ...await recognizeImage(bytes), complete: true };
  }
  result = { ...result, version: VERSION, sha256: digest };
  await saveMediaCache(cacheFile, result);
  return result;
}
