# 每日记录、月度与年度回顾：实现与验证

实施日期：2026-10-31（Asia/Shanghai）。基于 1.0.5、HEAD `053b604` 及工作区中原有的 2026-10-24—25 日记整改。工作分支 `feat/journal-work-review`。

## 结论与范围

用户目标已落地为完整闭环：每日自由记录 → 主动收录重点 → 月度整理 → 年度整理。没有把日记改成客户台账或业绩表单；原有富文本、任务快照、自动保存、草稿恢复、图片、回收站、备份和周期阅读继续保留。

本轮新增重点与回顾正文的独立持久化、来源关联和来源状态；普通列表查询改为按日期详情、索引、范围和分页读取，年度页不再默认挂载全年全文。桌面 Schema 由 8 升为 9。

摘要为唯一必填项，结果和主题可选。月度和年度回顾都是用户可编辑的独立文档；加入素材是显式动作，不自动把所有任务堆进正文。

实现完成时的状态为未提交、未推送、未制作安装包、未发布，未读写正式用户数据库。该实现随后作为 1.0.6 发布，桌面数据结构升级为 Schema 9。

## 已实现

### 每日页

- 保留月历、日期导航、本周阅读、自由富文本、自动保存、草稿恢复、版本冲突处理、图片和回收站。
- 新增「收录选中内容」「收录重点」「添加重点」，摘要／结果／主题编辑，来源显示，编辑、删除确认和查看原文。
- 没有重点时只显示小的「添加重点」；没有完成任务时仍可正常记录和收录重点。
- 重点编辑期间切换日期或页面会先要求保存或取消；保存失败保留表单。

### 月度与年度回顾

- 顶部导航改为每日／月度回顾／年度回顾／搜索；月度和年度正文使用同一富文本编辑器及自动保存机制，但各自独立保存。
- 月度素材按主题分组、可按主题筛选；显示日期、摘要、结果、来源状态，并可打开原文。
- 年度可使用全年重点，也可选择十二个月中的月度回顾；未来月份不可加入。
- 加入文字含日期、摘要、结果、主题和来源。已加入来源禁用重复操作。
- 原始重点和包含它的月度回顾双向检查重叠，拒绝重复追加，避免把同一成果累计两次。
- 年度原始日记按月展开日期索引，打开具体日期才显示正文；月历和年度首屏不读取全年正文和图片。

### 搜索与导出

- 搜索支持关键词、起止日期、只看重点，显示命中片段并可打开来源；覆盖正文、历史事项、任务快照、重点和回顾文字，明确不识别图片内文字。
- 普通结果按每页最多 50 篇从数据层查询；只看重点先按日期范围读取后在内存分页，没有宣称全库重点数据库分页。
- 导出菜单区分当前回顾、当前日记、本周／月／年原始日记，文件名和内容范围一致。
- 浏览器调试环境实际捕获年度回顾导出 Blob：290 字节，含月度回顾来源和原始重点来源；内容见 [browser-review-export.md](browser-review-export.md)。

### 数据与原子性

- Schema 9 新增 `journal_highlights` 和 `journal_review_sources`，包含软删除、独立修订、来源类型／ID、来源版本和快照。
- Rust 在单个 SQLite 事务中校验回顾内容版本、追加正文并写来源关联；超长、冲突或失败整体回滚。命令仅主窗口和 BootState 后可用，经过写生命周期门控，Quick Add 不获权限。
- 浏览器重点使用独立版本键；回顾正文和来源关联嵌在同一个日记存储值中，一次 `setItem` 提交，避免只留下半份关联。
- 来源日记进回收站、正文更新或任务完成撤销时保留已插入的回顾文字，并显示来源状态；删除重点不改写日记。
- 备份恢复参考库和校验和包含 Schema 9；本轮新增备份恢复断言覆盖重点、来源关联和回顾正文。

## 验证结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 前端全量 | 49 文件／355 项通过，退出 0 | [frontend-tests-final.log](frontend-tests-final.log) |
| 前端静态 | ESLint、`tsc --noEmit` 通过 | [lint-final.log](lint-final.log)（空输出） |
| 前端生产构建 | 通过，保留既有大于 500 kB 分包提示 | [frontend-build-final.log](frontend-build-final.log) |
| Rust 全量 | 63／63 通过，退出 0（串行执行） | [rust-tests-final.log](rust-tests-final.log) |
| Rust 格式 | `cargo fmt -- --check` 通过 | [rust-format-final.log](rust-format-final.log)（空输出） |
| 隔离原生构建 | `--debug --no-bundle` 退出 0 | [native-build.log](native-build.log)、[native-rebuild.log](native-rebuild.log) |
| 真实原生 GUI 主流程 | 18 步全部通过：输入、重点、月加入、年加入、重载、退出重启持久化 | [native-flow.results.json](native-flow.results.json)、[native-flow.json](native-flow.json) |
| 原生删除与恢复 | 10 步全部通过：删除确认、来源状态、回收站恢复、恢复后状态清除 | [native-delete-restore-fixed.results.json](native-delete-restore-fixed.results.json) |
| 原生布局复验 | 1360×844 下 page 1076px、composition `577.875px 404.513px`、note 577.875px | [native-wideflow.results.json](native-wideflow.results.json) |
| 原生 Markdown 导出 | 实际写出 [native-export-2026-10.md](native-export-2026-10.md)，266 字节，内容与月度摘录一致 | 文件本身；页面显示「已导出。」 |
| 浏览器流程 | 重点、月年收录、重复拒绝、按月展开、刷新保留、搜索、390px 无横向溢出；控制台无警告或错误 | [browser-checks.json](browser-checks.json) |

### 真实原生环境

- 标识 `com.todoa.desktop.test.review20261031`，窗口标题 `Todoa Review Validation`，构建产物 `src-tauri/target/debug/todoa.exe`。
- 运行时数据库实测为 `C:\Users\Heart\AppData\Roaming\com.todoa.desktop.test.review20261031\todo.db`，WebView profile 也为独立目录；未访问正式 `com.todoa.desktop` 数据库，用户原有 PID 4232 未被操作。
- 通过 WebView2 CDP 驱动真实点击、输入和页面重载；导出使用本应用自己的 Windows 保存对话框，实际落盘后读取核验。
- 验收结束已停止本次启动的 PID 和 CDP 端口；[native-cleanup.json](native-cleanup.json) 记录自有进程已停止、原进程仍运行、CDP 端口关闭。

### 发现并修复的问题

首次原生宽窗验收发现回顾页被后置的 `.daily-layout` 网格规则覆盖：`.daily-layout.review-layout` 的计算样式仍为 grid `230px 826px`，正文列被压到 0 宽。修复前截图：[月度](native-06-reloaded-month.png)、[年度](native-07-reloaded-year.png)。

将规则改为 `.daily-layout.review-layout { display:block; }` 并重建后，原生宽窗复验为 `block`，正文恢复 577.875px，截图：[月度](native-17-fixed-month.png)、[年度](native-18-fixed-year.png)。浏览器 1360px 和 390px 也重新检查，无横向溢出。该 CSS 修复只影响回顾页布局，不改变收录逻辑。

### 测试稳定性说明

全量前端在 49 个隔离 worker 并行时，「回收站恢复」用例的界面刷新曾超过默认查找超时；专项文件单独运行为 709ms。已将测试等待改为 10 秒并附注释，随后全量 355 项通过。产品逻辑未改。

Rust 全量首次并行运行时，既有 `pool_config_new_connection_and_lock_timeout` 用例出现一次无 CPU 进展的挂起；单独复跑 1／1 通过（5.77s），随后串行全量 63／63 通过。本轮没有修改连接池代码，记录为测试／环境稳定性边界，不代表业务测试失败。

## 未覆盖边界

- 原生验收未重复覆盖：图片导入、完成任务自动归档、搜索和回收站搜索、本周视图、编辑／删除已有重点、来源已更新状态、导出取消／覆盖、原生备份恢复、保存失败重试、多实例并发。
- 未覆盖移动端触控、真实 Windows 中文输入法跨午夜、物理 DPI／200% 字体、安装版和目标 Windows 11 环境；这些仍需目标环境验证。
- 原生验收时顶部存在 `Ctrl+Shift+Space` 注册失败提示，原因是快捷键被其他应用占用；未使用快捷键，不影响本次验证。
- 浏览器验证使用独立 localStorage；不能替代桌面 SQLite 的并发、IPC 和磁盘故障验证。自动化测试通过也不等于不存在潜在问题。

## 复跑

```bash
node node_modules/vitest/vitest.mjs run
node node_modules/eslint/bin/eslint.js src vite.config.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
rustup run 1.94.1-x86_64-pc-windows-msvc cargo test --manifest-path src-tauri/Cargo.toml
rustup run 1.94.1-x86_64-pc-windows-msvc cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

原生复跑入口：[native-cdp.mjs](native-cdp.mjs)、[native-gui-launch.ps1](native-gui-launch.ps1)，配置为 [native-test.conf.json](native-test.conf.json)。只应指向隔离标识和隔离数据目录，禁止连接正式用户数据库。
