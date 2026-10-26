import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { extractMedia } from '../src/lib/media-ocr.mjs';
import { fetchAutomaticMedia, mediaPeriod, parseMediaPoster, parseMediaDocument } from '../src/adapters/automatic-media.mjs';
import { fetchHtml } from '../src/adapters/html.mjs';

const plan={id:'coverage-test',url:'https://example.edu/events',adapter:'html',options:{timezone:'America/New_York'}};
const window={windowStart:'2026-09-26T00:00:00Z',windowEnd:'2027-10-26T00:00:00Z'};

test('all current semantic candidates are read regardless of previous small asset caps',async()=>{
  const html='<h1>Fall 2026 Seminars</h1><p>'+Array.from({length:25},(_,i)=>`<img src="${i}.png">`).join('')+'</p>';
  let reads=0;
  const result=await fetchAutomaticMedia(html,{...plan,options:{automaticMedia:[{selector:'p img',maxAssets:1,seriesTitle:'Seminar'}]}},
    {...window,fetchBytes:async()=>{reads++;return Buffer.from('image');},extractMedia:async()=>({text:'November 20, 2026\n4:00-5:30pm',variants:[]})});
  assert.equal(reads,25);assert.equal(result.coverage.discovered,25);assert.equal(result.coverage.processed,25);
  assert.equal(result.coverage.inspectionComplete,true);assert.deepEqual(result.coverage.internalIssues,[]);
});

test('fresh explicit semester headings exclude historical images without OCR or filename inference',async()=>{
  assert.deepEqual(mediaPeriod('2022 SPRING SPEAKER SERIES'),{start:'2022-01-01',end:'2022-07-01'});
  assert.deepEqual(mediaPeriod('Fall 2025 and Spring 2026'),{start:'2025-07-01',end:'2026-07-01'});
  const result=await fetchAutomaticMedia('<section><h1>Spring 2026 Schedule</h1><img src="future-2027.png"></section>',
    {...plan,options:{automaticMedia:[{selector:'img',contextSelector:'section'}]}},{...window,fetchBytes:async()=>{throw new Error('Printed historical semester should prune before download');}});
  assert.equal(result.partial,false);assert.equal(result.coverage.excludedHistorical,1);assert.equal(result.coverage.inspectionComplete,true);
  assert.match(result.coverage.assets[0].evidence,/Spring 2026/);
});

test('non-event illustrations do not hide their current dated HTML announcements',async()=>{
  const html='<main><p><strong>November 7, 2026<br>Location: Baker Hall A53<br>Schedule of events:<br>4:30 PM - 5:00 PM Reception<br>5:00 - 6:30 PM Speaker Presentation</strong></p><p><img class="floatleft" width="250" height="250" alt="Speaker portrait" src="photo.jpg">'+('A professor describes the research. '.repeat(8))+'</p></main>';
  const result=await fetchAutomaticMedia(html,{...plan,options:{automaticMedia:[{selector:'img',announcementSelector:'main p',seriesTitle:'Speaker series'}]}},{...window,fetchBytes:async()=>{throw new Error('Portrait should be classified through source semantics');}});
  assert.equal(result.coverage.excludedNonEvent,1);assert.equal(result.partial,false);assert.equal(result.events.length,1);
  assert.equal(result.events[0].start,'2026-11-07T21:30:00.000Z');assert.equal(result.events[0].end,'2026-11-07T23:30:00.000Z');
});

test('a related official listing supplies a year only for a unique matching title, day and organizer',async()=>{
  const rule={selector:'img',seriesTitle:'Public series',dateIndexes:[{url:'https://official.edu/list',selector:'article',titleSelector:'h2',dateSelector:'time',associationPattern:'organized by the Publisher'}]};
  const index='<article><a href="/detail"><h2>Film Screening: The Cost of Inheritance</h2><time>Friday, October 18, 2024</time></a></article>';
  const context={fetchBytes:async()=>Buffer.from('current poster'),fetchText:async url=>url.endsWith('/detail')?'This screening is organized by the Publisher.':index,
    extractMedia:async()=>({text:'FILM SCREENING\nTHE COST OF INHERITANCE\nFriday, October 18\n6:00 PM - 7:30 PM',variants:[]})};
  const result=await fetchAutomaticMedia('<img src="poster.png">',{...plan,options:{automaticMedia:[rule]}},context);
  assert.equal(result.events[0].start,'2024-10-18T22:00:00.000Z');assert.equal(result.coverage.assets[0].dateEvidence.associationVerified,true);
  const conflict=await fetchAutomaticMedia('<h1>Fall 2026 Seminars</h1><img src="poster.png">',{...plan,options:{automaticMedia:[rule]}},context);
  assert.equal(conflict.events.length,0);assert.equal(conflict.partial,true);assert.ok(!conflict.coverage.assets[0].dateEvidence);
});

/**
 * Create a minimal multi-page PDF to test page discovery without a network.
 * @param {string[][]} pages Visible text lines for each page.
 * @return {Buffer} Valid PDF with an explicit page tree.
 */
function pdfPages(pages){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(let i=0;i<pages.length;i++){
    const stream=pages[i].map((line,j)=>`BT /F1 16 Tf 50 ${740-j*25} Td (${line.replace(/[()\\]/g,'\\$&')}) Tj ET`).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let text='%PDF-1.4\n';const offsets=[];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

test('PDF agenda dates on later pages are extracted rather than fixed to page one',async()=>{
  const raw=await extractMedia(pdfPages([['Public Workshop','General introduction and research context without an occurrence date.'],['Agenda','Friday, November 20, 2026','4:00pm - 5:30pm','Baker Hall A53']]),{cacheDir:false});
  assert.equal(raw.pages.length,2);assert.equal(raw.totalPages,2);assert.equal(raw.complete,true);
  const result=parseMediaDocument(raw,{seriesTitle:'Public Workshop'},plan,window);
  assert.equal(result.events[0].start,'2026-11-20T21:00:00.000Z');assert.equal(result.partial,false);
});

const hasTesseract=spawnSync(process.env.CMU_TESSERACT_PATH||'tesseract',['--version'],{timeout:5000}).status===0;
test('PDF OCR budgets persist page progress and a later run completes every pending page',{skip:!hasTesseract},async()=>{
  const folder=await mkdtemp(join(tmpdir(),'cmu-pdf-progress-'));
  try{
    const bytes=pdfPages([[],[]]);
    const first=await extractMedia(bytes,{cacheDir:folder,ocrBudgetMs:0});
    assert.equal(first.complete,false);assert.deepEqual(first.pendingPages,[1,2]);
    const next=await extractMedia(bytes,{cacheDir:folder,ocrBudgetMs:60000});
    assert.equal(next.complete,true);assert.deepEqual(next.pendingPages,[]);assert.equal(next.pages.filter(page=>page.ocrDone).length,2);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('quiet-border OCR preserves edge-aligned white date text without a fixed event annotation',{skip:!hasTesseract},async()=>{
  const canvas=createCanvas(1100,500),drawing=canvas.getContext('2d');drawing.fillStyle='white';drawing.fillRect(0,0,1100,500);drawing.fillStyle='#c41230';drawing.fillRect(0,0,1100,100);drawing.fillStyle='white';drawing.font='bold 48px sans-serif';drawing.fillText('MARCH 18, 2026',25,65);drawing.fillStyle='black';drawing.fillText('Public Workshop',30,220);drawing.fillText('12:30-2:00 PM',30,340);
  const raw=await extractMedia(canvas.toBuffer('image/png'),{cacheDir:false});
  const result=parseMediaPoster(raw,{seriesTitle:'Workshop'},plan);
  assert.equal(result.events[0].start,'2026-03-18T16:30:00.000Z');assert.equal(result.events[0].end,'2026-03-18T18:00:00.000Z');
});

test('complete HTML traversal reads every undated candidate and prunes only explicit historical periods',async()=>{
  const cards=Array.from({length:21},(_,i)=>`<article><a href="/${i}"><h2>Seminar ${i}</h2></a><span>${i===0?'Spring 2026 Schedule':'Details inside'}</span></article>`).join('');
  const urls=[];
  const result=await fetchHtml({...plan,options:{eventSelector:'article',titleSelector:'h2',dateSelector:'span',linkSelector:'a',detailLinks:true,maxDetails:1,completeDetailTraversal:true,detailOptions:{eventSelector:'main',titleSelector:'h1',dateSelector:'time'}}},
    {...window,fetchText:async url=>{if(url===plan.url)return cards;urls.push(url);return '<main><h1>Seminar</h1><time>November 20, 2026</time></main>';}});
  assert.equal(urls.length,21);
  assert.ok(urls.includes('https://example.edu/0'),'Historical series context is inspected for child date evidence');assert.equal(result.coverage.discovered,21);assert.equal(result.coverage.excludedHistorical,1);
  assert.equal(result.coverage.processed,20);assert.equal(result.coverage.inspectionComplete,true);assert.deepEqual(result.coverage.internalIssues,[]);
});

test('a seminar footer and a paper reference date on a later PDF page never create an occurrence',()=>{
  const result=parseMediaDocument({kind:'pdf',complete:true,pages:[{number:1,text:'Research methods and applications\nNo occurrence date on this cover.',variants:[]},{number:2,text:'Related research\nPublished November 20, 2026\nAn optimization paper reference\nEWO Seminar',variants:[]}]},{seriesTitle:'EWO Seminar'},plan,window);
  assert.equal(result.events.length,0);assert.equal(result.recognized,0);
});

test('linked series terms outrank mismatched publication metadata only after detail month/day verification',async()=>{
  const main='<nav><a class="archive" href="/archive">Previous Events</a></nav><article><a href="/series"><h2>Spring 2019 Events</h2></a><span>Spring 2019 Events</span></article><article><a href="/talk"><h2>Public Talk</h2></a><span>Thursday, February 28</span></article>';
  const documents={
    '/series':'<main class="content"><h1>Spring 2019 Events</h1><h2>Public Talk</h2><p><strong>Thursday, February 28th at 4:30pm</strong></p><p><a class="cta" href="/talk">Read more</a></p></main>',
    '/archive':'<div class="filterable"><a href="/talk"><small>Thursday, November 8, 2018</small><h2>Public Talk</h2></a></div>',
    '/talk':'<main class="content"><h1>Public Talk</h1><p>Thursday, February 28<br>4:30pm</p></main>',
  };
  const result=await fetchHtml({...plan,options:{eventSelector:'article',titleSelector:'h2',dateSelector:'span',linkSelector:'a',detailLinks:true,completeDetailTraversal:true,detailDateIndexSelector:'a.archive',detailOptions:{eventSelector:'.content',titleSelector:'h1',dateSelector:':scope'}}},
    {...window,fetchText:async url=>url===plan.url?main:documents[new URL(url).pathname]});
  assert.equal(result.events.length,0);assert.equal(result.partial,undefined);assert.equal(result.coverage.inspectionComplete,true);assert.deepEqual(result.coverage.externalIssues,[]);
  const asset=result.coverage.assets.find(item=>item.url.endsWith('/talk'));
  assert.equal(asset.dateEvidence.start,'2019-02-28');assert.match(asset.dateEvidence.sourceUrl,/series$/);
});

test('an empty OCR result alone cannot classify an advertised poster as a non-event illustration',async()=>{
  const result=await fetchAutomaticMedia('<main class="content"><h1>Annual Research Event</h1><p><img alt="Annual Research Event" src="poster.png"></p></main>',{...plan,options:{automaticMedia:[{selector:'img',classifyIllustrations:true}]}},{fetchBytes:async()=>Buffer.from('image'),extractMedia:async()=>({variants:[{text:'',words:[]},{text:'',words:[]},{text:'',words:[]}]})});
  assert.equal(result.coverage.excludedNonEvent,0);assert.equal(result.coverage.inspectionComplete,false);assert.ok(result.coverage.internalIssues.length>0);
});
