# 剩余受限来源的 Computer Use 复查

2026-10-26T01:44:22.491Z。实际复查 10 个来源：原 4 个部分接入来源及 6 个未公布日期的资源页。通过浏览器截图、展开内容、切换视图、公共文档和匿名接口对照，发现并修正三处实质遗漏。

## 逐项结论

| 来源 | 结论 | 证据与处理 |
| --- | --- | --- |
| [SCS Seminars directory](https://www.cs.cmu.edu/events/scs-seminar-series) | 纠正：漏跟进目录链接 | 补收 Crypto 三场未来讲座、Econ-CS 一场窗口内讲座；只覆盖目录中的两个系列，继续标为部分覆盖。 |
| [Center for Transformational Play Workshops](https://www.cmu.edu/ctp/workshops/index.html) | 确认可预约资源 | 三条详情均写 group booking，只给时长、人数和预约兴趣表，未公布具体排期。 |
| [Data Storage Systems Center Events](https://www.dssc.ece.cmu.edu/news/Events.html) | 确认发布方冲突 | 2026 标题与 2025 正文年份矛盾真实存在；Japan 注册链接指向 2025 旧会，PDF 附件显示 401，未找到消除歧义的公开依据。 |
| [Robotics, Embodied AI and Learning — news and events](https://www.cmu.edu/real/news-and-events/index.html) | 细化：匿名访问受限 | Manipulation 匿名嵌入返回 401、公开 ICS 返回 404；登录上下文的空网格不能证明公开无活动。LCS 公开可读但下一场 TBD，另增加官网变更监测。 |
| [Enterprise-Wide Optimization Seminars](https://egon.cheme.cmu.edu/ewo/seminars.html) | 纠正：历史日期被漏读 | Fred Gardi PDF 标题页明确写 2026-05-07；改为已识别历史日期、当前窗口内为零。 |
| [CMU Alumni Online Events](https://www.cmu.edu/engage/events/online-events) | 确认公开范围 | 三页公开日历的 23 项与快照一致，其中四项明确线上；新增活动发现仍不完整。 |
| [CMU Alumni and Community Events](https://www.cmu.edu/engage/events) | 纠正：详情可读、时间可补全 | 原始公开报名页给出 Sydney 2026-10-28 08:00–09:30 AEDT、Planar Restaurant；与纽约 10-27 17:00 为同一时刻。仍未接通新增卡片发现。 |
| [CMU Silicon Valley Events](https://www.sv.cmu.edu/events/index.html) | 确认所检月份未列场次 | 入口及九月、十月、十一月页均只有月份导航；只说明这些视图，不代表 SV 校园没有活动。 |
| [EPP Faculty Seminar Series](https://epp.engineering.cmu.edu/events/seminar-series.html) | 确认特定档案范围 | Faculty 页是无逐场日期的录像档案；11-09 Sonia 讲座已由独立 EPP 事件日历收录，不能把整个 EPP 称为空。 |
| [IDeaS Virtual Social Cybersecurity Seminar](https://www.cmu.edu/ideas-social-cybersecurity/events/virtual-social-cybersecurity-seminar.html) | 确认缺当前日期 | 折叠区域展开后仍无当前场次日期；新找到的合办日历只有 2017–2022 历史，且范围更广，不整体并入。 |

## 当前接入边界

SCS 已补入四条有效记录，其中三条在未来；整个 26 系列目录尚未全部映射，仍标部分覆盖。校友两项仍限于核验的 23 项/其中线上 4 项；Sydney 时间补全不意味着新增活动发现已经完成。REAL 与 DSSC 仍保留访问和日期限制。

图片与 PDF 继续使用审核字段加字节哈希；新增 PDF href 复用同一机制，没有引入后台 OCR。Sydney 原始详情字段只在匿名时间接口与审核起点一致时复用；单场活动 UID 的更新不会保留旧的日期版本或影响循环活动。

## 验证

179 项测试通过，npm run check 通过；实际刷新复查来源，并全量核对 4416 条 API 活动。Sydney 仅保留一条记录，原始时区和结束时间准确；12 个官方转载社团活动身份继续在存储和 API 中保留，318 来源目录及纯来源排除政策保持一致。

[验证与图片哈希清单](validation.json) · [四项资源与 SCS 链接](undated-four.json) · [REAL、IDeaS、EPP](real-ideas-epp.json) · [DSSC](dssc.json) · [校友与 Sydney](alumni.json) · [代码复核](code-review.json)
