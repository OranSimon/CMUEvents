import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { extractMedia, parseOcrTsv } from '../src/lib/media-ocr.mjs';
import { mediaDates, mediaClock, parseMediaPoster, parseMediaTable, fetchAutomaticMedia } from '../src/adapters/automatic-media.mjs';
import { fetchEvents } from '../src/adapters/index.mjs';

const plan = { id: 'media-test', url: 'https://example.edu/seminars', adapter: 'html', options: { timezone: 'America/New_York' } };
const lti = JSON.parse(await readFile(new URL('./fixtures/automatic-media/lti.json', import.meta.url), 'utf8'));
const socialist = JSON.parse(await readFile(new URL('./fixtures/automatic-media/socialist.json', import.meta.url), 'utf8'));

test('visible dates require a printed year, a valid calendar day, and consistent weekday', () => {
  assert.equal(mediaDates('May 7').dates.length, 0);
  assert.equal(mediaDates('CMU, April 2026').dates.length, 0);
  assert.equal(mediaDates('February 30, 2026').dates.length, 0);
  assert.equal(mediaDates('Friday, November 20, 2026').dates[0].start, '2026-11-20');
  assert.equal(mediaDates('Thursday, November 20, 2026').dates.length, 0);
  assert.equal(mediaDates('November 20, 2026', { year: 2027 }).dates.length, 0);
  assert.equal(mediaDates('November 20', { year: 2026, allowContextYear: true }).dates[0].start, '2026-11-20');
  assert.deepEqual(mediaDates('April 3–4, 2024').dates.map(({start,end}) => ({start,end})), [{start:'2024-04-03',end:'2024-04-05'}]);
  assert.equal(mediaDates('Lecture on 2/27/2026 at 4:30pm').dates[0].start, '2026-02-27');
});

test('clock precision never guesses cross-period AM/PM or a missing duration', () => {
  assert.deepEqual(mediaClock('4:00–5:30pm'), {start:'16:00:00',end:'17:30:00'});
  assert.deepEqual(mediaClock('10–11:30 am'), {start:'10:00:00',end:'11:30:00'});
  assert.deepEqual(mediaClock('9–1pm'), {start:'09:00:00',end:'13:00:00'});
  assert.deepEqual(mediaClock('11–12:30pm'), {start:'11:00:00',end:'12:30:00'});
  assert.deepEqual(mediaClock('noon–1:30pm'), {start:'12:00:00',end:'13:30:00'});
  assert.equal(mediaClock('9–1am').ambiguous, true);
  assert.deepEqual(mediaClock('11:00am–1:30pm'), {start:'11:00:00',end:'13:30:00'});
  assert.deepEqual(mediaClock('Begins 3:00pm'), {start:'15:00:00'});
  assert.equal(mediaClock('9–11'), null);
});

test('real LTI OCR rows keep geometric pairing, printed clock labels, and DST', () => {
  const result = parseMediaTable(lti, {year:2026,heading:'Fall 2026 Schedule',seriesTitle:'LTI Colloquium'}, plan);
  assert.equal(result.recognized, 13);
  assert.equal(result.events.find(event => event.title.endsWith('Diyi Yang')).start, '2026-09-11T19:30:00.000Z');
  assert.equal(result.events.find(event => event.title.endsWith('Chris Potts')).start, '2026-10-30T19:30:00.000Z');
  assert.equal(result.events.find(event => event.title.endsWith('Jocelyn Shen')).end, '2026-11-13T22:00:00.000Z');
  assert.equal(result.events.filter(event => event.title === 'LTI Social').length, 6);
  assert.ok(result.events.every(event => event.location === 'NSH 4305'));
  assert.equal(result.events.find(event => event.start.startsWith('2026-11-20')).title, 'LTI Colloquium');
  assert.equal(result.partial, false, 'uncertain speaker metadata does not erase complete occurrence coverage');
  assert.match(result.warnings.join(' '), /Speaker text is uncertain/);
  assert.ok(result.events.every(event => !event.title.includes('Mohit lyyer')));
});

test('the same raw image cannot acquire a new semester year that conflicts with its printed weekday', () => {
  const result = parseMediaTable(lti, {year:2027,seriesTitle:'LTI Colloquium'}, plan);
  assert.equal(result.events.length, 0);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /weekday/);
  assert.equal(parseMediaTable(lti, {}, plan).events.length, 0);
});

test('real white-on-color poster is read from the inverted treatment without invented topic text', () => {
  const result = parseMediaPoster(socialist, {year:2026,allowContextYear:true,seriesTitle:'Socialist Studies Seminar'}, plan);
  assert.equal(result.recognized, 1);
  assert.equal(result.events[0].title, 'Socialist Studies Seminar — Anna Muller');
  assert.equal(result.events[0].start, '2026-11-20T21:00:00.000Z');
  assert.equal(result.events[0].end, '2026-11-20T22:30:00.000Z');
  assert.equal(result.events[0].location, 'Baker/Porter Hall 246A, CMU');
});

test('disagreement, multiple dates, and ambiguous clock ranges keep honest partial results', () => {
  const ambiguous = parseMediaPoster({text:'Seminar\nNovember 20, 2026\n9–1am',variants:[]}, {seriesTitle:'Seminar'}, plan);
  assert.equal(ambiguous.events[0].start, '2026-11-20');
  assert.equal(ambiguous.events[0].timePrecision, 'date');
  assert.equal(ambiguous.partial, false);
  assert.match(ambiguous.warnings.join(' '), /date-only/);
  const multiple = parseMediaPoster({text:'November 20, 2026\nNovember 21, 2026',variants:[]}, {seriesTitle:'Seminar'}, plan);
  assert.equal(multiple.events.length, 0);
  assert.equal(multiple.partial, true);
  const low = parseMediaPoster({variants:[{text:'November 20, 2026',words:[]}]}, {seriesTitle:'Seminar'}, plan);
  assert.equal(low.events.length, 0);
  assert.match(low.warnings.join(' '), /confidence/);
});

test('dynamic media discovery reads a newly added asset while an old asset remains present', async () => {
  const html = '<h1>Fall 2026 Schedule</h1><p><img src="old.png"><img src="new.png"></p>';
  const seen = [];
  const source = {...plan,options:{reviewedFragmentsOnly:true,automaticMedia:[{selector:'h1:contains("Schedule") + p img',seriesTitle:'Public seminar'}]}};
  const result = await fetchEvents(source, {fetchText:async()=>html,fetchBytes:async url=>{seen.push(url);return Buffer.from(url.endsWith('old.png')?'old':'new');},extractMedia:async bytes=>({text:`November ${bytes.toString()==='old'?20:21}, 2026\n4:00-5:30pm`,variants:[]})});
  assert.equal(result.events.length, 2);
  assert.equal(seen.length, 2);
  assert.equal(result.partial, undefined);
});

test('fresh accessible alt text works without OCR and retains explicit numeric date/time', async () => {
  const result = await fetchAutomaticMedia('<img alt="Photo of Augustus Wood\'s guest speaker lecture on 2/27/2026 at Baker Hall room A53, at 4:30pm - 6:45pm." src="poster.png">',
    {...plan,options:{automaticMedia:[{selector:'img'}]}}, {fetchBytes:async()=>{throw new Error('Alt equivalent should avoid a redundant OCR request');}});
  assert.equal(result.events[0].start, '2026-02-27T21:30:00.000Z');
  assert.match(result.events[0].title, /Augustus Wood/);
});

test('missing OCR or unreadable media never falls back to configured fixed reviewed event fields', async () => {
  const source = {...plan,options:{automaticMedia:[{selector:'img',seriesTitle:'Seminar',events:[{title:'Stale manually approved title',start:'2026-11-20'}]}]}};
  const result = await fetchAutomaticMedia('<img src="current.png">',source,{fetchBytes:async()=>Buffer.from('changed bytes'),extractMedia:async()=>{throw new Error('Tesseract executable missing');}});
  assert.deepEqual(result.events,[]);
  assert.equal(result.partial,true);
  assert.match(result.warnings.join(' '),/executable missing/);
  const missing = await fetchAutomaticMedia('<p>No longer advertises a poster</p>',source,{});
  assert.equal(missing.partial,true);
});

test('legacy asset caps never truncate complete semantic discovery', async () => {
  const source={...plan,options:{automaticMedia:[{selector:'a',attribute:'href',fromEnd:true,maxAssets:1,seriesTitle:'Seminar'}]}};
  const calls=[];
  const result=await fetchAutomaticMedia('<a href="one.pdf">Slides</a><a href="two.pdf">Slides</a>',source,{fetchBytes:async url=>{calls.push(url);return Buffer.from('pdf');},extractMedia:async()=>({text:'May 7, 2026',variants:[]})});
  assert.equal(calls[0],'https://example.edu/two.pdf');
  assert.equal(result.recognized,2);
  assert.equal(result.partial,false);
  assert.equal(calls.length,2);
  assert.equal(result.coverage.discovered,2);
  assert.equal(result.coverage.inspectionComplete,true);
  assert.deepEqual(result.coverage.internalIssues,[]);
});

/**
 * Build a small text-layer PDF with no filesystem or network dependencies.
 * @param {string[]} lines Visible cover text.
 * @return {Buffer} Valid one-page PDF bytes.
 */
function textPdf(lines) {
  const stream = lines.map((line,index)=>`BT /F1 16 Tf 50 ${740-index*24} Td (${line.replace(/[()\\]/g,'\\$&')}) Tj ET`).join('\n');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let output='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

test('PDF text layer uses visible cover dates and preserves month-only documents as unresolved', async () => {
  const raw=await extractMedia(textPdf(['Optimization Seminar at Carnegie Mellon University','May 7, 2026']),{cacheDir:false});
  assert.equal(raw.kind,'pdf');assert.equal(raw.variants.length,0);
  const result=parseMediaPoster(raw,{seriesTitle:'EWO Seminar'},plan);
  assert.equal(result.events[0].start,'2026-05-07');assert.equal(result.events[0].timePrecision,'date');
  const undated=await extractMedia(textPdf(['Optimization Seminar at Carnegie Mellon University','CMU, April 2026']),{cacheDir:false});
  assert.equal(parseMediaPoster(undated,{seriesTitle:'EWO Seminar'},plan).events.length,0);
});

const tesseractAvailable=spawnSync(process.env.CMU_TESSERACT_PATH||'tesseract',['--version'],{timeout:5000}).status===0;
test('actual OCR cache stores raw extraction by changed bytes, without approving event fields', {skip:!tesseractAvailable}, async () => {
  const directory=await mkdtemp(join(tmpdir(),'cmu-media-cache-test-'));
  try {
    const canvas=createCanvas(1100,400);const drawing=canvas.getContext('2d');drawing.fillStyle='white';drawing.fillRect(0,0,1100,400);drawing.fillStyle='black';drawing.font='42px sans-serif';drawing.fillText('Public Seminar',40,90);drawing.fillText('November 20, 2026',40,180);
    const first=canvas.toBuffer('image/png');const extracted=await extractMedia(first,{cacheDir:directory});
    assert.match(extracted.variants.map(variant=>variant.text).join(' '),/2026/);
    assert.equal((await readdir(directory)).length,1);
    const cached=await extractMedia(first,{cacheDir:directory});assert.equal(cached.sha256,extracted.sha256);
    drawing.fillText('4:00-5:30pm',40,270);const changed=await extractMedia(canvas.toBuffer('image/png'),{cacheDir:directory});
    assert.notEqual(changed.sha256,extracted.sha256);assert.equal((await readdir(directory)).length,2);
    assert.equal('events' in changed,false);assert.equal('start' in changed,false);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('unsupported media and malformed TSV do not masquerade as empty valid events', async () => {
  await assert.rejects(extractMedia(Buffer.from('html login response'),{cacheDir:false}),/signature/);
  assert.deepEqual(parseOcrTsv('garbage'),[]);
});
