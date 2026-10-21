# 海报与邮件来源的后续接入方案

海报识别和专用订阅邮箱都可以补充现有抓取器，但需要分别处理版面、订阅资格和信息可见范围。建议先试点 LTI、Socialist Studies、AUO 三个海报来源，再接入一个自有收件箱。

本文是后续实施方案。截至 2026-10-21，尚未接入生产 OCR／视觉模型、注册邮箱、提交订阅、连接收件箱或自动收取邮件。

## 先区分格式问题与数据缺失

本次复核的 19 个不支持来源中，三个明确将活动信息放在海报内，CAUSE 还有部分图文混排问题。这些适合增加识别能力。其他来源需要不同处理：

| 来源情况 | 可行的下一步 |
| --- | --- |
| LTI、Socialist Studies、AUO 图片日程 | 读取原始图片或 PDF，生成带证据的活动草稿并审核 |
| CAUSE 图文混排 | 先划分正文中的活动段落，再识别剩余海报，区分接待与报告时间 |
| Alumni 动态日历返回应用错误外壳 | 在浏览器中核实实际公开日历及其数据接口；OCR 无法从错误页面恢复活动 |
| 录像归档、无年份模板、未限定月份的周期活动 | 寻找准确日期的公告、订阅或主办方日历；不使用视频上传日、页脚年份补齐日期 |
| DSSC 页面年份互相冲突 | 寻找权威公告或请发布方澄清，保留冲突状态 |
| SCS 系列目录、CTP 按需预约项目 | 分别作为来源发现、可预约项目处理；只有具体排期才进入活动表 |

## 海报试点与读取流程

下面是已经人工核对的样例，尚未通过新增的海报管线写入活动库。

| 来源 | 海报中可读的信息 | 解析时需要保留的区别 |
| --- | --- | --- |
| [LTI Colloquium](https://www.lti.cs.cmu.edu/misc-pages/lti-colloquium.html) | Sewon Min，2026-10-23，NSH 4305；社交 15:00–15:30，报告 15:30–17:00 | 年份来自对应的 Fall 2026 页面上下文；按同一行配对日期与讲者，不把社交时段当报告，也不在社交专场生成报告 |
| [Socialist Studies](https://www.cmu.edu/dietrich/history/centers-seminars/socialist-studies-page.html) | Stephen Brockmann，2026-09-18，15:00–16:30，Baker/Porter Hall 246A | 这是一场已过去的活动；页面中的一个 `img` 地址实际指向 PDF，应先检查文本层 |
| [AUO Concerts](https://www.alluniversityorchestra.org/concerts) | DARK WATERS，2026-11-15，16:30，Carnegie Music Hall，免费入场 | 曲目与作曲家不是多场活动；海报未写结束时间，不能补一个默认时长 |

实施可分为四步：

1. **发现与版本记录。** 沿原页面获取图片／PDF，按实际 MIME 类型处理，保存来源页、资源 URL、关联学期标题和内容 SHA-256。同一 URL 的图片可能被覆盖，因此更新判断应比较文件内容，不能只比较 HTML。
2. **先读已有文本，再做识别。** 优先使用公开订阅、结构化事件、PDF 文本层和有意义的 `alt`。图片才进入可选的独立 OCR worker。保留文字坐标，按行、栏和页脚区域提取；整页 OCR 文本不足以保证日期和讲者配对正确。[Tesseract 官方文档](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)也明确指出，表格需要额外的分区／版面分析。
3. **生成候选记录。** OCR 结果不稳定时，可用可配置的视觉模型读取原图与区域，输出受 JSON Schema 约束的字段。候选至少包括标题、讲者、活动类型、起止时间、时区、地点，以及每个关键字段对应的原文／图像区域。缺失字段保持空值。[Cloud Vision OCR](https://cloud.google.com/vision/docs/ocr)提供文字框和文档层级；[Gemini 图片输入](https://ai.google.dev/gemini-api/docs/image-understanding)与[结构化输出](https://ai.google.dev/gemini-api/docs/structured-output)是可评估的另一条路径。本项目尚未对这些服务进行效果测试，JSON 格式正确也不等于事实正确。
4. **验证与审核后入库。** 初期所有候选都显示原图供核对；经过真实样本验证的版式才逐步自动接受。新模板、日期冲突和不确定记录继续进入审核队列。

审核应重点检查：年份是否出现在海报或对应标题中；日期与星期是否一致；讲者与日期是否属于同一行；社交、报告、截止日是否被混淆；时区和结束时间是否有依据。不能用模型自报的置信度代替这些检查。

保存已接受记录及其资源哈希、解析版本和审核修改。图片更新时重新处理并与现有网页／ICS 活动去重，保留全部来源归属；部分识别失败时保留上一份已接受数据，不据此删除活动。

## 专用地址可以订阅，收件箱应保持私有

可以公开一个服务订阅地址，让它接收活动通知，再由后台读取。公开地址不等于公开邮箱内容。当前四个 Mailman 页面及其匿名归档入口已核对，归档均要求成员身份：

| 列表 | 页面明确显示的加入步骤 | 限制 |
| --- | --- | --- |
| [Environmental Humanities Research Seminar](https://list.pitt.edu/mailman/listinfo/environmental_humanities_research_seminar) | 邮箱确认后等待管理员批准 | 能提交邮箱地址不代表一定获准加入 |
| [Theory Announce](https://mailman.srv.cs.cmu.edu/mailman/listinfo/theory-announce) | 验证码、邮箱确认、管理员批准 | 明确标注为 Internal CMU mailing list，不能假设普通 Gmail 地址适用 |
| [ML/AI Seminar](https://mailman.srv.cs.cmu.edu/mailman/listinfo/ml-ai-seminar) | 验证码、邮箱确认 | 未在页面披露管理员审批步骤；仍未验证服务地址是否会被接受 |
| [S3D Seminar](https://mailman.srv.cs.cmu.edu/mailman/listinfo/s3d-seminar) | 验证码、邮箱确认 | 同上；历史归档仍需成员认证 |

此外，[PDL SDI](https://pdl.cmu.edu/SDI/index.shtml)明确要求使用 `ANDREW.CMU.EDU` 地址订阅，并说明面向在校、在校园内的 CMU 人员。因此，**一个普通 Gmail 地址不能覆盖所有列表**。每个列表都需要先确认资格并完成其实际加入流程。加入后能收到未来邮件，也不代表会自动收到此前的历史邮件。

## 本地收件管线

本地应用适合先使用 Gmail API 的 `gmail.readonly` 权限，后台运行时每 5 分钟做一次增量检查。这是建议的检查间隔，不是实时性保证。`gmail.metadata` 无法读取正文；Gmail 的 IMAP OAuth 通常要求范围更大的 `mail.google.com` 权限，所以只读接入优先选择 API。[权限说明](https://developers.google.com/workspace/gmail/api/auth/scopes)、[IMAP OAuth 说明](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol)。

处理顺序：

1. 首次用 `messages.list` 和 `messages.get(full/raw)` 读取所需消息，之后保存 `historyId` 做增量同步。历史游标失效返回 404 时执行有界重同步；同一封邮件按 Gmail message ID、`Message-ID` 去重。[官方同步流程](https://developers.google.com/workspace/gmail/api/guides/sync)
2. 依据实际收到的 `List-Id` 等头字段建立来源白名单，递归解析 MIME。ICS 附件复用现有解析器，并在收件层补充 `UID`／`SEQUENCE` 版本管理；HTML／纯文本按通知段落解析；PDF 与 CID 内嵌海报复用上述文件处理管线。[消息结构](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)、[附件读取接口](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get)
3. 保留附件哈希和字段证据。发信时间是消息元数据，不能直接当活动日期；缺少年份、无法解析的相对日期和含糊的更正通知进入审核。公开网页与邮件里的同一活动合并来源；取消、改期应修改对应场次，不能仅新增一条同名活动。
4. 排除确认、密码提醒、退订等管理邮件；抓取时不访问退订链接，也不提交报名表单。

OAuth 刷新令牌放在仓库之外的受保护存储中，并处理撤销与过期。外部 OAuth 应用处于 Testing 状态时，Gmail 权限对应的刷新令牌通常 7 天过期；长期运行需要合适的发布配置。个人使用、组织内部应用存在验证例外，公开为其他用户连接邮箱时应另行评估，不能一概假设免验证。[令牌有效期](https://developers.google.com/identity/protocols/oauth2)、[验证例外](https://support.google.com/cloud/answer/13464323)。

应用关闭或电脑休眠时无法持续轮询；恢复后可补同步。需要持续及时更新时，再部署常驻服务，考虑 `watch → Cloud Pub/Sub → history.list`。`watch` 至少每 7 天续订，官方建议每天续订；推送可能延迟或丢失，仍需要补同步。[Gmail 推送说明](https://developers.google.com/workspace/gmail/api/guides/push)

## 成员信息与公开活动分开保存

邮件来源应记录列表、原消息、接收时间和可见范围。成员邮件先作为私有候选；只有独立公开页面能支持相应活动信息，或发布方允许预期分享时，才进入公开展示层。不要把 Mailman 密码、个性化退订令牌、非公开会议口令或 Gmail 邮件链接放进公开活动记录。成功加入列表只证明可以接收消息，不证明其全部内容适合公开再发布。

## 控制成本并分阶段交付

先以三个来源的真实海报建立人工标注样例，评估日期、时间、讲者和行配对错误；完成草稿队列后，再接入一个已获准订阅的自有邮箱。模板稳定后逐步自动接受，其他来源仍保留具体限制。

本地 OCR 没有逐图云服务费用，但仍有计算、维护和审核成本。按内容哈希缓存，给页数、重试次数和月用量设上限，可避免每次刷新重复识别同一海报。

截至 2026-10-21，[Cloud Vision 官方价格](https://cloud.google.com/vision/pricing)中 Text／Document Text Detection 每月前 1,000 单位免费，随后至 500 万单位为每 1,000 单位 1.50 美元；每个 PDF 页、每项识别功能分别计量。假设某项目每月仅使用 3,000 单位这项功能，示例费用为 3 美元；这不包含模型调用、存储和主机费用，也不是本项目的流量预测。视觉模型尚未选型，不预设价格或准确率。

Gmail API 的配额规则在 2026 年已有更新，需以实际 Cloud 项目和[当前官方配额页](https://developers.google.com/workspace/gmail/api/reference/quota)核算；配额单位不是美元价格。邮箱、常驻主机和 Pub/Sub 的费用应分别确认。
