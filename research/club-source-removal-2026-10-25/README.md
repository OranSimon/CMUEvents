# 社团直接来源移除与剩余访问问题

已从现行JSON／CSV目录、采集计划、配置和运行库移除 **711** 条学生社团直接来源，保留 **318** 条其他发布来源，当前共 **4382** 条去重活动。

**筛选只发生在来源层面。官方日历、院系、办公室、学生自治及其他保留来源发布的活动均保留，即使主办方是学生社团。** 不再使用任何活动层面的社团过滤；此前受影响的12组转载身份已重新抓取并验证恢复，见[恢复核验](official-reposts-to-verify.json)与[当前状态](remaining-source-status.json)。

## 来源范围

独立学生社团的官网、活动页、Google日历及其自己的订阅源停止追踪。TartanConnect／ScottyConnect全校总日历、院系公开日历、大学办公室及非社团来源继续保留。具体边界见[classification-notes.md](classification-notes.md)，逐项依据见[classification.json](classification.json)。旧目录和研究记录只作历史留档。

## 剩余访问问题

对318个保留来源的 **491** 个配置页面／抓取地址完成新匿名GET；另对 **32** 个重点来源核对私档、内嵌日历和成员入口。HTTP200认证页不等于能读取内容；下表区分完整内容、附加渠道及可用替代日历。

| 来源 | 当前限制 | 下一步 |
| --- | --- | --- |
| [Emerging Leaders](https://tartanconnect.cmu.edu/ical/tepper/ical_club_71334.ics) | 原ICS匿名200且有效但0 VEVENT。官方项目页可达：Spring2027申请将于November2026开放；独立Dec2 12–13 info-session没有明确年份。真实注册链接跳到private_event=1，浏览器明确要求已有账号且不允许公开建号。 | 有权限成员可自行核对event1937691准确年份/地点，或CELD在公开卡片补全；采集器继续公开ICS，不登录、不猜2026。 |
| [Interfaith Leadership Development](https://tartanconnect.cmu.edu/ical/tepper/ical_club_71450.ics) | 原ICS匿名200有效0 VEVENT，官方RSL项目描述可公开读取；ILD/events重定向officer目录，浏览器显示该页面已unpublished。不是连接失败。自定进度badge说明也不是已排期日程。 | 由项目维护者公开program-specific dated choices；保持资源描述，不从自定进度推算周期。父级RSL Friendsgiving属于更广办公室来源，勿误归ILD。 |
| [Pitt-CMU Environmental Humanities Research Seminar](https://list.pitt.edu/mailman/listinfo/environmental_humanities_research_seminar) | Listinfo公开200，明确邮件档案仅成员可看；广告链接/private/本次匿名GET也是200，但内容为Private Archives Authentication邮箱/密码表单。订阅需要邮箱确认及moderator approval。 这是真实内容认证/订阅障碍，不是HTTP无法连接。 | 由用户明确授权的合资格专用邮箱申请订阅，并遵守列表发布/转发边界；或由主办方提供匿名公开档案/日历。未创建邮箱、未填写表单、未登录、未订阅。 |
| [Parallel Data Lab — Systems Design and Implementation Seminar](https://pdl.cmu.edu/SDI/index.html) | 公开index.html有JS跳转，actual index.shtml匿名200并展示历史日程；网页明确SDI面向active,on-campus CMU，要求ANDREW.CMU.EDU地址。订阅站在浏览器可达，写closed list、moderator approval、member-only archive，且要求不要转发seminar信息。Node对该额外订阅站另有TLS链验证失败。 | 继续抓取公开网页；只有有资格并获授权者自行申请邮件订阅。普通公共邮箱不保证合资格；未经主办方允许不把成员邮件公开再发布。可请求主办方公开可聚合日程。 |
| [Theory Lunch and Theory Seminar](https://mailman.srv.cs.cmu.edu/mailman/listinfo/theory-announce) | Listinfo公开200，明确邮件档案仅成员可看；广告链接/private/本次匿名GET也是200，但内容为Private Archives Authentication邮箱/密码表单。订阅需要邮箱确认及moderator approval。 这是真实内容认证/订阅障碍，不是HTTP无法连接。 | 由用户明确授权的合资格专用邮箱申请订阅，并遵守列表发布/转发边界；或由主办方提供匿名公开档案/日历。未创建邮箱、未填写表单、未登录、未订阅。 |
| [ML/AI Seminar Series](https://mailman.srv.cs.cmu.edu/mailman/listinfo/ml-ai-seminar) | Listinfo公开200，明确邮件档案仅成员可看；广告链接/private/本次匿名GET也是200，但内容为Private Archives Authentication邮箱/密码表单。订阅需要邮箱确认，表单另有CAPTCHA；未执行。 这是真实内容认证/订阅障碍，不是HTTP无法连接。 | 由用户明确授权的合资格专用邮箱申请订阅，并遵守列表发布/转发边界；或由主办方提供匿名公开档案/日历。未创建邮箱、未填写表单、未登录、未订阅。 |
| [S3D Departmental Seminars and Calendar](https://mailman.srv.cs.cmu.edu/mailman/listinfo/s3d-seminar) | Listinfo公开200，明确邮件档案仅成员可看；广告链接/private/本次匿名GET也是200，但内容为Private Archives Authentication邮箱/密码表单。订阅需要邮箱确认，表单另有CAPTCHA；未执行。 这是真实内容认证/订阅障碍，不是HTTP无法连接。 | 由用户明确授权的合资格专用邮箱申请订阅，并遵守列表发布/转发边界；或由主办方提供匿名公开档案/日历。未创建邮箱、未填写表单、未登录、未订阅。 |
| [Nexus of Community Engagement](https://tartanconnect.cmu.edu/ical/tepper/ical_club_68569.ics) | 原ICS匿名200有效0 VEVENT。官方Nexus页明确通过加入其TartanConnect组获取weekly newsletter；组入口200后是Login is required，完整浏览器也确认Andrew/guest登录选项。 | 有资格账号获授权后可自行加入并订阅；更稳妥是主办方提供可公开归档/只读日程。普通公共邮箱能否入组未获保证；未登录、订阅或联系主办方。 |
| [Center for the Neural Basis of Cognition Calendar](https://www.cnbc.cmu.edu/cnbc-calendar/) | Node匿名HTTPS请求在证书链验证处失败（UNABLE_TO_VERIFY_LEAF_SIGNATURE）。Chrome直接访问无警告、未绕过；官方页面及Google Calendar完整加载October2026活动。iframe日历ID与已covered公开ICS完全一致；该ICS匿名200有效，不能将整个来源判不可访问。 | 继续用已配置Google ICS采集并保留来源归属；网站维护者应修复完整TLS证书链，采集器不得关闭证书验证。 |

更详细解释见[access-obstacles.md](access-obstacles.md)。全部318项当前状态见[remaining-source-status.json](remaining-source-status.json)，32项深入核实见[access-probes.json](access-probes.json)，全部配置URL见[http-probes.json](http-probes.json)。本轮没有登录、注册邮箱、订阅或联系主办方。

## 可访问但尚未完整解析

**4** 个partial：Humanities Center News and Events、School of Architecture Events、Tepper Research Conferences and Seminars、Center for Informed Democracy and Social-cybersecurity Events。已检查的页面可访问，问题是日期缺失、详情覆盖或分页空结果识别。**15** 个unsupported页面也可打开，属于海报、动态组件、资料目录或日期语义尚未适配，不应解释为访问失败。Alumni公开动态日历已确认三页23条完整日期卡片，无需登录；现有采集器仍待适配。

## 验证

261个可自动采集的保留来源已完成新刷新，见[retained-refresh.json](retained-refresh.json)。测试、API、来源清理、官方转载恢复与最终界面证据见[validation.json](validation.json)。
