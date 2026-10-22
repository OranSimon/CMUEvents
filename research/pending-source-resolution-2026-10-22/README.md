# 105 个待核实来源的进一步处理

截至 2026-10-22T18:58:31.272Z，已复查 **105/105** 项，剩余 **0** 项。全部计数项都有本轮实际浏览器证据；本轮修改 **42** 个采集契约。需要外部行动的 **29** 项和 **84** 项可选渠道维护单列在[下一步清单](external-actions.md)。公开零条只描述已检查入口，不能推断组织没有活动。

| 判定 | 来源数 |
| --- | ---: |
| 已找到公开活动 | 6 |
| 需要成员访问 | 6 |
| 尚未公布准确日期 | 9 |
| 需要主办方确认 | 19 |
| 当前公开列表为零 | 61 |
| 需要邮件订阅 | 1 |
| 上游技术故障 | 3 |

## 已修复的公开入口

| 来源 | ID | 刷新状态 | 窗口内记录 |
| --- | --- | --- | ---: |
| Iota Phi Theta Fraternity, Inc. | `57f076785638` | empty | 0 |
| Class of 2027 | `42c864cad300` | empty | 0 |
| Class of 2028 | `e4079298b407` | empty | 0 |
| Class of 2029 | `0c925198852d` | empty | 0 |
| Class of 2030 | `4898714e3ede` | empty | 0 |
| CMUQ Library | `c1587a0b2819` | empty | 0 |
| EcoCampus | `48e5e88860d3` | empty | 0 |
| Anime Club | `96d9c569ccf5` | empty | 0 |
| Arts & Crafts Club | `d7858a5f2b71` | empty | 0 |
| Association of Information System (AIS) | `c6da39f30954` | empty | 0 |
| Carnegie Consulting | `a2014c54892f` | ok | 1 |
| Carnegie Math Club | `af81054dbc6e` | empty | 0 |
| Carnegie Mellon Finance Society (CMFS) | `19248fc9767e` | empty | 0 |
| CMU-Q Undergraduate Journal Club (CUJC) | `8f4e483a1437` | empty | 0 |
| CMUQ Football Club | `7cdbbe1e7028` | empty | 0 |
| French Club | `0aa328464c5e` | empty | 0 |
| Game Dev Club (GDC) | `677602880a9d` | empty | 0 |
| Knits & Knots Club | `715aff642a67` | empty | 0 |
| OpenCMUQ Collective | `1116d82179ee` | empty | 0 |
| Shamunity | `fd5e37c9252e` | empty | 0 |
| The BioSci Club | `ca9e9e551f58` | empty | 0 |
| The Carnegie Innovation Club (CIC) | `c40f01fed271` | empty | 0 |
| The Music Club | `d32ab184e057` | empty | 0 |
| Student Majlis Executive Team | `1d28398c08fe` | empty | 0 |
| Undergraduate Student Senate | `d5a270fc4ae8` | ok | 1 |
| Carnegie Mellon Racquetball Club | `04b93bc6b736` | empty | 0 |
| Carnegie Mellon University Poker Club | `9f7bff4dc6be` | ok | 8 |
| Carnegie Mellon Young Americans for Liberty | `184e85bf058a` | empty | 0 |
| College Democrats | `4d9cc97bf058` | empty | 0 |
| Muslim Student Association | `0810e0d905cd` | ok | 53 |
| TEDxCMU | `d62d08f7df9d` | ok | 1 |
| Traders at Carnegie Mellon | `11e4692b9472` | empty | 0 |
| Women in Business | `afc8d82bc81d` | ok | 15 |
| Black Business Association Club | `d59c139e665b` | ok | 2 |
| Cricket Club | `9a2420282e05` | empty | 0 |
| International Business & Advisory Club | `931fac9f758c` | empty | 0 |
| MSBA Programs SLC | `60e7784409c9` | empty | 0 |
| One For the World | `640cd6c2b613` | empty | 0 |
| Tepper Ventures | `2e5dd8baa8e1` | empty | 0 |
| Carnegie Mellon University | `0fceb4066385` | empty | 0 |
| Home Page | `69aec3cbe07c` | empty | 0 |
| Wellness and Meaning-Making Programs | `40f7fd9f957c` | ok | 56 |

来源记录可能重叠，不能相加为新增活动数。本地库快照为 7624 条去重活动；没有声称全部 1,029 个来源本轮重抓成功。

- MSA：使用官网公开按钮原有的周五 13:15、一小时 ICS 周期规则；校验生成脚本哈希，保留每周教室可能调整的提示，不从普通周会文字推算其他活动。
- CampusGroups：保留原 ICS，追加与公共 Events 页面相同的匿名、按精确组织 ID 筛选的只读接口，使用响应内字段映射与分页。成员资料页受限不再自动否定已公开的公告。
- WIB：读取官方账号链到的匿名 Google ICS，保留成员活动语境；公开可见不代表所有人可参加。
- Poker：读取官网逐项完整日期，Time TBD 保持仅日期精度，独立 tournaments 页不能代表完整首页日程。
- BBA 与 Senate：保留公开活动说明中的商品订购语境和仅限本科生要求，私有地点原样保留。BBA 结构化结束 23:55 与文字报名截止 23:59 的差异记在逐项证据中；使用来源 IANA 时区处理跨夏令时窗口。
- TEDx：仅导入已确认的 2026-09-27 日期，三处时分／地点冲突留待主办方澄清。RSL Friendsgiving 以 2026-11-23 仅日期精度归入其所属办公室来源，不归给 ILD 学习徽章项目。

## 更正旧的 Qatar 零结果

上一轮 Carnegie Consulting 的零条结论无效：筛选后尚未完成异步加载时，页面残留上一次的零结果。现已对全部 23 组以新文档加载、准确选中分组和加载指示消失重新验证，22 组当前公开列表为零；Carnegie Consulting 有 2026 年 11 月 10 日 18:00–20:00（Doha）的 Oliver Wyman 活动。公开接口也返回同一活动。历史记录保留，并由[更正说明](../empty-source-followup-2026-10-21/ERRATA-2026-10-22.md)标明被取代的结论。

## 验证

离线测试、完整来源配置检查、42 个当前采集契约的定向刷新及 12 项实际 API 断言见 [validation.json](validation.json)。[活动导入截图](evidence/app-consulting-detail.jpg)、[重复合并与夏令时显示](evidence/app-bba-deduplicated-dst.jpg)、[受限原因与下一步](evidence/app-source-next-steps.jpg)可直接检查。

## 逐来源原因和下一步

完整检查 URL、限制、运行状态与截图哈希见 [review.json](review.json)。登录、订阅及主办方确认不会由本轮自动执行。

| 来源 | ID | 判定 | 原因 | 下一步 | 证据 |
| --- | --- | --- | --- | --- | --- |
| Carnegie Mellon Racquetball Club | `04b93bc6b736` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-04b93bc6b736-events-route.jpg) |
| Muslim Student Association | `0810e0d905cd` | 已找到公开活动 | Original Google calendar denies permission and anonymous ICS404, but official website offers its own public recurrence/calendar generator. | 已接入公开入口并完成定向刷新；继续按配置定期更新。参与资格、私有地点及日历覆盖限制以原公告和下列说明为准。 | [截图](evidence/dates-0810e0d905cd-jummah.jpg) |
| French Club | `0aa328464c5e` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-0aa328464c5e-public-events-complete.jpg) |
| Class of 2029 | `0c925198852d` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-0c925198852d-public-events-complete.jpg) |
| Carnegie Mellon University | `0fceb4066385` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-0fceb4066385-original-ics-identity.jpg) |
| OpenCMUQ Collective | `1116d82179ee` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-1116d82179ee-public-events-complete.jpg) |
| Sigma Alpha Epsilon | `112e7e479fd7` | 当前公开列表为零 | 外部旧域名失效不影响已核实CG公共零活动范围。 | 保留当前公共CG为权威；若要会员日程，请组织更新官方目录网站。 | [截图](evidence/aw-112e7e479fd7.jpg) |
| Traders at Carnegie Mellon | `11e4692b9472` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-11e4692b9472-events-route.jpg) |
| Carnegie Mellon Young Americans for Liberty | `184e85bf058a` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-184e85bf058a-events-route.jpg) |
| Big Straw Magazine | `18af0b77ad14` | 当前公开列表为零 | 旧HTTP访问失败已通过HTTPS官网解决；没有发现新的带日期活动。 | 目录网站改用HTTPS www；日后按contest正文日期判断，勿把NOW OPEN或文章发布时间当活动。 | [截图](evidence/aw-18af0b77ad14.jpg) |
| Carnegie Mellon Finance Society (CMFS) | `19248fc9767e` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-19248fc9767e-public-events-complete.jpg) |
| Student Majlis Executive Team | `1d28398c08fe` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-1d28398c08fe-public-events-complete.jpg) |
| Lambda Phi Epsilon | `201cdd38f271` | 当前公开列表为零 | 目录cmulamdbas拼写错误；公共活动范围可由CG明确零活动确认。 | 组织把网站拼写改为cmulambdas.com；有公开日期海报时重新审核。 | [截图](evidence/aw-201cdd38f271.jpg) |
| CMU Mumon Karate | `20b74dde90d1` | 当前公开列表为零 | 未找到可消除年份歧义的当前CMU Mumon日期公告；另一个cmu.ska.org为不同Shotokan组织，不能混同。 | 如需会员练习时间，请Mumon组织确认该表适用年份和学期。 | [截图](evidence/aw-20b74dde90d1.jpg) |
| Sigma Phi Epsilon | `21b5b696104a` | 当前公开列表为零 | 原sigepcmu.org失效不影响CG公共列表零活动证据。 | 组织更新目录官网；不把全国项目介绍直接归为当前CMU活动。 | [截图](evidence/aw-21b5b696104a.jpg) |
| CMU Sailing Club | `2dc6925349de` | 当前公开列表为零 | 已确认的公共零活动与成员Slack私有消息范围分开。 | 继续抓取CG公开活动；如需成员Slack日程由组织提供公开导出链接。 | [截图](evidence/aw-2dc6925349de.jpg) |
| Tepper Ventures | `2e5dd8baa8e1` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-2e5dd8baa8e1-events-route.jpg) |
| Carnegie Involvement Association | `2ea5cb566752` | 需要成员访问 | Publisher has not made the advertised Google calendar anonymously readable; alternate group event routes require authentication. | Organizer can publish a read-only Google calendar/ICS or public dated announcements; if permission changes, poll cia@andrew.cmu.edu/public/basic.ics. Authorized member access is an alternative external action, not performed. | [截图](evidence/dates-2ea5cb566752-advertised-calendar.jpg) |
| Women's Water Polo | `32353626ec57` | 当前公开列表为零 | No dated public upcoming record appears in actual events/news/resources views; badge alone cannot establish date or eligibility. | Keep polling public Events selector. No external action needed for current public-view conclusion; do not equate it with overall inactivity or claim badge is certainly historical. | [截图](evidence/dates-32353626ec57.jpg) |
| Puzzlehunt CMU | `354e85f1c77b` | 尚未公布准确日期 | Publisher has not assigned a date; registration/login does not supply a public scheduled occurrence. | Poll /hunt/current/info/ title/date area and /updates/; create event only after publisher supplies date. No login or organizer outreach required to represent present TBD accurately. | [截图](evidence/dates-354e85f1c77b.jpg) |
| Carnegie Mellon Moon Miners | `3f1483d3d17a` | 尚未公布准确日期 | Dates are intentionally only month/year, so they cannot ground exact day-level events. | Monitor homepage Operational Milestones and /updates/ for day/time publication; retain month-level plans as undated announcement metadata if supported. No login/subscription needed for these public pages. | [截图](evidence/dates-3f1483d3d17a.jpg) |
| Class of 2027 | `42c864cad300` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-42c864cad300-public-events-complete.jpg) |
| Class of 2030 | `4898714e3ede` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-4898714e3ede-public-events-complete.jpg) |
| EcoCampus | `48e5e88860d3` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-48e5e88860d3-public-events-complete.jpg) |
| Phi Delta Theta | `490d347fbe2e` | 当前公开列表为零 | 旧phideltcmu.org TLS故障已有大学目录提供的现存替代。 | 将目录官网更新为https://cmu.phideltatheta.org/。 | [截图](evidence/aw-490d347fbe2e.jpg) |
| Sustainable Earth | `4c0cf9d91106` | 需要主办方确认 | Dates and freshness are verified; remaining gap is organizer/recipient confirmation and intended audience of an unaccepted invitation on an archive-labelled calendar. | SE or Sustainability Studio should confirm these meetings remain in effect, intended attendees and location, or publish the current accepted public calendar. Keep these as review candidates until that confirmation, rather than importing as open SE events. | [截图](evidence/dates-4c0cf9d91106.jpg) |
| College Democrats | `4d9cc97bf058` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-4d9cc97bf058-events-route.jpg) |
| Iota Phi Theta Fraternity, Inc. | `57f076785638` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-57f076785638-events-route.jpg) |
| Lean On Me at CMU | `5a83fcb01175` | 当前公开列表为零 | 旧lean0n.me证书故障与CG公共零活动分开。 | 由组织修复旧站证书或提供新的匿名公告页。 | [截图](evidence/aw-5a83fcb01175.jpg) |
| ReFlexion | `5c05f7553108` | 尚未公布准确日期 | The public site publishes general recruitment information, not a current occurrence schedule. | Poll official homepage and /faq for dated audition announcements; do not expand generic rehearsal frequency. No external action needed for accurate present no-dated-announcement state. | [截图](evidence/dates-5c05f7553108.jpg) |
| Central Church Student Fellowship | `5cb99c6abe2b` | 需要主办方确认 | Exact year, intended fellowship audience and event times are not explicitly corroborated publicly; related church announcement cannot be assigned to student club without evidence. | Publisher should date its weekly announcement/bulletin or confirm year and student-fellowship relevance; monitor /announcements and its public sermon/bulletin channels for explicit edition date. No registration/contact performed. | [截图](evidence/dates-5cb99c6abe2b-announcements.jpg) |
| CMU Summit on US-China Innovation and Entrepreneurship | `5d51e7e650da` | 当前公开列表为零 | 公共范围CG零活动已确认，当前US-China Summit外部年度日程未核实。 | 由组织更新现存中美创新创业峰会官网。 | [截图](evidence/aw-5d51e7e650da.jpg) |
| Lemon | `5f8a00ca2d30` | 当前公开列表为零 | Cargo成员站受限与已确认公开CG零活动范围分开。 | 组织如需公开Cargo内容，可另发匿名活动公告。 | [截图](evidence/aw-5f8a00ca2d30.jpg) |
| Central Church of Pittsburgh Korean Ministry | `60af213aa3a3` | 当前公开列表为零 | 公开CG范围已确认；韩语团契外网故障与关联英语教会公告分开。 | 如需韩语团契日程，请组织给带年份的匿名公告；可把英语会众官网仅作相关链接。 | [截图](evidence/aw-60af213aa3a3.jpg) |
| MSBA Programs SLC | `60e7784409c9` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-60e7784409c9-events-route.jpg) |
| Alpha Chi Omega | `6147e6a18b94` | 需要主办方确认 | 公共活动页面未发布，不能以无可抓记录推断未来0，也无需要求用户先注册。 | 请组织恢复CG公开活动列表，或提供匿名ICS/带年份的公开活动公告。 | [截图](evidence/aw-6147e6a18b94.jpg) |
| One For the World | `640cd6c2b613` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-640cd6c2b613-events-route.jpg) |
| Gender Minorities and Women in Physics | `652be20f0f06` | 需要主办方确认 | 这不是验证为0的列表，也不是必须登录才能判断的活动日期；公开日程本身未发布。 | 请组织发布公开活动页或匿名日历，不依赖新账号登录。 | [截图](evidence/aw-652be20f0f06.jpg) |
| Game Dev Club (GDC) | `677602880a9d` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-677602880a9d-public-events-complete.jpg) |
| The Frame | `67f8a784cfa2` | 当前公开列表为零 | 旧theframecmu.com域名失效与已确认CG公共零活动范围分开。 | 继续CG监测；组织如将展览只发Instagram，提供独立公开海报或日历便于持续采集。 | [截图](evidence/aw-67f8a784cfa2.jpg) |
| Lunar Gala | `68eeb6ffb846` | 需要主办方确认 | Year and venue verified; performance day/time remain unpublished.2026archive/social link does not establish2027show timing. | Monitor official /info.html and2027 ticket announcement. Publisher must provide exact performance day and clock before a precise event is imported; retain weekend-level announcement meanwhile. | [截图](evidence/dates-68eeb6ffb846.jpg) |
| Home Page | `69aec3cbe07c` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-69aec3cbe07c-original-ics-identity.jpg) |
| Magic@CMU | `6ce794912c38` | 尚未公布准确日期 | A general usual schedule cannot determine an actual dated occurrence or alternating-week phase. | Poll public group Events/News and import only newly dated announcements; an authorized member/organizer can separately provide the dated Discord schedule or public ICS. No guessed expansion. | [截图](evidence/dates-6ce794912c38.jpg) |
| Knits & Knots Club | `715aff642a67` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-715aff642a67-public-events-complete.jpg) |
| Pi Tau Sigma | `74930628add2` | 尚未公布准确日期 | An unyear-labelled static month/day and explicitTBD cannot establish a current-window event. | Poll public Home/Events/News for a dated update. Do not roll September20 to next year or create initiation date from fall label; organizer publication may resolve it later. | [截图](evidence/dates-74930628add2.jpg) |
| Emerging Leaders | `74ef2bc806ae` | 需要成员访问 | Current program year context does not explicitly date the separate session; the authoritative registration detail is private. | An authorized member may provide event1937691 date/year/location, or CELD can add year to public session card. Keep public candidate month/day/time without guessing2026 and do not create account. | [截图](evidence/dates-74ef2bc806ae-official.jpg) |
| Japanese Mahjong Club | `7733ce4b21c3` | 尚未公布准确日期 | Missing current-term bounds, occurrence dates and clocks; unvisited Discord announcements cannot be inferred. | Poll official club Events/News for dated notices. If course sessions are desired, independently use official current course schedule and preserve enrollment audience; do not treat them automatically as open club events. | [截图](evidence/dates-7733ce4b21c3.jpg) |
| Computer Club | `781e677f1865` | 上游技术故障 | Remote organization calendar is unavailable, so its actual current schedule cannot be fetched; this is not proof of no activity and not a local parser failure. | Retry the official calendar when server recovers or have organizer publish a working read-only feed. Optional dedicated-mailbox subscription to announced members list requires separate user-authorized setup; no message/subscription performed. | [截图](evidence/dates-781e677f1865-503.jpg) |
| Jewish Business Association | `7c4d4271232a` | 需要成员访问 | 不能把需认证的成员范围当公开零活动，也不创建新账号。 | 请JBA提供匿名ICS或公开活动公告；已有TartanConnect成员可自行查看成员日程。 | [截图](evidence/aw-7c4d4271232a.jpg) |
| CMUQ Football Club | `7cdbbe1e7028` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-7cdbbe1e7028-public-events-complete.jpg) |
| Club Baseball | `83b2c5a21426` | 需要主办方确认 | Opponent and season/week confirmed, but exact individual game day/clock/venue are unpublished. | Organizer/NCBA should complete per-game Day/Time/Field fields or publish dated game poster. Poll current season schedule and each game-stats URL; do not turn week range into all-day or weeklong occurrence. | [截图](evidence/dates-83b2c5a21426-ncba-weeks.jpg) |
| Carnegie Industrials Club | `866cd105a000` | 需要主办方确认 | 组织身份可确认，但公开日程未发布，不是未来活动为0的证据。 | 请组织发布公开日程/匿名ICS，或明确本学期无公开活动。 | [截图](evidence/aw-866cd105a000.jpg) |
| CMU Bhangra | `89930c55ca6c` | 当前公开列表为零 | 新的公开Linktree已替代无法访问的独立旧域名；不把培训视频日期/队伍年份当未来活动。 | 目录改为维护中的官方Linktree；有日期海报时单独复核。 | [截图](evidence/aw-89930c55ca6c.jpg) |
| CMU-Q Undergraduate Journal Club (CUJC) | `8f4e483a1437` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-8f4e483a1437-public-events-complete.jpg) |
| BRICK | `8f8b52740902` | 需要主办方确认 | 组织公开日程未发布，不可从无导入记录推断无活动。 | 请BRICK组织提供匿名活动页/ICS，或恢复TartanConnect公开网站。 | [截图](evidence/aw-8f8b52740902.jpg) |
| International Business & Advisory Club | `931fac9f758c` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-931fac9f758c-original-ics-identity.jpg) |
| Anime Club | `96d9c569ccf5` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-96d9c569ccf5-public-events-complete.jpg) |
| Cricket Club | `9a2420282e05` | 当前公开列表为零 | 原 ID 有当前官方导出身份依据，匿名公共分组 API 返回有效空数组；公开目录说明及可访问组织网页未提供当前有日期活动，不能据此推断组织所有活动。 | 继续保留原 ID 并正常刷新匿名公开列表；成员区访问、网站恢复和别名维护均按可选事项单列。 | [截图](evidence/pd-9a2420282e05-original-ics-identity.jpg) |
| Carnegie Mellon University Poker Club | `9f7bff4dc6be` | 已找到公开活动 | Original transient browser failure resolved; homepage is a public structured schedule with year evidence and stable selectors. | 已接入公开入口并完成定向刷新；继续按配置定期更新。参与资格、私有地点及日历覆盖限制以原公告和下列说明为准。 | [截图](evidence/dates-9f7bff4dc6be.jpg) |
| Carnegie Consulting | `a2014c54892f` | 已找到公开活动 | 原 ICS / 快速筛选零记录漏覆盖，当前公开页面有带日期与时间的活动。 | 已接入公开入口并完成定向刷新；继续按配置定期更新。参与资格、私有地点及日历覆盖限制以原公告和下列说明为准。 | [截图](evidence/pd-a2014c54892f-public-events-complete.jpg) |
| Center for Leadership Studies | `a47678f5270e` | 尚未公布准确日期 | Official site currently announces programs/series without occurrence dates; no unpublished date can be inferred from course structure or grant year. | Poll CharacterInitiative CommunityConnection section and seminar page for actual date publication; represent six-event series as undated announcement if supported. No login needed for current public pages. | [截图](evidence/dates-a47678f5270e.jpg) |
| cmuTV | `aca85c42ee33` | 当前公开列表为零 | 公共CG范围已确认；媒体发布渠道受限不改变该范围。 | 组织可把活动同时发布CG或匿名日历；旧cmutv.org需重新配置域名。 | [截图](evidence/aw-aca85c42ee33.jpg) |
| Carnegie Strategy Group | `ad58641d0fad` | 尚未公布准确日期 | Public information is a recruitment/program description, without dated occurrence announcement. | Poll homepage/about#growth for dates; dedicated-mailbox list subscription is optional only if user later wants internal announcements, not necessary for representing current public absence of dates. | [截图](evidence/dates-ad58641d0fad-growth.jpg) |
| MBA Part-Time | `ad839d3b1fe8` | 需要成员访问 | Private PTGBA sponsored programs intentionally require sign-in. Current school academic information is publicly available, so the old PDF is not the only resource; however academic deadlines, no-class days and required class kickoffs must not be relabeled as open association events. | Continue anonymous public event checks; preserve the current academic PDF as a related program resource. Access private PTGBA programs only with separate eligible-user authorization or ask the publisher to expose a sanitized public activity announcement. | [截图](evidence/dates-ad839d3b1fe8-calendar.jpg) |
| Carnegie Math Club | `af81054dbc6e` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-af81054dbc6e-public-events-complete.jpg) |
| Women in Business | `afc8d82bc81d` | 已找到公开活动 | 旧独立域名失败与成员入口限制已有可持续匿名日历替代。 | 已接入公开入口并完成定向刷新；继续按配置定期更新。参与资格、私有地点及日历覆盖限制以原公告和下列说明为准。 | [截图](evidence/aw-afc8d82bc81d.jpg) |
| BAPS Campus Fellowship (BCF) | `b456cf80a90f` | 需要主办方确认 | 组织身份和旧活动可确认，当前公开未来日程未提供。 | 请本校BCF发布2026公告/匿名日历或恢复公开CG页面。 | [截图](evidence/aw-b456cf80a90f.jpg) |
| Hillel Jewish Students Association | `b5bc94e14a0c` | 上游技术故障 | Publisher’s advertised public event hub is a broken URL, not an empty schedule. New official CMU Linktree corroborates that this remains its event route. | Hillel JUC should provide a working public Hub landing or read-only calendar feed; update the collector once a verified target exists. Optional newsletter setup can supply announcements with separate user authorization. Do not import unrelated Pitt events. | [截图](evidence/dates-b5bc94e14a0c-cmu-links.jpg) |
| Alpha Phi | `b703a2672078` | 当前公开列表为零 | The old chapter domain is not a required public event source; the current public event list is verifiable. | Replace the outdated directory website with the current CMU Panhellenic chapter page; retain the public event list. | [截图](evidence/aw-b703a2672078.jpg) |
| Tepper Impact Investing Club | `b839ca411e45` | 需要主办方确认 | Official identity is corroborated, but recognition/approval is not a dated activity announcement. | Ask the organizer to publish the organization page or provide an anonymous calendar/event page. | [截图](evidence/aw-b839ca411e45.jpg) |
| CMUQ Library | `c1587a0b2819` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-c1587a0b2819-public-events-complete.jpg) |
| Smart Woman Securities | `c200c0afa9b2` | 当前公开列表为零 | The external chapter website has a certificate failure, but the public organization list is verifiable; the cohost dates do not establish future events. | Retain verified public zero; organizer should repair the chapter website certificate. | [截图](evidence/aw-c200c0afa9b2.jpg) |
| Asian Students Association | `c2182773b42e` | 当前公开列表为零 | Public event scope is verifiable. The old standalone website connection failure and optional mailing list do not invalidate that result. | Update the directory website to https://linktr.ee/cmuasa; use a controlled mailbox only if organizers approve a future subscription workflow. | [截图](evidence/aw-c2182773b42e.jpg) |
| Delta Gamma | `c34d7669aa5c` | 当前公开列表为零 | The alternative university chapter page works, but its external website has DNS failure. Public event coverage is verifiable. | Use the working Panhellenic chapter page as the organization website; ask chapter officers to update its broken outbound link. | [截图](evidence/aw-c34d7669aa5c.jpg) |
| The Carnegie Innovation Club (CIC) | `c40f01fed271` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-c40f01fed271-public-events-complete.jpg) |
| Association of Information System (AIS) | `c6da39f30954` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-c6da39f30954-public-events-complete.jpg) |
| Alpha Sigma Phi | `c8516c9d3a40` | 当前公开列表为零 | Current official chapter identity and public event zero are verified; the old cmualphasig.com site is not required for public coverage. | Replace the outdated external website with the current IFC chapter page. | [截图](evidence/aw-c8516c9d3a40.jpg) |
| The BioSci Club | `ca9e9e551f58` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-ca9e9e551f58-public-events-complete.jpg) |
| Nexus of Community Engagement | `caabdfa76cb4` | 需要邮件订阅 | The advertised current-opportunity delivery channel is a membership newsletter rather than an anonymous dated page or feed. | With separate user authorization, an eligible organization account/mailbox can join Nexus and receive the newsletter, or organizer can provide public archive/forwarding access. A generic public mailbox is not guaranteed eligible for a CMU-restricted group. No login/subscription/message performed. | [截图](evidence/dates-caabdfa76cb4-login.jpg) |
| Medical Visions | `cc5e1c0f8bf9` | 需要成员访问 | The public officer list verifies organization identity but does not establish public future-event zero. | Ask the organizer for an anonymous event page or published calendar feed. | [截图](evidence/aw-cc5e1c0f8bf9.jpg) |
| Recreational Volleyball Club | `cdcc38cd97e9` | 当前公开列表为零 | The optional Discord community is not an anonymous event feed; no join or app-opening action was taken. | Keep verified public event zero. Organizer may publish a public practice calendar or republish member-channel announcements. | [截图](evidence/aw-cdcc38cd97e9.jpg) |
| Taiwanese Students Association | `cfaa71977875` | 尚未公布准确日期 | Anonymous alternatives exist but show past or incomplete date announcements; inaccessible member events cannot be labelled empty. | Ask the organizer for an anonymous current calendar or dated event posters; a shared mailbox could receive the optional mailing list only after subscription authorization. | [截图](evidence/aw-cfaa71977875.jpg) |
| Sikh Student Organization | `d1b8754df0d7` | 需要主办方确认 | Current official recognition corroborates identity; it does not expose an anonymous event calendar. | Ask the organizer to publish the page or provide an anonymous dated event/calendar endpoint. | [截图](evidence/aw-d1b8754df0d7.jpg) |
| The Music Club | `d32ab184e057` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-d32ab184e057-public-events-complete.jpg) |
| Black Business Association Club | `d59c139e665b` | 已找到公开活动 | Actual event public page resolves previously undated-homepage limitation. Only location and preciseRSVPcutoff discrepancy remain specific optional field limits. | 已接入公开入口并完成定向刷新；继续按配置定期更新。参与资格、私有地点及日历覆盖限制以原公告和下列说明为准。 | [截图](evidence/dates-d59c139e665b.jpg) |
| Undergraduate Student Senate | `d5a270fc4ae8` | 已找到公开活动 | Anonymous event page and root anonymousAPI now supply a dated event; private venue does not make the whole event private. | 已接入公开入口并完成定向刷新；继续按配置定期更新。参与资格、私有地点及日历覆盖限制以原公告和下列说明为准。 | [截图](evidence/dates-d5a270fc4ae8.jpg) |
| TEDxCMU | `d62d08f7df9d` | 需要主办方确认 | Three publisher-controlled sources disagree on workshop time; two locations appear. No reliable precedence/update timestamp resolves it. | 已按 2026-09-27 仅日期精度导入；时分和地点仍需主办方澄清。2027 主会日期未公布，继续监测。 | [截图](evidence/dates-d62d08f7df9d-events.jpg) |
| Arts & Crafts Club | `d7858a5f2b71` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-d7858a5f2b71-public-events-complete.jpg) |
| Tepper MS Programs | `dbb1f1d15b97` | 需要主办方确认 | A school-wide or admissions calendar would have a different scope and cannot establish this organization’s events. | Program staff should publish the MS Programs organization page or supply an anonymous student-program calendar. | [截图](evidence/aw-dbb1f1d15b97.jpg) |
| Tepper MBA Robber Barons | `df9d9882f8d0` | 需要主办方确认 | Historical publication records cannot establish current event availability. | Ask the organizer or Tepper student services to publish current dated announcements or a public feed. | [截图](evidence/aw-df9d9882f8d0.jpg) |
| CMU Cyphers | `e00367a5854a` | 上游技术故障 | Publisher widget does not render a usable public calendar. This is not evidence of zero events; the earlier empty-src explanation was too narrow because a Wix widget URL is now present. | Publisher should repair the Calendar widget or advertise its public Google Calendar ID/ICS. Then collect that anonymous endpoint; alternatively supply a dated public announcement. Do not expand undated course descriptions. | [截图](evidence/dates-e00367a5854a-calendar.jpg) |
| Class of 2028 | `e4079298b407` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-e4079298b407-public-events-complete.jpg) |
| Spanish And Latin Student Association | `e9767638c7f0` | 需要主办方确认 | HLAA recurring dates and CMU identity are confirmed, but receipt of an unanswered calendar invitation does not establish SALSA hosting or public access. Fence-painting poster and linked form disagree; form lacks year and contains a weekday/date mismatch if interpreted as2026. Original Instagram post detail requires login and CDN image URL is temporary. Neither item is confirmed empty. | For HLAA, organizer should confirm intended attendees and whether the monthly meeting is public; preserve only sanitized review-candidate metadata, not meeting credentials. For Fence Painting, organizer should confirm year, exact night and final guarding/painting date, and publish a stable anonymous announcement/image. Do not add expiring CDN URLs as refresh sources, submit forms, or join groups. | [截图](evidence/dates-e9767638c7f0-calendar.jpg) |
| Alpha Epsilon Pi | `f3397a335a38` | 当前公开列表为零 | A current official alternative exists, but its dated poster does not establish future events. | Use the current IFC AEPi page instead of the old aepi.rocks host; retain verified public zero. | [截图](evidence/aw-f3397a335a38.jpg) |
| Alpha Kappa Alpha Sorority Inc. | `f439516839ca` | 当前公开列表为零 | The catalog national .org website is not a chapter calendar; a current chapter-specific official channel exists. | Use the official Alpha Sigma chapter profile/Linktree for organization updates; retain verified public event zero. | [截图](evidence/aw-f439516839ca.jpg) |
| Interfaith Leadership Development | `f5d9d68e0b15` | 需要主办方确认 | An anonymous official description exists, but the program-specific dated choices are housed in TartanConnect. Related RSL events have a broader scope. | Ask RSL staff to expose scheduled ILD choices anonymously if they want those aggregated; keep the self-paced program as a resource, not invented recurring events. | [截图](evidence/aw-f5d9d68e0b15.jpg) |
| Turning Point USA | `f6d1358deaf2` | 需要主办方确认 | Same-name TPUSA CMU results involving Rowdy belong to Colorado Mesa and must not be merged with Carnegie Mellon. | Ask the chapter organizer to publish a current public event page or anonymous calendar; do not infer inactivity from the unpublished page. | [截图](evidence/aw-f6d1358deaf2.jpg) |
| Awareness of Roots in Chinese Culture | `fa7813907900` | 需要成员访问 | Current event title is public; exact event date/time/venue are only known from an account-restricted form and were not independently verified as public in this pass. Existing authenticated-browser visibility must not be treated as anonymous access. | Organizer can publish the Hot Pot date/time/venue on Carrd, Wix or a public poster, or make the existing announcement form anonymously readable. An authorized member may separately supply a sanitized dated announcement; no login or registration was attempted. | [截图](evidence/dates-fa7813907900-public-links.jpg) |
| MSBA Community | `fa960d8d6a7e` | 需要主办方确认 | Admissions, academic dates, and university-wide events cannot be reassigned to the MSBA Community organization. | MSBA program staff should publish a community-specific event page or anonymous calendar. | [截图](evidence/aw-fa960d8d6a7e.jpg) |
| Shamunity | `fd5e37c9252e` | 当前公开列表为零 | 当前公开未来分组列表实证 0，目录未另给具体未来活动日程；可选成员限制不应保留整个来源待核实旗标。 | 继续正常刷新公开日历；成员区仅作为可选访问步骤单列。 | [截图](evidence/pd-fd5e37c9252e-public-events-complete.jpg) |
| Music Production Club | `fd60b328fbfd` | 当前公开列表为零 | Public event zero is verified. Discord invite failure is more specific than the previous assumption of a readable private community and does not prove organization inactivity. | Retain verified public zero; ask organizers to replace the invalid invitation and optionally publish an anonymous calendar. | [截图](evidence/aw-fd60b328fbfd.jpg) |
| Carnegie Mellon University Figure Skating Club | `fdbf6dfd7227` | 当前公开列表为零 | Anonymous public upcoming scope is verified zero. Counts do not establish that two future events were omitted or that the organization is inactive. | Continue refreshing the anonymous public CampusGroups API and pages; import newly published dated public entries. Optional member-only updates require separate authorized access and are outside this verified public-zero claim. | [截图](evidence/dates-fdbf6dfd7227.jpg) |
| The Treblemakers | `feb8aa56fd07` | 当前公开列表为零 | The earlier HTTP/www failure does not mean the website is unavailable. No future dated announcement was found on the inspected current public channels. | Update the directory website to https://cmutreblemakers.com/ and keep the verified public event zero. | [截图](evidence/aw-feb8aa56fd07.jpg) |
| Pittsburgh Go Association | `ff39febcec5f` | 需要主办方确认 | A current regular meeting resource is confirmed, but no individual dated future meeting or explicit final date/exception list is publicly exposed. It must not become an unbounded automatic weekly series. | Ask the organizer for an anonymous dated calendar or a semester start/end and cancellation list; publish the current recurring-meeting resource as a resource until confirmed. | [截图](evidence/dx-ff39febcec5f.jpg) |
| Student College | `ffbc5035e75d` | 当前公开列表为零 | The public event scope is verifiable. Important Dates has a weekday conflict for Thursday December 16 under Fall 2026, so that row must not be silently corrected or imported as an ordinary event. | Keep public event zero and surface official course/administrative resources separately. If supporting deadline listings later, preserve instructor/student audience and have the source owner correct the December 16 conflict. | [截图](evidence/dx-ffbc5035e75d.jpg) |

可用 `node scripts/build-pending-resolution.mjs --require-complete` 重建并核对精确的 105 项队列。
