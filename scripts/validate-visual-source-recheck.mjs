import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loadPlans } from '../src/config.mjs';

const folder = 'research/visual-recheck-2026-10-25';
const baseline = JSON.parse(await fs.readFile(`${folder}/baseline.json`, 'utf8'));
const policy = JSON.parse(await fs.readFile('config/source-scope.json', 'utf8'));
assert.equal(policy.mode, 'source-only');
assert.equal(policy.officialRepostsRetained, true);
const get = async path => {
  const response = await fetch(`http://127.0.0.1:4173${path}`);
  assert.equal(response.ok, true, path);
  return response.json();
};
const [status, sourceResult] = await Promise.all([get('/api/status'), get('/api/sources')]);
assert.equal(status.refreshing, false);
assert.equal(status.sources.total, 318);
assert.equal(status.sources.pending, 0);
const byID = new Map(sourceResult.sources.map(source => [source.id, source]));
const sources = baseline.sources.map(before => {
  const after = byID.get(before.id);
  assert.ok(after.evidence?.visualReview?.outcome, `Missing visual review: ${before.id}`);
  return { id: before.id, org: after.org, url: after.url, previousState: before.state,
    state: after.state, eventCount: after.eventCount, lastAttempt: after.lastAttempt,
    reason: after.reason, error: after.error, visualReview: after.evidence.visualReview };
});
assert.equal(new Set(sources.map(source => source.id)).size, 10);
assert.equal(byID.get('5ade174c3483').state, 'empty', 'Dated EWO history must not remain undated');
assert.equal(byID.get('1185bc345a9a').eventCount, 4);
assert.equal(byID.get('1185bc345a9a').state, 'error', 'Only two directory-linked series are connected');
assert.equal(byID.get('8f00fc7f2c7c').eventCount, 23);
assert.equal(byID.get('79e7cdffd54d').eventCount, 4);

const db = new DatabaseSync('var/events.sqlite', { readOnly: true });
const raw = db.prepare('SELECT source_id,data FROM occurrences').all()
  .map(row => ({ sourceID: row.source_id, event: JSON.parse(row.data) }));
db.close();
const expectedSeminars = {
  'cmu-crypto-qi-pang-2026-10-28': '2026-10-28T17:30:00.000Z',
  'cmu-crypto-chase-fickes-2026-11-05': '2026-11-05T21:30:00.000Z',
  'cmu-crypto-alper-cakan-2026-11-19': '2026-11-19T21:30:00.000Z',
  'cmu-econcs-brian-zhang-2026-09-29': '2026-09-29T18:00:00.000Z',
};
for (const [uid, start] of Object.entries(expectedSeminars)) {
  const matching = raw.filter(row => row.sourceID === '1185bc345a9a' && row.event.uid === uid);
  assert.equal(matching.length, 1, uid);
  assert.equal(matching[0].event.start, start, uid);
  assert.equal(matching[0].event.end, start, 'No seminar end time is invented');
}
const sydney = raw.filter(row => row.sourceID === '8f00fc7f2c7c' && row.event.uid === 'alumni:a7DUk000000OnpFMAS');
assert.equal(sydney.length, 1, 'Sydney must not retain a duplicate date-only occurrence');
assert.equal(sydney[0].event.start, '2026-10-27T21:00:00.000Z');
assert.equal(sydney[0].event.end, '2026-10-27T22:30:00.000Z');
assert.equal(sydney[0].event.timeZone, 'Australia/Sydney');
assert.match(sydney[0].event.location, /Planar Restaurant/);
assert.match(sydney[0].event.description, /Registration is shown as closed/);
assert.ok(raw.some(row => row.sourceID === '1b0f0b6e62fa' && /35467/.test(row.event.url)), 'Sonia remains covered by the separate EPP calendar');

const first = await get('/api/events?from=2000-01-01&limit=100&page=1');
const events = [...first.events];
for (let page = 2; page <= Math.ceil(first.total / 100); page += 6) {
  const pages = await Promise.all(Array.from({ length: Math.min(6, Math.ceil(first.total / 100) - page + 1) }, (_, offset) =>
    get(`/api/events?from=2000-01-01&limit=100&page=${page + offset}`)));
  events.push(...pages.flatMap(result => result.events));
}
const retained = new Set(loadPlans().map(plan => plan.id));
assert.equal(events.length, status.totalEvents);
assert.equal(new Set(events.map(event => event.id)).size, events.length);
assert.ok(events.every(event => event.sources.length && event.sources.every(source => retained.has(source.id))));
const reposts = JSON.parse(await fs.readFile('research/club-source-removal-2026-10-25/official-reposts-to-verify.json', 'utf8')).events;
const officialReposts = reposts.map(expected => ({ title: expected.title,
  rawMatches: raw.filter(row => expected.sourceIDs.includes(row.sourceID) && row.event.uid === expected.uid && row.event.start === expected.start).length,
  apiMatches: events.filter(event => event.start === expected.start && event.title === expected.title
    && event.sources.some(source => expected.sourceIDs.includes(source.id))).length }));
assert.equal(officialReposts.length, 12);
assert.ok(officialReposts.every(item => item.rawMatches && item.apiMatches));
const scope = JSON.parse(await fs.readFile(`${folder}/alumni-public-scope-recheck.json`, 'utf8'));
assert.equal(scope.observedCount, 23);
assert.deepEqual(scope.differences, []);
const testLog = await fs.readFile('.cache/visual-recheck-2026-10-25/tests.txt', 'utf8');
const tests = { passed: Number(testLog.match(/ℹ pass (\d+)/)?.[1]), failed: Number(testLog.match(/ℹ fail (\d+)/)?.[1]) };
assert.ok(tests.passed >= 179);
assert.equal(tests.failed, 0);
const evidenceManifest = [];
async function scan(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:png|jpe?g|pdf)$/i.test(entry.name)) {
      const bytes = await fs.readFile(path);
      evidenceManifest.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await scan(folder);
const summaries = {
  '1185bc345a9a': ['纠正：漏跟进目录链接', '补收 Crypto 三场未来讲座、Econ-CS 一场窗口内讲座；只覆盖目录中的两个系列，继续标为部分覆盖。'],
  '5ade174c3483': ['纠正：历史日期被漏读', 'Fred Gardi PDF 标题页明确写 2026-05-07；改为已识别历史日期、当前窗口内为零。'],
  '8f00fc7f2c7c': ['纠正：详情可读、时间可补全', '原始公开报名页给出 Sydney 2026-10-28 08:00–09:30 AEDT、Planar Restaurant；与纽约 10-27 17:00 为同一时刻。仍未接通新增卡片发现。'],
  '79e7cdffd54d': ['确认公开范围', '三页公开日历的 23 项与快照一致，其中四项明确线上；新增活动发现仍不完整。'],
  '31aa89be167d': ['确认发布方冲突', '2026 标题与 2025 正文年份矛盾真实存在；Japan 注册链接指向 2025 旧会，PDF 附件显示 401，未找到消除歧义的公开依据。'],
  '4c4f223b8c8b': ['细化：匿名访问受限', 'Manipulation 匿名嵌入返回 401、公开 ICS 返回 404；登录上下文的空网格不能证明公开无活动。LCS 公开可读但下一场 TBD，另增加官网变更监测。'],
  'd89f616f8462': ['确认缺当前日期', '折叠区域展开后仍无当前场次日期；新找到的合办日历只有 2017–2022 历史，且范围更广，不整体并入。'],
  'b453fc62eac4': ['确认特定档案范围', 'Faculty 页是无逐场日期的录像档案；11-09 Sonia 讲座已由独立 EPP 事件日历收录，不能把整个 EPP 称为空。'],
  '1aa9b956ba78': ['确认可预约资源', '三条详情均写 group booking，只给时长、人数和预约兴趣表，未公布具体排期。'],
  '97bebc670839': ['确认所检月份未列场次', '入口及九月、十月、十一月页均只有月份导航；只说明这些视图，不代表 SV 校园没有活动。'],
};
for (const source of sources) [source.judgment, source.finding] = summaries[source.id];
const result = { checkedAt: new Date().toISOString(), method: 'CUA screenshots and visible DOM, public documents and explicitly anonymous endpoint controls',
  sourcesReviewed: 10, corrections: ['1185bc345a9a', '5ade174c3483', '8f00fc7f2c7c'], sources,
  current: status, tests, projectCheck: 'npm run check', allAPIEventsInspected: events.length,
  newSeminars: expectedSeminars, sydney: sydney[0].event, officialReposts, evidenceManifest,
  accessBoundaries: 'No account changes, login, subscription, form submission or private event/guest-list collection.' };
await fs.writeFile(`${folder}/validation.json`, `${JSON.stringify(result, null, 2)}\n`);
const table = sources.map(source => `| [${source.org}](${source.url}) | ${source.judgment} | ${source.finding} |`).join('\n');
await fs.writeFile(`${folder}/README.md`, `# 剩余受限来源的 Computer Use 复查\n\n${result.checkedAt}。实际复查 10 个来源：原 4 个部分接入来源及 6 个未公布日期的资源页。通过浏览器截图、展开内容、切换视图、公共文档和匿名接口对照，发现并修正三处实质遗漏。\n\n## 逐项结论\n\n| 来源 | 结论 | 证据与处理 |\n| --- | --- | --- |\n${table}\n\n## 当前接入边界\n\nSCS 已补入四条有效记录，其中三条在未来；整个 26 系列目录尚未全部映射，仍标部分覆盖。校友两项仍限于核验的 23 项/其中线上 4 项；Sydney 时间补全不意味着新增活动发现已经完成。REAL 与 DSSC 仍保留访问和日期限制。\n\n图片与 PDF 继续使用审核字段加字节哈希；新增 PDF href 复用同一机制，没有引入后台 OCR。Sydney 原始详情字段只在匿名时间接口与审核起点一致时复用；单场活动 UID 的更新不会保留旧的日期版本或影响循环活动。\n\n## 验证\n\n${tests.passed} 项测试通过，npm run check 通过；实际刷新复查来源，并全量核对 ${events.length} 条 API 活动。Sydney 仅保留一条记录，原始时区和结束时间准确；12 个官方转载社团活动身份继续在存储和 API 中保留，318 来源目录及纯来源排除政策保持一致。\n\n[验证与图片哈希清单](validation.json) · [四项资源与 SCS 链接](undated-four.json) · [REAL、IDeaS、EPP](real-ideas-epp.json) · [DSSC](dssc.json) · [校友与 Sydney](alumni.json) · [代码复核](code-review.json)\n`);
console.log(JSON.stringify({ reviewed: sources.length, corrections: result.corrections.length, events: events.length,
  newSeminars: Object.keys(expectedSeminars).length, sydneyOccurrences: sydney.length, officialReposts: officialReposts.length, tests,
  evidenceImages: evidenceManifest.length }));
