# 空结果来源视觉复核（2026-10-21）

本轮先对基线中 **451 个运行状态为 empty 的来源做静态筛查**，再对其中 **15 个来源进行浏览器视觉抽样**；另检查 Tepper 部分失败来源和 Drama 健康来源两个对照。**没有逐页视觉验证全部 451 个来源**，本轮其余 436 个来源继续保留未视觉核实状态。

基线记录时间为 2026-10-21 20:33 UTC：共 1,029 个来源、6,523 条合并活动，运行状态 empty 为 451。这些是修正前的基线，不是本文之后刷新完成的统计。采集窗口为向前回看 30 天、向后看 365 天，本轮用于判断旧活动的窗口起点为 2026-09-21。

## 静态筛查能说明什么

| 基线分组 | 来源数 | 可支持的结论 |
| --- | ---: | --- |
| 缓存中存在历史或被窗口／规则排除的记录 | 167 | 零条入库记录不等于源站从未发布活动；仍需核对窗口和排除规则 |
| 缓存端点／页面契约给出零条记录 | 284 | 只说明该响应为零；仍需核对查询语义、页面渲染和频道范围 |

不能把任一分组直接解释为“整个组织没有活动”。Art 的持续系列、BME 的有日期暂定场次和 Wushu 的另页日历，正是这类推断的反例。

## 15 个基线空结果来源

| 来源 | 视觉结果与解释 | 本地截图 |
| --- | --- | --- |
| [School of Art Exhibitions](https://art.cmu.edu/events/exhibitions/) | 公开页面有持续于2026-09-06至2026-12-06的Open Figure Drawing系列，明确列出12个周日；其中2026-10-25、11-01、11-08、11-15、11-22、12-06六次在复核日之后。默认WordPress查询返回零并不能证明该系列不存在。 | [截图](evidence/visual-empty-review-2026-10-21/art-drawing.jpg) |
| [School of Design Events](https://design.cmu.edu/design-events) | 默认公开Design Events页面明确显示No results。该结论只描述当时这个公开视图的结果，不推断整个School of Design没有活动。 | [截图](evidence/visual-empty-review-2026-10-21/design-no-results.jpg) |
| [BME Seminars](https://www.cmu.edu/bme/News_Events/seminars-current.html) | 2026日程明确排有日期的TBD场次，并给出周二/周四共享时间09:30–10:30、房间DH2315。通用占位标题过滤曾使这些场次全部消失。来源特定的暂定场次选项经新鲜重放得到窗口内9条，其中6条未来场次，无警告；讲者和题目仍须显示待定。 | [截图](evidence/visual-empty-review-2026-10-21/bme-pending.jpg) |
| [Center for AI-Driven Biomedical Research Seminars](https://www.cmu.edu/ai4bio/seminar/index.html) | Upcoming区域显示Stay tuned，当前页面没有已公布的未来讲座。不能把该页面的预告状态扩展为整个中心没有活动。 | [截图](evidence/visual-empty-review-2026-10-21/ai4bio-no-upcoming.jpg) |
| [Robotics Club](https://tartanconnect.cmu.edu/ical/tepper/ical_club_68235.ics) | TartanConnect正文显示No Upcoming Events，导航徽标显示1；徽标不是带日期的活动卡。另行打开官方日历可见当周36项记录，官方日历来源已采集1311条窗口记录，因此空的是旧频道。 | [截图](evidence/visual-empty-review-2026-10-21/roboclub-tartanconnect.jpg)、[补充截图1](evidence/visual-empty-review-2026-10-21/roboclub-calendar.jpg) |
| [School of Architecture](https://events.cmu.edu/architecture/all) | 大学日历中的School of Architecture频道在All Upcoming视图显示No events。学院自己的活动网站已有11条窗口记录；不能据此说Architecture没有活动。 | [截图](evidence/visual-empty-review-2026-10-21/architecture-university-empty.jpg) |
| [Parallel Data Lab — Systems Design and Implementation Seminar](https://pdl.cmu.edu/SDI/index.html) | 可见最新SDI日程为2026-08-27，早于本轮2026-09-21的窗口起点。页面有历史活动，当前窗口为零是时间范围结果；页面另明确要求ANDREW.CMU.EDU地址订阅。 | [截图](evidence/visual-empty-review-2026-10-21/pdl-historical.jpg) |
| [Career and Professional Development Center — fairs and recruiting events](https://www.cmu.edu/career/employers/calendar.html) | 可见招聘活动在2026-09-14至09-18，均早于2026-09-21窗口起点。页面并非没有发布过活动，不能把旧活动日期改成当前日期。 | [截图](evidence/visual-empty-review-2026-10-21/cpdc-historical.jpg) |
| [ECE Graduate Seminars](https://www.ece.cmu.edu/news-and-events/seminars.html) | 当前Graduate Seminars区域只有通用安排/参与说明，没有本学期具体排期；最新链接归档为Spring2026。应表达为当前日程未发布或仅有旧档案，不能声称已证实没有未来讲座。 | [截图](evidence/visual-empty-review-2026-10-21/ece-current-unpopulated.jpg) |
| [Humanities Scholars Program Events](https://www.cmu.edu/dietrich/hsp/events/index.html) | 页面最近可见的活动为2026-04-28和04-24，均在当前窗口之前。 | [截图](evidence/visual-empty-review-2026-10-21/hsp-historical.jpg) |
| [Hunt Institute for Botanical Documentation Exhibitions](https://www.huntbotanical.org/exhibitions/) | 宣布了Fall2029展览，但日期明确待定，没有当前可入库的准确活动日。提交截止日不应当作展览日期；这也不等于研究所没有活动。 | [截图](evidence/visual-empty-review-2026-10-21/hunt-date-tbd.jpg) |
| [CMU Wushu Club Events](https://cmuwushu.org/events) | Events页面写No Upcoming并保留9月4日旧活动，但其公布的/schedule#calendar日历显示2026年10月多场WUSHU PRACTICE，例如10月22、27、29日19:00。已核实该页公布的公共ICS返回200，含95个VEVENT，重放得到40条窗口实例且无警告；相关配置已合并，持久化刷新同样得到40条窗口实例，见下文统计。 | [截图](evidence/visual-empty-review-2026-10-21/wushu-no-upcoming.jpg)、[补充截图1](evidence/visual-empty-review-2026-10-21/wushu-calendar.jpg) |
| [Philosophy Workshops and Conferences](https://www.cmu.edu/dietrich/philosophy/events/workshops-conferences/index.html) | 页面明确表示更多PFEW workshops将于下学期发布；最近历史活动为2025-08-02至08-03。保留旧档案与当前无新预告的区别。 | [截图](evidence/visual-empty-review-2026-10-21/philosophy-no-upcoming.jpg) |
| [ScottyLabs](https://tartanconnect.cmu.edu/ical/tepper/ical_club_68253.ics) | 旧TartanConnect来源最新活动为2025-12-10；官方ScottyLabs日历则可见当周4项，包括10月21日Baking GBM和10月23日MiniCarnival，且其独立来源已采集114条窗口记录。 | [截图](evidence/visual-empty-review-2026-10-21/scottylabs-calendar.jpg) |
| [Society of Women Engineers](https://tartanconnect.cmu.edu/ical/tepper/ical_club_68280.ics) | 旧TartanConnect来源最新活动为2025-10-05；官方SWE日历明确显示2026-11-19的November GBM，17:30–18:30，且其独立来源已采集1条。 | [截图](evidence/visual-empty-review-2026-10-21/swe-current.jpg) |

## 两个额外对照

**[Tepper Research Conferences and Seminars](https://www.cmu.edu/tepper/faculty-and-research/seminars-and-conferences)**：用户提到的Tepper研究会议页并不属于451个empty来源：复核时是部分失败/错误，仍保留1条Child Welfare记录。现场可见该活动为2026-10-23 08:00–16:00，Tepper4242；还可见2027-05-21至05-22的Women in Economic Theory会议。独立Faculty Tracker已有100条，不能替代研究会议目录的子页发现。

截图：[证据1](evidence/visual-empty-review-2026-10-21/tepper-directory.jpg)、[证据2](evidence/visual-empty-review-2026-10-21/tepper-child-welfare.jpg)、[证据3](evidence/visual-empty-review-2026-10-21/tepper-women-2027.jpg)。

**[School of Drama — What's Happening](https://drama.cmu.edu/whats-happening/)**：健康对照来源已有48条窗口记录。页面可见11月8日Tesori与11月12/13日Jagged Little Pill，和已采集活动相符。它不属于451个empty来源；修正持续活动查询并刷新后，该来源为57条。

该控制页面由实际浏览器目视确认；证据目录没有对应落盘 JPEG，JSON 中截图路径保留为空，避免补造证据。

## 修正与状态表达

- **Art**：查询应覆盖与采集窗口相交的持续系列，并读取发布方列出的具体日期，不能把整段范围当每天连续开放，也不能补出所有周日。
- **BME**：用来源特定选项保留有准确日期、时段、地点的暂定场次，并继续标明讲者／题目待定；持久化刷新已得到9条窗口记录，其中6条未来记录，无警告。
- **Wushu**：已接入同一官网公布的公共日历并通过局部重放验证；Events摘要的“No Upcoming”不能覆盖其他已公布的练习安排。
- **Tepper**：修复子页面发现后已保留2条确切会议记录，没有旧记录重复；AI and Human Decisions与Sustainability Forum两个子页面仍无法提取带准确日期的活动，因此继续显示部分失败。

界面和来源元数据应区分“公开视图明确无预告／无结果”“历史记录在当前窗口之外”“当前排期未发布／日期待定／尚未验证”。Robotics Club、Architecture、ScottyLabs 和 SWE 的已维护日历都说明：一个旧频道为零，不能扩展为组织层面的结论。

## 修正后的持久化结果

截至2026-10-21 20:52 UTC，已对9个受影响来源完成两批定向刷新；这不是全目录刷新，也不增加视觉抽样范围。

| 指标 | 基线 | 定向刷新后 |
| --- | ---: | ---: |
| 来源总数 | 1,029 | 1,029 |
| 合并后的独立活动 | 6,523 | 6,603 |
| ok来源 | 293 | 296 |
| empty来源 | 451 | 448 |
| error来源 | 3 | 3 |
| covered来源 | 259 | 259 |
| unsupported来源 | 19 | 19 |
| subscription_only来源 | 4 | 4 |

Art Exhibitions、BME和Wushu从空结果恢复，分别为9、9、40条窗口记录，均无警告。持续活动查询修正还影响其他WordPress来源，因此同时刷新Art主日历、Art Lectures、Drama与两个RI来源；刷新后这些来源分别为14、5、57、24和13条。各来源存在活动重合，不能将来源计数直接相加当作独立活动总数。

Tepper的2条会议已保留，但两个子页面仍失败，状态继续诚实保留为部分失败。新增80条合并活动是上述定向刷新后的持久化差值，不是对其余436个未视觉核实来源作出的估计。

整合验证通过106/106项测试，1,029条来源策略检查及`git diff --check`通过。统计原始记录见[刷新统计](evidence/visual-empty-review-2026-10-21/post-refresh.json)。逐条来源ID、原始URL、视觉结论、真实截图路径和刷新结果见[JSON记录](visual-empty-review-2026-10-21.json)。

浏览器中已验证新版诊断筛选、搜索、30→60条分页，以及Art来源的9条记录与单独视觉复查说明；[界面截图](evidence/visual-empty-review-2026-10-21/app-art-diagnostics.jpg)。截图与刷新统计一同保存在仓库证据目录，原缓存路径不是交付依赖。

另外验证了Tepper两场会议的搜索与详情：Child Welfare为10月23日08:00–16:00、Room 4242；Women in Economics Theory保留2027年5月21–22日范围，明确显示Time not listed。BME限定来源后有6个未来Details TBD场次，Art搜索显示6个明确列出的未来场次并正确切换EDT/EST。随后仅对Tepper重刷以保留正文和地点段落分隔，仍为2条会议、总计6,603条，部分失败原因不变。
