import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFParse } from 'pdf-parse';

const execute = promisify(execFile);
const VERSION = 'tesseract-eng-psm11-invert-v1';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 28_000_000;

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
    const canvas = createCanvas(image.width, image.height);
    const drawing = canvas.getContext('2d');
    drawing.drawImage(image, 0, 0);
    const original = join(folder, 'original.png');
    await writeFile(original, canvas.toBuffer('image/png'));
    const pixels = drawing.getImageData(0, 0, image.width, image.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const grey = 255 - Math.round(.299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2]);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = grey;
      pixels.data[i + 3] = 255;
    }
    drawing.putImageData(pixels, 0, 0);
    const inverted = join(folder, 'inverted.png');
    await writeFile(inverted, canvas.toBuffer('image/png'));
    const variants = [];
    // Sequential work avoids running several memory-heavy OCR processes per source.
    for (const [name, file] of [['original', original], ['inverted', inverted]]) {
      const output = join(folder, name);
      await execute(process.env.CMU_TESSERACT_PATH || 'tesseract', [file, output, '-l', 'eng', '--psm', '11', 'txt', 'tsv'], { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
      variants.push({ text: await readFile(`${output}.txt`, 'utf8'), words: parseOcrTsv(await readFile(`${output}.tsv`, 'utf8')) });
    }
    return { kind: 'image', width: image.width, height: image.height, variants };
  } finally { await rm(folder, { recursive: true, force: true }); }
}

/**
 * Read a current public image/PDF; cache raw extraction by bytes, never events.
 * PDF dates come only from visible page content, never filenames or metadata.
 * @param {Uint8Array} bytes Downloaded media bytes.
 * @param {Object} options Optional cache directory; false disables disk caching.
 * @return {Promise<Object>} Raw first-page text and/or OCR with a content hash.
 */
export async function extractMedia(bytes, options = {}) {
  if (!bytes?.length || bytes.length > MAX_BYTES) throw new Error('Media bytes are missing or exceed the 20 MiB limit');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const folder = options.cacheDir === false ? null : options.cacheDir || process.env.CMU_MEDIA_CACHE_DIR || '.cache/media-ocr';
  const cacheFile = folder && join(folder, `${VERSION}-${digest}.json`);
  if (cacheFile) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (cached.version === VERSION && cached.sha256 === digest && Array.isArray(cached.variants)) return cached;
    } catch { /* A missing or incomplete cache always triggers extraction. */ }
  }
  let result;
  if (Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-') {
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const page = await parser.getText({ partial: [1] });
      const text = page.pages?.[0]?.text || page.text;
      result = { kind: 'pdf', text: text || '', variants: [], pageLimit: 1 };
      if ((text || '').replace(/\s/g, '').length < 40) {
        const rendered = await parser.getScreenshot({ partial: [1], desiredWidth: 1800, imageDataUrl: false });
        if (!rendered.pages?.[0]?.data) throw new Error('PDF first page could not be rendered');
        result = { ...result, ...await recognizeImage(rendered.pages[0].data), kind: 'pdf' };
      }
    } finally { await parser.destroy(); }
  } else {
    const magic = Buffer.from(bytes).subarray(0, 12);
    if (!(magic[0] === 0x89 && magic.subarray(1, 4).toString() === 'PNG') && !(magic[0] === 0xff && magic[1] === 0xd8) && magic.subarray(0, 3).toString() !== 'GIF' && magic.subarray(8, 12).toString() !== 'WEBP') throw new Error('Unsupported image signature');
    result = await recognizeImage(bytes);
  }
  result = { ...result, version: VERSION, sha256: digest };
  if (cacheFile) {
    await mkdir(folder, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result));
  }
  return result;
}
