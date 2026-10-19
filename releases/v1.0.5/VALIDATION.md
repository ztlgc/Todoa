# Todoa 1.0.5 发布核验

日期：2026-10-19。目标：Windows x64（`x86_64-pc-windows-msvc`）。

## 自动化验证

| 项目 | 结果 |
| --- | --- |
| 冻结依赖锁离线核验 | 通过，pnpm-lock.yaml 无变化 |
| TypeScript / ESLint | 通过 |
| 前端测试 | 覆盖 43 文件、289 项通过 |
| Rust 格式检查 | 通过 |
| Rust 测试 | 57 项通过，0 失败；bin 与文档测试通过 |
| 生产浏览器每日流程 | 11 组通过，0 页面错误 |
| 生产浏览器日／周／月／年范围 | 8 组通过，0 页面错误 |
| 生产构建与 NSIS 打包 | 通过 |

前端首轮通过 42 文件／279 项，另一个文件 `src/features/lists/ListsWorkspace.test.tsx` 遇到工作进程启动超时，没有断言失败。随后单独重跑该文件，10 项全部通过，无错误。上述 289 项为两次运行合计覆盖结果。

Rust 验证包含迁移、事务、数据库备份恢复、真实进程崩溃恢复、Windows 文件锁、富文本内容和图片归属。生产浏览器使用隔离 Edge 上下文及本次构建的 dist，覆盖日期切换前保存、格式和图片刷新保留、月历标记、跨周期浏览、单篇编辑、含图片的真实 Markdown 下载、历史与回收站隔离、恢复及 390px 布局；未操作用户桌面数据库。

浏览器脚本、截图及逐项结果见 [每日流程](../../docs/simple-journal-2026-10-18/VALIDATION.md) 与 [范围浏览](../../docs/journal-periods-2026-10-19/VALIDATION.md)。机器可读摘要见 [test-results.json](test-results.json)。

## 安装包核验

构建命令：

```powershell
pnpm tauri build --ci --bundles nsis --target x86_64-pc-windows-msvc
```

| 项目 | 结果 |
| --- | --- |
| 文件 | `Todoa_1.0.5_x64-setup.exe` |
| 大小 | 3,136,212 字节 |
| SHA-256 | `09f6de917cf262d1529cf743ad845763bca81fa9df835760b0fab5790377d050` |
| 安装器 ProductVersion | 1.0.5 |
| 应用 ProductVersion | 1.0.5 |
| 应用 PE 架构 | x86_64（0x8664） |
| 7-Zip 归档完整性与提取 | 通过 |
| 包内程序与构建产物比对 | 预期 Tauri NSIS 标记补丁后逐字节一致 |
| 代码签名 | 未签名（NotSigned） |

Tauri 在打包时将程序中的单个 `__TAURI_BUNDLE_TYPE_VAR_UNK` 标记替换为 `__TAURI_BUNDLE_TYPE_VAR_NSS`，完成后恢复独立 exe。包内程序与独立 exe 原始 SHA-256 因这 3 个字节不同；验证在确认恰好一个标记后应用同样替换，再比较全部字节，结果一致。具体摘要见 [artifact-details.json](artifact-details.json) 与 [SHA256SUMS.txt](SHA256SUMS.txt)。验证只提取归档，未运行安装器。

## 验证边界

本轮没有覆盖现有安装或用户数据库，未完成安装后的原生 GUI 操作验收。Windows 11、安装版通知实际显示、真实登录自启和跨显示器 DPI 仍需目标环境验证。浏览器预览数据与桌面数据库相互独立。

构建保留既有的大于 500 kB 分包提示，未通过提高阈值隐藏提示。安装包未签名。
