# 保留来源访问障碍复查

截至 2026-10-25T20:06:29.262Z，对重点 **32** 个保留来源分别核对原入口、实际抓取入口及必要附加渠道。完整逐来源原因与下一步见 [access-probes.json](access-probes.json)，全量318来源的传输状态以父任务 [http-probes.json](http-probes.json) 和刷新报告为准。

- **4个运行partial均是解析/覆盖问题**，已检查主入口均200：IDeaS、Humanities、Tepper、Architecture。建筑学院原固定第二页现明确零结果，首页仍有10个有日期条目。
- **15个unsupported都可打开**：包括档案/资料页、无完整日期的系列描述、海报或动态日历。unsupported不等于无法访问；也不能据此宣称活动都已成功采集。
- **4个Mailman是真实私有档案限制**：公开listinfo为200，广告中的/private/也是200认证页；需要成员订阅及邮箱/密码，部分还需管理员批准。
- **Emerging Leaders**：公开项目介绍和ICS可达；真实info-session详情是private event且不开放建号。公开Dec2卡片缺年份，不能猜2026。
- **Nexus**：公开项目与空ICS可达；weekly newsletter要求加入TartanConnect组，组入口明确Login is required。
- **ILD**：空ICS与官方说明可达；独立活动页明确unpublished，自定进度badge介绍不是可推算的日程。
- **PDL**：公开SDI网页可达；邮件须ANDREW.CMU.EDU地址、closed list、管理员批准，且页面要求不要转发邮件中的讲座信息。普通公共邮箱不能假定合资格，不能默认把私有邮件公开再发布。
- **Alumni两个入口**：已视觉确认同一公开动态日历三页23张卡片；23张均有完整2026日期；末页日期晚于首次AX返回，但实际截图已加载，已据图纠正。仍显示Sign In，公开列表无需登录；属于动态组件适配缺口。
- **CNBC**：Node请求证书链验证失败；Chrome无警告可打开并加载公开Google Calendar。匹配的已配置Google ICS匿名200，因此无需把整个来源判不可用。额外PDL订阅站也出现同类Node TLS错误，但Chrome可达。应修完整证书链，不关闭证书验证。

没有登录、创建邮箱、订阅、发信、填写表单或操作CAPTCHA。本轮14张截图均未包含凭证、私人邮箱、账号选择器或私人日历。S3D私档仅以本轮匿名HTTP认证页作证，未声称已保存截图。
