# 工作日记整改与验证

实施日期：2026-10-24 至 2026-10-25（Asia/Shanghai）。基于 1.0.5、HEAD `053b6040930d8ed3369b860d9955e18a32b15eb4` 的未提交工作区。对应 [整改前审计](../audit-journal-2026-10-24/REPORT.md)。

## 结论与范围

审计确认的 **D01–D07 共 7 项缺陷均已修复**，并补充历史搜索与整篇／整周期导出范围说明。最优先的数据风险——旧草稿交接失败时删除唯一持久副本——已有针对两种旧草稿的失败、立即关闭、重开回归。正常使用继续保留“完成任务自动归档＋自由补充＋月历与周期阅读”，没有增加客户台账、账号或云端功能。

前端全量 45 文件／312 项通过，Rust 全量 59 项通过；ESLint、TypeScript 及前端生产构建通过。新增的原生边界用例使用真实 Rust 服务和迁移后的 SQLite 内存数据库。浏览器用独立端口 1436 的虚构样本验证真实 Tiptap、IndexedDB、Web Locks、图片撤销、恢复和实际 Markdown 下载。**服务／数据库验证与浏览器验证不等于安装版原生 GUI 验收**，边界见下文。

本轮没有提交、推送、生成安装包、发布或操作用户正式数据库。版本仍为 1.0.5、Schema 仍为 8；无需升级或重写旧数据。原审计的复现脚本和日志保留原貌，不能当作修复后测试运行。

## 修复结果与验收证据

| 编号 | 修复与当前行为 | 代码与回归证据 |
| --- | --- | --- |
| D01 · P1 | 新草稿持久化返回成功／失败；旧 editor、quick 草稿仅在新副本落盘或正式保存成功后清理。草稿存储失败时，“读取已保存内容”不替换当前缓冲。 | [JournalNoteEditor:50](../../src/features/journal/JournalNoteEditor.tsx#L50)；[两种旧草稿配额与交接用例:34](../../src/features/journal/JournalRemediation.test.tsx#L34)、[正常交接:97](../../src/features/journal/JournalRemediation.test.tsx#L97)、[读取保护:144](../../src/features/journal/JournalRemediation.test.tsx#L144)。全量通过。 |
| D02 · P2 | 图片导入从忙转闲时重新安排 650ms 自动保存；仍在组字或恢复确认阶段则继续等待。不需要用户再输入一次来触发。 | [自动保存调度:60](../../src/features/journal/JournalNoteEditor.tsx#L60)、[导入回调:140](../../src/features/journal/JournalNoteEditor.tsx#L140)；[慢／失败导入用例:85](../../src/features/journal/JournalRemediation.test.tsx#L85)。 |
| D03 · P2 | 列表复用已渲染的子节点，同一图片在单次文档导出中缓存读取 Promise；按实际编号宽度缩进。8 层嵌套的一张图片由 256 次读取降为 1 次。 | [Markdown 渲染:60](../../src/domain/journalContent.ts#L60)；[深度 1／4／8 与重复图片:29](../../src/domain/journalContent.test.ts#L29)，另验证从 10 开始的有序列表缩进。 |
| D04 · P2 | 启动及编辑器关闭后尝试清理无引用图片。共享锁保护所有打开编辑器的撤销历史，关闭时等待在途保存；独占锁下保留正文、回收站及所有可恢复草稿的引用。SQLite 在事务内重新读取正文，浏览器用一个 IDB 写事务删除。解析失败或缺少 Web Locks 则跳过。 | [维护协调器](../../src/data/journalImageMaintenance.ts)、[IDB 清理:42](../../src/data/browserJournalImages.ts#L42)、[SQLite 清理:174](../../src-tauri/src/services/journal_content.rs#L174)；[协调测试](../../src/data/journalImageMaintenance.test.ts)、[原生资源测试](../../src-tauri/src/services/journal_content/tests.rs)、[真实浏览器 11 项](browser-image-lifecycle.txt)。 |
| D05 · P2 | 组字、导入或保存阻断解除后重新尝试跟随今天；先把旧内容保存到旧日期。用户主动选择历史日期后，迟到的午夜保存结果不能覆盖该选择。 | [跟随与导航版本:48](../../src/features/journal/JournalWorkspace.tsx#L48)；[组字结束:69](../../src/features/journal/JournalRemediation.test.tsx#L69)、[历史选择:112](../../src/features/journal/JournalRemediation.test.tsx#L112)、[失败重试:126](../../src/features/journal/JournalRemediation.test.tsx#L126)。 |
| D06 · P3 | Rust 与 JavaScript 一致：先去除同一组末尾空白，再计 UTF-16 长度，200000 为上限；超限仍拒绝且不覆盖已保存正文。Repository 显示长度提示。 | [原生归一化:7](../../src-tauri/src/services/journal_content.rs#L7)、[长度校验:82](../../src-tauri/src/services/journal_content.rs#L82)；[原生边界测试:29](../../src-tauri/src/services/journal_content/tests.rs#L29)，涵盖 199999／200000／200001、100000 个表情、多段落分隔、BOM 与 U+0085。 |
| D07 · P3 | 代码块提取原始文本，保留缩进、末行空格和结尾换行；围栏长度超过内容中的反引号串，避免提前闭合。 | [代码块渲染:67](../../src/domain/journalContent.ts#L67)；[4 组代码块测试:49](../../src/domain/journalContent.test.ts#L49)。 |

D04 不永久删除日记或清除防补录复活的删除标记；软删除的日记及其图片仍可恢复。已存在备份文件保持原状，SQLite 删除记录也不保证数据库文件立即缩小。清理失败只推迟维护，不把已成功的任务归档显示为失败。新命令限于主窗口、经过写入生命周期门控；Quick Add 权限未扩大，生成 ACL 中已包含命令。

另修复范围阅读中把 `key` 混入 JSX props 展开的 React 开发警告。新标签页打开含加粗与图片的月视图后，捕获的 warn／error 为空：[控制台](browser-console-final.json)。

## 体验调整

- 历史输入框改为“搜索历史日记”。有搜索词时显示“仅筛选历史列表；导出包含当前日期或范围内的全部日记。”
- 菜单明确显示“导出当前日记”或“导出本周／月／年全部日记”。搜索“青禾”后导出的整月仍包含同月“云杉”日记，行为与提示一致。这是整篇／范围导出，不提供按客户脱敏保证。
- 保留原有完成清单、完整补充、月历、历史和日／周／月／年浏览。搜索片段、选中文字生成待办、复杂回顾工作台等没有混入本次缺陷修复。

最终页面：[完整宽窗口截图](search-export-scope-final.png)、[390px 截图](search-export-scope-390.png)、[最终 DOM](browser-main-flow-final.txt)。宽 1280 与窄 390 的实际可用宽度分别为 1265 与 375，均未发现横向溢出；测试后已清除视口覆盖。

## 已执行验证

| 项目 | 结果 | 日志／方式 |
| --- | --- | --- |
| 前端最终全量 | 45 文件，312／312；退出 0 | [frontend-tests-final.log](frontend-tests-final.log)，`pnpm test -- --reporter=dot` |
| 原生全量 | 59／59；退出 0，包含备份、日记恢复及真实子进程崩溃恢复 | [rust-tests-final.log](rust-tests-final.log)，`cargo test --manifest-path src-tauri/Cargo.toml` |
| 原生长度补充 | 在全量后补充 199999 和多段落边界，专项 1／1 通过，退出 0 | [rust-boundary-final.log](rust-boundary-final.log)，`cargo test --manifest-path src-tauri/Cargo.toml journal_content::tests::normalized_utf16_limits_match_browser_and_rejections_leave_saved_content_intact -- --nocapture` |
| 静态与构建 | ESLint、tsc＋Vite 前端生产构建退出 0 | [lint-final.log](lint-final.log)、[frontend-build-final.log](frontend-build-final.log)；保留大于 500kB 的分包提示 |
| Rust 静态 | 格式检查、Clippy 所有目标且警告视为错误均退出 0 | [rust-format-final.log](rust-format-final.log)、[Clippy 完成检查](clippy-completion.log) |
| 浏览器资源生命周期 | 11 项通过，实际 Web Locks＋IndexedDB | [页面脚本](image-lifecycle.html)、[结果](browser-image-lifecycle.txt)、[截图](image-lifecycle.png) |
| 源码收尾 | `git diff --check` 通过，版本和迁移保持原样 | [完成元数据](validation.json) |

首次专项回归有 3 项失败：新增编辑器资源锁后，恢复入口与编辑器初始化的时序需要协调，已改为资源锁就绪后显示恢复操作，并让新编辑器读取当前文档。修正后原工作区＋整改专项 20 项及最终全量均通过，旧日志 `targeted-tests.log` 留存。首次严格 Clippy 报出两处既有测试警告，已删除 Preferences 测试的无效默认展开、去掉 Schedule 测试比较中的多余 String 分配；不改变业务行为，最终结果以完成日志为准。

### 真实浏览器操作

使用 `http://127.0.0.1:1436/`，与审计端口 1435、其他站点及桌面库隔离。仅使用“整改样本”客户和有效 8×8 PNG：

1. 今天输入客户补充后立即切到前一天，再回来，最后一次输入已保存。
2. 加粗、插图、删除图片再 Ctrl+Z，图片恢复；跨日期销毁编辑器后重开，文字、格式和图片仍可读。
3. 为前一天补写另一客户记录，返回今天；真实下载 [当日日记](export-day.md) 与 [整月日记](export-month.md)，校验加粗 Markdown、PNG Base64 及月范围内两篇样本。下载发生在创建测试完成任务前，因此两份文件显示“当天暂无完成任务”，不以它们证明任务导出。
4. 软删除当前日记，再从回收站恢复，文字与图片仍在；重新载入后新开标签页再次确认恢复。
5. 创建并完成“整改样本：青禾材料归档”，日记显示当天完成 1，补充保持不变；新标签页仍能读取该快照。浏览器任务本身刷新清空是原有调试边界。
6. 搜索“青禾”：历史列表只命中对应日期，右侧月正文保留两篇，菜单明确整月导出，范围说明可见。
7. 1280×900／390×844 下检查页面，未发现横向溢出；测试后恢复默认尺寸。原宽窄截图含测试任务；最终完整截图再次核对了加粗、图片、任务和导出提示。

资源生命周期页面的两个编辑器会话在同一页面持有真实共享锁，并非两个原生窗口联动验收。它验证全部会话退出后才清理、保留已保存／回收站／草稿图片、舍弃草稿后回收、坏草稿中止以及故障解除后继续。跨标签页的范围来自 Web Locks API 的 origin 作用域，未把这一 API 语义冒充实际双窗口 GUI 操作。

测试期间开发服务曾中断，确认端口不可用后重新启动，再新开正常 localhost 页面恢复验证。没有绕过浏览器内部错误页或把连接失败记为业务数据丢失。

### 长历史基准

使用实际 8 个迁移、SQLite 内存库、原生路径的 `JournalRepository.list()` 和领域搜索／范围函数。每日日记约 160 句重复短句、每天 10 条任务快照；全为虚构数据。运行 `pnpm exec vitest run --config docs/journal-remediation-2026-10-24/benchmark.config.ts`。

| 样本 | SQLite 大小 | 三次全量读取 | 已加载数据搜索 | JS heap 差值 |
| --- | --- | --- | --- | --- |
| 365 篇／3650 快照 | 10,489,856 B | 202.90／199.06／183.27 ms | 34.41 ms | 37.25 MiB |
| 1826 篇／18260 快照 | 57,593,856 B | 843.41／736.05／738.91 ms | 86.66 ms | 146.28 MiB |

[原始 JSON](history-benchmark.json)、[脚本](history.benchmark.ts)、[日志](history-benchmark.log)。这不是峰值内存，也不含 IPC、原生窗口渲染、图片解码或磁盘延迟；不能证明多年图片库流畅。结果支持下一步评估按范围读取和缓存，暂不凭一轮基准引入大规模架构重构。

## 剩余边界与建议下一步

1. **原生 GUI 验收优先**：用一次性独立数据目录实测 Windows 中文输入法跨午夜、慢图片、强制关闭与重开、原生导出和恢复；不得指向正式用户库。本批未安装新包、未打开原生主窗口，合成 composition 事件不能替代真实输入法。
2. **性能以原生量测决定**：对五年样本和大图片量测打开、输入、范围切换、滚动后峰值内存；确认瓶颈后引入范围查询、缓存或窗口化。当前全量查询、年视图图片累积驻留仍是审计中的待验证风险。
3. **异常可用性**：后续考虑坏记录逐条诊断、保留原文的只读导出，以及可靠落盘后“保留草稿离开／复制原文”；当前坏记录会阻断查询或维护，本批选择保守中止，未自动丢弃数据。
4. **可选产品改进**：客户搜索命中片段、选中文字创建跟进待办、压缩周期空完成区、草稿来源／代次提示。须维持简单本地日记，不把普通补充强制改为业务表单。它们是产品建议，未宣称已实现。

其他未覆盖边界：系统休眠／时区切换、真实双原生窗口、物理 DPI、200% 字体缩放、原生外链打开及安装后全流程。Web Locks 不可用或任一引用无法解析时，图片清理延后；已保存数据仍保留。性能基准、浏览器通过和测试通过均不等于没有任何潜在问题。
