import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadPlans } from '../src/config.mjs';
import { openStore } from '../src/lib/store.mjs';

const folder = 'research/remaining-19-2026-10-25';
const baseline = JSON.parse(await fs.readFile(`${folder}/baseline.json`, 'utf8'));
const policy = JSON.parse(await fs.readFile('config/source-scope.json', 'utf8'));
assert.equal(policy.mode, 'source-only');
assert.equal(policy.officialRepostsRetained, true);
const plans = loadPlans();
const retained = new Set(plans.map(plan => plan.id));
const get = async pathname => {
  const response = await fetch(`http://127.0.0.1:4173${pathname}`);
  assert.equal(response.ok, true, pathname);
  return response.json();
};
const status = await get('/api/status');
const sources = (await get('/api/sources')).sources;
const byID = new Map(sources.map(source => [source.id, source]));
const reviewed = baseline.sources.map(previous => {
  const source = byID.get(previous.id);
  assert.ok(source, previous.id);
  assert.ok(source.evidence?.solutionReview?.reason, `Missing solution evidence for ${previous.org}`);
  assert.ok(source.evidence.solutionReview.nextStep, `Missing next step for ${previous.org}`);
  assert.ok(source.lastAttempt || source.state === 'covered', `Source was not refreshed: ${source.org}`);
  return { id: source.id, org: source.org, url: source.url, previousState: previous.state,
    state: source.state, eventCount: source.eventCount, lastAttempt: source.lastAttempt,
    reason: source.reason, error: source.error, warnings: source.warnings,
    solutionReview: source.evidence.solutionReview };
});
assert.equal(reviewed.length, 19);
assert.equal(new Set(reviewed.map(row => row.id)).size, 19);
assert.ok(reviewed.filter(row => row.previousState === 'error').every(row => ['ok', 'empty'].includes(row.state)), 'Original four partial parsers still need work');
assert.ok(reviewed.every(row => !['pending', 'unsupported'].includes(row.state)), 'Every source needs an implemented extraction or explicit monitored-resource path');
assert.equal(sources.length, 318);
assert.equal(status.sources.pending, 0);
assert.equal(status.refreshing, false);

const first = await get('/api/events?from=2000-01-01&limit=100&page=1');
const events = [...first.events];
for (let page = 2; page <= Math.ceil(first.total / 100); page += 6) {
  const pages = await Promise.all(Array.from({ length: Math.min(6, Math.ceil(first.total / 100) - page + 1) }, (_, offset) =>
    get(`/api/events?from=2000-01-01&limit=100&page=${page + offset}`)));
  events.push(...pages.flatMap(result => result.events));
}
assert.equal(events.length, status.totalEvents);
assert.equal(new Set(events.map(event => event.id)).size, events.length);
assert.ok(events.every(event => event.sources.length && event.sources.every(source => retained.has(source.id))));
const store = openStore('var/events.sqlite');
const raw = store.db.prepare('SELECT source_id,data FROM occurrences').all().map(row => ({ sourceID: row.source_id, event: JSON.parse(row.data) }));
store.close();
const reposts = JSON.parse(await fs.readFile('research/club-source-removal-2026-10-25/official-reposts-to-verify.json', 'utf8')).events;
const officialReposts = reposts.map(expected => ({ title: expected.title, uid: expected.uid,
  rawMatches: raw.filter(row => expected.sourceIDs.includes(row.sourceID) && row.event.uid === expected.uid && row.event.start === expected.start).length,
  apiMatches: events.filter(event => event.start === expected.start && event.title === expected.title
    && event.sources.some(source => expected.sourceIDs.includes(source.id))).length }));
assert.equal(officialReposts.length, 12);
assert.ok(officialReposts.every(item => item.rawMatches && item.apiMatches));
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
const testLog = await fs.readFile('.cache/remaining-19-2026-10-25/tests.txt', 'utf8');
const tests = { passed: Number(testLog.match(/ℹ pass (\d+)/)?.[1]), failed: Number(testLog.match(/ℹ fail (\d+)/)?.[1]) };
assert.ok(tests.passed >= 158);
assert.equal(tests.failed, 0);
const tally = rows => Object.fromEntries([...new Set(rows.map(row => row.state))].sort().map(state => [state, rows.filter(row => row.state === state).length]));
const summaries = {
  '1468ddb723b2': '解析有明确日期的正文；对已核实的历史档案和海报做变更监测，解除无效详情遍历上限。',
  'a8c3a641e8c5': '复用公开 Google 文档议程的 Date 行；录像资源单独监测，日期不取自酒店预订或当前年份。',
  'e3acb99b6056': '识别相邻两日的完整日期；已定日期的父记录与无日期系列详情分开处理。',
  '4f854e94f2a9': '跟随发布方当前给出的分页链接，移除已失效的固定第二页配置。',
  '1185bc345a9a': '监测网页和官方系列目录 JSON；只排除已确认易变的响应时间戳，不把每周几当成实际场次。',
  '1aa9b956ba78': '监测课程目录及三个可预约工作坊详情；当前只有团体预约说明，没有公开场次日期。',
  '31aa89be167d': '复用一致的历史日期，并持续检查四个详情页；两页的 2025/2026 年份冲突始终保留为待核实。',
  '34fa7359276d': '复用现有 reviewedImages：视觉核对三张海报，按图片 SHA-256 绑定日期、时间和地点。',
  '4c4f223b8c8b': '复用 Learning and Control 公开 ICS；Manipulation 的公开 ICS 返回 404，保留部分覆盖提示并重试。',
  '528193392a78': '复用图片审核机制恢复 Fall 2026 日程，分别保留讲座和实际列出的 Social，正确处理夏令时。',
  '54c24d7416bb': '读取 2024/2023 横幅中的完整日期；均在窗口外，网页与海报变化会触发复查。',
  '5a47a3eb65bf': '复用已有 LiveWhale 解析器，使用 AI-SDM + Seminars 标签接口，避免混入其他类型活动。',
  '5ade174c3483': '按未公布场次的讲义/录像资源监测；文件名、上传时间和演示文稿中的旧日期不当成当前排期。',
  '79e7cdffd54d': '仅接入三页视觉确认范围内明确标为线上的活动；校对官方时间显示接口，新增公告发现仍待接通。',
  '8f00fc7f2c7c': '仅接入三页视觉确认的公开活动；不使用无筛选接口的较大结果集，公开视图自动发现仍待接通。',
  '97bebc670839': '视觉检查当前月及官方链接的下月页面，按尚未公布具体日程的页面监测。',
  'b453fc62eac4': '监测月度系列介绍和往期录像；不从月度频率生成会议，也不把视频发布日期当活动日期。',
  'd861fd81e26d': '复用海报审核机制读取 2026-02-27 的明确时间；当前在窗口外，新增内容会触发复查。',
  'd89f616f8462': '监测系列介绍及演讲者变更；没有起止边界和个别场次日期时，不自动扩展每月首个周四。',
};
for (const row of reviewed) {
  assert.ok(summaries[row.id]);
  row.solutionSummary = summaries[row.id];
}
const result = { checkedAt: new Date().toISOString(), baseline: baseline.status, current: status,
  scope: { reviewed: 19, originalPartial: 4, originalUnsupported: 15, retainedPublishers: 318, sourceOnlyPolicy: true },
  outcomes: tally(reviewed), sources: reviewed, tests, projectCheck: 'npm run check',
  allAPIEventsInspected: events.length, officialReposts, evidenceManifest };
await fs.writeFile(`${folder}/validation.json`, `${JSON.stringify(result, null, 2)}\n`);
const labels = { ok: '已提取', empty: '已识别历史日期，窗口内为零', undated: '无具体场次日期，监测中', error: '部分接入，缺口仍显式提示', covered: '复用同范围日历' };
const rows = reviewed.map(row => `| [${row.org}](${row.url}) | ${row.previousState === 'error' ? '部分提取' : '尚未适配'} | ${labels[row.state] || row.state}${row.eventCount ? `（${row.eventCount} 条）` : ''} | ${row.solutionSummary} |`).join('\n');
const fullRefresh = JSON.parse(await fs.readFile(`${folder}/full-refresh.json`, 'utf8'));
await fs.writeFile(`${folder}/README.md`, `# 剩余 19 个来源的方案与验证\n\n核验时间：${result.checkedAt}。本轮对象是原来的 4 项部分提取和 15 项尚未适配来源，均已配置可执行的解析或监测路径。\n\n原 4 项部分提取已全部解除。19 项当前结果：${Object.entries(result.outcomes).map(([state, count]) => `${labels[state] || state} ${count} 项`).join('；')}。部分接入的项目不算完整解决，也不称为空。\n\n## 逐项结果\n\n| 来源 | 原状态 | 当前结果 | 可复用方案与具体边界 |\n| --- | --- | --- | --- |\n${rows}\n\n## 复用与更新行为\n\n- 公开日历、LiveWhale、HTML 日期及图片审核均复用现有解析能力；新增的是有范围限制的网页翻页、公开文档日期读取、资源指纹监测和匿名校友时间查询。\n- 图片字段仅在已审核字节的 SHA-256 匹配时使用。资源监测覆盖所选正文、链接、媒体地址和结构化元数据；目录 JSON 仅排除经核实的易变传输字段。变化会要求复查，并保留此前成功的记录。\n- undated 表示未公布具体场次日期，与窗口内零条的日历分开显示。它不代表该组织没有活动。\n- 校友两项采用已视觉确认的公开范围，明确保留新增活动自动发现的集成缺口。不会导入更宽的未筛选接口结果，时区冲突保留日期精度。\n- REAL 需要发布方修复或开放 Manipulation 日历；DSSC 需要发布方消除页面内的年份冲突。两项会继续被检查，错误不会被包装成空结果。\n\n## 验证\n\n本轮完整刷新 ${fullRefresh.completed}/${fullRefresh.total} 个当时可刷新的来源，随后校验新增的校友接入。最终 API 共 ${status.totalEvents} 条去重后的 occurrences；全量检查 ${events.length} 条的来源归属。${tests.passed} 项测试通过，npm run check 通过。\n\n来源目录保持 318 项，只排除学生社团自己发布的来源。12 个已记录的官方转载社团活动身份在存储和 API 中均保留。\n\n[完整验证结果](validation.json) · [原始 19 项基线](baseline.json) · [4 项 HTML 家族及 IDeaS 系列](partial-family.json) · [学术海报及档案](academic.json) · [目录与精确日历接口](alumni-other-sources.json) · [补充方案及冲突监测](root-investigation.json) · [独立代码审查](code-review.json)\n`);
console.log(JSON.stringify({ sourcesReviewed: reviewed.length, outcomes: result.outcomes, allAPIEventsInspected: events.length,
  officialRepostsPreserved: officialReposts.length, tests, evidenceAssets: evidenceManifest.length }));
