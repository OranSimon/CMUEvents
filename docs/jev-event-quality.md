# 用 Jev 改善活动时间识别和跨来源去重

设计与分支试跑 · 调查基线 `c1d7f28`

先验证 Jev 能否从公开内容中选对活动时间，再验证它能否找回标题或描述被改写的转载。两项分别验收。日期不同的场次独立发布，同一场合并后保留全部来源链接和原始版本。首轮生成隔离预览和评估报告，线上数据仍由现有管线生成。

## 功能分支的试跑方式

向 `codex/jev-event-quality` 推送功能变更后，Jev 预览工作流先用两次实际 API 请求核对时间和去重，再复用正常静态构建抓取公开来源。工作流使用 `jev-evaluation` 环境，从日更状态分支只读恢复，上传 `jev-calendar-preview` 和 `jev-preview-reports`。现有 Pages 日更继续使用规则基线。 [预览工作流](../.github/workflows/jev-preview.yml)

构建可分别指定 `--jev-time=off|shadow|apply` 和 `--jev-merge=off|shadow|apply`，默认均为 `off`。`shadow` 记录通过规则复核的提议，`apply` 将提议用于本次构建。预览使用独立 SQLite、输出目录和状态文件。Jev 开启时在 `publication-jev.json` 记录请求数、模型、用量、回退与通过复核的提议；正式合并报告中的 `jev-same-occurrence` 表示实际合组。 [构建入口](../scripts/build-static.mjs)

当前时间判断覆盖独立会议正文、可信海报文本和 PDF 封面。开始与结束是同一请求内的独立 Choice，另有单场范围判断。代码从原文穷举可验证的候选，对两端配对、时区、已确认的范围和其他明确场次进行复核。现有议程表、周期场次、结构化日历和 OCR 矛盾继续按已有规则处理。去重以同一开始值、同等精度、已知结束相容及独立身份佐证筛选，再由 Jev 判断是否是同一场。试跑初始门槛为时间 0.90、去重 0.95，每个功能最多 24 次 API 请求，每次最长 6 秒；这些是用于观察的保守起点。 [时间选择](../src/lib/jev-time.mjs) · [去重](../src/lib/occurrence-merge.mjs) · [调用限额](../src/lib/jev.mjs)

## 现有处理方式

| 环节 | 当前行为 | 适合验证的缺口 |
| --- | --- | --- |
| 日期和时钟 | 日历、结构化字段和页面正文由相应适配器读取。`resolveEventDateRoles` 在会议页面区分主日期、议程、独立场次与辅助日期，检测矛盾。标准化保留 `time`、`date`、`all-day` 的区别，计算来源时区和跨日范围。 [日期角色](../src/lib/date-semantics.mjs) · [会议适配器](../src/adapters/text-schedules.mjs) · [日期范围](../src/lib/published-dates.mjs) · [标准化](../src/lib/normalize.mjs) | 同一段正文里同时写活动、报名和会务日期，段落或标签不足以区分角色。 |
| 海报和 PDF | 优先使用可关联的页面文字、alt 或 PDF 文本层，再用现有 OCR 和版面位置关联日期、标题和场次。识别不清或冲突会留下诊断，缓存按原始字节和提取器版本复用。 [媒体适配器](../src/adapters/automatic-media.mjs) · [OCR](../src/lib/media-ocr.mjs) | OCR 已读到多个日期或时钟，但现有规则无法决定哪一组对应当前活动。 |
| 活动合并 | `rebuildEvents` 先尝试从具有可信身份的来源补齐唯一时钟，再按精确开始值和标题、标题后缀、单场链接或 scoped UID 生成候选。时间精度、完整日期范围和已知结束值必须相容；合组时重新检查所有跨组成员。保留 `sources`、`sourceVariants` 和合并报告。 [事件存储](../src/lib/store.mjs) · [合并逻辑](../src/lib/occurrence-merge.mjs) | 同一时刻的转载可能改写标题，又没有共用详情链接或 UID，因此连候选对都进不了。 |
| 日更与发布 | GitHub Actions 恢复独立状态分支的规范化来源记录，抓取后重建活动，检查来源覆盖、数据质量和活动数量，再生成静态站点。抓取失败保留上一次成功结果。 [日更工作流](../.github/workflows/daily-pages.yml) · [构建入口](../scripts/build-static.mjs) · [发布校验](../src/lib/static-site.mjs) | 状态分支里的规范化记录缺少部分原始歧义上下文。时间评估样本应在提取时采集，合并评估可以复用规范化记录。 |

上游页面无法访问、来源仅通过邮件发布、原文没有时间和系统漏抓需要分别诊断。首轮实验仅处理已经取得公开证据的语义歧义。来源筛选继续针对发布方，官方转载的学生社团活动可进入相同评估流程。 [项目架构](design.md)

## Jev 的能力和边界

TypeSafe 的 `POST /v1/systemone` 接收文本或结构化 `state` 和命名问题。`Choice` 可在给定候选中选择并返回概率分布，适合选取日期片段和判断记录关系。官方日期示例也把日历计算留给程序。首轮采用 OCR 和页面文本，准备调用时核对账户可用模型，优先锁定文档当前列出的 `jev-1.14.0` 并记录响应模型及用量。 [API](https://docs.typesafe.ai/api/system-one) · [模型](https://docs.typesafe.ai/models) · [日期示例](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook) · [候选选取示例](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)

官方实体匹配示例的 57 个建议合并对中，样本数据只标记了 48 对为同一实体。这是专辑数据上的结果，CMU 活动的表现需要独立评估。模型概率用于排序和拒答，由本项目的留出样本决定阈值。 [实体匹配示例](https://docs.typesafe.ai/cookbooks/entity_alignment) · [置信度说明](https://docs.typesafe.ai/confidence)

## 拟实现方案

### 1. 时间角色识别

1. 从会议正文和媒体解析开始。现有规则先提取文本片段、日期及完整范围、时钟范围、段落标题或 OCR 行。为每个候选保留来源 URL、记录身份、字符位置或媒体页码和行号。在原本会丢弃歧义上下文的分支采集候选。日历和无歧义的结构化时间继续直接走现有路径。
2. 对同一活动作用域内存在多个合理候选、且代码无法确定角色的记录，提交裁剪后的上下文。让 Jev 从候选 ID 中选出活动日期和与之关联的时钟，或选择 `none` / `unclear`。把已解析的日期范围或时钟范围作为完整候选，避免独立选出两个无关端点。会议整体日期、议程子场次、报名截止和发布日期分别标注。首轮将明确多场的记录纳入验证，只有各场能凭原文独立定位时才考虑补全。
3. 代码核验 ID 属于原候选、日期与时钟属于同一场、证据与来源结构及已知字段相容，再调用现有标准化和活动资格校验。时区、夏令时、跨日和排他结束边界按项目规则计算。缺少年份且无可信的同活动上下文时保留未解析，只有日期时保留 `date`，明确全天时保留 `all-day`。相对日期必须有明确的来源参考日，首轮优先留作诊断。遇到两个可信来源实质冲突、OCR 未读到关键字段或活动身份不明时，保留冲突或缺失状态。

### 2. 同一场活动的跨来源去重

1. 保留现有链接和 UID 等强匹配。对规则未合并的跨发布者记录，在相容的精确开始值或相同的完整日期范围内，按主讲人、主办方、具体场地、辨识度较高的标题词或正文片段查找少量候选。相同日期只是候选条件，同系列、同主题或同地点各自都不足以合并。日期或开始时刻不同、两个已知结束时刻冲突的场次直接分开；日期补时继续使用现有唯一且有证据的补时规则。
2. 只向 Jev 提交两条候选记录及其公开证据，用 `same_occurrence`、`different_occurrence`、`unclear` 表示关系。可以分别询问主讲人、主办方和议程片段是否指向同一场。预处理记录对并固定顺序，按候选召回率和数量调节筛选，避免全量两两调用。即使模型倾向合并，也必须存在可回查的独立佐证，例如明确的同一主讲人与具体场地，或两边都刊载的特定讲座摘要。证据薄弱或矛盾的记录继续分开。
3. 未来启用时将通过校验的建议交给现有分组机制，由代码检查组间每一对，防止信息不全的中间记录把两场活动串起来。复用现有合并输出，保留原始详情链接、来源页、版本和冲突标记，并在报告中记录模型版本和佐证。保持原始来源快照独立可重建；模型不拆分已有规则确认的合并。

### 3. 调用、隔离和回退

- 首轮单独运行只读评估任务，使用固定样本和相同输入的规则基线。实验分支可用仅匹配该分支的 `push` 触发，并通过环境审批控制付费运行；新建工作流若要使用 `workflow_dispatch`，GitHub 要求工作流文件先存在于默认分支。评估任务只读，报告与 Pages 构建目录、生产快照分开。若进入日更旁路，评估任务独立限时，消费当次提取证据的副本。生产流程只使用通过既有校验的正式产物。 [GitHub 触发规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
- Jev 密钥通过独立的 `jev-evaluation` GitHub Actions 环境提供，限定给经审核的分支和评估任务。仅发送与判断相关的公开短文本及必要字段，过滤联系方式、私有链接和跟踪参数。公开 Actions 报告只记录统计、可公开来源引用、候选 ID、模型决策、概率和规则复核结果。 [GitHub 环境](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) · [TypeSafe 数据处理说明](https://help.typesafe.ai/articles/5974925716-how-is-submitted-data-used-or-retained)
- 网络调用安排在构建阶段的异步批处理中，保留 `rebuildEvents` 和匹配规则的同步、离线可重放性。按规范化证据哈希、模型 ID 和问题版本缓存有效决定。单次运行设请求数、输入量和总时间上限，记录调用量、用量、延迟和跳过原因。缺密钥、欠费、限流、超时、响应无效或证据不足都回退到现有规则。建议独立开关时间和去重，关闭后从原始来源记录重建。
- 保持来源覆盖、未解析诊断、所有应抓来源的执行检查和发布数量门槛。评估过程不能将缺失来源判为成功，也不能靠 `allow_event_drop` 通过发布校验。 [覆盖配置](../config/coverage-validation.json) · [发布校验](../src/lib/static-site.mjs)

## 验收和上线顺序

| 阶段 | 产出及通过条件 |
| --- | --- |
| 1. 建立基线 | 从现有回归样本和新抓的公开证据准备人工标注。时间集覆盖主日期、报名、缺年、跨年、DST、全天、无时钟、海报多行和多场次；合并集覆盖改写转载、同标题不同日期、同日不同时间、结束冲突、同时间不同活动和三条记录的间接冲突。按来源或活动系列切分调参与留出集，避免同一海报或系列出现在两边。 [时间测试](../tests/date-semantics.test.mjs) · [媒体测试](../tests/automatic-media.test.mjs) · [合并测试](../tests/occurrence-merge.test.mjs) · [发布回归](../tests/published-occurrence-regressions.test.mjs) |
| 2. 对照评估 | 对相同冻结输入分别运行规则基线和 Jev 辅助，人工复核所有拟自动应用的差异。时间报告区分原文可解析时的完整字段正确率、额外正确记录和无证据时的错误补全；合并报告区分候选召回、最终漏合并、误合并和保留的来源链接数。报告样本量和各类结果，分开计算两项收益。 |
| 3. 日更旁路 | 建议至少观察 7 次成功的日更输入。每次比对差异与失败回退，核对正式产物的事件、来源和搜索数据语义与基线一致。初始验收要求是对应功能在留出集和日更样本中均有可复核的净收益，并且新增错误时间、错误合并和来源链接丢失均为零。按独立场次和来源数检查样本覆盖，样本不足则继续评估。 |
| 4. 分别启用 | 时间和合并独立决策，先选择通过验收且收益明确的一项。实现后先跑 `npm test`、`npm run check`、离线重放及无密钥/超时模拟，再验证日更实际构建和 Pages 上的同批次数据。合并功能还要验证不同场次隔离及所有来源链接的并集。上线由维护者审阅评估报告后决定。 |

## 需要维护者完成的事项

1. **准备 TypeSafe 账户和余额。** 在 TypeSafe Console 注册或登录，选定组织并由组织管理员添加预付余额。官方当前价格为每百万输入 token 0.042 美元，输出免费，且暂无免费试用额度。按实际 `usage.input_tokens` 核算试跑费用，充值金额以控制台为准。 [TypeSafe Console](https://console.typesafe.ai/) · [计价](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost) · [充值](https://help.typesafe.ai/articles/7771619341-how-do-i-add-credits)
2. **生成专用 API key 并配置密钥。** 在 TypeSafe 的 API keys 页面创建 CMU Events 评估专用 key。第一次付费评估前，在仓库 `Settings → Environments` 中创建 `jev-evaluation`，限定为本次受信任的评估分支，在 `Environment secrets` 下添加 `TYPESAFE_API_KEY`。只需告知已配置，密钥值留在 GitHub。 [TypeSafe 密钥管理](https://help.typesafe.ai/articles/8310295754-who-can-create-and-manage-api-keys) · [仓库环境设置](https://github.com/OranSimon/CMUEvents/settings/environments) · [GitHub 密钥设置](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-an-environment)
3. **在试跑前确认费用上限，在上线前审阅结果。** 按自己愿意承担的额度给出试跑上限。开发侧将它转换为每次运行的请求和输入量限制。也可以提供曾遇到的错时或重复活动原始链接，作为额外的对照样本。
