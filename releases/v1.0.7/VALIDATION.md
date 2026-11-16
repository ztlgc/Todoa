# Todoa 1.0.7 发布核验

日期：2026-11-16（Asia/Shanghai）。目标：Windows x64（`x86_64-pc-windows-msvc`）。

## 构建与测试状态

生产构建命令：

```powershell
pnpm tauri build --ci --bundles nsis --target x86_64-pc-windows-msvc
```

构建退出码为 0，TypeScript、Vite 生产构建、Rust Release 编译和 NSIS 安装程序生成均完成。Rust Release 编译用时 7 分 04 秒，前端保留既有的大于 500 kB 分包提示。日志见 [package-build.txt](package-build.txt)。

本次实现已通过前端 51 个文件／429 项测试、Rust 72 项测试、ESLint、TypeScript、生产前端构建和 Rust 格式检查，详见 [日期与重复审查记录](../../docs/schedule-audit-2026-11-16/VALIDATION.md)。全量测试在版本号升至 1.0.7 前完成，版本号调整后未再次运行全量测试；发布阶段重新通过 ESLint、Rust 格式检查、版本一致性核验和生产安装包构建，不将打包视为新增测试结果。

package、Tauri 配置、Cargo 与 Cargo.lock 中的应用版本均为 1.0.7，应用身份为 `com.todoa.desktop`。数据库 Schema 由 9 升至 10，新增重复任务处理进度；迁移、完成事务、备份恢复等自动化证据见上述审查记录。

## 安装包核验

| 项目 | 结果 |
| --- | --- |
| 文件 | `Todoa_1.0.7_x64-setup.exe` |
| 大小 | 3,197,152 字节 |
| SHA-256 | `c572fc553fd1828bbb39c9b0519617c94a3c4c4b4194f311244e211967db6c20` |
| 安装器 ProductVersion | 1.0.7 |
| 构建应用 ProductVersion | 1.0.7 |
| 包内应用 ProductVersion | 1.0.7 |
| 应用 PE 架构 | x86_64（0x8664） |
| 7-Zip 归档完整性 | 通过，见 [archive-test.txt](archive-test.txt) |
| 内嵌程序与构建产物 | Tauri NSIS 标记补丁后逐字节一致 |
| 代码签名 | 未签名（NotSigned） |

核验从安装包提取 `todoa.exe`，在独立构建程序副本上将唯一的 `__TAURI_BUNDLE_TYPE_VAR_UNK` 替换为 `__TAURI_BUNDLE_TYPE_VAR_NSS`，并与提取的内嵌程序逐字节比较，结果一致。构建应用 SHA-256 为 `220b0d4851dda4b72d6ee1b4e1a5cb47e2577e7e5f0112bb13f43fd23d1aba75`，包内应用 SHA-256 为 `d2e9af9e6ad6531a962cdc3bb68557c19985f5706e396136f50007fe3fa48cf1`。

结构化核验摘要见 [artifact-details.json](artifact-details.json)，安装包校验清单见 [SHA256SUMS.txt](SHA256SUMS.txt)。

## 验证边界

本轮没有运行安装器、覆盖用户现有安装或操作正式用户数据库，`installation_performed` 为 `false`。真实浏览器操作未完成，组件自动化不能作为真实界面验收。安装后原生 GUI、系统通知实际送达、休眠唤醒和时区变化后的实际行为、Windows 11、真实登录自启及跨显示器 DPI 仍需目标环境验证。

升级前建议在旧版「设置 → 数据」创建数据库备份。升级前已撤销完成的旧重复任务没有历史处理进度可供追溯；手动创建的独立提醒没有规则偏移，撤销完成不会重建这类提醒。
