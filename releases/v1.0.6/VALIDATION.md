# Todoa 1.0.6 发布核验

日期：2026-10-31。目标：Windows x64（`x86_64-pc-windows-msvc`）。

## 构建与测试状态

生产构建命令：

```powershell
pnpm tauri build --ci --bundles nsis --target x86_64-pc-windows-msvc
```

构建退出码为 0，TypeScript、Vite 生产构建和 Rust Release 编译均完成，NSIS 安装程序成功生成。构建保留既有的大于 500 kB 分包提示。

发布前实现验证覆盖 49 个前端文件／355 项测试、ESLint、TypeScript、生产构建、Rust 63 项测试及隔离原生流程，详见 [日记回顾验证](../../docs/journal-review-2026-10-31/VALIDATION.md)。用户在最终发布阶段明确要求不再测试，因此未将全量测试复跑作为本次发布构建的 Gate；本次核验只陈述已完成的构建和安装包检查，不把此前测试结果冒充为本次新增结果。

## 安装包核验

| 项目 | 结果 |
| --- | --- |
| 文件 | `Todoa_1.0.6_x64-setup.exe` |
| 大小 | 3,187,185 字节 |
| SHA-256 | `bcdd2511ae10e39cde0b528265dc7ed2e827785f49cd770ed0a8ef2c951dc3a4` |
| 安装器 ProductVersion | 1.0.6 |
| 应用 ProductVersion | 1.0.6 |
| 应用 PE 架构 | x86_64（0x8664） |
| 7-Zip 归档完整性 | 通过 |
| 内嵌程序与构建产物 | Tauri NSIS 标记补丁后逐字节一致 |
| 代码签名 | 未签名（NotSigned） |

Tauri 在打包时将程序中的单个 `__TAURI_BUNDLE_TYPE_VAR_UNK` 标记替换为 `__TAURI_BUNDLE_TYPE_VAR_NSS`。核验从安装包提取内嵌程序，确认标记数量，并在独立构建程序副本上应用相同替换后逐字节比较，结果一致。具体摘要见 [artifact-details.json](artifact-details.json) 与 [SHA256SUMS.txt](SHA256SUMS.txt)。

## 验证边界

本轮没有运行安装器、覆盖用户现有安装或读取正式用户数据库。Windows 11、安装后原生 GUI、真实中文输入法跨午夜、系统通知实际显示、真实登录自启和跨显示器 DPI 仍需目标环境验证。安装包未签名，浏览器预览数据与桌面数据库相互独立。
