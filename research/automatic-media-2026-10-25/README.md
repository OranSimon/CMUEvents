# 自动海报与 PDF 提取

本轮审计发现 6 个保留来源仍使用 14 个 `reviewedImages` 注释。这条路径把人工抄录的具体活动字段和一次性的资产 SHA 绑定，未来换海报或新增图片时不能持续更新。`config-patches.json` 将这 6 处改成当前页面的语义选择器和自动提取规则；配置没有具体活动日期、姓名、海报文件名或批准哈希。

## 运行路径

- `src/adapters/automatic-media.mjs` 每次解析当前页面发现当前资产。学期图片从当前标题读取年份，不采用运行年份、页脚、图片/PDF 文件名或 PDF 元数据。
- `src/lib/media-ocr.mjs` 优先读取 PDF 第一页文字层；扫描 PDF 才渲染第一页。普通图片运行 Tesseract 英文稀疏文本识别；同时读取原图和灰度反色图，保留 TSV 字框、位置及置信度。
- 白字彩色背景在原图上会漏读。真实社会主义研究海报的反色版本正确识别日期、时间、地点与讲者。LTI 使用几何行带配对，避免纯文本把上下一行讲者错配。
- 明确日期必须经过公历有效性、正文/当前学期年份一致性、印刷星期校验。LTI 日期列需要两种图像处理一致；单张海报日期需要足够置信度或多个处理结果一致。模糊跨午时间保留日期精度，缺失结束时间不补时长。没有可靠完整日期则不发布该资产的活动并返回 partial。
- 缓存只保存当前资产字节 SHA 对应的原始 OCR/文字及字框，不保存人工活动字段。换字节会重新 OCR；原始缓存命中仍使用当前 HTML 年份和当前解析器重新生成事件。
- 明确 publisher alt 可以作为可访问等价文本直接解析；它是当前官网字段，不是历史人工注释。此路径适用于 CAUSE 的完整日期时间 alt。
- 无 API key 或付费服务。CI 需要 Node 24、`tesseract-ocr`（eng 语言包）；PDF 解析与绘制使用既有 `pdf-parse`，图片绘制需显式声明 `@napi-rs/canvas` 依赖。

## 实际验证

`sample-results.json` 是匿名访问六个当前官方页面、下载当前媒体、运行实际提取器所得。日期包含历史记录，便于验证精度；正式抓取仍使用请求的日期窗口过滤。

| 来源 | 当前解析结果 | 保留的边界 |
| --- | --- | --- |
| LTI | 13 个明确印刷行；社交/colloquium 使用各自印刷时段，冬令时自动转换 | 一个姓氏 OCR 不可靠，保留系列名称并 partial；不扩展未列出的周五 |
| Socialist Studies | 12 个媒体读出 11 个去重发生日期，包含 Fall 2026 三场 | 最新 12/18 个媒体，剩余档案 partial；姓名不清晰时只用官方系列名称 |
| Humanities faculty workshops | 6 张海报读出 5 场，年份来自各自 Fall 2025 / Spring 2026 标题 | 1 张无可靠完整日期；部分跨午 AM/PM 模糊，保留日期并 partial |
| CAUSE | 当前完整 alt 自动读出 Augustus Wood 2/27/2026 的 4:30–6:45pm；另一旧海报完整两日范围 | 当前有 38 个图片，仅扫描前 8 个；纯头像、没有年份的海报不编造活动，partial |
| PwC | 当前两张宽 banner 自动读出 2024/2023 的两日范围及标题 | 当前维度明确的宽 banner 全部读取；若未来页面改变版式仍需调整语义发现规则 |
| EWO | 最新 8 个 PDF 首屏里 6 个具有完整可见日期 | Hooker 只有 April 2026，Lara 首屏无日期，不从文件名补；其余 115 个旧 PDF 未读，partial |

## 长期限制

这个实现能自动处理同类新海报、换图、增行、变更学期，不能保证任意全新版式、非英文文字、复杂多活动/跨月海报都完整。低置信度、不同 OCR 结果冲突、没有明确年份、日期和星期矛盾、超出资产/像素/大小/CLI 时间上限都会明确报 partial，不转成已验证 empty，也不退回旧人工事件。源站删除活动的语义仍由刷新/存储层管理；自动提取器不主动读取旧手工字段。

PDF 当前只读第一页来寻找演讲封面日期。文档后页才列议程时需要新增可复用的议程页规则；不声称已检查整份 PDF 或全部历史档案。Tesseract 置信度与两种处理一致也不能证明每个单词绝对正确，所以不使用词典猜姓氏或补全题目。

## 回归

`node --test tests/automatic-media.test.mjs tests/visual-recheck.test.mjs tests/empty-followup.test.mjs tests/remaining-partial-family.test.mjs tests/html-detail-review.test.mjs`：45/45 通过（含真实 Tesseract 运行与字节变化缓存测试）。新测试使用独立 OCR fixture 保留当前真实版式证据，另有新增图片与原图同时存在、改变当前学期年份、缺失 OCR、错误格式、日期冲突、日期范围、DST 与 PDF 文字层的契约测试。

原 `reviewedImages` 的旧内联 fixture 测试保留用于描述历史防护行为；活跃计划迁移后不会走这条人工字段路径。此轮没有编辑生产 SQLite。

官方接口依据：[Tesseract CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) 与安装的 `pdf-parse` 文档（`getText({partial:[1]})`、`getScreenshot({partial:[1]})`）。
