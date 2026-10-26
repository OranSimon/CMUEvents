# 来源目录与邮件订阅入口验收

2026-10-25（America/New_York）。本次只扩展来源展示与访问说明；活动收录规则和来源注册表保持原有范围。

## 已交付

- **Our sources** 显示全部 318 条来源原链接，包括 38 条共享来源别名；默认每页 30 条，可继续加载或一次显示全部。搜索覆盖组织、部门、类别和 URL，可与 Department、Category、Coverage 筛选组合。
- **Email subscriptions** 列出 6 个经过核对的频道，提供官方订阅入口、访问要求和收录说明：4 个邮件专属来源，2 个公开日历与邮件渠道并存的来源。
- 页面明确说明仅通过订阅邮件发布的内容未收录。独立发布的公开活动仍可收录；S3D 的邮件列表与其单独的公开日历也分别说明。
- 目录的搜索和筛选不会改变活动搜索状态。关闭后保留目录自身筛选；Escape、关闭按钮、弹窗切换和焦点返回已核对。

## 数据与验证

完整的 [邮件渠道审核](../source-subscriptions-2026-10-25/audit.json) 对照了全部 318 个来源，以及已记录的受限访问证据。订阅配置位于 [source-subscriptions.json](../../config/source-subscriptions.json)。它不把公开邮件归档、可选提醒或仅需成员登录但未核实邮件渠道的页面标成邮件专属。

[verification.json](verification.json) 记录 API 与浏览器核对结果：318 个唯一来源 ID、318 个可见原链接均匹配现行配置；原链接不藏在诊断折叠区。组合搜索 `seminars` + `Tepper School of Business` + `Event pages` 得到 2 项。邮件列表的两个分组分别为 4 项与 2 项。验收时活动总数仍为 4,416。

Chrome 桌面 1470×900 和 390×844 响应式预览均已通过 computer use 检查。窄屏预览使用临时本地测试服务器，在 390px iframe 内加载相同的 HTML/CSS/JS 与本地 API；这是浏览器布局验证，不是真机验证。确认了三项顶部导航、单列卡片、粘性筛选、长链接换行和订阅访问说明。正式服务的安全响应头未改动。

`npm test`：184 项通过、0 失败。`npm run check`：JavaScript 语法及 318 条来源完整性检查通过。新增 API 回归测试确认邮件元数据不会隐藏公开活动或来源别名。

## 界面截图

- [完整来源目录，桌面](evidence/sources-desktop.png)
- [Tepper 组合筛选](evidence/sources-tepper-filter.png)
- [邮件列表，桌面](evidence/subscriptions-desktop.png)
- [邮件覆盖声明，390px](evidence/subscriptions-390px.png)
- [访问要求与长链接，390px](evidence/subscriptions-card-390px.png)

订阅资格可能由发布方调整；未知资格保持未核实，并引导用户核对官方页面。本次没有注册邮箱、执行订阅或读取私有邮件。
