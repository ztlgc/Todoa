# ADR 落地记录

本文件只记录已在项目中落地的选择；其余固定决策以《Windows待办应用AI开发执行手册-最终修订版.md》为准。

## STEP 1：应用身份、窗口与隔离

- 正式应用 `productName = Todoa`，identifier 固定为 `com.todoa.desktop`。改变显示名称时不得静默改变 identifier，以免将后续 AppConfig 数据指向新目录。
- 基础窗口 label 显式设为 `main`，Capability 只匹配 `main`。当前没有自定义 command 或额外插件权限；模板演示用的 `greet` 与 opener 已移除。
- 目标为 Windows x64，`rust-toolchain.toml` 固定 Rust 1.94.1 和 `x86_64-pc-windows-msvc`；默认打包目标仅 NSIS。尚未打包或验证安装版。
- 开发运行使用 `pnpm tauri dev --config src-tauri/tauri.dev.conf.json --target x86_64-pc-windows-msvc`，identifier 为 `com.todoa.desktop.dev`。隔离测试配置为 `src-tauri/tauri.test.conf.json`，identifier 为 `com.todoa.desktop.test`；只在实际运行时显式传入。三者以后不得共享业务数据库路径。
- 前端为本地 Vite/React/TypeScript 页面；无数据库和业务逻辑。保留官方模板的 CSP 配置，安全配置在后续引入真实 API 时逐项核对。

依据：[Tauri 配置扩展](https://v2.tauri.app/develop/configuration-files/)、[Tauri CLI](https://v2.tauri.app/reference/cli/)、[Tauri Capability](https://v2.tauri.app/security/capabilities/)。

## STEP 2：样式体系与组件

- 在现有 Vite 项目使用 Tailwind CSS 4 的 `@tailwindcss/vite` 插件和 `src/index.css` 入口，不建立 Tailwind 3 风格配置。
- 使用 shadcn CLI 4.21.1 的 `--base base --preset nova` 初始化；`components.json` 的 `style` 为 `base-nova`、`baseColor` 为 `neutral`。仅生成 Button、Input、Checkbox；底层为 `@base-ui/react`，没有直接安装 Radix 同名组件。
- `@/*` 同时映射到 Vite 的 `src` 与 TypeScript 的 `paths`。本项目 TypeScript 6.0.3 已弃用 `baseUrl`，故只使用 `paths`，并由 `pnpm build` 验证解析。
- 保留 CLI 生成的颜色、圆角、字体、间距 token；Geist 字体通过本地包构建进产物，不依赖在线 CDN。临时验证页只用于 STEP 2 的样式和键盘操作验收。

依据：[shadcn Vite 现有项目指南](https://ui.shadcn.com/docs/installation/vite/)、[shadcn CLI](https://ui.shadcn.com/docs/cli/)、[Tailwind Vite 指南](https://tailwindcss.com/docs/installation/using-vite)。

## STEP 3：目录与依赖边界

- 现有主窗口入口为 `src/windows/main.tsx`，只负责挂载 React 根组件与全局 CSS；`index.html` 指向该入口。`src/app/App.tsx` 是当前应用根组件，暂时承载 STEP 2 验证页。已有 `src/components/ui/` 继续保存 shadcn 组件，`src/lib/utils.ts` 是生成组件所需的 class 工具。
- 当前依赖方向为 `windows/main → app/App → components/ui`。UI 基础组件不导入应用、业务、数据或 Tauri IPC。这个边界目前由文件位置和导入关系体现；尚未设置专门的静态依赖规则。
- 未来业务层按手册保持 `windows → app → features → data/repositories → data/db` 的调用方向；`domain` 保存纯类型与规则，可被 feature 和 repository 引用，不反向依赖 UI、数据库或 Tauri。`stores` 只保存 UI 状态，不保存任务、清单、标签、提醒或设置的权威副本。`features` 的 Query hook 调用 repository，组件不直接写 SQL。
- SQL 常规路径限定为 `feature/Query → TS Repository → plugin-sql → SQLite`；初始化、Schema 检查和连接状态可在 `data/db`，任务 CRUD 不放在那里。需要多语句原子操作或系统服务协调时，TS Repository 可调用**固定用途** Rust command，Rust 调用方向为 `commands → services → db`；不暴露通用 SQL 或任意路径 command。
- `src/domain/`、`src/data/`、`src/features/`、`src/stores/`、Rust 的 `db/services/commands`、`migrations/permissions` 尚无实现，故 STEP 3 不创建这些目录或占位文件。`src-tauri/capabilities/` 已有实际配置。
- 不引入 GenericRepository、Service Locator、DI 框架或自研 Event Bus。后续每个 STEP 仅在真实实现需要时建文件，并同步核对 Capability、权限及边界。

## STEP 4：依赖、测试与 SQL 权限

- 本阶段只安装 React Query、Zustand、Zod、Vitest 和 SQL 插件 Rust/JS 绑定。`tauri-plugin-sql` 仅开启 `sqlite` feature；当前未直接依赖 SQLx，待 Rust 数据库代码实际使用时再以插件锁定的 SQLx 0.8.6 为兼容基准加入。时间库、日志插件及后续系统插件继续延后。
- `pnpm test` 固定为一次性的 `vitest run`；`pnpm build` 继续先执行 `tsc`；`pnpm lint` 使用 ESLint flat config 与 TypeScript 推荐规则。第一项测试断言现有 `cn` 工具在条件样式和冲突间距下的结果，运行环境不是 Tauri IPC。
- 官方 `pnpm tauri add sql` 自动给 `main` Capability 加入了 `sql:default` 并在 `lib.rs` 静态注册插件。本阶段尚无 SQL 调用，且固定启动顺序要求 STEP 5 在前置检查之后初始化 SQL 插件，因此已撤销这两项自动启用。当前 Capability 仍只有 `core:default`，只匹配 `main`；没有向未来窗口授予权限，也没有配置 SQL preload 或 Migration。

依据：[Tauri SQL 插件及权限](https://v2.tauri.app/plugin/sql/)、[Vitest 一次性运行](https://vitest.dev/guide/)、[typescript-eslint 配置](https://typescript-eslint.io/getting-started/)。

## STEP 5：首个 Schema 与 Database Boot

- 数据库 URL 固定 `sqlite:todo.db`，实际文件由锁定的 `tauri-plugin-sql` 2.5.0 映射到当前 identifier 的 AppConfig。正式、开发和两套隔离测试配置使用不同 identifier；只有测试配置被用于真实数据库验收。Rust 直接依赖 SQLx 0.8.6，与插件依赖同版，使用公开的 `DbInstances → DbPool::Sqlite` 取得共享池；没有第二个在线业务池。
- 前置检查对已有文件核对 `application_id`、`user_version` 和空库状态；未知身份、未来版本、损坏文件拒绝启动。无文件或空的未版本化文件可初始化为 v1；目前没有已发布的旧业务 Schema，真正的旧版本升级案例须在新增 v2 Migration 时验证。短时检查连接用后即关闭。
- SQLx 0.8.6 的 SQLite 新连接默认 `foreign_keys=ON`、`busy_timeout=5000`，默认不设置 journal mode。隔离测试发现先建池后只对池中一个连接执行 `PRAGMA journal_mode=WAL`，新取到的连接仍可见 `delete`。因此前置检查后、插件建池前使用短时连接将文件切换为 WAL 并关闭；插件随后预加载，同 URL 注册并应用 Migration 1，最后从共享池同时验证两条连接的 PRAGMA、实际 `PRAGMA database_list` 路径、Schema、迁移记录和完整性，才发布 Rust Ready。测试还关闭一条连接后验证新连接；`synchronous` 只要求不为 `OFF`。
- Migration SQL 是六张业务表、六个索引、清单删除触发器、`application_id=0x57544431` 与 `user_version=1` 的唯一来源。时间列有毫秒 UTC 文本结构检查；实际日历合法性和输入边界留给后续 domain/repository。单次迁移失败的 SQLx 临时库测试显示本迁移内已创建的业务表回滚；不推断未来多版本迁移共同回滚。
- `database_boot_status` 是首个只读应用 command，已写入 AppManifest 与独立 permission，只授权 `main`；Rust 另核对调用窗口 label。主窗口仅有 `sql:allow-select`、`sql:allow-execute`，没有 `sql:default`、`sql:allow-load`、`sql:allow-close`。前端缓存 `initDatabase()` Promise，先取 Rust Ready 再 `Database.get()`，并以真实插件 `select` 核对版本。失败页面要求完全关闭并重新启动，失败的同一进程不重跑 Migration。
- `tauri.acl-test.conf.json` 仅为隔离 ACL 验收，增加无权限的 `acl-probe` 窗口且使用独立 identifier。原生运行确认该窗口的状态 command、SQL `select/execute` 均被 Tauri ACL 拒绝，`main` 仍可 Ready。正式配置只含 `main`。

依据：[Tauri SQL Migration 与权限](https://v2.tauri.app/plugin/sql/)、[Tauri Capability](https://v2.tauri.app/security/capabilities/)、[SQLx SQLite 连接选项](https://docs.rs/sqlx/0.8.6/sqlx/sqlite/struct.SqliteConnectOptions.html)。
