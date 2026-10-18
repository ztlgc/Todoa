# 自动生成每日工作日记验收

日期：2026-10-18。目标：完成任务即按当天归档，启动补漏，手写工作记录独立保留。

## 已验证行为

| 场景 | 结果与证据 |
| --- | --- |
| 任务完成后形成日记 | 浏览器通过实际新增表单创建任务并勾选完成，进入日记后立即显示完成快照，同一天合并为一篇。 |
| 日期归属与重复请求 | 前端、Rust 测试覆盖本地午夜前后、按实际完成时间归属、重复完成与重复启动补录去重；重复任务按实例分别保存。 |
| 保留手写内容 | 页面分为自动完成记录与手动工作补充。编辑面板打开期间自动追加的回归测试通过；浏览器恢复旧草稿后保存，仍保留新追加的两项自动快照。 |
| 完成撤销 | 当天撤销后只撤回自动条目，手写总结保留。跨日撤销的快照与时间保留，素材归入“完成后撤销”，导出注明撤销。 |
| 删除与恢复 | 删除源任务不影响快照；删除自动日记后创建删除标记，刷新／启动补录不能将日记恢复，手动恢复后自动条目与手写内容完整。 |
| 事务失败与并发 | 注入自动快照写入失败后，任务仍待办、提醒保留、重复任务不生成；并发完成仅产生一份快照和一个后续实例。浏览器存储失败同样保留待办状态。 |
| Unicode 与长备注 | 完整保存任务允许的标题、清单名称和 100000 字符备注，包含补充平面字符；快照独立于手写条目的长度约束。 |
| 搜索、总结与导出 | 自动事项参与现有搜索、状态／重点／主题筛选及阶段素材。浏览器实际下载 [Markdown](daily-journal.md)，包含两项任务与手写总结。 |
| 数据库升级与备份 | Schema 6 升级后原日记及版本号保持，补录现存完成时间；Schema 6 备份仍可校验。自动快照在删除原任务后经真实备份恢复仍完整。 |
| 浏览器持久化与隔离 | 临时任务刷新清空后，已保存日记快照仍在且不重复；银行样本保持独立命名空间，刷新不重复生成当日样本。 |
| 小屏 | 1280px 与 390px 观察时间线，390px 编辑面板无横向溢出；浏览器运行未捕获页面异常。 |

## 检查命令

最终结果：前端全量 42 个文件／281 项测试通过；Rust 全量 53 项通过，包含真实进程崩溃恢复。TypeScript、全量 ESLint、生产构建、Rust 格式检查和 `git diff --check` 通过。浏览器 8 组交互检查通过，页面异常为 0。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src vite.config.ts
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2 --testTimeout=15000
node node_modules/vite/bin/vite.js build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --lib
git diff --check
```

浏览器使用本机 Edge 的独立无头上下文与 Asia/Shanghai 时区，测试普通入口及虚构银行样本。重跑 [browser-qa.mjs](browser-qa.mjs) 前设置 `TODOA_QA_NODE_MODULES` 为 Codex 依赖目录的 `node_modules`，并设置 `TODOA_QA_URL` 为本地开发服务器地址；默认 `http://127.0.0.1:1424`。结构化结果见 [browser-results.json](browser-results.json)。

## 界面证据

- [宽屏日记](automatic-daily-journal-wide.png)
- [390px 日记](automatic-daily-journal-narrow.png)
- [390px 编辑面板](automatic-daily-journal-editor.png)
- [银行样本日记](bank-automatic-journal.png)

## 数据与交付边界

旧版本已经撤销并清空完成时间的记录无法准确补回；不会推断客户、业务结果或银行业绩。历史任务的补录内容取自升级时仍存在的任务，启用后的新记录保存完成当时的快照。

浏览器任务仍是临时预览数据，桌面 SQLite 保存路径另由原生与数据库测试验证。本轮未制作安装包，未做 Tauri 原生窗口或安装后 GUI 验收，未提交或推送。生产构建仅保留既有大于 500 kB 的分包提示。
