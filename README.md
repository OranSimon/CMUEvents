# CMUEvents

CMU 公开活动来源目录。核验日期：**2026-10-20**。

主清单包含 **1,029 个来源入口**，只使用 `Department`、`Org`、`link` 三列。一个组织可能同时提供网页、ICS 和邮件订阅，因此入口数不等于组织数。

- [下载 Excel 清单](outputs/01a15b3a-aa11-79f0-96c7-fdcfed7eef2f/CMU_Event_Sources.xlsx)：单张表，可筛选，冻结表头，网址可点击。
- [查看 CSV 清单](data/event_sources.csv)：UTF-8，适合导入表格或开发活动聚合功能。
- [查看带核验信息的 JSON](data/event_sources.json)：包含来源类型、核验时间、HTTP 状态、说明和已发现的日历记录数。

## 字段

| 字段 | 含义 |
| --- | --- |
| Department | 学院、院系或归属类别。学生社团没有可确认的学术院系归属时，使用官方组织类别。 |
| Org | 主办单位或来源名称；后缀区分网页、日历和订阅方式。 |
| link | 活动列表、长期日历、系列活动页面、公开周报目录或订阅源。 |

Public 指无需登录即可查看来源内容。具体活动的参与对象、报名、票务和地点可见性，以活动说明为准。

## 覆盖范围

覆盖七个学院、下属院系与研究中心、跨学科机构、图书馆、学生事务、教职工发展、校友和国际校区，并逐项检查官方目录中的组织来源。

| 来源类型 | 入口数 |
| --- | ---: |
| 院系、研究中心及组织独立维护的活动列表 | 159 |
| CMU 官方单位日历 | 73 |
| iCalendar / ICS 订阅源 | 422 |
| TartanConnect 组织活动网页 | 364 |
| 公开邮件列表订阅页 | 4 |
| 公开周报归档 | 5 |
| 活动 RSS | 2 |
| 合计 | 1,029 |

包含 OIE **Friday Greetings**、Swartz **Weekly Bulletin**、**The Piper**、研究生与博士后公开周报，以及你提供的 HCII、RI、LTI、Swartz、音乐、戏剧、Activities Board 和 RoboClub 来源。RI 的固定月份视图替换为长期列表，RoboClub 的年度回顾替换为日历。Liberty Magic 属于校外机构，未作为 CMU 下属组织收录。

本轮检查了 [CMU Calendar Directory](https://events.cmu.edu/directory/) 的全部 **73 个单位日历**、TartanConnect 的 **499 个组织活动页候选入口**、Pittsburgh 与 Qatar 平台公开目录中的 **576 个日历订阅链接**，并检查了学院、院系、研究中心及组织独立网站。576 个平台订阅链接中，**399 个返回完整 VCALENDAR 文件**。

## 使用时需要保留的区别

- 主清单不收录固定单场活动详情链接。年会、讲座系列和工作坊使用持续维护的列表入口。
- **313 个组织活动网页**在匿名 HTML 中显示暂无即将开展的活动；它们作为长期入口保留。**122 个有效平台 ICS**当前没有 VEVENT 记录。两者均不能据此推断组织停止活动，也不能据此保证近期有活动。
- 官方公开订阅目录中也存在 404。失效、反爬阻挡、登录跳转和其他未核验入口放在 [候选与失败记录](research/unavailable-sources.json)，不混入可用主清单。CALCM、Graphics Seminar 和两处 Constant Contact 订阅页仍有访问核验限制；旧 Monday Mailer 页面会跳转到登录。
- 来源之间可能重叠。聚合具体活动时，应按 UID、原始活动链接及主办方去重。JSON 中的 `calendar_event_count` 是该文件的 VEVENT 数量，可能包括历史或取消记录，不能当作未来活动数量。
- 这是按公开目录和独立网站系统检索得到的来源清单。新开设、未被公开链接、仅在社交平台发布或需要登录的来源可能不在其中；本目录不声称全网永久穷尽。
- 国际校区已收录 Africa、Qatar 和 Silicon Valley 的公开入口。Miami 官网本轮返回 403，未确认其独立公开活动列表。

## 更新数据

`research/manual-sources.tsv` 保存独立来源候选；官方日历、组织目录和订阅链接分别由脚本发现。页面缓存不进入 Git。

```bash
python3 scripts/discover_directories.py
python3 scripts/discover_hubs.py
python3 scripts/discover_centers.py
python3 scripts/discover_org_websites.py
python3 scripts/discover_feeds.py
python3 scripts/discover_additional_subscriptions.py
python3 scripts/build_catalog.py
```

默认复用本地页面缓存。需要重新访问网址时，为命令设置 `CMUEVENTS_REFRESH=1`。Excel 通过 `scripts/build_workbook.mjs` 生成，再使用 `scripts/add_xlsx_hyperlinks.py` 添加原生链接；生成器使用 Codex 配套的 `@oai/artifact-tool` 运行时。

项目许可证：[GNU Affero General Public License v3.0](LICENSE)。
