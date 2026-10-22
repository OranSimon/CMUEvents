import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadPlans, readConfig } from '../src/config.mjs';
import { openStore } from '../src/lib/store.mjs';

const folder = 'research/pending-source-resolution-2026-10-22';
const queue = JSON.parse(await readFile(`${folder}/queue.json`, 'utf8'));
const ids = new Set(queue.queue.map(row => row.sourceID));
if (queue.queue.length !== 105 || ids.size !== 105) throw Error('Expected the frozen 105-source follow-up scope');
const categories = {
  confirmed_public_events: '已找到公开活动', public_zero_verified: '当前公开列表为零',
  no_current_dated_announcement: '尚未公布准确日期', login_required: '需要成员访问',
  subscription_required: '需要邮件订阅', organizer_confirmation: '需要主办方确认',
  source_identity_unknown: '需要确认来源身份', technical_integration_needed: '上游技术故障',
};
const publicCategories = new Set(['confirmed_public_events', 'public_zero_verified', 'no_current_dated_announcement']);
const latest = new Map();
for (const file of (await readdir(folder)).filter(name => /-results\.jsonl$/.test(name)).sort()) {
  for (const line of (await readFile(`${folder}/${file}`, 'utf8')).split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (!ids.has(row.sourceID)) throw Error(`Unexpected source ID ${row.sourceID}`);
    if (!Number.isFinite(Date.parse(row.checkedAt))) throw Error(`Invalid review date ${row.sourceID}`);
    if (!latest.has(row.sourceID) || Date.parse(row.checkedAt) >= Date.parse(latest.get(row.sourceID).checkedAt)) {
      latest.set(row.sourceID, { ...row, journal: file });
    }
  }
}
const missing = [...ids].filter(id => !latest.has(id));
if ((process.argv.includes('--require-complete') || process.argv.includes('--apply-evidence')) && missing.length) {
  throw Error(`Still missing ${missing.length} visual reviews: ${missing.join(', ')}`);
}
const plans = loadPlans();
const byID = new Map(plans.map(row => [row.id, row]));
const oldPlans = JSON.parse(execFileSync('git', ['show', 'a8a5f99:config/source-plans.json'], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
})).plans;
const oldByID = new Map(oldPlans.map(row => [row.id, row]));
const contract = row => JSON.stringify([row.adapter, row.fetchUrl, row.options]);
const fixes = plans.filter(row => contract(row) !== contract(oldByID.get(row.id)));
const fixedIDs = new Set(fixes.map(row => row.id));
const relatedFixes = [{ discoveredWhileReviewing: 'f5d9d68e0b15', sourceID: '40f7fd9f957c',
  reason: 'The RSL Friendsgiving announcement belongs to the parent Wellness and Meaning-Making office, not the self-paced Interfaith Leadership Development badge program.' }];
const store = openStore(readConfig().databasePath);
const states = new Map(store.listSources().map(row => [row.id, row]));
const runtimeFor = id => {
  const source = states.get(id);
  return source ? { sourceID: source.id, state: source.state, eventCount: source.eventCount,
    lastAttempt: source.lastAttempt, warnings: source.warnings, error: source.error,
    currentContract: contract(source) === contract(byID.get(id)) } : null;
};
const manifest = new Map();
const reviews = [];
for (const item of queue.queue) {
  const row = latest.get(item.sourceID);
  if (!row) continue;
  if (!categories[row.category] || row.sourceURL !== item.sourceURL || !row.note || !row.reason || !row.nextStep
    || !Array.isArray(row.inspectedURLs) || !row.inspectedURLs.length || !row.screenshot) {
    throw Error(`Incomplete source identity or review fields: ${item.sourceID}`);
  }
  const evidencePath = value => value.startsWith('evidence/') ? `${folder}/${value}` : value;
  row.screenshot = evidencePath(row.screenshot);
  row.details ||= {};
  row.details.additionalScreenshots = [...new Set([...(row.details.additionalScreenshots || []),
    ...(row.details.evidenceScreenshots || [])].map(evidencePath))];
  if (row.details.evidenceScreenshots) row.details.evidenceScreenshots = row.details.evidenceScreenshots.map(evidencePath);
  const screenshots = [row.screenshot, ...(row.details?.additionalScreenshots || [])];
  for (const screenshot of screenshots) {
    if (!screenshot.startsWith(`${folder}/evidence/`)) throw Error(`Fresh screenshot required: ${screenshot}`);
    const info = await stat(screenshot);
    if (!info.isFile() || info.size < 1000) throw Error(`Unreadable screenshot: ${screenshot}`);
    if (!manifest.has(screenshot)) manifest.set(screenshot, {
      path: screenshot, bytes: info.size, sha256: createHash('sha256').update(await readFile(screenshot)).digest('hex'),
    });
  }
  const runtime = runtimeFor(row.sourceID);
  const implemented = fixedIDs.has(row.sourceID) && runtime?.currentContract && runtime.lastAttempt
    && ['ok', 'empty'].includes(runtime.state);
  const publicEventPending = row.requiresFix && !implemented;
  const requiresReview = !publicCategories.has(row.category) || publicEventPending || row.details?.requiresReview === true;
  const resolution = publicEventPending ? 'public_fix_pending'
    : implemented ? 'implemented_and_refreshed'
      : requiresReview ? 'external_action_documented' : 'public_scope_verified';
  const nextStep = implemented && row.sourceID === 'd62d08f7df9d'
    ? '已按 2026-09-27 仅日期精度导入；时分和地点仍需主办方澄清。2027 主会日期未公布，继续监测。'
    : implemented && row.category === 'confirmed_public_events'
    ? '已接入公开入口并完成定向刷新；继续按配置定期更新。参与资格、私有地点及日历覆盖限制以原公告和下列说明为准。'
    : row.nextStep;
  const accessRestrictions = [...(row.details?.accessRestrictions || [])];
  if (row.details.event?.locationVisibility === 'private_sign_in_to_display') accessRestrictions.push({
    type: 'login', requiredForPublicCoverage: false, url: row.inspectedURLs.at(-1),
    reason: '活动日期及说明已公开，具体地点需成员登录查看。',
    nextStep: '符合参与资格的读者通过原活动页查看地点；采集器保留私有地点提示，不补猜地址。',
  });
  if (row.details.optionalOrganizerClarification) accessRestrictions.push({ type: 'organizer',
    requiredForPublicCoverage: false, reason: row.details.optionalOrganizerClarification,
    nextStep: '向主办方核对最终报名截止分钟；应用保留结构化结束值及公告中的不同文字，不将二者悄悄合并。' });
  if (row.sourceID === '0810e0d905cd') accessRestrictions.push({ type: 'calendar', requiredForPublicCoverage: false,
    url: row.inspectedURLs.at(-1), reason: '官网公开的 Jummah 周期已接入，完整 Google 日历仍未匿名开放。',
    nextStep: '若需要完整日程，由主办方公开只读日历；当前公开周会可继续自动更新。' });
  reviews.push({ sourceID: item.sourceID, organization: item.organization, department: item.department,
    ...row, nextStep, verificationNextStep: row.nextStep, resolution, requiresReview,
    accessRestrictions, runtime });
}
const unresolvedFixes = reviews.filter(row => row.resolution === 'public_fix_pending');
if (process.argv.includes('--require-complete') && unresolvedFixes.length) {
  throw Error(`Public fixes are still pending: ${unresolvedFixes.map(row => row.sourceID)}`);
}
const countBy = field => Object.fromEntries([...new Set(reviews.map(row => row[field]))].sort()
  .map(value => [value, reviews.filter(row => row[field] === value).length]));
const required = reviews.filter(row => row.requiresReview).map(row => ({
  sourceID: row.sourceID, organization: row.organization, category: row.category,
  reason: row.reason, nextStep: row.nextStep, inspectedURLs: row.inspectedURLs, screenshot: row.screenshot,
}));
const optional = reviews.flatMap(row => row.accessRestrictions.filter(item => item.requiredForPublicCoverage === false)
  .map(item => ({ sourceID: row.sourceID, organization: row.organization, ...item })));
const generatedAt = new Date().toISOString();
const result = { schemaVersion: 1, generatedAt, baselineCommit: 'a8a5f99',
  scope: { requested: 105, reviewed: reviews.length, remaining: missing.length, missing,
    claim: 'All counted sources have fresh computer-use evidence. Public scope, optional member channels, and required external actions are separate; zero public records never establishes organization-wide inactivity.' },
  summary: { categories: countBy('category'), resolutions: countBy('resolution'),
    requiresReview: required.length, optionalChannelActions: optional.length, publicFixesPending: unresolvedFixes.length },
  runtime: { ...store.status(), note: 'Persistent store after targeted refreshes. Other catalog sources were not all re-fetched in this follow-up.' },
  relatedFixes,
  fixes: fixes.map(plan => ({ sourceID: plan.id, organization: plan.org, sourceURL: plan.url,
    additionalEndpoints: plan.options?.additionalEndpoints || [],
    runtime: runtimeFor(plan.id) })),
  reviews, evidenceManifest: [...manifest.values()],
  corrections: [{ sourceID: 'a2014c54892f', previousReport: 'research/empty-source-followup-2026-10-21/review.json',
    reason: 'The prior Qatar filter check read stale zero-result content before the new asynchronous group request finished. Fresh document loads, selected-group verification and a populated anonymous API control establish one public Carnegie Consulting event on 2026-11-10. All other 22 Qatar groups were independently rechecked after full loading.' }],
};
store.close();
if (process.argv.includes('--require-complete')) {
  const unrefreshed = result.fixes.filter(row => !row.runtime?.currentContract || !row.runtime.lastAttempt
    || !['ok', 'empty'].includes(row.runtime.state));
  if (unrefreshed.length) throw Error(`Changed contracts still need a successful refresh: ${unrefreshed.map(row => row.sourceID)}`);
}
await writeFile(`${folder}/review.json`, `${JSON.stringify(result, null, 2)}\n`);
await writeFile(`${folder}/external-actions.json`, `${JSON.stringify({ generatedAt, required, optional }, null, 2)}\n`);
const esc = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const shotLink = value => value.replace(`${folder}/`, '');
const categoryRows = Object.entries(result.summary.categories).map(([name, count]) => `| ${categories[name]} | ${count} |`).join('\n');
const fixRows = result.fixes.map(row => `| ${esc(row.organization)} | \`${row.sourceID}\` | ${row.runtime?.state || 'pending'} | ${row.runtime?.eventCount ?? '?'} |`).join('\n');
const reviewRows = reviews.map(row => `| ${esc(row.organization)} | \`${row.sourceID}\` | ${categories[row.category]} | ${esc(row.reason)} | ${esc(row.nextStep)} | [截图](${shotLink(row.screenshot)}) |`).join('\n');
await writeFile(`${folder}/README.md`, `# 105 个待核实来源的进一步处理\n\n截至 ${generatedAt}，已复查 **${reviews.length}/105** 项，剩余 **${missing.length}** 项。全部计数项都有本轮实际浏览器证据；本轮修改 **${fixes.length}** 个采集契约。需要外部行动的 **${required.length}** 项和 **${optional.length}** 项可选渠道维护单列在[下一步清单](external-actions.md)。公开零条只描述已检查入口，不能推断组织没有活动。\n\n| 判定 | 来源数 |\n| --- | ---: |\n${categoryRows}\n\n## 已修复的公开入口\n\n| 来源 | ID | 刷新状态 | 窗口内记录 |\n| --- | --- | --- | ---: |\n${fixRows}\n\n来源记录可能重叠，不能相加为新增活动数。本地库快照为 ${result.runtime.totalEvents} 条去重活动；没有声称全部 1,029 个来源本轮重抓成功。\n\n- MSA：使用官网公开按钮原有的周五 13:15、一小时 ICS 周期规则；校验生成脚本哈希，保留每周教室可能调整的提示，不从普通周会文字推算其他活动。\n- CampusGroups：保留原 ICS，追加与公共 Events 页面相同的匿名、按精确组织 ID 筛选的只读接口，使用响应内字段映射与分页。成员资料页受限不再自动否定已公开的公告。\n- WIB：读取官方账号链到的匿名 Google ICS，保留成员活动语境；公开可见不代表所有人可参加。\n- Poker：读取官网逐项完整日期，Time TBD 保持仅日期精度，独立 tournaments 页不能代表完整首页日程。\n- BBA 与 Senate：保留公开活动说明中的商品订购语境和仅限本科生要求，私有地点原样保留。BBA 结构化结束 23:55 与文字报名截止 23:59 的差异记在逐项证据中；使用来源 IANA 时区处理跨夏令时窗口。\n- TEDx：仅导入已确认的 2026-09-27 日期，三处时分／地点冲突留待主办方澄清。RSL Friendsgiving 以 2026-11-23 仅日期精度归入其所属办公室来源，不归给 ILD 学习徽章项目。\n\n## 更正旧的 Qatar 零结果\n\n上一轮 Carnegie Consulting 的零条结论无效：筛选后尚未完成异步加载时，页面残留上一次的零结果。现已对全部 23 组以新文档加载、准确选中分组和加载指示消失重新验证，22 组当前公开列表为零；Carnegie Consulting 有 2026 年 11 月 10 日 18:00–20:00（Doha）的 Oliver Wyman 活动。公开接口也返回同一活动。历史记录保留，并由[更正说明](../empty-source-followup-2026-10-21/ERRATA-2026-10-22.md)标明被取代的结论。\n\n## 验证\n\n离线测试、完整来源配置检查、42 个当前采集契约的定向刷新及 12 项实际 API 断言见 [validation.json](validation.json)。[活动导入截图](evidence/app-consulting-detail.jpg)、[重复合并与夏令时显示](evidence/app-bba-deduplicated-dst.jpg)、[受限原因与下一步](evidence/app-source-next-steps.jpg)可直接检查。\n\n## 逐来源原因和下一步\n\n完整检查 URL、限制、运行状态与截图哈希见 [review.json](review.json)。登录、订阅及主办方确认不会由本轮自动执行。\n\n| 来源 | ID | 判定 | 原因 | 下一步 | 证据 |\n| --- | --- | --- | --- | --- | --- |\n${reviewRows}\n\n可用 \`node scripts/build-pending-resolution.mjs --require-complete\` 重建并核对精确的 105 项队列。\n`);
const requiredSections = Object.keys(categories).map(category => {
  const rows = required.filter(row => row.category === category);
  return rows.length ? `## ${categories[category]}（${rows.length}）\n\n${rows.map(row => `- **${row.organization}**（\`${row.sourceID}\`）：${row.reason} 下一步：${row.nextStep} [证据](${shotLink(row.screenshot)})`).join('\n')}\n` : '';
}).filter(Boolean).join('\n');
await writeFile(`${folder}/external-actions.md`, `# 需要外部条件的后续事项\n\n本轮已完成公开范围复查。以下是当前无法仅靠匿名采集解决的条件；未代登录、注册邮箱、订阅列表或联系主办方。\n\n${requiredSections}\n## 可选渠道维护（不推翻已确认的公开范围）\n\n${optional.map(row => `- **${row.organization}**（\`${row.sourceID}\`）：${row.reason} 下一步：${row.nextStep}${row.url ? ` [渠道](${row.url})` : ''}`).join('\n')}\n`);
if (process.argv.includes('--apply-evidence')) {
  const path = 'config/source-overrides.json';
  const config = JSON.parse(await readFile(path, 'utf8'));
  for (const row of reviews) {
    const plan = byID.get(row.sourceID);
    const entry = config.sources[plan.url] ||= {};
    entry.evidence = { ...plan.evidence, ...entry.evidence,
      visualReview: { checkedAt: row.checkedAt, outcome: row.outcome, note: row.note,
        url: row.inspectedURLs.at(-1), requiresReview: row.requiresReview, resolution: row.resolution,
        report: `${folder}/review.json`, screenshot: row.screenshot },
      followupResolution: { checkedAt: row.checkedAt, category: row.category, reason: row.reason,
        nextStep: row.nextStep, requiresReview: row.requiresReview, accessRestrictions: row.accessRestrictions,
        report: `${folder}/review.json`, screenshot: row.screenshot } };
  }
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}
console.log(JSON.stringify({ reviewed: reviews.length, remaining: missing.length, fixes: fixes.length,
  categories: result.summary.categories, requiresReview: required.length, publicFixesPending: unresolvedFixes.length }));
