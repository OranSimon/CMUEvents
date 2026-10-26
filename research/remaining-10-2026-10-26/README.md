# SCS 目录与 REAL/LCS 动态覆盖修复

匿名实时复验：`2026-10-26T04:28:13.492Z` → `2026-10-26T04:28:23.517Z`。使用生产安全 HTTP fetcher 和内存响应缓存；未打开生产 SQLite、未使用本机 headless browser。日期窗口为 `2026-09-26T04:28:13.492Z` 至 `2027-10-26T04:28:13.492Z`。

SCS 当前 JSON 的 **26/26** 系列已检查，19 项复用现有 catalog/canonical source；其余采用官网结构排期或明确无网站的目录元数据及官方公告检索。共 **107 个窗口内唯一 UID**，`inspectionComplete:true`，`internalIssues:[]`、`externalIssues:[]`。运行总计50个HTTP请求、4,059,824字节（同时包含REAL/LCS），约10秒。

## 26 系列检查矩阵

| 系列 | 当前记录 | 复用 source ID | 证据 / 当前状态 |
| --- | ---: | --- | --- |
| Accessibility Lunch Seminar | 0 | — | directory_metadata_and_public_calendar；无可确认的当前个别日期，不由星期/时刻造场次 |
| AI Institute for Societal Decision Making Seminar | 5 | 5a47a3eb65bf | catalog_source_reuse, explicit_public_calendar_announcements |
| Algorithms, Combinatorics and Optimization Seminar | 8 | a35bf71459aa | catalog_source_reuse, live_structural_profile |
| Center for Informed Democracy & Social - cybersecurity Seminar | 0 | — | live_structural_profile |
| CMU Foundation and Language Model Seminar | 0 | 7a5d5c3584ce | Only explicitly named FLAME seminar/meeting records from the advertised center calendar; public symposia are not silently assigned to this members-only weekly series.；无可确认的当前个别日期，不由星期/时刻造场次 |
| Colloquium on Computer Science Pedagogy | 0 | — | directory_metadata_and_public_calendar；无可确认的当前个别日期，不由星期/时刻造场次 |
| Crypto Seminar | 3 | — | live_structural_profile |
| Cylab Seminar | 5 | 9903c32bf0ab | catalog_source_reuse, explicit_public_calendar_announcements |
| Current Topics in Privacy Seminar | 7 | fbdc39977a83 | The directory legacy privacy.cs URL serves the same official Privacy Engineering series linked by the current privacy.s3d catalog source. |
| Database Seminar | 10 | 804b8b6951fe | Use the official current /seminars/ index reached from the legacy /seminar2025/ page, rather than pinning April 2025. |
| Economics-CS Seminar | 1 | — | live_structural_profile |
| Human-Computer Interaction Seminar | 4 | 83459e4d2608 | catalog_source_reuse |
| Joint CMU-Pitt Ph.D. in Computational Biology Seminar | 14 | 1afa627d953d | Supplement the existing explicitly dated table with named-speaker rows whose topic is blank; omit NO SEMINAR and unnamed pending slots. |
| Language Technologies Institute Colloquium | 9 | 528193392a78 | catalog_source_reuse |
| Machine Learning - Artificial Intelligence Seminar | 6 | 276c414f1ee0 | catalog_source_reuse |
| Parallel Data Laboratory Talk Series | 0 | — | live_structural_profile |
| Principles of Programming Seminar | 0 | a8e37996c63d | catalog_source_reuse |
| Robotics Institute Seminar | 7 | b24d9c9bb1f5 | The advertised month URL is stale; reuse its official current Seminar API category, selecting only the publisher RI Seminar category tag. |
| Software and Societal Systems Department Seminar Series | 4 | d286f9c7c4b4 | The linked S3D public feed is department-wide. Only events explicitly naming this distinguished/seminar series are assigned here. |
| Software Research Seminar | 0 | 13fff1668ca0 | The linked public calendar is department-wide; only explicit SSSG/Software Research Seminar labels ground this series. Its syllabus weekday rule does not create occurrences.；无可确认的当前个别日期，不由星期/时刻造场次 |
| Systems Design and Implementation Seminar | 0 | 45f983439757 | catalog_source_reuse |
| Theory Lunch Seminar | 14 | a75d27bb1128 | catalog_source_reuse |
| Theory Seminar | 8 | a75d27bb1128 | The shared Theory Lunch page explicitly labels these individual rows as part of the Theory Seminar series. |
| Visions and Autonomous Systems Seminar | 5 | b24d9c9bb1f5 | Same official RI parent calendar as RI Seminar, but only publisher VASC Seminar category tags are assigned here. |
| SCS Distinguished Lectures | 5 | d31338711e1f | catalog_source_reuse |
| SCS Professional Seminar | 0 | — | directory_metadata_and_public_calendar；无可确认的当前个别日期，不由星期/时刻造场次 |

## 范围与长期行为

- 每轮重新读取官方 JSON 的 cols/data；不固定26行、不固定活动 ID/标题/日期。新增系列自动进入公共 HTML/ICS 发现；目录延续标志、无法识别的新布局或详情预算不足会记录 internal issue，不会报完整。
- 复用来源以本轮原始 context 共享 Promise；covered alias 解析 canonical source，fetchText 按 URL/请求选项共享。新一轮 context 重新取数。显式依赖图拒绝并发及递归循环。
- AI-SDM 使用官方 seminar widget；数据库使用官网当前 /seminars/ 入口，避免目录过时2025 URL。RI/VASC 仅按原始 publisher category 标签分配；S3D/SSSG 仅按明确系列名过滤其院系公共 feed，不把宽泛院系全部活动认作该系列。Theory Seminar 仅取页面明确标为该系列的行。
- ACO 以当前学期 heading 的唯一年份补全其卡片日期，8场窗口内记录；CPCB 表格14场具名活动，空主题使用系列+已公布讲者，不造主题；NO SEMINAR 和无讲者/无主题空槽不造活动。PDL 使用可见日期分组标题，完全不从HTML文件名推断日期。
- 三个无网站条目只检索官方SCS日历中精确完整系列名/目录明确简称的标题；未见公告则 undated。FLAME/SSSG 对共享feed保持窄范围，公开页面/日历未明确指向该系列的记录不会冒认。目录常规星期和时刻不生成 recurrence。
- 新发现来源先执行 source-only 排除规则；官网转载的 club-hosted 活动及其原始链接仍保留。

## REAL / Learning and Control

REAL 的周期描述和明确标记 example schedule 不构成活动日期。每轮解析当前官网广告 Calendar/Website 链接，解码其显式 Google calendar ID；不会保留固定 calendar ID 列表或整页内容指纹。

LCS 当前 Next upcoming seminar 为 TBD；5条明确日期的历史 talk 均为2024，不在当前窗口。其公共 ICS 可访问且无当前活动。新出现的明确日期 speaker section 会自动解析；Biography 里的毕业/论文年份不作为活动日期。当前 `inspectionComplete:true`、`internalIssues:[]`，无需因网站导航/footer变化重新手工确认。

Manipulation 官网当前广告的公开 Google ICS 仍返回 **HTTP404**：

`https://calendar.google.com/calendar/ical/c_b7b9af5e32917907f37e33bcfe0399d267a15c550fad853518793053f65c42b4%40group.calendar.google.com/public/basic.ics`

这项是实际上游公开端点失败，保留 `partial:true` 和精确 external issue。官网只广告该ID、对应Calendar入口与Mailman订阅；未发现另一个官方公共feed。不能由该失败推断组织没有活动，也不会登录、订阅或绕过权限。

## 验证与风险

`npm run check` 通过（318 sources）；相关41测试通过，其中新增11个目录/语义/coverage回归。覆盖新增第27行、alias/跨轮memo、并发循环、来源排除前置、官方club repost、RI/VASC范围、LCS新talk与bio年、PDL可见日期和错误filename、ACO/CPCB pending主题、404与parser预算分离、字符串issue合并及失败endpoint不得被健康endpoint掩盖。

页面布局/API仍可能变化；此时新的解析缺口应成为 internal issue 并被每日gate挡住，而不是以“无日期”掩盖。上游未公开的成员邮件详情不在公共数据覆盖承诺内。107是本次UTC窗口的目录结果数，不是全站去重总数；跨来源合并由现有store处理。

机器可读配置：`directory-real-patch.json`（两个完整options replacement）。逐系列原始结果、公开URL、复用canonical ID及当前统计：`directory-real-live.json`。GitHub每日正式复验链接由root在工作流结束后补充。
