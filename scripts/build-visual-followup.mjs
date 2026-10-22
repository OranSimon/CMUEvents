import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadPlans, readConfig } from '../src/config.mjs';
import { openStore } from '../src/lib/store.mjs';

const folder = 'research/empty-source-followup-2026-10-21';
const queue = JSON.parse(await readFile(`${folder}/queue.json`, 'utf8'));
const journalNames = (await readdir(folder)).filter(name => /-results\.jsonl$/.test(name)).sort();
const reviews = new Map();
for (const name of journalNames) for (const line of (await readFile(`${folder}/${name}`, 'utf8')).split('\n').filter(Boolean)) {
  const record = JSON.parse(line);
  const old = reviews.get(record.sourceID);
  if (!old || Date.parse(record.checkedAt) >= Date.parse(old.checkedAt)) reviews.set(record.sourceID, { ...record, journal: name });
}
const queueIDs = new Set(queue.queue.map(row => row.sourceID));
if (queueIDs.size !== 436 || queue.queue.length !== 436) throw Error('Expected the exact remaining 436-source scope');
const extraIDs = [...reviews.keys()].filter(id => !queueIDs.has(id));
if (extraIDs.length) throw Error(`Unexpected review IDs: ${extraIDs}`);
const missing = queue.queue.filter(row => !reviews.has(row.sourceID)).map(row => row.sourceID);
const plans = loadPlans();
const byID = new Map(plans.map(plan => [plan.id, plan]));
const previous = JSON.parse(execFileSync('git', ['show', 'b4abb09:config/source-plans.json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })).plans;
const previousByID = new Map(previous.map(plan => [plan.id, plan]));
const fixes = plans.filter(plan => {
  const old = previousByID.get(plan.id);
  return JSON.stringify([old.adapter, old.fetchUrl, old.options]) !== JSON.stringify([plan.adapter, plan.fetchUrl, plan.options]);
});
const fixedIDs = new Set(fixes.map(plan => plan.id));
const relatedFixes = { '0ac44bbaa92b': '2b24be5ef52c', '2208e5d8f7ba': '68c9b0b21fb8', 'bbeaf92e5f54': 'a3d9dd542e5c' };
const store = openStore(readConfig().databasePath);
const states = new Map(store.listSources().map(source => [source.id, source]));
const evidence = new Map();
const limitedPattern = /missing|incomplete|conflict|requires?_review|needs_.*review|unmapped|unverified|unconfirmed|unresolved|restricted|login|unavailable|fail(?:ed|ure)|error|unreachable|domain|blocked|private|weekend|uncertain|unspecified|no_exact|date_tbd|date_tba/;
const records = [];
const evidencePath = value => value?.startsWith('evidence/') ? `${folder}/${value}` : value;
for (const row of queue.queue) {
  const review = reviews.get(row.sourceID);
  row.state = review ? 'reviewed' : 'pending';
  if (!review) continue;
  if (review.sourceURL !== row.sourceURL || !review.note || !Array.isArray(review.inspectedURLs) || !review.inspectedURLs.length) throw Error(`Incomplete source identity/evidence: ${row.sourceID}`);
  review.screenshot = evidencePath(review.screenshot);
  if (review.details?.additionalScreenshots) review.details.additionalScreenshots = review.details.additionalScreenshots.map(evidencePath);
  const screenshots = new Set([review.screenshot, ...(review.details?.additionalScreenshots || [])].filter(Boolean));
  for (const screenshot of screenshots) {
    const info = await stat(screenshot);
    if (!info.isFile() || info.size < 1000) throw Error(`Missing screenshot evidence: ${screenshot}`);
    if (!evidence.has(screenshot)) evidence.set(screenshot, { path: screenshot, bytes: info.size,
      sha256: createHash('sha256').update(await readFile(screenshot)).digest('hex') });
  }
  if (!screenshots.size) throw Error(`No primary screenshot: ${row.sourceID}`);
  const fixID = fixedIDs.has(row.sourceID) ? row.sourceID : relatedFixes[row.sourceID];
  const fixed = fixID && fixedIDs.has(fixID);
  const current = states.get(fixID || row.sourceID);
  let resolution = fixed ? fixID === row.sourceID ? 'implemented_and_refreshed' : 'implemented_on_correct_canonical_source' : 'no_importable_omission_confirmed';
  if (!fixed && (review.requiresFix || limitedPattern.test(review.outcome))) resolution = 'verification_or_date_precision_needed';
  if (['19fc6a91c57a', '068d6a981513'].includes(row.sourceID)) resolution = 'already_indexed_by_other_sources';
  const requiresReview = resolution === 'verification_or_date_precision_needed' || Boolean(fixed && current?.state !== 'ok');
  records.push({ ...row, ...review, organization: row.organization, department: row.department,
    resolution, requiresReview, ...(fixed ? { fixSourceID: fixID } : {}),
    runtime: current ? { sourceID: current.id, state: current.state, eventCount: current.eventCount, lastAttempt: current.lastAttempt,
      warnings: current.warnings, error: current.error } : null });
}
const counts = field => Object.fromEntries([...new Set(records.map(row => row[field]))].sort()
  .map(value => [value, records.filter(row => row[field] === value).length]));
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), baseline: queue.baselineReport, baselineCommit: 'b4abb09',
  scope: { requested: 436, reviewed: records.length, remaining: missing.length, missing,
    earlierSample: 15, cumulativeBaselineReviewed: 15 + records.length,
    claim: 'Every counted source has computer-use evidence. Access-limited, incomplete-date and different-scope pages remain explicitly qualified. This is not visual verification of all 1029 sources, nor proof that an organization has no activities.' },
  summary: { outcomes: counts('outcome'), resolutions: counts('resolution'), requiresReview: records.filter(row => row.requiresReview).length },
  runtime: { ...store.status(), snapshotNote: 'Local persistent store after targeted source refreshes; the full source catalog was not freshly re-fetched as one batch.' },
  fixes: fixes.map(plan => { const state = states.get(plan.id); return { sourceID: plan.id, organization: plan.org, sourceURL: plan.url,
    fetchURL: plan.fetchUrl, additionalEndpoints: plan.options.additionalEndpoints || [],
    ...(plan.options.reviewedImages ? { reviewedImages: plan.options.reviewedImages } : {}),
    runtime: state ? { state: state.state, eventCount: state.eventCount, lastAttempt: state.lastAttempt, warnings: state.warnings, error: state.error } : null }; }),
  reviews: records, evidenceManifest: [...evidence.values()] };
await writeFile(`${folder}/review.json`, `${JSON.stringify(result, null, 2)}\n`);
await writeFile(`${folder}/queue.json`, `${JSON.stringify(queue, null, 2)}\n`);
await writeFile(`${folder}/review-candidates.json`, `${JSON.stringify({ generatedAt: result.generatedAt,
  note: 'These require identity, audience, access, year, date, time, or organizer confirmation; they are not asserted to be empty organizations.',
  reviews: records.filter(row => row.requiresReview) }, null, 2)}\n`);
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const relativeShot = path => path.replace(`${folder}/`, '');
const rows = records.map(row => `| ${escape(row.organization)} | \`${row.sourceID}\` | ${escape(row.outcome)} | ${escape(row.note)} | ${escape(row.resolution)} | [截图](${relativeShot(row.screenshot)}) |`).join('\n');
const fixRows = result.fixes.map(row => `| ${escape(row.organization)} | \`${row.sourceID}\` | ${row.runtime?.state || 'pending'} | ${row.runtime?.eventCount ?? '?'} | ${escape(row.runtime?.error || row.runtime?.warnings?.join(' ') || '')} |`).join('\n');
const readme = `# 余下 436 个空结果来源的视觉复查\n\n截至 ${result.generatedAt}，已完成 **${records.length}/436** 个来源的计算机视觉复查；剩余 **${missing.length}** 个。加上[第一轮 15 个样本](../visual-empty-review-2026-10-21.md)，原 451 个 empty 来源累计已复查 **${15 + records.length}** 个。复查跨越美东 10 月 21–22 日，目录名保留开始日期。\n\n这里的“完成复查”包括明确记录登录限制、证书问题、身份未核实及日期不全；它不等于所有页面内容都已验证，也不代表全部 1,029 个来源都经过视觉检查。零条导入只描述某个来源在 30 天回看、365 天前看的采集窗口结果，不证明组织没有活动。\n\n## 修复与运行验证\n\n本次修改 **${result.fixes.length}** 个实际采集契约。当前持久化库有 **${result.runtime.totalEvents}** 条去重活动。下表为各修复来源的实际刷新结果；来源计数存在重叠，不能相加为新增活动数。\n\n| 来源 | ID | 刷新状态 | 窗口记录 | 诊断 |\n| --- | --- | --- | ---: | --- |\n${fixRows}\n\n- 入口与子页：接入 CMSAC 会议、Math Workshop、ScottyCon、Tepper Alumni Reunion、ACF、Joyful Noise、DSC、Buggy；Math Workshop 归数学系完整日历，CBD 日历归院系，避免误归 Core Model 或 CBS。\n- 替代日历：按组织官网实际公布的 Google／Tockify 日历读取有界 ICS，并保留原始 TartanConnect 来源。归档日历及外来邀请未自动视为当前组织活动。\n- 海报：AUO、Ice Hockey、180DC 通过人工视觉确认字段与 SHA-256 绑定；图片变化或缺失即待审核，保留旧有效记录。未接入通用生产 OCR，不能自动接受未来新海报。\n- Chabad：读取新站自身使用的匿名公开月历 API，只保留 RSVP 活动字段；未知结束时间保持未知，未注册日期条目链接回公开日历，不构造报名链接。\n- Juggling：采集一条经人工核对的公开邮件线程；后续回复已把地点改成室外，故不沿用原 NSH 室内地点。只接受单次日期，不扩展全年周会；未知新邮件仍需审核。\n- 两个适配器边界已修复：主端点解析失败时额外日历成功仍保留 partial，避免删除主端点旧记录；月历请求按来源本地日期构造窗口边界。\n\n## 保留的限制\n\n共有 **${result.summary.requiresReview}** 个来源保留额外核实标记，完整内容在 [review-candidates.json](review-candidates.json)。包括：匿名访问受限、缺年份、仅周末／比赛周粒度、时间地点冲突、无学期边界的周期说明及失效组织身份。它们仍可能有活动，不能改写成“确认 empty”。ARCC 的 Google Form 在已登录浏览器能看到活动说明，但匿名请求返回 401，因此没有把它当匿名公开抓取成功。\n\nSpring Carnival 日期，以及 CSDI 精选的 Homecoming／AES Maqam 活动已在其他来源入库，避免重复添加或误称该部门主办。Tepper 用户示例由第一轮处理，保留两个准确会议日期；无年份及无准确日期的子页继续显示部分提取。\n\n本轮没有注册邮箱、订阅邮件列表、读取私人收件箱或提交活动报名。专用订阅地址的可行性与私有收件管线见[后续方案](../../docs/source-ingestion-next-steps.md)；公开邮件归档优先直接读取。\n\n## 验证\n\n离线测试、来源配置检查、定向刷新和最终浏览器核对见 [validation.json](validation.json)；各修复来源的持久化结果见 [targeted-refresh.json](targeted-refresh.json)。应用截图：[海报活动详情](evidence/app-auo-result.jpg)、[待核实来源诊断](evidence/app-source-review.jpg)。\n\n## 逐来源记录\n\n每行对应原队列一个 ID，包含实际检查页面、判定及主截图。完整 URL、补充截图、日期字段、运行结果和截图哈希见 [review.json](review.json)。\n\n| 来源 | ID | 视觉判定 | 证据说明 | 处理 | 证据 |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\n可用 \`node scripts/build-visual-followup.mjs\` 从审计日志、当前配置和本地库重建报告；它核对精确的 436 项队列与截图存在性。报告来源日志采用每个 ID 最新有效检查，不重复计数纠正记录。\n`;
await writeFile(`${folder}/README.md`, readme);
store.close();
console.log(JSON.stringify({ reviewed: records.length, remaining: missing.length, fixes: fixes.length,
  evidenceFiles: evidence.size, requiresReview: result.summary.requiresReview, events: result.runtime.totalEvents }));
if (process.argv.includes('--require-complete') && missing.length) process.exitCode = 1;
