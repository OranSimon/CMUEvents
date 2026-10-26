# GitHub Pages 长期部署验收

2026-10-25，America/New_York。公开网站：[CMU Events](https://oransimon.github.io/CMUEvents/)。仓库已按用户授权改为 public，Pages 发布源为 GitHub Actions；AGPL-3.0-only 许可保持不变。

## 已完成

- 构建产物只包含静态页面、前端模块、许可证和公开 JSON，不需要本机服务器常开。
- `Daily events and Pages` 每天纽约时间 06:17 自动检查全部自动来源，也支持代码变更及手动触发。GitHub 定时任务可能延迟，站点使用真实成功更新时间并在 48 小时后提示过期。
- `codex/crawl-state` 保存各来源规范化记录和状态；临时 runner 可以恢复数据。来源契约不兼容时不恢复旧记录，发布下降基线仍独立保留。
- 11 个来源配置移除固定活动名单、手工海报字段和按已批准哈希发布活动的依赖。当前配置的 `reviewedPublicEvents`、`reviewedImages`、`reviewedFragments` 数量为 0；CI 递归禁止重新引入。
- 公开 DOM 分页、当前 HTML 行、动态媒体选择器、PDF 文本及 OCR 提取均由云端运行。变更文件字节会重新提取，无需录入一套新日期。
- 全量目录、邮件订阅边界、官方来源转载的社团活动和日期/时区不确定性保持原有规则。

## 三轮真实云端运行

| 运行 | 代码 | 结果 | 验证内容 |
| --- | --- | --- | --- |
| [40262344021](https://github.com/OranSimon/CMUEvents/actions/runs/40262344021) | f72769f | build / deploy 均成功，4,402 条 | 首次从空状态抓取、创建持久化分支和公开站点；暴露 Linux OCR 失败及详情页超时 |
| [40264133917](https://github.com/OranSimon/CMUEvents/actions/runs/40264133917) | db59fe2 | build / deploy 均成功，4,414 条 | 恢复旧状态，保留 4,402 发布基线；LTI 恢复 9 条；确认详情页 HTTP 403 验证页 |
| [40264806726](https://github.com/OranSimon/CMUEvents/actions/runs/40264806726) | a81df88 | build / deploy 均成功，4,415 条 | 再次恢复 276 个来源，独立基线 4,414；HTTP 403 立即结束，完整抓取约 104 秒 |

最后一轮运行：276/276 自动来源已检查，266 完成、10 项部分提取或需要复查，另有 38 项共享覆盖别名和 4 个邮件专属来源。来源目录总数仍为 318。这些是验收时的快照，不是永久活动数量或穷尽覆盖承诺。

最后一轮 Ubuntu / Node 24 实际运行了 240 项测试，240 通过、0 失败、0 跳过。`npm run check` 通过；数据下降、兼容状态恢复、过期提示和静态 JSON 一致性均有回归测试。

## 解析与运行边界

GitHub runner 对 GiveCampus 详情页得到 HTTP 403、页面标题 `Just a moment...`。公开 Alumni 列表的 23 场活动和其中 4 场线上活动仍按当前显示日期收录。详情时钟与描述未收录；旧人工时钟不会作为回退。连续详情失败触发停止本轮可选详情请求，保留明确 partial 状态。

LTI 自动 OCR 在最后一轮提取了 9 条窗口内活动，约 1.1 秒；一位讲者姓氏仍不确定，因此保留系列标题并显示诊断。Socialist Studies 的 2 条窗口内活动恢复，但扫描上限仍标注部分覆盖。其他未给出完整日期、日期冲突、历史档案扫描上限及受限日历仍在 Our sources 中显示具体原因。没有把它们统一标为无活动。

## 浏览器与状态验证

- 本地隔离构建：4,389 条实际公开活动、318 来源；该轮明确未启用本地 Chromium，因此 Alumni 标记未采集，不伪装为完整云端运行。
- 状态回环：6,634 条原始来源记录重新恢复为相同的 4,389 条去重活动，来源归属保持。
- 静态查询：16 组真实数据查询的总数和全部 facets 与 SQLite 一致；非搜索分页顺序相同。静态标题权重排序与 SQLite BM25 的搜索排名存在已记录差异。
- Computer use 检查桌面及 390px 布局、日期/搜索/分页/详情原链接、318 个来源原链接、6 个邮件频道和 Reload。
- 公开站点 smoke 通过；`app.js`、`styles.css`、`data-client.js` 的在线字节和 SHA 与冻结本地版本一致。静态数据请求只有 GET，没有本地 API 或 POST 抓取请求。
- 最后在公开站点重新载入并确认成功更新时间为纽约时间 23:38，首页 Upcoming 为 3,668，完整数据为 4,415。

## 证据

- [最终 workflow 验证日志摘要](final-workflow-validation.json)
- [最终在线 JSON、来源归属及代际一致性](final-live-verification.json)
- [最终发布、独立基线和来源诊断](final-cloud-publication.json)
- [第二轮来源 403 及 OCR 诊断](second-cloud-diagnostics.json)
- [正式站点验收](live-pages-smoke.json) 与 [线上资源 SHA](live-pages-resources.json)
- [查询一致性](static-query-parity.json) 与 [状态回环](state-roundtrip.json)
- [本地真实数据及窄屏验收](frontend-qa.json)
- [最终公开站点截图](evidence/final-live-home.png)

长期操作与失败恢复见 [部署说明](../../docs/deployment.md)。
