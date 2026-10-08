# PROJECT_STATE

更新日期：2026-10-08（Asia/Shanghai）

## 2026-10-08 自定义重复扩展

- 日期面板新增周多选、月内日期多选、相对星期、首末工作日、年度规则、实际完成时刻间隔、自选日期和结束条件；独立编写 Todoa 的界面与规则引擎。
- 沿用 SQLite `repeat_rule` 字段保存版本化规则，兼容旧规则；浏览器和 Rust 均实现生成、停止及提醒保留，不仅是界面预览。
- 前端 215 项测试、Rust 41 项测试、构建和 lint 通过；26 组日期样例由两端共用。浏览器已验证周一/周三的生成与次数结束，以及每月首个工作日生成 11 月 2 日。
- 工作日按周一至周五计算；无节假日/调休日历。此次未重打安装包，未做安装版或原生窗口 GUI 验收。规则语义和边界见 [RECURRENCE.md](RECURRENCE.md)。
- 修复了既有 Cargo.lock 中混入的工具输出与缺失包条目，原文件已备份，再由 Cargo 离线补全。

## 当前步骤与范围

- STEP 0：已验收（Windows 开发环境检查）。
- STEP 1：已验收（当前 Windows 10 x64 开发主机上的基础项目、编译和实际窗口）。
- STEP 2：已验收（当前 Windows 10 x64 开发主机上的 Tailwind/shadcn 基础页、构建和键盘操作）。
- STEP 3：已验收（实际文件目录、依赖边界、构建和原窗口行为）。
- STEP 4：已验收（依赖、一次性测试、lint、构建、Rust 检查和自动权限审查）。
- STEP 5：已验收（SQLite Migration 1、Database Boot、隔离库与原生 IPC/ACL/失败门验证）。
- STEP 6：已验收（Task Domain、TS Repository、单元协议测试及隔离 Tauri IPC 数据链）。
- STEP 7：已验收（Ready 门、TanStack Query Hooks、离线标志/缓存失效与真实 Tauri 数据链及窗口刷新）。
- STEP 8：已验收（Inbox CRUD、真实原生界面、逐项退出重启持久化；第一阶段 Gate PASS）。
- STEP 9：已验收（清单 CRUD、当前清单新增、任务移动、删除清单回 Inbox、原生失败路径与重启持久化）。
- STEP 10：已验收（标签创建/分配/移除/删除、真实标签筛选、判重、幂等、外键级联与原生重启持久化）。
- STEP 11：已验收（Main 最小权限、原生 CRUD/重启回归和真实 ACL 拒绝）。
- STEP 12：已验收（独立 Quick Add、窄 Rust 创建、独立 Capability、真实窗口/IPC/重启验证）。
- STEP 13：已验收（本次 STEP 15 的“重复启动无第二托盘”要求所需前置；首插件拦截、隐藏/最小化 Main 唤醒、无第二长期进程）。
- STEP 14：已验收（按本次明确授权独立执行；固定 Rust 快捷键、真实触发/冲突/正常退出注销，验收期间只运行一套应用实例）。
- STEP 15：已验收（真实 Tray 菜单/找回、关闭隐藏、统一 Quit、Main/Quick 在途写入、热键释放、单实例无重复 Tray、失败回退）。
- STEP 16：已验收（提醒 CRUD/重启、Rust 完成事务、隔离 fake 调度/失败/并发/时钟/停止；正式出口禁用且不消费提醒）。
- STEP 17：已验收（Windows 开发版实际通知 API 成功/错误、触发状态、重启补发、Rust-only ACL；安装版显示 Gate 待 STEP 22）。
- STEP 18：已验收（当前 Windows 开发主机；一致性快照、隔离文件故障/进程崩溃、真实 Tauri 恢复和启动迁移失败回滚）。
- STEP 19：已验收（开发 Gate；实际窗口状态、OS 自启状态、真实托盘后台启动和单实例；真实登录留 STEP 22）。
- STEP 20：已验收（开发 Gate；真实六视图、编辑与重启、日期/时区/夏令时、恢复后重建、键盘/焦点及真实 Windows 中文输入法）。
- STEP 21–22：本次 UI 设计目标暂不实施。
- STEP 0 时当前目录只有《Windows待办应用AI开发执行手册-最终修订版.md》，且不是 Git 仓库；本文件于 STEP 0 首次创建。STEP 2 Inspect 时已存在 Git 仓库，文件仍均为未跟踪状态；本步未提交。
- STEP 0 Inspect 时 `docs/ADR.md`、源码、package/Cargo manifests、lockfile、Tauri 配置、Capability、permissions、Migration 均不存在。STEP 1 现已创建基础项目与 `docs/ADR.md`；permissions 和 Migration 仍未建立，因为本步没有自定义 command 或数据库。

## STEP 0 环境证据（执行当时）

| 检查项 | 状态 | 本机证据 |
| --- | --- | --- |
| Windows x64 开发主机 | PASS | Windows 10 企业版 10.0.19045，64 位；进程和 OS 均为 x64。手册默认产品目标 Windows 11 x64，尚未在该目标系统验证。 |
| Node.js | PASS | `node --version` → `v24.14.1`，退出 0；满足当前 Vite 指南的 Node 20.19+ / 22.12+ 要求。 |
| pnpm | PASS | `pnpm --version` → `11.19.0`，退出 0；当前命令来自 Codex 工作区运行时，项目尚无 `packageManager` 锁定。 |
| Rust / Cargo | PASS | `rustc --version` → `1.94.1`；`cargo --version` → `1.94.1`；均退出 0。 |
| Rust x64 MSVC | PASS | `rustup show`：默认且活动的 `stable-x86_64-pc-windows-msvc`，已安装 `x86_64-pc-windows-msvc` target；`rustc -vV` host 相同。 |
| Git | PASS | `git --version` → `2.20.0.windows.1`，退出 0。 |
| MSVC C++ Build Tools | PASS | `vswhere` 找到完整、可启动的 Visual Studio 2026 Build Tools 18.4.2；`VC.Tools.x86.x64` 组件可查询，MSVC 14.50.35717 的 x64 `cl.exe`、`link.exe` 均存在。普通 shell 的 PATH 不作为缺失判据。 |
| Windows SDK | PASS | Windows Kits 注册 `KitsRoot10`；10.0.26100.0 的 x64 `rc.exe`、`mt.exe`、UM/UCRT 库和头文件均存在。 |
| WebView2 Runtime 安装 | PASS | 卸载注册项显示 Microsoft Edge WebView2 Runtime `154.0.4258.53`；同版 `msedgewebview2.exe` 存在。应用中的实际加载留待 STEP 1。 |
| Tauri 编译与窗口运行 | 当时待验收 | STEP 0 尚无应用；STEP 1 的实际窗口证据见下文。 |

核对依据：[Tauri Windows 前置依赖](https://v2.tauri.app/start/prerequisites/)、[Vite Node 版本要求](https://vite.dev/guide/)。上述为 STEP 0 的依赖状态；STEP 1 锁定版本见下文。

## 实际命令与结果摘要

- `node --version`、`pnpm --version`、`rustc --version`、`cargo --version`、`rustup show`、`git --version`：均退出 0；版本见上表。
- `rustup target list --installed`、`rustc -vV`：退出 0；确认 x64 MSVC。
- `vswhere -all -products *`、`vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64`：执行成功；确认 Build Tools 和 VC 组件，另检查编译器文件。
- 查询 Windows Kits 注册表及 SDK 文件、WebView2 卸载注册项及可执行文件：存在，见上表。
- `git rev-parse --is-inside-work-tree`：退出 128；当前目录不是 Git 仓库。
- `Get-AppxPackage` 探测因当前 PowerShell 平台不支持 Appx 模块而失败；WebView2 使用卸载注册项和可执行文件独立确认，未将该探测当作运行验证。

## STEP 0 当时的 ADR、验证边界与后续

- ADR 落地/变更：无。手册的技术架构与 ADR 决策保持原样；STEP 0 时 `docs/ADR.md` 尚未创建。
- 隔离测试位置：无；本步未产生测试数据，也未运行应用测试。
- GUI 当时待验收：STEP 1 已在当前主机完成基础窗口显示检查；Windows 11 x64 目标机验证仍未完成。
- 已知问题：开发主机为 Windows 10 x64，与手册默认 Windows 11 x64 产品目标不同；这不等于 Windows 11 运行 PASS。项目版本锁定、编译和窗口验证均属于后续步骤。
- 外部发布依赖：代码签名证书/服务和 Updater 托管地址未检查或提供；仅在后续发布步骤处理。
- STEP 0 完成时下一步为 STEP 1；已收到明确指令并执行，记录见下文。

## STEP 1 基础项目

- 使用官方 `create-tauri-app` 4.7.4 的 pnpm/React/TypeScript 模板，在当前项目根目录落地；生成器临时创建的同名子目录已搬空并删除。已有手册与 STEP 0 状态文件未覆盖。
- `productName = Todoa`；正式 identifier `com.todoa.desktop`；基础窗口 label `main`。开发与测试配置分别用 `com.todoa.desktop.dev`、`com.todoa.desktop.test`；开发运行显式传入开发配置。目标为 `x86_64-pc-windows-msvc`，bundle 目标设为 NSIS，未制作安装包。
- 删除模板演示 `greet` command、opener 插件及其权限、外链演示 UI；保留本地的简体中文基础窗口页面。未实现任何待办业务、数据库或 STEP 2 样式组件。
- `packageManager` 固定 pnpm 11.19.0；`rust-toolchain.toml` 固定 Rust 1.94.1 与 x64 MSVC target。`pnpm-lock.yaml` 和 `src-tauri/Cargo.lock` 已生成。
- 锁定的直接依赖：`@tauri-apps/api` 2.12.1、React/React DOM 19.3.0、`@tauri-apps/cli` 2.12.1、Vite 8.3.2、TypeScript 6.0.3、`@vitejs/plugin-react` 6.1.1；Rust Tauri core 2.12.1、tauri-build 2.7.1。业务插件、SQLx、SQLite 均未安装或运行。
- ADR 落地见 `docs/ADR.md`。保留模板的 `core:default` 与 CSP 配置；实际权限将随 API 使用情况在后续步骤收紧。

### 实际命令与验证

- `pnpm create tauri-app ... --manager pnpm --template react-ts --identifier com.todoa.desktop --tauri-version 2 --yes`：退出 0；版本 4.7.4。生成器先放入当前目录下同名子目录，随后逐项确认无碰撞后移动到根目录。
- `pnpm install`：退出 0；`pnpm install --frozen-lockfile`：退出 0。
- `pnpm build`：退出 0；脚本先执行 `tsc` 再执行 Vite build。无 lint 脚本或业务测试，本步未声称测试通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`：退出 0；加 `--locked` 重跑：退出 0。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：首次因固定工具链缺少 rustfmt 而未运行；安装该必要组件后重跑退出 0。
- `pnpm tauri dev --config src-tauri/tauri.dev.conf.json --target x86_64-pc-windows-msvc`：完成编译并启动 `todoa.exe`。确认 `Todoa` 顶层窗口可见、WebView2 子进程存在，截图中可读到 STEP 1 基础页面。证据：`docs/evidence/step1-window.png`。验收后以 Ctrl+C 主动结束开发会话；因此会话最终退出码 1 / `STATUS_CONTROL_C_EXIT` 是主动停止结果，不是启动失败。
- 静态配置检查：正式、开发、测试 identifier 互异；Capability 只匹配 `main`；`opener:default` 已移除。

### GUI、隔离数据和遗留问题

- GUI：当前 Windows 10 x64 主机上的基础窗口显示 **PASS**，截图见上文。真实业务 IPC、持久化、安装版及 Windows 11 x64 目标机运行均未验收，按相应后续 STEP 执行。
- 隔离测试位置：本步没有数据库或测试数据。开发/测试 identifier 已分离；后续 STEP 5 必须再核对实际 AppConfig 路径和数据库文件位置。
- 外部依赖：代码签名证书/服务和 Updater 托管地址仍未检查或提供；属于后续发布步骤。
- 一次临时空目录清理请求被自动策略拒绝（无更详细原因）；该目录位于系统临时目录，不影响项目内容或验证，未继续尝试删除。
- STEP 1 完成时下一步为 STEP 2；已收到明确指令并执行，记录见下文。

## STEP 2 Tailwind CSS 与 shadcn/ui Base UI

- 按现有 Vite 项目流程安装 Tailwind CSS 4.3.3、`@tailwindcss/vite` 4.3.3，配置 Vite 插件与 `src/index.css` 入口。
- 使用 shadcn CLI 4.21.1 初始化 `base-nova` / neutral 预设；`components.json` 的 `style` 为 `base-nova`。只生成 `button.tsx`、`input.tsx`、`checkbox.tsx` 和必要的 `src/lib/utils.ts`，没有添加全部组件。临时页面为三个组件的样式和键盘验证页，不是待办业务 UI。
- `@/*` 别名已在 Vite 和 TypeScript 配置中接到 `src`。TypeScript 6.0.3 对 `baseUrl` 报弃用错误，移除后保留 `paths`，重新构建通过。CLI 生成的主题 token 未手工改动。
- 直接依赖新增并锁定：`@base-ui/react` 1.8.0（组件底层）、`@fontsource-variable/geist` 5.3.0（本地字体）、`class-variance-authority` 0.7.1（Button 变体）、`cn` 0.4.0（class 合并）、`lucide-react` 1.50.0（Checkbox 图标）、`shadcn` 4.21.1（生成样式入口）、`tw-animate-css` 1.4.0（生成样式动画）；开发类型 `@types/node` 26.6.4。无直接 Radix 依赖。具体版本见 `pnpm-lock.yaml`。
- ADR 记录见 `docs/ADR.md`；项目身份、数据隔离、Tauri 权限和 Rust 依赖未改变。

### 实际命令与验证

- `pnpm dlx shadcn@latest --version` → 4.21.1，退出 0；后续 CLI 命令固定使用 `shadcn@4.21.1`。
- `pnpm add tailwindcss @tailwindcss/vite`、`pnpm add -D @types/node`：均退出 0。
- `pnpm dlx shadcn@4.21.1 init --template vite --base base --preset base-nova --yes`：退出 1，CLI 拒绝该 preset 名；改用 `--preset nova` 后退出 0，生成配置样式仍为 `base-nova`。
- `pnpm dlx shadcn@4.21.1 add input checkbox --yes`：退出 0；Button 已由 init 生成。
- `pnpm build`：首次因 TypeScript 6 的 `baseUrl` 弃用报错而失败；移除该项后重跑退出 0，包含 `tsc` 类型检查和 Vite 构建。本地 Geist woff2 已进入 `dist/assets`。
- `pnpm install --frozen-lockfile`：退出 0。没有 lint 脚本或业务测试；本步没有修改 Rust 代码。
- 静态核对：`components.json` 为 `base-nova`，`src/components/ui` 恰有 Button/Input/Checkbox 三个文件，`@base-ui/react` 已安装，没有直接 Radix 依赖。
- `pnpm tauri dev --config src-tauri/tauri.dev.conf.json --target x86_64-pc-windows-msvc`：完成编译并显示真实 Todoa 窗口。初始截图 `docs/evidence/step2-initial.png`；键盘操作前后截图 `docs/evidence/step2-keyboard-first.png`、`docs/evidence/step2-keyboard-pass.png`。验收后主动 Ctrl+C 结束，最终会话退出 1 / `STATUS_CONTROL_C_EXIT` 属于主动停止。

### GUI、隔离数据和遗留问题

- GUI：当前 Windows 10 x64 主机 **PASS**。窗口里三个组件的样式可见；Tab 焦点依次进入 Input、Checkbox、Button，Input 接受键盘文字，Space 切换 Checkbox，Enter 提交 Button，状态文字显示输入与选中结果。Windows 输入法会转换按键文本；验收以页面实际输入和提交结果一致为准。
- 隔离测试位置：使用 STEP 1 的开发 identifier `com.todoa.desktop.dev`；本步只操作临时 UI 状态，没有业务持久化数据。
- Windows 11 x64 目标机、安装版和业务 IPC 未验收，按后续对应 STEP 处理。代码签名与更新托管资源仍未检查。
- STEP 2 完成时下一步为 STEP 3；已收到明确指令并执行，记录见下文。

## STEP 3 目录与边界

- 将实际主窗口入口从 `src/main.tsx` 移至 `src/windows/main.tsx`，并更新 `index.html`；将现有根组件从 `src/App.tsx` 移至 `src/app/App.tsx`。现有 shadcn `src/components/ui/` 与 `src/lib/utils.ts` 保持原位。没有改动验证页行为或主题 token。
- `src/domain`、`src/data`、`src/features`、`src/stores` 及 Rust `db/services/commands`、`migrations/permissions` 尚无实际职责，本步没有创建它们，也没有增加占位文件。
- ADR 已记录当前 `windows → app → components/ui` 导入方向、未来 feature/domain/repository/db 的职责、SQL 的窄 Rust command 例外与禁止的泛化架构。当前仅为文档和导入约束，尚无自动静态边界检查工具。
- 新增依赖及版本变更：无。`package.json`、`pnpm-lock.yaml`、`Cargo.toml`、`Cargo.lock`、Capability 和 Tauri 配置均未变更。

### 实际命令与验证

- Inspect：读取本手册、PROJECT_STATE、ADR、现有 TS/Rust 源码、manifests、lockfile、Tauri 配置和 Capability；当前无 permissions 或 Migration 文件，未补造。
- 移动文件前核对源路径位于工作区 `src` 且目标不存在，再移动两个现有文件；未覆盖已有文件。
- `pnpm build`：退出 0，含 TypeScript 类型检查；`cargo check --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`：退出 0。
- `pnpm tauri dev --config src-tauri/tauri.dev.conf.json --target x86_64-pc-windows-msvc`：完成编译并显示真实 `Todoa` 窗口，STEP 2 验证页保持原样；截图为 `docs/evidence/step3-window.png`。验收后主动 Ctrl+C 结束，最终会话退出 1 / `STATUS_CONTROL_C_EXIT` 属于主动停止。
- 为核对原交互，重新运行同一开发命令：输入框接受键盘输入；中文输入法完成组合输入后，Tab 聚焦 Checkbox、Space 选中、Tab 聚焦 Button、Enter 提交，结果显示“复选框：已选中”。截图：`docs/evidence/step3-keyboard.png`（选中前）和 `docs/evidence/step3-keyboard-pass.png`（提交后）。第二次开发会话验收后同样主动结束。
- 没有新测试、lint 脚本或业务功能；本步未把这些项目记为 PASS。

### GUI、隔离数据和遗留问题

- 当前 Windows 10 x64 GUI：**PASS**，真实窗口截图确认布局与 STEP 2 验证页仍显示，且本步重复了输入、Checkbox、Button 的键盘链路。输入法组合输入期间 Space 会被输入法接收；组合完成后组件操作正常。
- 开发运行继续使用 `com.todoa.desktop.dev`；没有业务数据库或测试数据。
- STEP 1 模板留下的 `src/assets` 和 `public` 为空目录、没有占位文件；尝试移除空目录时自动审批审查返回 `blocked by policy`，未继续尝试。这两个空目录不被 Git 跟踪，也不参与构建。
- Windows 11 目标机、业务 IPC、安装版未验收；后续按对应 STEP 处理。
- 下一步：STEP 3 Gate 已通过；等待明确指令再执行 STEP 4。

## STEP 4 依赖与测试基础

- 用 `pnpm tauri add sql` 安装 SQL 插件 Rust/JS 绑定，随后在 `Cargo.toml` 开启 `sqlite` feature。直接新增并锁定的 JS 运行依赖：`@tanstack/react-query` 5.104.1、`zustand` 5.0.15、`zod` 4.6.5、`@tauri-apps/plugin-sql` 2.5.0；开发依赖：Vitest 5.0.3、ESLint 10.12.0、`@eslint/js` 10.0.1、`typescript-eslint` 8.71.0。Rust 直接依赖 `tauri-plugin-sql` 锁定 2.5.0，插件依赖的 SQLx/`sqlx-sqlite` 锁定 0.8.6，`libsqlite3-sys` 0.30.1。Rust SQLx 暂无直接依赖，因为尚无 Rust 数据库调用；当前 Cargo 依赖树只激活 SQLite 驱动，未激活 MySQL/PostgreSQL 驱动。
- 新增 `pnpm test` 一次性脚本和 `pnpm lint`；Vitest 测试对现有 `cn` 工具的条件样式与冲突间距有实际断言。没有加入浏览器 DOM 测试或声称这覆盖 Tauri IPC、真实 SQL、Migration、业务规则。
- SQL 安装工具自动在 `src-tauri/capabilities/default.json` 加入 `sql:default`，并在 `src-tauri/src/lib.rs` 静态注册 SQL 插件。审查后均撤销：当前 Capability 仍只匹配 `main`，权限只含 `core:default`；没有任何未来窗口预授权。按固定启动 ADR，SQL 插件的动态初始化、preload 和 Migration 留在 STEP 5。
- 没有加入通知、快捷键、托盘、自启、dialog、updater、window-state、single-instance、日期/复杂表单库，也没有创建数据库、业务代码或业务数据。ADR 决策见 `docs/ADR.md`。

### 实际命令与验证

- `pnpm tauri add sql`、`pnpm add @tanstack/react-query zustand zod`、`pnpm add -D vitest eslint @eslint/js typescript-eslint`：退出 0。安装时 npm 注册表曾出现一次 `ECONNRESET`，pnpm 自动重试后完成。
- `pnpm install --frozen-lockfile`：退出 0。
- `pnpm build`：退出 0，包含 `tsc` 类型检查与 Vite 8.3.2 构建。
- `pnpm test`：退出 0，1 个测试文件、1 项测试通过；测试有两条实际断言。
- `pnpm lint`：首次发现测试代码中使用常量布尔短路表达式，退出 1；调整为布尔参数输入后重跑退出 0，没有禁用规则。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`：首次因新启用的 `sqlite` feature 需要更新 Cargo.lock 而退出 1；无 `--locked` 的 `cargo check` 更新锁文件并退出 0，随后相同的 `--locked` 检查退出 0。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo tree --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --prefix none`：均退出 0；依赖树确认 SQLx 与 SQLite 驱动版本及没有激活 MySQL/PostgreSQL 驱动。
- 静态权限检查：`src-tauri/capabilities/` 只有 `default.json`，窗口列表仅 `main`，权限仅 `core:default`；Rust 入口无 `.plugin(tauri_plugin_sql...)`。

### GUI、隔离数据和遗留问题

- 本步没有变更 UI，也没有重新启动 Tauri 窗口，故 STEP 4 的 GUI 实际运行验收记为**未执行**；上次 GUI 通过的证据仅属于 STEP 3。构建通过不等于本步窗口运行 PASS。
- 本步测试为 Node/Vitest 中的纯 TS 测试，没有创建数据库或测试用户；开发/测试 identifier 继续分离，实际数据库路径仍待 STEP 5 核对。
- 当前 Windows 10 x64 开发主机的构建、测试、lint、Rust check 均通过；Windows 11 x64 目标机、真实 SQL 初始化/IPC、Migration、安装版尚未验证，按后续步骤处理。
- 当前仓库文件均未跟踪；本步没有提交。STEP 4 Gate 已通过；停止，等待明确指令再执行 STEP 5。

## STEP 5 SQLite、Migration 与 Database Boot

- 新增 `src-tauri/migrations/0001_initial.sql`，作为六张业务表、六个索引、清单删除更新时刻触发器、所有时刻字段的基本格式检查、JS 安全整数约束、`application_id=0x57544431` 和 `user_version=1` 的唯一 Schema 来源。Rust 以 `MigrationKind::Up` 注册版本 1，注册 URL 和 `plugins.sql.preload` 均为 `sqlite:todo.db`。
- 启动顺序：检查已有库身份/版本/空库状态并关闭短时连接 → 短时连接切换 WAL 后关闭 → 在 Tauri setup 动态注册 SQL 插件并预加载 Migration → 克隆插件公开共享池句柄 → 同时检查两条连接的路径/外键/5 秒 busy timeout/WAL/同步策略，再核对迁移记录、Schema 对象、外键与完整性 → Rust Ready。检查失败保持失败门，不删除或替换数据库。
- 前端 `src/data/db/initDatabase.ts` 缓存一次性 Promise，先调用只读 `database_boot_status`，再 `Database.get('sqlite:todo.db')`，用实际 SQL 插件 `select('PRAGMA user_version')` 核对版本。主窗口显示真实 Ready 或错误页；错误页要求完全关闭并重新启动，不在失败进程内自动重试。
- `build.rs` 为状态 command 注册 AppManifest；`permissions/database-boot.toml` 定义独立 permission，Capability 只授权 `main`，SQL 只授权 select/execute，未授权 load/close。额外 `tauri.acl-test.conf.json` 用独立 identifier 和无权限窗口实际测试拒绝，不改变正式窗口配置。
- 新增 Rust 直接依赖 SQLx 0.8.6（与插件间接依赖同版）、`serde_json` 1.0.151（Tauri 配置宏所需），Rust 测试依赖 `tempfile` 3.27.0；Cargo.lock 已更新。为运行额外检查安装固定 Rust 1.94.1 工具链的 Clippy 组件。没有加入待办业务、Scheduler、Quick Add 或备份逻辑。

### 实际命令与自动验证

- `cargo add sqlx@0.8.6 --no-default-features --features sqlite,runtime-tokio,migrate --manifest-path src-tauri/Cargo.toml`、添加 `serde_json` 和开发依赖 `tempfile`：退出 0；`rustup component add clippy --toolchain 1.94.1-x86_64-pc-windows-msvc`：退出 0。
- `pnpm build`、`pnpm lint`、`pnpm test`：最终均退出 0。前端测试仍为 STEP 4 的 1 项 class 合并测试，不能代替 IPC 验收。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`：最终均退出 0。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`：最终退出 0，5 项 Rust 临时文件数据库测试通过。覆盖首建和重复迁移记录、六张表/索引/trigger、时间和安全 ID 约束、状态与完成时刻、外键拒绝、任务/标签级联、清单删除回 Inbox 与 UTC 毫秒更新时间、双连接及新连接 PRAGMA、真实写锁约 5 秒报错、未知/损坏/未来 Schema 拒绝，以及一条失败迁移内业务表回滚。
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --all-targets -- -D warnings`：首次因固定工具链未装 Clippy 未运行；安装组件后重跑退出 0。
- 首轮 Rust 测试曾发现池中一个连接设置 WAL 后其他连接仍返回 `delete`，因此改为插件建池前用短时连接切换 WAL；重新运行全部相关测试通过。首次 `cargo check` 还发现直接 `serde_json` 依赖缺失和一个 SQLx Result 比较错误，均修复后复核通过。

### 原生 Tauri、路径与权限验收

- 用 `pnpm tauri dev --config src-tauri/tauri.test.conf.json --target x86_64-pc-windows-msvc` 启动真实 Windows Tauri/WebView2。原生窗口可访问性文本显示“本地数据库已就绪，Schema 版本 1”；这要求 Rust Ready 与前端实际 SQL `select` 同时成功。隔离文件实测位于 `%APPDATA%/com.todoa.desktop.test/todo.db`，`PRAGMA database_list` 指向同一位置；身份为十进制 1465140273（十六进制 `0x57544431`），`user_version=1`，journal 为 WAL，插件迁移历史 `(1, success=1)`，六张业务表存在。正式 `%APPDATA%/com.todoa.desktop` 目录在测试前后均未创建。
- 关闭后再次以相同测试 identifier 启动，窗口仍 Ready，版本 1 迁移成功记录仍仅 1 条。将**隔离库**身份临时改为错误值后启动，窗口显示错误页；停止后恢复原身份，重启重新 Ready，迁移记录仍 1 条。
- 对隔离库持有独占写锁时，独立读连接返回 `database is locked`，Tauri 原生窗口显示错误页；释放锁后同一进程仍保持错误，完全关闭再启动后才 Ready。这是本阶段的安全重启路径，无自动重复 Migration。
- 用 `pnpm tauri dev --config src-tauri/tauri.acl-test.conf.json --target x86_64-pc-windows-msvc` 运行独立 identifier；`acl-probe` 原生窗口对 `database_boot_status`、SQL select、SQL execute 均得到 Tauri `not allowed on window "acl-probe"`，同一进程的 `main` 仍 Ready。正式配置未增加该窗口。
- 原生窗口截图捕获超时；GUI 证据为 Windows 可访问性树/文本及实际 SQLite 文件与 PRAGMA 复核，不记录不存在的截图。每次开发会话验收后主动 Ctrl+C 停止，退出 1 为主动停止。

### 验证边界与后续

- Migration 1 是首个发布基线，目前没有已发布的旧业务 Schema。已测空的未版本化文件升级到 v1；真正的旧业务 Schema→新版本升级须在未来 Migration 2 出现时验收。失败迁移回滚测试只证明单个版本内的业务表回滚，不声称多版本共同回滚。
- 业务 CRUD、前端 Repository、Query、Scheduler、备份恢复、正式 Windows 11 x64、安装版仍未实现或验收。没有执行 STEP 6。
- 隔离数据库在 `%APPDATA%/com.todoa.desktop.test/` 和 `%APPDATA%/com.todoa.desktop.test.acl/`；这些是合成测试数据，未访问正式库。仓库文件目前仍未跟踪；本步没有提交。
- STEP 5 Gate 已通过；停止，等待明确指令再执行 STEP 6。

## STEP 6 Task Domain 与 TS Repository

- 新增纯 TS `Task`、`TaskStatus`、`CreateTaskInput`、`UpdateTaskInput` 和筛选类型；状态仅 `todo/completed`。统一校验正安全整数 ID、标题/备注长度、状态以及带时区的合法日历时刻，并将时刻标准化为毫秒 UTC 文本。`UpdateTaskInput` 仅定义和校验类型，实际 `update/getById` 仍按手册留待 STEP 20。
- `TaskRow` 明确记录 SQLite 的 snake_case 列，`mapTaskRow` 转为 camelCase `Task`；可空列保持 `null`，状态与完成时刻不一致时拒绝映射。
- `TaskRepository` 首批 API 为 `list(filters)`、`create(input)`、`updateStatus(id,status)`、`delete(id)`。筛选区分未传 `listId`、Inbox 的 `null` 和正整数；查询列显式列出，按 `sort_order,id` 稳定排序。所有外部值绑定，不拼入 SQL；创建使用本次执行返回的 `lastInsertId` 再读取行；更新和删除按 `rowsAffected` 区分不存在。状态与 `completed_at/updated_at` 在同一条 UPDATE 中变更，重复设置同一状态保留原时刻。
- Repository 默认经 `initDatabase()` 取得已通过 Rust Ready 门的 SQL 插件连接；注入式 `TaskDatabase` 仅用于 Vitest fake adapter。没有增加 Query Hooks、业务 UI、Rust command、权限、Migration、依赖或第二个数据库驱动。STEP 5 后 Git 已建立根提交 `f49017b`；本步未提交。

### 实际命令与自动验证

- `pnpm test`：最终退出 0，2 个测试文件、6 项测试通过。STEP 6 测试覆盖 Row Mapping/null、非法 ID/标题/备注/日期、时区转 UTC、三种清单筛选语义、稳定排序、参数绑定、创建返回 ID、单语句状态更新、删除及不存在行。首轮有一处把异步拒绝当作同步异常的测试写法，修正后无未处理拒绝。
- `pnpm build`：最终退出 0，含 TypeScript 6 类型检查和 Vite 构建。首轮新增 fake adapter 的泛型测试类型不匹配，修正后通过。
- `pnpm lint`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`：最终均退出 0。Rust 代码本步未改变。

### 原生 Tauri 数据链与边界

- 仅在验收期间把临时探针加入现有启动页，用 `pnpm tauri dev --config src-tauri/tauri.test.conf.json --target x86_64-pc-windows-msvc` 启动真实 Windows Tauri/WebView2。`main` 原生窗口的可访问性文本出现 `STEP 6 IPC PASS: create → list → complete → repeat → undo → delete`。该探针实际调用默认 Repository，经 Ready、plugin-sql IPC 写读 `%APPDATA%/com.todoa.desktop.test/todo.db`，检查创建后可查、完成、重复完成时 `completed_at` 不变、取消完成清空时刻、删除后不可查。隔离库只读复核探针标题前缀剩余 0 行、`user_version=1`。
- 验收后主动停止开发会话（Ctrl+C 对 Tauri 子进程返回 `STATUS_CONTROL_C_EXIT`），完整移除临时探针；`src/app/App.tsx` 与原提交无差异。原生窗口显示与文本已实测；没有保存截图，也没有安装版或 Windows 11 x64 验收。
- 本步仅覆盖 Repository 到 SQLite 的原生链；UI→Query→Repository 的完整业务路径属于 STEP 7–8。正式 identifier 的数据库未访问；没有提前实现 STEP 7。
- STEP 6 Gate 已通过；停止，等待明确指令再执行 STEP 7。

## STEP 7 TanStack Query 与任务 Hooks

- 从现有 App 抽出 `DatabaseGate`，只在 `initDatabase()` 成功后挂载 `MainQueryProvider` 及其业务消费者；加载和失败页面保持真实启动状态。当前正式页面仍为启动验证页，首个待办业务界面留待 STEP 8。
- `createLocalQueryClient()` 建立主窗口内稳定的 QueryClient；本地查询和 Mutation 使用 `networkMode: 'always'`，查询最多重试 1 次、延迟 250ms，写入不重试。关闭浏览器默认焦点/网络重连刷新，主窗口实际 `onFocusChanged(true)` 与 `document.visibilitychange` 重新可见时显式 refetch 活动查询；卸载清理监听，包括异步注册完成晚于卸载的情况。
- 新增 `useTasks/useCreateTask/useUpdateTaskStatus/useDeleteTask`，只调用 STEP 6 Repository。成功写入后等待任务列表、受影响任务详情、任务计数缓存失效和活动查询刷新；失败保持错误状态与已有缓存，没有提前写入乐观数据。
- Query keys 集中包含 view/listId/tagId/status/dateRange，并保留列表、详情、计数的失效前缀。实际 `useTasks` 目前只暴露 STEP 6 已实现的 listId/status；tag/date 仅为手册指定的 key 维度，不代表提前实现后续过滤或视图。
- 新增测试开发依赖：`@testing-library/react` 16.3.3、`jsdom` 30.1.1；既有运行时 `@tanstack/react-query` 5.104.1 未变更。package.json 与 pnpm-lock.yaml 已记录版本。没有修改 Rust 源码、Schema、正式配置、Capability 或权限，也没有创建业务存储副本。

### 自动验证与实际命令

- `pnpm add -D @testing-library/react jsdom`：退出 0；`pnpm install --frozen-lockfile`：退出 0。
- 移除所有临时原生探针后，`pnpm build`、`pnpm test`、`pnpm lint`、`cargo check --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc` 均退出 0。build 包含 TypeScript 类型检查。
- Vitest：4 个测试文件、14 项测试通过。本步新增 8 项，使用实际 React Hooks/QueryClient 和 mock Repository；覆盖 Ready 前零调用、启动失败零调用、key 维度区分、离线标志下首查及全部写操作、每种成功 Mutation 的活动列表刷新与列表/详情/计数失效、失败创建不改缓存且仅调用 1 次、读失败最多调用 2 次、焦点/可见刷新及监听清理竞态。这些 DOM 测试不声称是真实 SQL 或 Tauri IPC。

### 原生 Tauri 与窗口验收

- `pnpm tauri dev --config src-tauri/tauri.test.conf.json --target x86_64-pc-windows-msvc` 启动真实 Windows Tauri/WebView2。临时消费者使用生产 Hooks 与 Repository；把 TanStack OnlineManager 设为离线后，真实查询→创建→完成→取消完成→删除成功，每次成功后从活动 Query 缓存确认已重新读取 SQLite；窗口文本显示 `STEP 7 NATIVE PASS`、`Mutation paused: false`、`offline flag: false`。
- 独立 Python 连接在隔离库持有 `BEGIN IMMEDIATE`，临时消费者通过 `useCreateTask` 写入。约 5 秒后真实插件返回 `database is locked`，窗口显示 `AUTO LOCK TEST PASS: cache unchanged`、`mutation error: true`、`paused: false`。随后独立连接 rollback/close；探针任务剩余 0 行，`user_version=1`。正式 AppConfig 目录仍不存在。
- 先以限定到 main 的 Tauri 焦点事件注入验证真实监听与 IPC 刷新，再用临时 `tauri.step7-test.conf.json`（同一隔离 identifier，仅 main 临时增加 hide/show/set-focus 权限）进行真实窗口 API 验收。隐藏后 `isVisible=false`，显示并聚焦后收到系统焦点事件，活动 SQLite 查询成功刷新；窗口文本为 `NATIVE WINDOW TEST PASS`，Query 更新时间由 `1791107178061` 变为 `1791107178494`。
- 两次会话验收后主动 Ctrl+C 结束，`STATUS_CONTROL_C_EXIT`/退出 1 是主动停止。临时组件和额外测试配置全部移除，正式权限没有扩大。原生可访问性结果及验证边界已保存于 `docs/evidence/step7-native.txt`。
- 截图捕获超时，坐标输入不可用、键盘尝试未移动焦点；没有记录截图或人工 GUI 操作 PASS。窗口显示/聚焦刷新由应用自己的原生 API 和真实系统事件单独验证。离线验收针对 TanStack 离线状态及真实本地 IPC，没有关闭 OS 网络适配器；完整业务界面的物理断网、重启持久化属于 STEP 8。Windows 11 x64 与安装版仍未验收。

### 后续与状态

- 当前 STEP 7 Gate 已通过。未实现 STEP 8，未进行本步 Git commit/push。
- 等待明确指令再执行 STEP 8。

## STEP 8 Inbox 垂直切片与第一阶段 Gate

- `App` 在 DatabaseGate Ready 后挂载 MainQueryProvider 与 Inbox；Inbox 仅经现有 Query Hooks 调用 Repository。筛选 `listId: null`，显示未完成和已完成任务，支持新增、完成/取消完成及带永久删除提示的确认/取消交互。列表区分 Loading、Empty、Error，读取失败可重试。
- 草稿与确认状态仅用 React local state；标题使用 Domain 校验并 trim，Enter 创建，组合输入期间的 Enter 被拦截。pending 禁用控件并用同步 ref 防止同一事件周期重复提交；新增成功才清空草稿，写入失败保留输入，状态/删除失败保留任务与实际状态。不做乐观业务副本。
- 复用已有 Base UI/shadcn Button、Input、Checkbox，没有安装项目依赖或修改锁文件、Rust 源码、Migration、正式配置与 Capability。本工作区现有 STEP 6–7 未提交变更保留，STEP 8 未 commit/push。

### 执行命令与自动验证

- `pnpm build`、`pnpm lint`：退出 0；TypeScript/Vite 构建与 ESLint 通过。
- `pnpm test`：最终退出 0，5 个测试文件、20 项测试通过。新增 6 项 Inbox DOM/Query 测试覆盖加载/空态/读取失败、空标题和 trim、IME 防误提交、pending 防重复/失败保留草稿、完成任务可见和取消完成、删除确认/取消，以及状态/删除失败不假成功。首轮一项异步调用次数断言早于 Mutation 调度，改为等待调用发生后通过，未禁用或跳过测试。
- `cargo install tauri-driver --locked`：退出 0，安装外部验收工具 tauri-driver 2.1.0；Microsoft 官方 Edge WebDriver 154.0.4258.53 与本机 WebView2 Runtime 154.0.4258.53 一致。工具不加入应用依赖。
- `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step8-test.conf.json --target x86_64-pc-windows-msvc`：退出 0；生成内嵌前端的隔离 Debug exe，无需 Vite server。该 exe 使用 `com.todoa.desktop.test.step8`，不是正式安装包。
- `python -u tests/step8_native.py --native-driver "$env:TEMP\todoa-step8-webdriver-20261004\msedgedriver.exe"`：两轮退出 0，9 项原生验收全部 PASS。第一轮从不存在的数据库建立 Schema；第二轮从空的已初始化隔离库开始，另验证每次运行时 identifier 后才允许 UI 写入。

### 原生 GUI、SQLite 与重启证据

- 实际启动 Windows Tauri/WebView2，由官方 tauri-driver/Edge WebDriver 输入 Enter、点击 Checkbox 与删除按钮；所有业务写入经渲染的 Inbox → Query → 默认 Repository → plugin-sql → SQLite。Python 仅对隔离库只读复核及持有合成写锁，没有代替 UI 写入任务。
- 隔离库：`C:/Users/Heart/AppData/Roaming/com.todoa.desktop.test.step8/todo.db`。第一轮 `initial_database_exists=false`；两轮所有检查点均为 `user_version=1`、`application_id=1465140273`、Migration 1 成功记录恰好 1 条。正式 `%APPDATA%/com.todoa.desktop` 目录检查仍不存在。
- 第二轮先确认旧 PID 退出再启动，五个不同进程 PID 为 `19788 → 11004 → 23792 → 8644 → 10896`，不是 React 组件重挂载或网页刷新冒充应用重启。

| 手册必测项 | 结果与证据 |
| --- | --- |
| 空库 | PASS，首轮文件不存在，Boot 建库，界面显示“收件箱为空”，任务 0 行。 |
| 新增 Buy milk | PASS，通过实际输入与 Enter 创建，界面可见、输入清空，SQLite 为 todo、list_id NULL。 |
| 新增后退出并重开 | PASS，新进程显示同一任务 ID、标题与 todo 状态。 |
| 完成后退出并重开 | PASS，已完成任务仍可见、勾选；completed 状态及 completed_at 精确保留。 |
| 取消完成后退出并重开 | PASS，取消勾选，todo、completed_at NULL。 |
| 删除后退出并重开 | PASS，先取消删除确认并验证行仍存在，再确认永久删除；新进程空态且任务 0 行。 |
| 空标题失败 | PASS，空白 Enter 出现标题校验错误，无任务写入。 |
| 数据库写失败保留输入 | PASS，对隔离 SQLite 持有 BEGIN IMMEDIATE 写锁；真实插件写入超时失败，显示错误并保留“Keep draft after failure”，任务仍 0 行。 |
| 离线可用 | PASS，WebDriver CDP 禁用实际 WebView2 网络，navigator.onLine=false；内嵌页面重新加载后 Ready，查询/新增/完成/取消完成/删除全部正常，最终任务 0 行。 |

- 第一轮证据：`docs/evidence/step8-20261004-180042/`。最终复跑证据：`docs/evidence/step8-20261004-180446/report.json` 及同目录 8 张实际原生截图。已查看新增后重启、完成后重启、写锁失败截图，状态/草稿与 SQL 快照一致，界面无明显裁切或重叠。
- 原生测试会话和 driver 均已结束，进程复核无 todoa/tauri-driver/msedgedriver 遗留。保留隔离测试库及截图作为证据。

### 验收边界与停止点

- 第一阶段 Gate **PASS**：真实 UI→Query→Repository→plugin-sql→SQLite，首次 Migration→Schema 与每项写入的进程重启持久化均有证据。
- 离线验证禁用的是 WebView2 网络，没有关闭 OS 网络适配器。IME 防误提交为 DOM 事件测试；不声称人工 Windows 中文输入法操作已验证。GUI CRUD、截图与重启来自真实原生 Windows 10 x64 应用；Windows 11 x64 及安装版留待 STEP 22，不标记 PASS。
- 未执行 STEP 9 或其他后续功能；报告后停止，等待明确指令。

## STEP 9 Lists、任务归属与移动

- 新增纯 TS List Domain（名称 trim、1–100 Unicode 字符、正安全整数 ID）、ListRepository 的 `list/create/rename/delete` 和 Row Mapping。SQL 值全部绑定，列表按 `sort_order,id` 稳定排序，创建读取本次 insert ID；不存在行与写失败明确拒绝，不自动重试写入。重复清单名称按现有 Schema 允许，不添加未要求的唯一规则。
- Task 创建输入增加可选 `listId`（缺省/null 为 Inbox）；创建时在同一 INSERT 写入归属。新增 `TaskRepository.setList(id,listId)`，单 UPDATE 移动到另一清单或 Inbox；保留任务状态、完成时刻及其他字段。现有 listId 筛选继续区分缺省/null/正整数，不以客户端过滤替代 SQL。
- 现有 SQL adapter 接口抽为 `data/db/SqlDatabase.ts`，两个 Repository 共用 Ready 的 SQL 插件，不新增驱动/池、GenericRepository 或业务副本。原 TaskDatabase 名称保留为类型别名供既有测试使用。
- App Ready 后挂载 ListsWorkspace：侧栏 Inbox/清单选择、创建，当前清单重命名/删除确认；任务区复用 STEP 8 组件并增加受控的归属选择。当前清单内新增直接归属该清单。清单写入成功失效清单、任务列表/详情/计数；任务移动后失效相关缓存。失败保留草稿、原归属和当前视图；删除当前清单后回 Inbox，重新读取时发现选中清单不存在也显示 Inbox。
- 清单删除提示“任务会回到收件箱，不会被删除”；仅执行 `DELETE FROM lists WHERE id=?`，依靠 Migration 1 的 `ON DELETE SET NULL` 与 `trg_tasks_list_changed_at` 原子处理归属和 updated_at。**未修改 Migration、Rust 源码、Capability、正式配置、项目依赖或锁文件**。

### 执行命令、修复与自动验证

- `pnpm build`：最终退出 0，TypeScript/Vite 通过。首轮 TypeScript 对两种不同长度 Query key 的条件参数推断失败；改为分别调用 invalidateQueries 后通过，没有类型断言绕过。
- `pnpm lint`、`git diff --check`：退出 0。
- `pnpm test`：修复后退出 0，7 个文件、30 项测试通过（本步新增 10 项）。覆盖 List 校验/Mapping、稳定排序、SQL 参数绑定、插入 ID、缺失行与失败传播；Task 当前清单创建及单语句移动/非法目标；实际 React Query 下离线清单创建/重命名、任务归属、缓存失效、删除确认/取消、失败草稿/归属/视图保留、被删除视图回 Inbox 和唯一当前标题。DOM/Repository fake 测试不替代真实外键验收。
- `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step9-test.conf.json --target x86_64-pc-windows-msvc`：两轮退出 0，含前端构建及真实 Rust 编译；隔离 Debug exe 使用 identifier `com.todoa.desktop.test.step9`，不生成安装包。
- 首次 `python -u tests/step9_native.py --native-driver "$env:TEMP\todoa-step8-webdriver-20261004\msedgedriver.exe"` 退出 1：原生界面发现任务区域与清单控制区域 sibling key 相同，切换清单后旧任务 DOM 留存。修为 `tasks-*` / `controls-*`，补充“恰好一个 h1”断言。失败报告/截图保存在 `docs/evidence/step9-20261004-182943/`，不记为 PASS。
- 修复后执行 `python -X utf8 -u tests/step9_native.py --native-driver "$env:TEMP\todoa-step8-webdriver-20261004\msedgedriver.exe" --clean-known-failed-fixture`：退出 0，11 个检查点全部 PASS。恢复选项只允许第一轮已知的两个清单/两项合成任务，核对运行时测试 identifier 后通过 UI 清理，清理前后快照保存于最终报告；没有直接 SQL 删除业务行。最终完整流程结束也通过 UI 删除合成任务，隔离库剩余清单/任务均 0 行。

### 原生清单 CRUD、删除回 Inbox 与重启验收

- 使用已有外部工具 tauri-driver 2.1.0、Edge WebDriver/WebView2 154.0.4258.53 驱动实际原生 Tauri 窗口。业务写入经 UI → Query → Repository → plugin-sql → SQLite；Python 只读快照与合成写锁。正式 `%APPDATA%/com.todoa.desktop` 目录复核仍不存在。
- 隔离库：`C:/Users/Heart/AppData/Roaming/com.todoa.desktop.test.step9/todo.db`。所有检查点 Schema=1、Migration 1 成功记录=1、foreign_key_check 无错误。五次启动 PID：`19536 → 10800 → 19340 → 21548 → 1676`，每次确认旧 PID 退出后才启动新进程。

| 手册验收项 | 结果与证据 |
| --- | --- |
| 清单创建/重命名、按清单查看、当前清单新增 | PASS，创建“工作/个人”，分别直接新增任务；重命名为“个人项目”，created_at 保留，updated_at 前进；列表界面只显示该清单任务。 |
| 创建/重命名后重启 | PASS，新进程复核全部清单/任务数据库字段与重启前快照完全相同，界面选择各清单显示正确任务。 |
| 清单间移动、移回 Inbox | PASS，Work task 从工作→个人项目；Personal task 从个人项目→Inbox；列表实时刷新，移动任务 updated_at 前进，其余字段保持。 |
| 移动后重启 | PASS，归属与全部任务字段精确保留，新进程显示正确任务分组。 |
| 不存在的目标清单 | PASS，仅向移动控件注入不存在的正整数目标并调用实际 change handler，真实 Repository/SQL 外键拒绝，归属与全部数据不变；正式 UI 不包含该选项。 |
| 写入失败不假成功 | PASS，同一隔离库 BEGIN IMMEDIATE 写锁下，创建/重命名/移动/删除四种实际写入均失败；草稿保留，原名称/归属/当前视图保留，数据库快照完全不变。 |
| 删除确认/取消，删除清单任务回 Inbox | PASS，先取消删除并核对无变化，再确认删除“个人项目”；任务数仍 4，Work task list_id=NULL、updated_at 前进，其余任务字段不变，当前视图回 Inbox。 |
| 删除清单后重启 | PASS，新进程无已删除清单，Work task 仍在 Inbox，全部字段与删除后的快照相同。 |
| 已完成任务所在清单删除、再次重启 | PASS，再删除“工作”，Completed task 回 Inbox，completed 状态/原 completed_at 保留；重启后 4 项任务、1 项完成，均归属 Inbox，无清单剩余。 |

- 最终报告与 11 张实际原生截图：`docs/evidence/step9-20261004-183322/`。已查看重命名后重启、写锁失败、删除回 Inbox、完成任务回 Inbox 后重启截图；当前标题唯一、选择与任务归属一致，较长任务列表和删除提示可滚动访问。最后复核无 todoa/tauri-driver/msedgedriver 遗留进程。

### 验收边界与停止点

- STEP 9 Gate **PASS**，STEP 8 第一阶段 Gate 保持已通过。当前 Windows 10 x64 的真实原生数据链/GUI/重启已验收；Windows 11 x64 与安装版仍留待 STEP 22，不标 PASS。离线清单逻辑本步为 Query/DOM 验证，真实 WebView 网络禁用证据仍属于 STEP 8。
- 无新增项目依赖，无额外权限；保留 STEP 6–8 既有未提交变更，本步未 commit/push。
- 未实现 Tags 或其他 STEP 10 功能；报告后停止，等待明确指令。

## STEP 10 Tags 与任务标签视图

- 新增纯 TS Tag/TaskTag 类型、Tag 名称/ID 校验：trim、1–100 Unicode 标量、正安全整数，拒绝 NUL 和孤立代理字符；Row Mapping 明确把 snake_case 转为 camelCase。
- 单个 TagRepository 提供 `list/listTaskTags/create/assign/remove/delete`。创建用单 INSERT 的 `ON CONFLICT(name) DO NOTHING`，0 行转为 TagConflictError，成功取本次 insert ID 后读取行。判重严格依照 Migration 1 的 `COLLATE NOCASE UNIQUE`（ASCII 大小写语义），不预查、不自定义全语言大小写折叠。
- 分配用单条参数绑定 INSERT 和联合主键定向冲突处理；重复分配同一关系成功且仍只有一行，其他错误正常拒绝，不使用 INSERT OR IGNORE。移除只删指定关系，0 行为 TaskTagNotFoundError；不存在的标签删除为 TagNotFoundError。非法 ID 在获取 DB 前拒绝，分配到不存在的正整数父记录由实际外键拒绝。
- TaskRepository 新增 `tagId` 参数绑定 EXISTS 筛选，可跨 Inbox/清单并与 listId/status 组合，不在 UI 过滤，不产生 JOIN 重复行。已有 Query keys 的 tag 视图维度正式启用；标签元数据、关联、任务/清单/计数缓存在成功后失效，任务删除也刷新标签关联。Ready 门与本地 networkMode always、写入不重试保持。
- 侧栏支持创建、按标签查看、带确认的删除；任务行支持一次分配或移除一个标签。标签视图显示跨清单任务、保留完成状态，移除当前标签后任务退出该视图；新建入口保持在 Inbox/清单。删除当前标签回 Inbox。业务数据只来自 Query，local state 仅保存草稿/选择/确认/错误，失败不显示假成功。
- 没有标签重命名、层级、规则引擎、批量替换标签、Rust 多语句事务或 STEP 11 权限收紧。复用现有两个 ON DELETE CASCADE 外键，不修改 Migration、Rust 源码、正式 Capability/配置、项目依赖或锁文件。

### 自动验证、命令与补核

- `pnpm build`、`pnpm lint`、`pnpm test`：最终均退出 0；TypeScript/Vite 与 ESLint 通过，9 个测试文件、41 项测试 PASS（本步新增 11 项）。原清单测试补齐空的标签查询 mock，保持既有清单回归行为。
- 单元/DOM 覆盖：Unicode 名称长度与 trim/NUL/无效代理字符、正安全 ID、Row Mapping、参数绑定/稳定排序、名称冲突分类、重复分配、缺失关联/父记录拒绝、错误传播；EXISTS 与组合筛选；IME/pending、中文创建、冲突保留输入、离线 Query 写入/缓存失效、跨清单标签视图、移除/删除与读取/写入失败保留数据。
- `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step10-test.conf.json --target x86_64-pc-windows-msvc`：两轮退出 0，包含真实 Rust 编译；exe 使用隔离 identifier `com.todoa.desktop.test.step10`，不是正式安装包。
- `python -X utf8 -u tests/step10_native.py --native-driver "$env:TEMP\todoa-step8-webdriver-20261004\msedgedriver.exe"`：两轮退出 0，均 13 个检查点 PASS。首轮证据 `docs/evidence/step10-20261004-185154/`；补核手册 ADR-009 后收紧名称非法字符校验，并使移除不存在的关联明确报错，再构建/测试/完整原生复跑。最终证据 `docs/evidence/step10-20261004-190117/`，检查 01 包含空白、NUL、孤立高代理字符拒绝。
- `git diff --check`：退出 0。没有运行或宣称未执行的独立 Rust check/test；本步 Rust 运行验证由真实编译与原生数据链提供。

### 原生约束、标签视图、级联与重启证据

- 外部工具沿用 tauri-driver 2.1.0、Edge WebDriver/WebView2 154.0.4258.53，未安装项目依赖。每次启动读取运行时 identifier 后才操作；实际业务写入经过渲染界面 → Query → Repository → plugin-sql → SQLite。Python 仅只读快照与合成写锁，没有代替 UI 写入标签或关联。
- 隔离库：`C:/Users/Heart/AppData/Roaming/com.todoa.desktop.test.step10/todo.db`。首轮从不存在的文件建库；所有检查点均为 Schema 1、application_id=1465140273、Migration 1 成功记录恰好 1 条、foreign_key_check 无结果。正式 `%APPDATA%/com.todoa.desktop` 目录仍不存在。
- 完成创建/分配、移除、任务删除、标签删除后，均确认旧进程结束再启动新进程，逐项比较清单/任务/标签/关联全字段快照；不以网页刷新代替进程重启。
- 最终五次原生启动 PID：`19880 → 10884 → 23472 → 20800 → 21676`，运行时 identifier 均为 `com.todoa.desktop.test.step10`。

| 手册验收项 | 结果与证据 |
| --- | --- |
| ASCII 大小写判重、中文名称 | PASS，Work 后创建 work/WORK 均报重名并保留输入，原标签字段不变；家庭、家务创建成功，再建家庭同样冲突。 |
| 空白/NUL/非法 Unicode、非法 ID | PASS，单元校验坏名称/ID 在 DB 前拒绝；最终原生控件拒绝空白/NUL/孤立高代理字符，标签表未写入。 |
| 重复分配同一关系 | PASS，通过 UI 两次分配 Inbox tagged→Work，关联仍恰好一行、全库快照不变；最终 3 个任务、3 个标签、5 条不同关联。 |
| 标签视图真实筛选 | PASS，重启后 Work 显示 Inbox 的任务 1 与清单中的已完成任务 3，不显示无 Work 的任务 2；家庭显示 1/2，家务只显示 3。UI task ID 与绑定 SQL 结果一致，无重复任务。 |
| 不存在的正整数标签 | PASS，向控件测试注入不存在的标签 ID，仅调用实际 UI handler；真实外键拒绝，所有任务/标签/关联不变。正式 UI 不保留该测试选项。 |
| 实际写入失败 | PASS，BEGIN IMMEDIATE 写锁下，创建、分配、移除、删除四种写入均失败；输入/标签关联仍保留，完整数据库快照完全相同。 |
| 移除关联不删除任务及重启 | PASS，移除任务 1→Work 后该任务离开 Work 视图，关联 5→4，全部 3 个任务字段完全不变；重启后仍保持，任务 1 的家庭关联仍在。 |
| 删除任务级联关联及重启 | PASS，永久删除已完成任务 3 后，任务数 3→2、关联 4→2，两个相关关系均消失、所有标签字段不变；重启后任务与关系未回来。 |
| 删除标签级联关联及重启 | PASS，先取消删除家庭并确认无变化，再确认删除；标签 3→2、关联 2→0、剩余 2 个任务全部字段不变，当前视图回 Inbox；重启后仍无已删除标签/关联，任务保留。 |
| 无孤儿与清理 | PASS，每个检查点 foreign_key_check 为空；最终通过现有 UI 删除合成标签、清单及任务，四张相关表均空，保留隔离库与证据。 |

- 最终报告 `docs/evidence/step10-20261004-190117/report.json` 及同目录 13 张实际原生截图。已查看跨清单标签视图、写锁失败和删除标签后任务保留截图；任务与标签数量较多时使用页面滚动，不声称截图包含整个页面。
- 验收完成后进程复核无 todoa/tauri-driver/msedgedriver 遗留。

### 验收边界与停止点

- STEP 10 Gate **PASS**。当前 Windows 10 x64 真实原生 GUI、SQL 约束/级联与进程重启已验收；Windows 11 x64 与安装版仍待 STEP 22。
- IME、离线标签写入是本步 DOM/Query 测试；没有人工中文输入法或本步物理断网验收，不把 STEP 8 的网络禁用记录替代成本步新证据。
- 保留 STEP 6–9 未提交变更，本步未 commit/push。未执行 STEP 11；报告后停止，等待明确指令。

## STEP 11 执行记录

- 完成：移除 core:default；Main API→permission 对照与全部 Capability/Manifest/handler 审计见 ADR STEP 11。新增 audit_capabilities.py、step11_acl.py、独立 step11-test 配置；复用清单/标签原生验收，NativeSession 使用真实数据库路径核对隔离身份。无依赖和 lockfile 变更。
- 自动：pnpm test 9 文件/41 测试、pnpm lint 均退出 0；pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step11-test.conf.json --target x86_64-pc-windows-msvc 退出 0，含 pnpm build 与原生编译；python tests/audit_capabilities.py --step 11 退出 0。
- 实际原生：step9_native.py --step 11 的 11 项清单/任务检查与 step10_native.py --step 11 的 13 项标签检查 PASS，包含重启持久化、删除清单保留任务/回 Inbox、外键和写失败。step11_acl.py 9 项真实拒绝 PASS，Main Ready 前后均成功。
- 证据：docs/evidence/step11-lists-20261004-191712、step11-tags-20261004-191757、step11-acl-20261004-191701 的 report.json/截图；已查看 Main 和拒绝窗口截图。初次 ACL 脚本将业务返回的 error 键误识为 WebDriver 协议错误，修复返回键后完整重跑通过；失败证据 step11-acl-20261004-191649 保留，不计 PASS。首次构建因配置创建脚本默认编码错误退出 1，修复 UTF-8 后完整构建通过。
- 当前 Windows 10 x64/WebView2 原生自动 GUI 验收 PASS；未声明 Windows 11/安装包或人工验收。正式 identifier 数据目录不存在，测试最终业务表为空。无全权限补救。
- 建议 Commit Message：security: tighten Main capability and verify native ACL boundaries。本步未提交。STEP 11 Gate PASS；按用户同次明确授权开始 STEP 12，停止于其报告，不执行 STEP 13。

## STEP 12 执行记录

- 完成：独立 quick-add.html/src/windows/quick-add.tsx 与 QuickAdd/Launcher；Rust 单实例隐藏窗口、窄 create/show/hide、复用 plugin pool；提交后 Main-targeted task-created/id、缓存失效及既有 focus 补偿；IME/pending/草稿/成功与隐藏失败分离；独立 Capability 与 Manifest 同步。文件说明见 ADR STEP 12。无新依赖、无本步 lockfile 变化；历史 STEP 6–10 未提交改动保持。
- 沿用锁定版本：@tauri-apps/api 与 CLI 2.12.1、Tauri Rust 2.12.1、tauri-build 2.7.1、plugin-sql JS/Rust 2.5.0、SQLx 0.8.6、Vite 8.3.2；WebDriver 沿用 tauri-driver 2.1.0 / Edge 154.0.4258.53。
- 命令/最终结果（均退出 0）：pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step12-test.conf.json --target x86_64-pc-windows-msvc（包含 pnpm build，双 HTML 入口）；pnpm test（11 文件/48 测试）；pnpm lint；cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc（8 Rust 测试）；cargo check 同参数（--locked）；cargo fmt --manifest-path src-tauri/Cargo.toml -- --check；python tests/audit_capabilities.py --step 12；python tests/audit_quick_entry.py；python tests/step12_native.py --native-driver [隔离测试所用匹配 EdgeDriver 路径]。
- 初次前端测试 1/48 失败：旧 Ready 测试 mock 缺新增 window.listen；补齐 mock 后全量 48 PASS，产品代码未放宽权限。pnpm list 核对上述实际锁版本，不以 package.json 范围推断。
- 原生 GUI/数据链两次 PASS：docs/evidence/step12-20261004-192707 与最终 step12-20261004-192912/report.json。每次 11 项行为检查：初始隐藏；系统前台+DOM输入焦点；越权拒绝；Rust 空白/NUL/超长校验；Escape 草稿/同 HWND 复用（最终还验证已显示时再次打开）；原生 Close 隐藏保留草稿；IME guard+真实 Enter+提交+Main event/id+刷新；真实写锁等待下双 submit 仅一条；真实写失败保留草稿；不同进程重启持久化/初始隐藏；Main 删除清理。
- 每次 11 项实际拒绝：Main 调 Quick create/hide；Quick 调 SQL select/execute/load/close、Main Ready/show、直接 window hide/create、事件 emit。全部为真实 Tauri ACL not allowed，不是模拟 rejection 或未知 command。Main Ready/CRUD/事件监听保持成功。
- GUI 截图已查看聚焦窗口、失败保留草稿及 Main 刷新；Windows 10 x64 开发机原生自动验收 PASS。没有 Windows 11、安装包/人工系统 IME 验收；组合输入 guard 已自动验证。正式 %APPDATA%/com.todoa.desktop 目录仍不存在。测试最终任务为空、foreign_key_check 无错误，Schema 1 未改。
- 无占位文件、业务扩展、托盘、全局快捷键或自动提交。无外部阻塞。建议 Commit Message：feat: add isolated Quick Add with narrow Rust commands and native ACL tests。STEP 12 Gate PASS；已停止，不执行 STEP 13，不提交 Git。

## STEP 14 执行记录

- 用户明确授权 STEP 14，本步不实现 STEP 13 或 STEP 15；Inspect 已发现 Single Instance 缺失并在执行前说明。它保持未开始，不以快捷键测试冒充单实例 Gate。
- 完成：Rust 固定 Ctrl+Shift+Space、Pressed/repeat/Released 防护、重复初始化防护、复用已有 Quick、明确状态/冲突提示、正常退出注销。未新增快捷键编辑界面或前端注册能力。
- 修改/新增文件：src-tauri/Cargo.toml、Cargo.lock、src/global_shortcut.rs、src/lib.rs、src/commands/quick_add.rs、build.rs、permissions/global-shortcut-status.toml、capabilities/default.json、tauri.step14-test.conf.json；src/features/quick-add/ShortcutNotice.tsx/.test.tsx、QuickAddLauncher.tsx、QuickAdd.tsx/.test.tsx；tests/step14_native.py、audit_capabilities.py；docs/ADR.md、PROJECT_STATE.md。既有 STEP 6–12 未提交改动保持，无 Git 提交。
- 新依赖：tauri-plugin-global-shortcut 锁定 2.4.0；global-hotkey 0.8.0、新增 keyboard-types 0.7.0；另锁定 gethostname 1.1.0、x11rb/x11rb-protocol 0.13.2、xkeysym 0.2.1（非 Windows 传递依赖）。cargo add/fetch 退出 0；不安装 JS 插件、不运行会追加前端权限的 tauri add；仅增固定 Main 只读自定义 permission，无 global-shortcut:allow-* 权限。
- 自动最终 PASS/退出 0：pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step14-test.conf.json --target x86_64-pc-windows-msvc（包含 pnpm build，Windows 原生编译）；pnpm lint；pnpm test（12 文件/50 测试）；cargo fmt --manifest-path src-tauri/Cargo.toml -- --check；cargo check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc；cargo clippy 同 manifest/locked/target 加 --all-targets -- -D warnings；cargo test 同 manifest/locked/target（9 Rust 测试）；python tests/audit_capabilities.py --step 14；python tests/audit_quick_entry.py。
- 真实 Windows 原生 PASS：python tests/step14_native.py --native-driver [匹配 EdgeDriver]，最终 docs/evidence/step14-20261004-200007/report.json；前一完整 PASS 为 step14-20261004-195825。每次 8 项检查：Rust 注册/ACL、其他进程焦点下一按一次显示且输入聚焦、下一按同 HWND 复用、正常退出释放、真实 OS 注册冲突/提示/Ready 仍可用、冲突下 Main 按钮仍打开 Quick、冲突解除重启成功注册、再次正常退出可占用。最终另记录 9 项真实 ACL 拒绝（两个窗口各 4 种插件管理命令，Quick 的 Main-only status）；默认权限未放宽。
- 失败/修复保留：step14-20261004-195513 在测试宿主夺取焦点时超时，未当触发 PASS；脚本改为临时 AttachThreadInput，核对实际 foreground 后再发按键。step14-20261004-195619 真实触发通过，但 Main close 留下 Quick 导致进程不退出；修复当前关闭 Main 的正常退出路径后完整重跑。首次 clippy 指出 collapsible_if，按建议合并判断后严格 clippy PASS，没有抑制 lint。
- GUI：已查看实际聚焦 Quick 与 Main 红色冲突提示截图。Windows 10 x64/WebView2 当前主机原生自动验收 PASS；Windows 11/安装版未测试。测试宿主/应用均正常退出，测试热键释放，正式 %APPDATA%/com.todoa.desktop 仍不存在，业务数据不涉及。
- ADR：详见 STEP 14。遗留：STEP 13 未实施，不能承诺第二实例拦截；STEP 15 统一 Tray/Quit/在途任务收尾未实施。本次无阻塞于固定快捷键的单实例验收。
- 建议 Commit Message：feat: register fixed Rust global shortcut with conflict feedback and cleanup。下一步：已停止；不执行 STEP 15、不提交 Git。

## STEP 15 执行记录

- 完成：Rust core Tray 三项菜单、关闭 Main 隐藏、退出真正结束；补齐必要 Single Instance；统一 quitting/write drain/pool close；托盘失败可见提示与正常关闭退出。未实现 Scheduler、窗口状态插件或其他未来业务。
- 文件：src-tauri/Cargo.toml/Cargo.lock、src/lifecycle.rs/tray.rs/lib.rs/global_shortcut.rs/commands/quick_add.rs、build.rs、permissions/lifecycle.toml、capabilities/default.json、tauri.step15-test.conf.json/tauri.step15-no-tray-test.conf.json；src/data/db/mainWriteLease.ts/.test.ts/initDatabase.ts、src/app/LifecycleGate.tsx/.test.tsx/App.tsx、src/features/quick-add/QuickAdd.tsx；tests/audit_capabilities.py/step15_native.py；ADR/PROJECT_STATE。之前未提交改动保持，不提交 Git。
- 新依赖与锁定：tauri-plugin-single-instance 2.5.2；启用已有 Tauri 2.12.1 的 tray-icon feature，tray-icon 0.25.1 / muda 0.20.0。single-instance 带来的传递依赖均记录 Cargo.lock（含非 Windows 的 D-Bus 等锁项）；没有新增 JS dependency。cargo add/fetch 最终退出 0（一次网络握手重试后恢复）。不自动追加前端 Tray/插件权限，精确 Capability 审计 PASS。
- 自动命令最终退出 0：pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step15-test.conf.json --target x86_64-pc-windows-msvc（内含 pnpm build）；pnpm lint；pnpm test（14 文件/54 测试）；cargo fmt --manifest-path src-tauri/Cargo.toml -- --check；cargo check 同 manifest 加 --locked --target x86_64-pc-windows-msvc；cargo clippy 同参数加 --all-targets -- -D warnings；cargo test 同参数（11 Rust 测试）；python tests/audit_capabilities.py --step 15；python tests/audit_quick_entry.py。
- 正常原生完整 PASS（退出 0）：tests/step15_native.py --clean-known-fixture --native-driver [匹配 EdgeDriver]，最终 docs/evidence/step15-20261004-204011/report.json。13 项：真实 Shell 图标；Main close 隐藏、池继续可用；实际菜单显示/聚焦 Main 并 CRUD；二次启动唤醒隐藏 Main 且同一进程/Tray HWND；二次启动恢复最小化；菜单 Quick 聚焦及 3 项 Main-only lifecycle ACL 拒绝；Quit 拒绝两窗口新写并等待 Quick 在途 SQL；quitting 后两窗口关闭均未拦截、在途任务提交且热键释放；重启持久化/一个 Tray；Main SQL adapter 在途写 Quit 等待；Main 写持久化后退出；再次启动恢复；UI 清理后真实 Tray Quit。前一完整 13 项 PASS：step15-20261004-202721，较早 10 项核心 PASS：step15-20261004-202145。
- 故障注入原生 PASS（退出 0）：pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step15-no-tray-test.conf.json --target x86_64-pc-windows-msvc --features test-tray-failure；step15_native.py --no-tray。证据 docs/evidence/step15-no-tray-20261004-203254/report.json：明确失败提示、没有隐藏的 Tray、关闭 Main 正常退出且热键可再次注册。是显式 Debug 注入，不假称真实 Explorer 故障。之后完整恢复默认无注入构建，再跑正常 13 项通过。
- 失败记录保留：step15-20261004-202044 为测试脚本错误假设 icon ID=1，Rust实际 Tray 已被 Shell 接受；按锁定 tray-icon builder/backend 计数源码改为仅本 PID HWND 内探测 ID。step15-20261004-203437 前 8 项通过，退出后的新 WebDriver 会话超时，应用进程已退出，合成两条任务已提交；测试驱动在无 Todoa PID 后重建自己的 driver tree，重新启动应用验证，不通过强杀应用制造 Quit PASS。最终以明确选项校验固定夹具标题/defaults，通过 Main UI 清理后全程重跑通过。失败报告均不计 PASS。
- GUI/数据证据：实际 Shell 右键菜单三项/点击、Main/Quick/Quitting/故障提示截图已查看；DPI 使用原生物理坐标。各正常退出后 Win32 同一 Ctrl+Shift+Space 可重新注册，应用 PID 消失；从锁等待中退出后只保留应有任务，无被拒绝的新任务，重启读回；最终合成业务任务经 UI 清理为空。正式 %APPDATA%/com.todoa.desktop 不存在，未触碰。
- 当前 Windows 10 x64/WebView2 原生自动 GUI 验收 PASS；Windows 11/安装版未验收。Scheduler 未接入，窗口状态持久化在 STEP 19，不声称这两项已实现。外部无阻塞。
- ADR 落地：见 STEP 15。STEP 13 作为用户重复启动要求的必要前置也已通过相应 Gate；STEP 15 Gate PASS。建议 Commit Message：feat: add single-instance tray and drain writes on quit。下一步：已停止，不执行 STEP 16、不提交 Git。


## STEP 16：提醒入口与 Rust 调度（2026-10-04）

### 范围与 Inspect

- 已先检查手册第 8 节、STEP 16、固定 Report、PROJECT_STATE、TaskRepository/Query/UI、Migration 1/共享 SQLx pool/Boot，以及 STEP 15 Lifecycle/Tray。祖先及项目目录无额外 AGENTS.md。本步只实现提醒 CRUD、任务完成事务和调度，不提前执行 STEP 17。
- Migration 1 已有 reminders 与 task 外键/索引，保持原样。沿用共享 pool，不另建运行时连接池。既有 STEP 6–15 工作区修改保留；不提交 Git。

### 修改文件与依赖

- Rust 新增 src/reminder_scheduler.rs、src/reminder_scheduler/tests.rs、src/services/reminders.rs、src/commands/reminders.rs；修改 lib.rs、lifecycle.rs、services/mod.rs、commands/mod.rs、build.rs。
- 新增 permissions/reminders.toml、tauri.step16-test.conf.json；default.json 仅加入 Main 专属 main-reminders，Quick Add 未增加权限。tests/audit_capabilities.py 增加 STEP 16 精确允许清单。
- TS 新增 data/repositories/ReminderRepository.ts 及测试、features/reminders/queries.ts、TaskReminders.tsx 及测试、app/mainReminderEvents.ts；修改 TaskRepository.ts 及测试、tasks/queries.ts、Inbox.tsx、MainQueryProvider.tsx。新增 tests/step16_native.py、证据与 ADR/本文件。
- 新增直接 Rust 依赖 chrono 0.4.45（clock）和 tokio 1.53.2（sync/time/macros）；原已锁定这两个传递版本，新增锁定 tokio-macros 2.7.2。没有新增 JS/通知插件依赖。Tauri 2.12.1、SQLx 0.8.6、plugin-sql 2.5.0 保持原锁定版本。

### 落地行为

- Main 任务行展开提醒面板，可多个创建、编辑待触发提醒和删除；只能为 todo 任务保存未来时刻。读写失败明确显示、失败保留草稿、提交中防重复。已完成任务不提供新建；已触发提醒不提供编辑。
- TaskRepository.updateStatus 不再保留 SQL 更新状态的第二条业务路径；窄 Rust 事务更新状态并删除全部未触发提醒，保留已触发记录，取消完成不恢复取消提醒。任务删除用外键级联，并唤醒 Rust。
- Rust 一个循环/精确到期 timer/30 秒周期恢复；变更、任务完成和删除直接唤醒，提交后 Main invalidate。串行去重、投递前重查、按时间补发、单调时钟节流最多每秒一次，失败指数退避最高 5 分钟，API 成功但标记失败只重试标记。
- Quit 禁止新写入/新投递、等待 worker 结束再排空写入与关闭 pool。真实应用当前只使用 Disabled 出口，UI 告知未启用；正式待触发提醒不写 triggered_at。FakeNotification 只编译进 Rust tests，使用 tempfile 独立库，无正式路径或 AppHandle。

### 命令与结果

| 命令 | 退出结果与证据 |
| --- | --- |
| pnpm test | 0；16 文件、57 tests PASS |
| pnpm lint | 0；eslint src vite.config.ts |
| pnpm build | 0；TS + Vite Main/Quick 双入口；首次 Mutation 返回类型错误已修复 |
| pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step16-test.conf.json --target x86_64-pc-windows-msvc | 0；最终当前实现 Debug 原生应用，无安装包 |
| cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc | 0；19 tests PASS（8 个新增提醒调度/事务隔离库测试） |
| cargo check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc | 0 |
| cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings | 0 |
| cargo fmt --manifest-path src-tauri/Cargo.toml -- --check | 0 |
| python tests/audit_capabilities.py --step 16 | 0；Main 10 grant、Quick 4 grant、14 command、Schema 与自动加载范围 PASS |
| python tests/audit_quick_entry.py | 0；独立 Quick 不加载 SQL/Boot/Main command chunk |
| python tests/step16_native.py --clean-known-fixture --native-driver "$env:TEMP/todoa-step8-webdriver-20261004/msedgedriver.exe" | 0；13 行为 PASS、6 IPC 拒绝 PASS；最终证据 step16-20261004-210850 |
| git diff --check | 0；仅已有换行格式提示 |

### 自动与真实原生验收

- 隔离 Rust tempfile 库：到期前 1ms 不投递、精确到期/全部逾期补发、顺序与 1/sec 限制、tokio::join 并发 Reconcile 不重复；时间修改/删除使计划失效、标题从 DB 更新；完成保留 triggered 记录并取消 pending，取消完成不重建；重新连接/启动补发、任务删除外键级联 PASS。
- 故障触发器：取消提醒失败使整个完成事务回滚；fake API 失败保持 pending，退避后重试；API 成功/写标记失败只重试标记不重发；重排时间使旧 accepted 计划失效；错误输入/不存在任务/已完成任务/已触发编辑拒绝 PASS。
- 调度 worker 的实际 run 循环通过 Notify 唤醒，stop 等待 worker 结束后不投递；12 次失败验证最高 300s 退避。墙钟前后跳变重新计算等待，墙钟回拨不能突破单调节流 PASS。
- 禁用出口隔离测试保持 triggered_at=NULL；fake 只用 tests 内临时库，无打开正式库的代码路径。原生测试使用真实 Main SQL 构造独立 identifier 中的过期 fixture，唤醒和重启后仍未触发，fake_in_app=false PASS。
- 原生 UI/IPC 13 项 PASS：无效时刻（UI + Rust）、创建、编辑、创建编辑重启、删除、删除重启、完成事务取消、取消完成不恢复、完成/取消重启、过期保持未触发、过期重启仍未消费、Quick 越权、任务删除级联、清理后重启。报告的 13 项中首项合并创建/校验，具体条目见 report.json。
- Quick Add 对六个新增 command（create/edit/delete_reminder、update_task_status、reconcile_reminders、reminder_scheduler_status）全部真实 ACL 拒绝；没有为通过测试扩大权限。
- 每轮原生退出通过真实 Tray“退出”或托盘不可用时可见 Main 原生关闭完成，应用进程消失后才清理驱动。每轮退出验证 OS 可重新注册固定快捷键；最终无 todoa.exe 进程。最终数据清理通过渲染 Main UI，库为空且无外键错误。
- 截图已查看：01-create-validation-disabled-notification.png、02-edit.png；面板按页面滚动访问，实际保存/编辑/删除点击验证通过。属于 Windows 10 x64 开发主机自动原生 GUI 验收，不是手工 Windows 11/安装版验收。
- 最终证据：[report.json](evidence/step16-20261004-210850/report.json)、[automated-results.json](evidence/step16-20261004-210850/automated-results.json)、同目录 PNG/driver.txt。正式 %APPDATA%/com.todoa.desktop/todo.db 不存在，未创建或触碰正式数据。

### 已修复失败与限制

- 首次脚本写入读 lib.rs 使用 Windows 默认 GBK，读取失败；改为显式 UTF-8 并完成缺失 wiring。首次前端构建发现 Mutation Promise<void>/Promise<number> 推断不一致，统一 void 后通过。新增组件测试最初缺 jsdom 注释，修复环境后 57 项通过。这些初次失败不计 PASS。
- step16-20261004-210123 前 9 行为通过后托盘初始化失败，测试假定必须有托盘而超时；保留失败证据。修正测试验证既有“托盘不可用”可见关闭退出回退，不授予权限、不制造托盘成功。
- step16-20261004-210359 前 4 行为通过后 EdgeDriver bind 端口占用；修改 helper 每次新端口并仅在已确认应用退出后重建驱动。失败运行清理可能强制结束测试进程，不用这些清理证明 Quit；完整最终运行 13 项全部通过，4 次真实菜单退出、2 次可见关闭回退，均确认进程正常消失。
- 未接 OS 通知：正式提醒保持待触发，不能声称系统弹窗、安装版身份或用户看到；留待明确授权 STEP 17。未实现可靠 Windows resume API，只用周期恢复；退出/关机/休眠期间不运行、不唤醒设备。
- 本步不实现 STEP 17–22、不制作安装包、不提交/推送 Git。建议 Commit Message：feat: add reminder CRUD and transactional Rust scheduler。

STEP 16 状态：已验收。下一步：已停止，等待用户明确启动 STEP 17。


## STEP 17：实际系统通知（2026-10-04 Asia/Shanghai）

### Inspect 与实现范围

- 已读取手册 STEP 17/第 8 节、PROJECT_STATE、STEP 16 调度出口、状态/Query/提醒面板以及 Cargo/窗口启动和权限。仅接入任务标题系统通知，不做 STEP 18、安装包、通知 Action、Snooze、重复提醒或点击导航。
- 生产出口已从 Disabled 切换为 SystemNotification；FakeNotification 与 Disabled 仅在 cfg(test) 回归测试中。实际初始化官方 notification Rust 插件，Ready 后沿用唯一 Scheduler。
- 发现官方锁定 2.5.1 desktop.show 启动后台 task 后立即返回，后台错误被忽略；桌面 permission_state 恒为 Granted。已用本地同版源码补丁落实手册的真实返回语义，详见 ADR 与 vendor/tauri-plugin-notification/TODOA_PATCH.md。不能将未补丁的 show 成功等同 WinRT 接受。

### 文件与依赖

- Cargo.toml/Cargo.lock：新增 tauri-plugin-notification 2.5.1（本地补丁），锁定 notify-rust 4.18.1、tauri-winrt-notification 0.8.1、mac-notification-sys 0.6.15。补丁在 Windows 使用已锁定 windows 0.62.2 的 UI_Notifications/Foundation feature，无新 JS 包。
- 新增 src-tauri/vendor/tauri-plugin-notification 官方包镜像与补丁说明，保留 MIT/Apache 许可证；修改其 src/desktop.rs、src/error.rs、Cargo.toml。新增 tauri.step17-test.conf.json，隔离 identifier=com.todoa.desktop.test.step17。
- 修改 src-tauri/src/lib.rs、reminder_scheduler.rs；修改 features/reminders/queries.ts、TaskReminders.tsx 及测试；新增 tests/step17_native.py，audit_capabilities.py 增加 STEP 17；更新 ADR/本文件及证据。无 Migration/业务 Schema 改动，没有 Capability 授权扩大。

### 行为与语义

- 发送前查询真实 WinRT ToastNotifier.Setting，明确拒绝不发送；Setting 的元素找不到返回 Unknown，并在 UI 告知可用性未知，再尝试真实 Show。其他查询错误不吞掉。检查和发送使用同一 App ID；开发 target-triple 构建沿用真实 PowerShell 身份，安装目录使用正式 identifier。
- notify-rust/WinRT Show 在 blocking worker 调用并等待，真实 API 返回成功后才取 UTC 写 triggered_at/updated_at；失败保留 pending 与错误，指数退避，最高 5 分钟。成功但写标记失败只重试标记。错误计划不会因其他提醒成功而假清除；变更或删除清除对应旧计划。
- Main 提醒面板显示动态可用性、拒绝、发送失败、标记失败；触发状态为“API 已接受”。文案明确这不代表用户看到或阅读，勿扰/通知关闭可能抑制显示。进程退出期间不发送；启动后按原规则补发。
- Main/Quick 均无 notification grant：Main 10 grant、Quick 4 grant、14 个自定义 command 保持一致。所有通知实际从 Rust 调度器发送。

### 执行命令及结果

| 命令 | 退出及验证结果 |
| --- | --- |
| cargo add tauri-plugin-notification@2 --manifest-path src-tauri/Cargo.toml | 0；后以 patch.crates-io 固定上述同版补丁 |
| pnpm test | 0；16 文件、59 项 PASS；增加 Granted、Denied、Unknown 文案验收 |
| pnpm lint | 0 |
| pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step17-test.conf.json --target x86_64-pc-windows-msvc | 0；TS/Vite 双入口 + Windows Debug 原生构建，未打包 |
| cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc | 0；19 项 PASS，仍使用临时测试库验证错误、标记失败/不重发、串行/时间/停止 |
| cargo check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc | 0 |
| cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings | 0 |
| cargo fmt --manifest-path src-tauri/Cargo.toml -- --check | 0；vendored 修改的两个 Rust 文件也经 rustfmt |
| python tests/audit_capabilities.py --step 17 | 0；精确窗口/grant/command/自动加载及 Schema PASS |
| python tests/audit_quick_entry.py | 0；Quick 独立构建与依赖边界 PASS |
| python tests/step17_native.py --clean-known-fixture --native-driver "$env:TEMP/todoa-step8-webdriver-20261004/msedgedriver.exe" | 0；8 行为 PASS、4 真实 IPC 拒绝 PASS |
| git diff --check | 0；仅已有换行提示 |

### 原生开发验收证据

最终证据：[report.json](evidence/step17-20261004-213310/report.json)、[automated-results.json](evidence/step17-20261004-213310/automated-results.json)、同目录 PNG 与 driver.txt。

1. Windows 通知真实可用性查询成功；最终运行初始状态 ready。UI 不再声称“尚未启用”。PASS。
2. 实际 Service 创建未来提醒，达到时刻后真实 WinRT Show 成功返回，随后 triggered_at 从 NULL 写为 UTC；Query/界面显示“API 已接受”。PASS。
3. 隔离库任务标题暂加入非法 XML 控制字符，真实通知 API 返回错误，状态为 NOTIFICATION_API_FAILED；triggered_at 保持 NULL，UI 明确显示失败/重试。没有 fake 故障出口。PASS。
4. 经隔离 Main SQL 恢复标题，退避重试真实 API 成功，triggered_at 写入，错误恢复。PASS。
5. 创建未来提醒并正常退出，进程消失后等待其过期；只读 SQLite 核对退出期间 triggered_at=NULL。新进程启动后补发成功，写入触发状态。PASS。
6. 再次退出/重启，全部 triggered_at 保持原值，不重置或正常再次投递。PASS。
7. Quick Add 的 plugin:notification|notify、permission_state、Main Scheduler 状态，以及 Main 的 plugin:notification|notify 全部被 ACL 拒绝（4 项）。PASS。
8. 经真实 Main UI 删除合成任务，提醒外键级联、库清空、无外键错误。退出时热键释放、最终无 todoa.exe。PASS。

- 截图已查看 03-real-api-error-remains-pending.png 与 05-restart-overdue-catchup.png，分别确认错误提示和 API 接受语义；只证明开发主机上的 UI/data/API 行为，未拿 Main 窗口截图当系统弹窗证据。
- 最终有 1 次真实托盘菜单 Quit 与 2 次“托盘不可用”可见 Main 关闭退出回退，均在确认应用正常消失后才清理驱动。正式 %APPDATA%/com.todoa.desktop/todo.db 不存在，未打开或写入正式库。
- user_saw_notification 明确为 NOT VERIFIED；没有确认用户实际看到 Toast，更没有确认阅读。未做安装版名称/图标或 Windows 11 验收。

### 修复记录与保留的失败证据

- 初次 wiring 读取 lib.rs 误用 Windows 默认编码失败，改显式 UTF-8 后完成初始化；不算成功运行。
- step17-20261004-212219、212532、212843 的可用性检查 FAIL 均保留：先修正开发 App ID，后诊断为 Setting（不是 CreateToastNotifier）返回 0x80070490。仅该 HRESULT 作为 Unknown 明确报告，继续实际 API 尝试；其他错误与明确 Denied 保持失败。首次真实投递后后续运行可用性为 ready，不能泛化为所有开发/安装环境始终可用。
- step17-20261004-213104 前 4 项真实 API 行为 PASS 后，托盘菜单操作超时，重启补发当时未验收。增加通知发送后菜单操作等待，并提前安排未来提醒，完整复验 8 项通过。失败运行的强制测试清理不能当作正常 Quit 证据。
- 通知插件升级须重新核对/维护本地补丁与 App ID 策略；只有上游提供等价真实结果和可用性检查时才可移除补丁。

### STEP 22 指定发布 Gate（全部待验收，不阻塞本步开发验收）

| 安装版检查 | 当前状态 | 要求与后续步骤 |
| --- | --- | --- |
| Windows 11 x64 NSIS 安装后真实 Toast 显示 | 待验收 | STEP 22；实际观察/截图系统弹窗，不能仅凭 API 成功或数据库标记 |
| 正式应用名称、图标和 App ID | 待验收 | STEP 22；确认来源为 Todoa 与正式图标/identifier，不能沿用开发 PowerShell 身份证明 |
| Windows 关闭该应用通知 | 待验收 | STEP 22；验证实际禁用状态、UI 提示、pending 不假标记及重新允许后的恢复 |
| 勿扰/专注助手 | 待验收 | STEP 22；分别记录 API 返回、triggered_at、实际弹窗/通知中心表现，API 成功不保证显示 |
| 安装版进程退出/重启与过期补发 | 待验收 | STEP 22；正式安装路径再次验证顺序、节流、无正常重复；开发版本步已通过 |
| 睡眠恢复/时钟变化 | 待验收 | STEP 22；仍为最多 30 秒 periodic recovery，没有声称实现可靠 Windows resume 监听或睡眠中唤醒 |

STEP 17 状态：已验收（开发 Gate）。STEP 22 发布 Gate 尚未通过；正式发布前必须补测。建议 Commit Message：feat: deliver reminders through verified Windows notification API。已停止，未执行 STEP 18，未提交/推送 Git。

## STEP 18 Backup / Restore

### 固定 Report

- STEP 18 状态：已验收（Windows 10 x64 开发主机；安装版/Win11 发布验证仍为 STEP 22）。
- 完成行为：参数绑定一致性快照、完整文件校验、Rust 原生对话框/取消/覆盖确认、受控暂存和持久化移动日志、统一停写/停调度/排空/关闭/重启、preload 前替换与失败回滚、恢复前快照保留和新 Query/Scheduler 重建。
- 修改文件：src-tauri/src/db/backup.rs 与 backup/tests.rs、commands/backup.rs、db/mod.rs、lib.rs、lifecycle.rs、build.rs、backup.toml/Main Capability、Cargo manifests/lock/vendor SQL；src/features/settings/BackupRestorePanel 与测试、App；隔离配置、tests/step18_native.py、ACL audit、ADR/本文件。
- 新增依赖及锁定版本：tauri-plugin-dialog 2.8.1（rfd 0.16.0、自动传递 fs 2.6.0，均无 JS grant）；serde 1.0.229 derive、same-file 1.0.6（已有传递锁版本，改为直接使用）。SQL 2.5.0 vendored patch 显式关闭失败池，通知 2.5.1 既有补丁保留。
- ADR 落地/变更：ADR-008 已落地；Schema 1 为唯一支持版本，未声称有旧版本升级路径；窗口与 OS 自启不进入 SQLite 备份。
- 执行命令及退出结果：pnpm build / lint / test 退出 0，61 TS 测试；cargo test --lib 退出 0，29 Rust 测试（含两个无 fixture 时跳过工作的测试子进程入口）；cargo check --locked 退出 0；pnpm tauri build --debug --no-bundle --features test-restore-startup-failure --config src-tauri/tauri.step18-test.conf.json 退出 0；python tests/audit_capabilities.py --step 18 退出 0。
- 自动/实际运行验证：共享 WAL pool 并发写时快照包含六表；损坏/错身份/未来/旧无支持版本/历史缺失或错 checksum/列约束差异/外键错误/外部 WAL 拒绝；Windows 真实文件锁/只读目标不破坏原库和旧备份；copy/journal/snapshot/publish 磁盘满注入；17 个移动/逆向移动位置真实进程 abort 后回滚；未 checkpoint 的原 WAL 成功进入恢复前快照。真实 Tauri 12 项检查与 Quick 的 3 个新 command ACL 拒绝通过，还断言 Main guest dialog/fs 调用被拒绝、缺少恢复确认拒绝。
- GUI 或指定后续验收：原生文件对话框取消/显式拒绝覆盖、损坏备份拒绝、外部 SQLite 句柄锁住时回滚、释放后成功恢复、旧进程退出和新进程/Query、六表/关系/设置/触发状态/恢复前快照、恢复后真实通知 API 接受并标记、真实插件迁移 checksum 错误后原库还原与 Ready UI 关闭、再次打开不自动重试、正常退出均 PASS。API 接受通知仍不表示用户实际看见。
- 外部依赖与遗留问题：物理磁盘填满未执行（已用 OS 112 故障注入），安装版显示/名称/图标/Win11/登录验证为 STEP 22。早期原生驱动失败证据保留为 FAIL，不计入验收；递归删除测试目录被自动审批拒绝，后续通过身份核对和 API 清理已知测试夹具。测试阶段未创建或打开正式 com.todoa.desktop 数据库。
- PROJECT_STATE 更新：STEP 18 已验收；STEP 19/20 待顺序执行，STEP 21/22 未开始。
- 建议 Commit Message：feat: add consistent SQLite backup and recoverable restore
- 下一步：按本次明确的顺序授权执行 STEP 19。

原生通过证据：docs/evidence/step18-20261004-231625/report.json（status=PASS，12 checks，3 Quick denials，正常退出）。同目录 PNG、driver.txt；SQL 故障补丁说明见 src-tauri/vendor/tauri-plugin-sql/TODOA_PATCH.md。隔离 DB 位于 %APPDATA%/com.todoa.desktop.test.step18，测试选取的备份位于 .local-test-data/step18-*；没有正式库，结束时无 todoa.exe 进程。此前驱动误选地址栏曾在用户 Documents 生成只含隔离数据的 todoa-backup.db，核对身份和测试数据后已移入 .local-test-data/step18-20261004-225117/misdirected-backup.db，未当作正式备份。

## STEP 19 Window State / Autostart

### 固定 Report

- STEP 19 状态：已验收（开发 Gate）；真实登录/安装版和物理显示器变更为 STEP 22 发布 Gate。
- 完成行为：官方插件只跟踪/恢复 Main 尺寸、位置、最大化；Quick 排除，隐藏/最小化不恢复。物理工作区不相交时修正位置，运行中也检查；手动启动可见，--autostart 在真实托盘 Ready 后后台隐藏；二次手动唤醒、二次自启不唤醒。自启默认不注册，设置读取实际 OS 状态，写后重新查询，读取失败保持未知。
- 修改文件：window_state.rs、lib.rs、tray.rs、lifecycle.rs；autostart.toml/Main Capability/build.rs、Cargo manifests/lock/vendor；AutostartSettings 与测试、LifecycleGate 与测试、App；隔离配置、step19_native.py、native_support.py、ACL audit、ADR/本文件。
- 新增依赖及锁定版本：tauri-plugin-window-state 2.5.0；tauri-plugin-autostart 2.7.0（auto-launch 0.6.0）；既有 tray-icon 0.25.1 改为本地最小补丁；未授予官方插件 JS 权限。Autostart 完整官方包仅补 Windows 可执行路径引号和明确 HKCU 模式。
- ADR 落地/变更：Main 保存 flags=SIZE|POSITION|MAXIMIZED，filter=main；OS Run 与窗口 JSON 独立于 SQLite。只增加两个 Main Rust command，Quick 无新增权限。托盘登记等待最多 3 秒；超时仍显示 Main。锁定托盘库将有效边界的 S_FALSE 视为存在，防止隐藏区域的真实图标被误删；保留失败 HRESULT 拒绝。
- 执行命令及退出结果：pnpm test 退出 0（64 测试），追加 LifecycleGate 启动门测试退出 0（3 测试，合计现有 65）；pnpm lint 0；cargo test --locked --lib 0（31 Rust 测试）；pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step19-test.conf.json 0；python tests/audit_capabilities.py --step 19 0；最终 step19_native.py 0。
- 自动/实际运行验证：物理像素、多屏负坐标/移除/DPI 倍率/大窗口回退单元通过。实际 HKCU 开关、带空格路径引号、StartupApproved OS 禁用状态同步、主窗口位置尺寸/最大化重启、不恢复最小化、注入屏幕外坐标及运行时修复、后台 DB Ready、二次启动同 PID、实际托盘退出和快捷键清理均 PASS。
- GUI 或指定后续验收：最终 docs/evidence/step19-20261005-000308/report.json 为 PASS，12 检查、4 Quick 拒绝、正常退出；autostart_tray_status=tray-ready，Main 实际隐藏后可由手动启动找回。当前实际 DPI=120（125%）。早期 tray-unavailable 回退报告保留，不把它当后台成功；修补后重新通过真实隐藏 Gate。
- 外部依赖与遗留问题：真实 OS 注销登录启动、安装路径/安装版、物理显示器拔插、跨显示器 DPI 切换留 STEP 22；只对精确 com.todoa.desktop.test.step19 注册项测试，结束时 Run 项已禁用、StartupApproved 测试值清理、无 todoa.exe 进程。
- PROJECT_STATE 更新：STEP 19 已验收；STEP 20 按本次顺序授权继续；21/22 未开始。
- 建议 Commit Message：feat: persist main window state and add verified autostart
- 下一步：执行 STEP 20，不执行 STEP 21。

## STEP 20 正式 UI / 任务详情 / 日期视图

### 固定 Report

- STEP 20 状态：已验收（Windows 10 x64 开发 Gate）。本次在此停止，未执行 STEP 21。
- 完成行为：统一 Base UI 页面，真实 Inbox/Today/Upcoming/Lists/Tags/Settings；详情编辑标题、纯文本备注、含毫秒的本地截止时间和清单，详情内分配/移除标签与提醒 CRUD；新增 getById/update、Query Hooks 和实际 UTC SQL 日期过滤；跨午夜/焦点恢复/时区变化重算范围；草稿保留或明确确认放弃，异步操作防重入。
- 修改文件：domain/task.ts/taskDates.ts 与测试；data/repositories/TaskRepository 与测试；features/tasks/queryKeys、queries、useLocalClock、TaskDetails、Inbox 与测试；ListsWorkspace/Tags 测试、TaskTags、TaskReminders、BackupRestorePanel、AutostartSettings（显式可访问名称及测试）、QuickAddLauncher、App；components/ui/dialog/textarea/use-confirm-dialog；step20 隔离配置、两个原生脚本、ADR/本文件。Rust 仅将既有 Windows 文件权限测试改为保存并恢复原 permissions，不再 set_readonly(false)，并执行格式检查；没有新增 Rust 业务或权限。
- 新增依赖及锁定版本：无新增 runtime 依赖。现有 shadcn 4.21.1 CLI 按 base-nova 创建 Dialog/Textarea，沿用 @base-ui/react 1.8.0；已有 Button 被 CLI 跳过，未覆盖。采用浏览器日期与时间输入，不加入未需要的 Calendar/date-fns/复杂表单库。
- ADR 落地/变更：ADR-006 日期规则落实；Today 固定未完成且 [本地当日00:00, 次日00:00)，Upcoming 固定未完成且从明日00:00起，按 due_at 升序。输入不存在的本地时间拒绝，重叠输入取较早时刻；未编辑日期保留原 UTC（含毫秒/重叠另一侧）。打开详情时若时区改变，需明确采用新时区；未改变截止时间仍保留原 UTC。getById 缺失返回 null；update 一条绑定 SQL 原子更新允许字段，失败不伪装成功。
- 执行命令及退出结果：pnpm build（含 tsc）/lint/test 最终退出 0，21 文件/74 TS 测试；最终可访问名称补充后定向复测 AutostartSettings 3 项、build/lint 均退出 0；pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step20-test.conf.json 0；cargo fmt -- --check、cargo check --locked、cargo clippy --all-targets -- -D warnings 均 0；既有 Rust 全套 31 测试已通过，修改后的 Windows 文件锁/只读/回滚用例独立复测 0（1 项，30 filtered）；python tests/audit_capabilities.py --step 20 0。
- 自动/实际运行验证：允许字段绑定/空更新/不存在行/UTC范围校验与排序；离线编辑后 Today/Upcoming/detail/counts 缓存失效；失败和 refetch 保留草稿、IME/重复提交；午夜/focus重算；上海与纽约 23/25 小时日期、跳跃时段拒绝、重叠较早时刻、毫秒保留/清空均 PASS。时区单元测试在独立 Node 进程编译并加载实际 Domain TS 模块，不依赖被测试框架改写的函数 toString。
- GUI 或指定后续验收：docs/evidence/step20-20261005-005216/report.json status=PASS、16 项、normal_exit=true。覆盖六视图、新建/编辑/字段与清单一次保存、普通退出重启及清空截止后再重启、详情真实标签/提醒与标签跨清单筛选、真实 SQL 日期边界/逾期/无日期/已完成/排序、跨午夜、时区、DST 23小时与非法时间、打开详情时区确认且 UTC 不变、Tab 捕获/返回、Space 完成取消、大字体/长标题/小窗口/滚动保存、损坏恢复错误在 modal 内可读且 Escape 取消、真实原生文件对话框备份/恢复/新 PID/日期 Query/调度 Ready、恢复长路径无横向溢出、Quick Escape 只隐藏 Quick。
- 外部依赖与遗留问题：日期时刻与时区使用 renderer Date + CDP 时区模拟，执行真实 Tauri SQL；未改 OS 时钟。合成 composition 与真实中文输入法单独记录。最终真实 Windows TSF/中文输入法证据 docs/evidence/step20-ime-20261005-011238/report.json：2 项 PASS，可信 composition + Win32 SendInput，组合 Enter 未提交；Space 候选“中文”后单独 Enter 恰好创建一项，UI 删除测试行；原始/恢复 HKL 均 0x8040804，正常退出、无清理错误。较早主流程 report 的 physical_ime=pending 字段是该轮当时状态，由后续真实 IME 报告补齐，不改写旧证据。安装版通知显示/名称/图标、真实登录自启、物理显示器/DPI、Win11 等已指定 STEP 22 的项目仍未通过。
- PROJECT_STATE 更新：18/19/20 开发 Gate 均已验收；21/22 未开始。正式 %APPDATA%/com.todoa.desktop/todo.db 仍不存在，所有测试仅 test.step18/19/20 或 TempDir；fake 通知没有消费正式库。原生结束均无 todoa.exe 进程。
- 建议 Commit Message：feat: unify task views and edit local calendar deadlines
- 下一步：本次停止；后续需明确授权 STEP 21。STEP 22 发布 Gate 保留，不把开发版验收当安装版发布验收。

### 失败记录与修复

- 原生首轮发现 WebView 的 window.confirm 无可用确认交互；改为真实 Base UI Dialog。丢弃导航、重新读取内容与提醒输入确认均不依赖 JavaScript 原生 confirm。
- 原生驱动曾误读 SQL execute 的二元组，以及直接清理隔离 SQL 后未触发已有可见性刷新；修正驱动，失败报告保留，未当业务 PASS。
- 完整测试最初因旧行内控件路径失败；改为新清单/标签导航和真实详情弹窗路径，保留离线/失败/关系与删除语义断言；最终全套通过。
- 截图发现恢复长路径溢出，修正 break-all，重新完整原生验证无横向溢出；确认 modal 内显示恢复失败，不将错误藏在 inert 背景中。
- clippy 发现 Windows 专用测试的 set_readonly(false) 警告；改为恢复原始权限，clippy 与相关真实文件锁用例均复测通过。

## UI/UX 规范补齐（2026-10-05）

- 范围：按本次指令继续完成《Windows 待办应用 UIUX 架构设计规范》中 STEP 20 的界面结构；STEP 21、STEP 22 暂缓，未接入更新入口、未制作发布安装包。
- Main 导航改为一级 Rail（仅任务/设置）与按工作区切换的 Context Sidebar。任务侧栏包含 Inbox/Today/Upcoming/Lists/Tags；设置侧栏只显示已接通的常规、数据、关于分组。窄窗口通过按钮打开左侧 Overlay，选择视图后关闭。
- 任务详情在宽窗口（至少 1100 CSS px）为右侧非模态 Inspector；760–1099px 为右侧覆盖层，更窄窗口为全高覆盖层。宽窗口切换任务、关闭详情、切换工作区时对未保存草稿给出确认，并保留焦点返回。关于页读取运行版本，只给 Main 授予 `core:app:allow-version`；Quick Add 权限未变。
- 前端构建、lint 与 21 个测试文件的 78 项测试通过；`python tests/audit_capabilities.py --step 20` 通过；隔离 `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step20-test.conf.json` 退出 0。关于页最初因缺版本权限失败，中等窗口详情覆盖层最初受通用 Dialog 居中样式影响；两项均修复并复测。最终 `docs/evidence/step20-uiux-20261005-095301/report.json` 为 PASS，11 项原生检查通过，含真实版本、窄窗口侧栏、宽窗口非模态 Inspector、焦点返回、中等窗口右侧覆盖层、紧凑窗口全高覆盖层及隔离任务创建/清理；已查看三种布局截图。
- 原生检查只操作 `com.todoa.desktop.test.step20`，没有停止或打开运行中的正式安装版进程；其全局快捷键占用使隔离测试版显示冲突提示，此提示不计为应用自身回归。测试结束后 `S20 UIUX %` 合成任务剩余 0，隔离测试进程已退出，正式安装版进程仍在运行且未操作。STEP 21/22 的更新、签名、安装版和 Windows 11 Gate 仍未执行。

## UI 设计目标收尾（2026-10-05）

- 本轮按用户指令只处理 UI 设计目标，STEP 21/22 暂不实施。此前临时加入的 Updater 依赖及 NSIS 发布配置已撤回；测试包不作为本轮交付。
- Compact 模式维持左侧纵向任务/设置 Rail。任务 Context Sidebar 在所有任务视图持续列出真实清单、标签及其创建操作；Compact Overlay 支持初始焦点、Escape、Tab 边界和关闭后返回触发按钮。
- 任务 Inspector 增加真实完成状态操作与永久删除确认；任务行删除确认补充关联标签和提醒的删除后果。相关操作复用现有任务 Mutation，不复制业务状态。
- `pnpm build`、`pnpm lint` 和 `pnpm test` 均退出 0；21 个测试文件、79 项测试通过。隔离 `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step20-test.conf.json` 退出 0。
- 原生 Windows 10 x64 隔离身份 `com.todoa.desktop.test.step20` 的最终证据：`docs/evidence/step20-uiux-20261005-113333/report.json`，19 项 PASS，包含三档布局、纵向 Rail、侧栏 Escape/焦点返回、Inspector 完成/取消完成的真实数据操作和删除确认，以及隔离任务创建/清理。已查看 Wide 和 Compact 截图。未将这些证据扩展为 Windows 11 或安装版验收。

## Windows 任务栏与托盘图标修复（2026-10-05）

- Windows ICO 的 16/24/32 像素帧改用简化、放大的勾选图形；32x32 PNG 同步更新。48 像素及以上继续使用现有完整图标。托盘从可执行文件的 32 像素图标资源取图，避免把默认大图直接缩到通知区域；生成源为 `src-tauri/icons/todoa-small.svg` 与 `tools/generate_windows_icons.py`。
- 托盘左键双击调用现有 Main 激活路径，恢复最小化或隐藏窗口并聚焦。右键菜单和退出路径仍按原流程。
- `cargo fmt --all -- --check`、`cargo check --target x86_64-pc-windows-msvc`、隔离 `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.step15-test.conf.json --target x86_64-pc-windows-msvc` 均退出 0。真实 Windows Shell 双击、窗口恢复聚焦及菜单正常退出证据：`docs/evidence/tray-double-click-20261005-193849/report.json`，PASS；仅启动隔离 `com.todoa.desktop.test.step15`，没有关闭或替换正在运行的安装版。安装版更新和 STEP 22 发布验收尚未执行。

## 本地 1.0.0 发布（2026-10-06）

- 在浏览器调试页添加临时示例数据，拍摄收件箱、任务详情和日历截图，存于 `docs/screenshots/`；调试数据未写入正式桌面数据库。
- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `Cargo.lock` 版本统一为 1.0.0。
- `pnpm lint`、`pnpm test`（23 个文件、138 项）、`pnpm build`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc` 与 `cargo test --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`（34 项）均退出 0。
- `pnpm tauri build --ci --bundles nsis --target x86_64-pc-windows-msvc` 退出 0；新安装包 `releases/v1.0.0/Todoa_1.0.0_x64-setup.exe` 长度 2,834,156 字节，ProductVersion 1.0.0，SHA-256 为 `e9aa3f08c3536c43cb30a958903e7ba1800a894a0d3f3860a1f765057d6c1626`，与构建输出一致。安装包未签名。
- 本地安装包及其校验值已归档。1.0.0 安装后的操作、Windows 11、安装版通知和真实登录自启仍未验收。

## 已完成与回收站（2026-10-07）

- 任务侧栏底部提示已移除，新增“已完成”和“回收站”。已完成视图跨收件箱与所有清单读取已完成任务；普通删除操作直接移入回收站，永久删除确认只在回收站内出现，回收站支持恢复。
- SQLite 新增版本 4 迁移和 `deleted_at`；普通任务查询排除回收站任务，回收站查询仅显示删除任务。提醒调度及任务状态、日期更新路径排除已删除任务。备份校验接受旧版本并验证新版迁移历史。
- 浏览器调试页已实际验证新增、完成、移入回收站、恢复和永久删除确认；浏览器数据仍为临时会话。隔离内存 SQLite 验证版本 3→4 保留任务、标签及提醒，恢复后仍可读取，永久删除级联移除关联。前端构建、lint、全套 24 个文件的 143 项测试、`cargo fmt --check` 和 Windows x64 `cargo check --locked` 已通过。
- 完整 Windows Rust 测试的链接阶段因本机低内存未完成；新桌面版安装包及安装后原生界面尚未验收。已发布的 1.0.0 安装包不包含本节改动。

## 任务卡片与重复清除（2026-10-07）

- 任务列表改为每项独立边框、四角圆角及卡片间距。详情截止时间输入框右侧提供“清空”，下方显示重复情况与“清除重复”。重复清除随详情保存，保留截止时间及已有提醒；清空截止时间仍停止重复。
- 浏览器与桌面 SQLite 调度更新路径均支持清除重复，无需新增迁移。浏览器实际验证重复清除后时间及提醒保留、截止时间清空和完成后不生成下一项，截图：`docs/screenshots/task-cards-and-repeat-20261007.png`。
- 相关 4 个测试文件合计 32 项通过（界面测试首次因 worker 启动超时失败，单文件重跑通过）；`pnpm lint`、`pnpm build`、Windows x64 `cargo check --locked` 通过。用当前迁移和实际更新 SQL 验证清除重复保留时间、偏移及提醒。尚未重新打包或进行安装版原生界面验收。

## 1.0.1 版本号（2026-10-07）

- 前端 package.json、Tauri 配置、Rust 包及 Cargo.lock 中 Todoa 的版本号统一为 1.0.1。

## Todoa 1.0.1 发布（2026-10-07）

- Windows x64 NSIS 正式构建成功；安装包为 `releases/v1.0.1/Todoa_1.0.1_x64-setup.exe`，校验值记录在同目录 `SHA256SUMS.txt`。已核对安装包 ProductVersion 为 1.0.1。
- 本版没有重新运行测试套件；前端构建和本次 NSIS 打包均成功。安装后的实际操作、Windows 11、通知显示、登录自启、跨显示器 DPI 和代码签名仍未验收。

## 1.0.2 数据库启动修复（2026-10-07）

- 1.0.1 存在两处版本 4 迁移适配遗漏：Rust 仅统计版本 1–3 却要求 4 次迁移；前端初始化仍要求数据库版本 3。这两项均会阻止正常数据库启动。
- Rust 迁移历史检查改为绑定 SCHEMA_VERSION 并按版本范围计数，前端要求版本同步为 4。没有修改迁移 SQL，也没有清空或重建用户数据库。
- 6 项 Rust 数据库测试、3 项前端初始化测试通过，覆盖旧版本升级保留任务、正常版本 4 启动以及拒绝缺失迁移或前端版本不匹配。隔离应用使用本机数据库的独立 SQLite 快照，已实际进入收件箱；证据：`docs/evidence/startup-fix-20261007/report.json`。原生截图捕获超时，界面通过可访问性文本确认。
- 1.0.2 使用现有数据库。升级请完全退出旧版应用后安装新包；安装后的完整操作及 Windows 11 验收仍未进行。
- 正式 Windows x64 NSIS 构建成功；1.0.2 安装包和 SHA-256 校验文件已归档于 `releases/v1.0.2/`，安装程序 ProductVersion 已确认。

## 工作日记（2026-10-07）

- 用户确认页面原型后接入日记真实功能：每日工作快照、独立周／月／年总结、年度月份回顾、搜索／主题／重点、Markdown 导出及日记回收站。使用说明见 `docs/JOURNAL.md`。
- SQLite 迁移 0005 新建 `journal_records`，快照无任务外键，原任务修改或删除不影响历史。备份恢复验证及旧版本 4 备份兼容已通过专项原生测试。浏览器日记使用独立 localStorage，与桌面数据隔离。
- 浏览器实际验证保存刷新、任务快照、独立阶段总结、追加素材保留原文、未保存保护、删除恢复和 Markdown 下载。构建与 lint 已通过，最后一轮前端全套 168 项测试、原生数据库／备份恢复 19 项测试通过；本轮未重跑耗时的真实进程崩溃恢复测试。
- 原生开发版成功编译，独立身份窗口可读取真实日记页面；本机窗口截图捕获持续超时，未完成原生 GUI 保存／导出操作验收。年度截图：`docs/evidence/journal-preview/functional-year.jpg`。
- 未重新打包安装版。页面原型记录保留于 `docs/JOURNAL_PREVIEW.md`。

## 任务详情改造（2026-10-07）

- 详情改为固定顶部操作、中央富文本正文、固定底部清单／格式／标签／更多操作。日期、时间、重复及自动提醒在统一浮层中确认保存。
- 富文本支持加粗、高亮、列表、链接和本地图片；旧纯文本备注保持兼容。增加 SQLite 迁移 0006，接续日记迁移 0005，桌面及前端数据库版本统一为 6。
- 标题和正文自动保存，组合输入期间不提交；修订冲突拒绝覆盖，失败保留恢复草稿。浏览器任务、图片与草稿刷新后清空，桌面图片随数据库备份保存。
- 浏览器真实验证格式／图片关闭重开、日期重复提醒保存、全天重复生成、宽窄详情布局。原生 37 项全套测试及新增富文本／图片／修订冲突／备份恢复专项测试通过。原生界面图片交互、系统通知和 Windows 关闭流程未验收；未重新打包或发布。
- 说明与截图入口见 `docs/TASK_DETAIL_REDESIGN.md`。此前已回退的收件箱范围及新增表单清单／标签选择保持回退后的行为。
- 最终前端全套 28 个文件、169 项测试通过，生产构建、TypeScript 检查及 lint 通过；构建提示主包超过 500KB。

## Todoa 1.0.3 发布（2026-10-07）

- 合并最近两次未推送提交，并统一 package.json、Cargo.toml、Cargo.lock 与 Tauri 配置的版本号为 1.0.3。
- 发布包含任务详情富文本与图片、日期／重复／提醒设置、日记、标签管理及列表筛选改进。
- Windows x64 NSIS 安装包和 SHA-256 记录归档于 `releases/v1.0.3/`；安装包未签名。安装后的完整操作、Windows 11、系统通知、登录自启及跨显示器 DPI 仍需目标环境验收。
- 安装包大小 3,058,537 字节，SHA-256 为 `5c53ac7bc86ec341f56837b18aa8d8f75562bd2083313933b319bcde59e9fbd3`。本次 Release 构建通过 TypeScript、Vite 和 Rust Release 编译；本轮未重跑自动化测试套件。


## 功能设置与提醒通知（2026-10-08）

- 设置侧栏新增“功能设置”和“提醒与通知”，沿用右侧页面布局。日历／日记开关立即控制一级导航入口，仅隐藏功能，不删除任务或日记。
- 通知设置支持暂停系统通知、隐藏任务标题、跨午夜免打扰时段。暂停时保留待提醒记录，恢复后继续按调度器限速发送。测试按钮使用固定内容直接调用桌面通知 API，不受偏好开关限制；提交成功不代表用户实际收到。
- 桌面偏好保存于 SQLite settings 表，提交成功后才更新运行时状态；浏览器预览保存于 localStorage，通知测试明确禁用并提示到桌面版操作。新增 IPC 仅授权 main 窗口，无新增迁移。
- 前端 220 项测试、构建及 lint 通过；Rust 全套 43 项测试通过，追加暂停／恢复不重复投递专项测试通过。浏览器验证功能入口隐藏／恢复及刷新持久化、通知开关和时段保存，无控制台错误。
- Windows 实际通知显示尚未验收；本轮未重新打包安装版。测试时浏览器偏好已恢复默认值。


## 重复菜单样式与默认时间（2026-10-08）

- 日期与提醒中的重复规则和自定义提醒单位改用 Base UI 选择菜单，沿用应用圆角、黑白配色、悬停底色和选中勾号，支持滚动、键盘操作及视口内自动定位。
- 未设置具体时间时默认显示 09:00；已有具体时间保持原值。选择“无时间”仍可保存全天任务；默认时分不会在未确认时写入任务。
- 日期选择器及任务详情 12 项专项测试通过，生产构建及 lint 通过。浏览器实际验证重复菜单、自定义重复入口、取消不改规则及“明天 09:00／每天”确认保存。未重新打包安装版。


## 热力图自适应与移除免打扰（2026-10-08）

- 完成热力图月视图取消固定七列与最大宽度，日期按顺序从左到右填满可用宽度再换行。年视图月份容器与每日网格也采用自适应列布局，保留一月至十二月的顺序，无横向溢出。
- 上下方向键读取实际渲染列数，列数改变后按当前行宽移动。10 项前端专项测试通过，含列数从 10 变为 6 后的键盘导航；2 项 Rust 偏好测试、生产构建及 lint 通过。
- 完全移除免打扰界面、时间偏好与调度暂停逻辑；旧 JSON 中的免打扰字段兼容读取后忽略，通知仅由系统通知开关控制。
- 浏览器核对当前宽度下月视图 18 列铺满、年视图无横向溢出以及通知页移除免打扰。浏览器 viewport 工具未改变实际渲染宽度，多宽度实测未完成；布局使用 CSS auto-fill 自适应规则。未重新打包安装版。


## Todoa 1.0.4 发布构建（2026-10-08）

- 版本号统一为 1.0.4，保留正式应用身份 com.todoa.desktop 及现有数据库迁移版本。包含自定义重复、日期时间菜单、功能与通知设置和自适应热力图，更新 README、截图及发布说明。
- 前端全套 32 个文件／222 项测试、lint、生产构建与冻结锁文件检查通过；Rust 全套 44 项测试通过，包含真实进程崩溃恢复测试。
- Windows x64 Release 与 NSIS 构建成功，安装包归档于 releases/v1.0.4/Todoa_1.0.4_x64-setup.exe。ProductVersion 核对为 1.0.4，大小 3,100,816 字节；SHA-256 为 aa915387e3a651884df272f2acc5c342c0d7d8cb16a9322dca085e1b70e74ed8。
- 安装包未签名；安装后完整操作、Windows 11、实际通知显示、真实登录自启和跨显示器 DPI 尚未验收。前端主包超过 500 kB 的性能提示保留。
- 发布附件包含安装包、SHA256SUMS.txt 及 RELEASE_NOTES.md；目标 GitHub Release 为 https://github.com/ztlgc/Todoa/releases/tag/v1.0.4 。
