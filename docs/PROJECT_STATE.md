# PROJECT_STATE

更新日期：2026-10-04（Asia/Shanghai）

## 当前步骤与范围

- STEP 0：已验收（Windows 开发环境检查）。
- STEP 1：已验收（当前 Windows 10 x64 开发主机上的基础项目、编译和实际窗口）。
- STEP 2：已验收（当前 Windows 10 x64 开发主机上的 Tailwind/shadcn 基础页、构建和键盘操作）。
- STEP 3：已验收（实际文件目录、依赖边界、构建和原窗口行为）。
- STEP 4：已验收（依赖、一次性测试、lint、构建、Rust 检查和自动权限审查）。
- STEP 5：已验收（SQLite Migration 1、Database Boot、隔离库与原生 IPC/ACL/失败门验证）。
- STEP 6–22：未开始。下一步须由用户明确指令启动 STEP 6。
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
