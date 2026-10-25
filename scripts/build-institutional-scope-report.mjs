import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { readConfig, loadPlans } from '../src/config.mjs';
import { openStore } from '../src/lib/store.mjs';
import { sourceAllowed } from '../src/lib/source-scope.mjs';

const folder = 'research/club-source-removal-2026-10-25';
const read = async name => JSON.parse(await fs.readFile(`${folder}/${name}`, 'utf8'));
const classification = await read('classification.json');
const access = await read('access-probes.json');
const http = await read('http-probes.json');
const refresh = await read('retained-refresh.json');
const reposts = await read('official-reposts-to-verify.json');
const config = readConfig();
const plans = loadPlans();
const store = openStore(config.databasePath);
const sources = store.listSources();
const status = store.status();
const byID = new Map(plans.map(source => [source.id, source]));
const effectiveSource = source => {
  const visited = new Set();
  while (source.status === 'covered' && source.canonicalSourceId && !visited.has(source.id)) {
    visited.add(source.id);
    source = byID.get(source.canonicalSourceId);
  }
  return source;
};
const retainedIDs = new Set(classification.retained.map(source => source.sourceID));
const excludedIDs = new Set(classification.excluded.map(source => source.sourceID));
assert.equal(plans.length, 318);
assert.equal(sources.length, 318);
assert.ok(plans.every(source => retainedIDs.has(source.id) && !excludedIDs.has(source.id) && sourceAllowed(source, config.sourceScope)));
assert.equal(refresh.completed, refresh.total);
const occurrences = store.db.prepare('SELECT source_id,data FROM occurrences').all().map(row => ({ sourceID: row.source_id, event: JSON.parse(row.data) }));
const restoration = reposts.events.map(expected => ({ uid: expected.uid, title: expected.title, start: expected.start,
  officialOccurrences: occurrences.filter(row => expected.sourceIDs.includes(row.sourceID)
    && row.event.uid === expected.uid && row.event.start === expected.start).length }));
assert.ok(restoration.every(row => row.officialOccurrences > 0), 'Previously removed official reposts must be restored');
const observations = new Map(access.observations.map(row => [row.sourceID, row]));
const probeByURL = new Map(http.results.map(row => [row.url, row]));
const inventory = sources.map(source => ({ sourceID: source.id, organization: source.org, department: source.department,
  sourceURL: source.url, fetchURL: source.fetchUrl, state: source.state, eventCount: source.eventCount,
  lastAttempt: source.lastAttempt, error: source.error, warnings: source.warnings,
  sourcePageHTTP: probeByURL.get(source.url)?.access, configuredFetchHTTP: probeByURL.get(source.fetchUrl || source.url)?.access,
  effectiveFetchURL: effectiveSource(source).fetchUrl || effectiveSource(source).url,
  effectiveFetchHTTP: probeByURL.get(effectiveSource(source).fetchUrl || effectiveSource(source).url)?.access,
  ...(observations.has(source.id) ? { accessStatus: observations.get(source.id).status,
    accessReason: observations.get(source.id).reason, nextStep: observations.get(source.id).nextStep } : {}) }));
store.close();
const result = { generatedAt: new Date().toISOString(), policy: { mode: 'source-only', officialRepostsRetained: true,
  description: 'Stop tracking independent student-club publishers. Preserve every activity published by retained sources regardless of organizer.' },
  scope: { original: 1029, excluded: excludedIDs.size, retained: retainedIDs.size, activeRegistry: sources.length },
  runtime: status, retainedSourceRefresh: refresh,
  httpChecks: { sourceCount: http.scope.sourceCount, checkedURLs: http.scope.checkedURLs, summary: http.summary },
  substantiveAccessChecks: access.summary, officialRepostRestoration: restoration, sources: inventory };
await fs.writeFile(`${folder}/remaining-source-status.json`, `${JSON.stringify(result, null, 2)}\n`);
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const required = access.observations.filter(row => row.hasRequiredAuthenticationOrSubscription || row.requiresProgramPagePublication
  || row.status === 'public_schedule_available_restricted_mail_channel' || row.status === 'browser_available_http_tls_failure_covered_by_public_ics');
const requiredRows = required.map(row => `| [${escape(row.organization)}](${row.sourceURL}) | ${escape(row.reason)} | ${escape(row.nextStep)} |`).join('\n');
const errors = sources.filter(source => source.state === 'error');
const unsupported = sources.filter(source => source.state === 'unsupported');
await fs.writeFile(`${folder}/classification-notes.md`, `# 来源筛选口径\n\n只停止学生社团自行维护的官网、活动页和独立日历，共711条。保留318条其他发布来源。完整逐来源身份与依据见[classification.json](classification.json)。\n\n- 移除Student Organizations558条、Tepper学生社团87条、Fraternity/Sorority35条、Qatar学生社团28条，以及HOPEful/Sigma Tau Delta学生组织及别名3条。\n- 学校／院系／办公室发布源、学生自治组织、年级来源和全校总日历继续追踪；Math院系Colloquia与Club Sports办公室入口也保留。\n- 不根据活动主办方、标题、描述、社团标签或报名链接筛掉活动。其他来源转载的社团主办活动照常进入应用。\n- 同一活动仍按原有去重规则合并并保留所有有效发布来源。来源公开可读不保证每场活动对所有人开放。\n`);
await fs.writeFile(`${folder}/README.md`, `# 社团直接来源移除与剩余访问问题\n\n已从现行JSON／CSV目录、采集计划、配置和运行库移除 **711** 条学生社团直接来源，保留 **318** 条其他发布来源，当前共 **${status.totalEvents}** 条去重活动。\n\n**筛选只发生在来源层面。官方日历、院系、办公室、学生自治及其他保留来源发布的活动均保留，即使主办方是学生社团。** 不再使用任何活动层面的社团过滤；此前受影响的12组转载身份已重新抓取并验证恢复，见[恢复核验](official-reposts-to-verify.json)与[当前状态](remaining-source-status.json)。\n\n## 来源范围\n\n独立学生社团的官网、活动页、Google日历及其自己的订阅源停止追踪。TartanConnect／ScottyConnect全校总日历、院系公开日历、大学办公室及非社团来源继续保留。具体边界见[classification-notes.md](classification-notes.md)，逐项依据见[classification.json](classification.json)。旧目录和研究记录只作历史留档。\n\n## 剩余访问问题\n\n对318个保留来源的 **${http.scope.checkedURLs}** 个配置页面／抓取地址完成新匿名GET；另对 **${access.summary.reviewedSources}** 个重点来源核对私档、内嵌日历和成员入口。HTTP200认证页不等于能读取内容；下表区分完整内容、附加渠道及可用替代日历。\n\n| 来源 | 当前限制 | 下一步 |\n| --- | --- | --- |\n${requiredRows}\n\n更详细解释见[access-obstacles.md](access-obstacles.md)。全部318项当前状态见[remaining-source-status.json](remaining-source-status.json)，32项深入核实见[access-probes.json](access-probes.json)，全部配置URL见[http-probes.json](http-probes.json)。本轮没有登录、注册邮箱、订阅或联系主办方。\n\n## 可访问但尚未完整解析\n\n**${errors.length}** 个partial：${errors.map(source => source.org).join('、')}。已检查的页面可访问，问题是日期缺失、详情覆盖或分页空结果识别。**${unsupported.length}** 个unsupported页面也可打开，属于海报、动态组件、资料目录或日期语义尚未适配，不应解释为访问失败。Alumni公开动态日历已确认三页23条完整日期卡片，无需登录；现有采集器仍待适配。\n\n## 验证\n\n${refresh.total}个可自动采集的保留来源已完成新刷新，见[retained-refresh.json](retained-refresh.json)。测试、API、来源清理、官方转载恢复与最终界面证据见[validation.json](validation.json)。\n`);
console.log(JSON.stringify({ sources: sources.length, events: status.totalEvents, restoredOfficialIdentities: restoration.length, accessRows: required.length }));
