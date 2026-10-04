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

## STEP 6：任务边界与首批 Repository 协议

- `src/domain/task.ts` 只定义任务类型和纯校验，不导入 Tauri、SQL 或 UI。标题写前 trim；ID 用正安全整数；带时区时刻先校验真实日历日期和偏移，再标准化为固定毫秒 UTC。`UpdateTaskInput` 预留为手册指定类型，但 `update/getById` 方法按 STEP 20 才开放。
- `src/data/repositories/TaskRepository.ts` 是任务 SQL 与 Row Mapping 的唯一前端位置。默认 adapter 使用 STEP 5 的 `initDatabase()`，因此真实调用必须经过 Ready 门；单元测试可注入 fake adapter 检查协议，而不把 fake 当作原生验收。
- `listId` 缺省表示不限清单，`null` 表示 Inbox，正整数表示指定清单。写操作只使用单条参数绑定 SQL；状态、完成时刻和更新时间在一条 UPDATE 中同步，重复状态保持原时间。插入 ID 取本次 `execute` 的 `lastInsertId`，不查询连接本地 `last_insert_rowid()`；`rowsAffected=0` 表示目标不存在。
- STEP 6 不引入 Query、业务 UI、窄 Rust 事务 command 或新权限。STEP 16 如需完成任务时原子取消提醒，再将 `updateStatus` 按手册改为固定用途 Rust Service 事务；不能在 JS 用多次 `execute` 拼事务。

## STEP 7：Ready 门、本地 Query 与失效策略

- App 用 `DatabaseGate → MainQueryProvider → 业务消费者` 的挂载顺序，未 Ready 或启动失败时不挂载 Query 消费者。每个主窗口 Provider 持有稳定 QueryClient，不持久化缓存，不给 ACL probe/未来 Quick Add 挂载主窗口 Provider。
- 本地 Query/Mutation 使用 `networkMode: 'always'`；读最多重试 1 次，写不重试。TanStack 的离线标志不能阻止 SQLite IPC。主窗口焦点和重新可见回调显式 refetch 活动查询，清理异步注册的 Tauri 监听器，避免仅依赖浏览器焦点规则。
- taskKeys 集中维护视图、清单、标签、状态和日期范围，以及列表/详情/计数前缀。后续 key 维度不等于相应 Repository SQL 已实现。首批 Hooks 只使用当前 Repository API，成功后等待全部列表、受影响详情、计数失效；失败不更新业务缓存，不做 Optimistic Update。
- 原生测试临时授权 main 隐藏/显示/聚焦，仅用于验收实际焦点刷新；额外配置和探针已经删除，不扩展正式 Capability。STEP 15 实现托盘显示主窗口时须继续保证显示后聚焦及刷新链路，并验收真实托盘交互。

依据：[TanStack Query Network Mode](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)、[Tauri Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)，并核对项目锁定的 React Query 5.104.1 与 Tauri API 2.12.1 源码及类型。

## STEP 8：Inbox 交互与原生验收

- Inbox 在 Ready 后挂载，业务数据唯一来源是 `useTasks({ listId: null })`，不筛除已完成任务；计数由查询结果派生。组件只调用 STEP 7 Hooks，SQL 与 Row Mapping 保留在 Repository。新增、状态、删除成功后由现有失效策略刷新界面，不引入乐观任务副本。
- 草稿、错误、删除确认保存在 React local state。输入以纯 Domain 校验；composition/isComposing/229 拦截 IME Enter，pending 配合同步 ref 防重复。成功才清空草稿；失败展示错误并保留输入或实际任务状态。永久删除使用行内确认与取消，复用已有 Base UI/shadcn 组件。
- 原生自动验收使用官方 Windows WebDriver 路径，不将 jsdom 或浏览器页面代替 Tauri IPC。独立测试配置 identifier 为 `com.todoa.desktop.test.step8`，内嵌构建前端；脚本读取运行时 identifier，匹配后才能操作任务。隔离 SQLite 的只读核对及合成写锁不用于业务写入，持久化以不同原生进程 PID 证明。
- 离线验收用 WebDriver CDP 禁用 WebView2 实际网络并重新加载内嵌页面，再执行 CRUD；不声称关闭 OS 网卡。没有新增应用权限或项目依赖。

依据：[Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)、[Windows WebDriver 手动配置](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)。项目验收锁定 tauri-driver 2.1.0 与匹配本机 WebView2 的 Edge WebDriver 154.0.4258.53。

## STEP 9：清单、归属与删除语义

- List Domain 只存纯类型/校验；ListRepository 负责参数绑定 SQL 与 Row Mapping。名称 trim、1–100 Unicode 字符，ID 正安全整数。依照现有 Schema 允许重名清单；Inbox 是 list_id=NULL 视图，不创建特殊业务行。
- Task 创建可直接携带 listId，避免创建后再移动造成两次写入；setList 使用单 UPDATE，仅改变归属与 updated_at，缺省/null/正整数清单筛选语义保持。共享 SqlDatabase 是现有 Ready adapter 的最小类型接口，不引入第二连接池、通用仓储或 JS 事务。
- 删除清单仅执行单 DELETE，复用 Migration 1 的外键 SET NULL 与归属更新时间触发器，保留任务及关联数据。不编辑已应用的 Migration。重命名、移动同值保持 updated_at；真实归属变化以现有触发器的 UTC 时刻为准。
- 清单/任务 Hooks 都采用 networkMode always、写入不重试；成功后等待清单、任务列表/详情/计数失效。界面用 Query 数据作为唯一业务真值；local state 只保存草稿、选择、错误和确认。删除当前清单后返回 Inbox，失败不清空草稿或假设任务已移动/删除。
- 原生验收独立 identifier `com.todoa.desktop.test.step9`，每次核对运行时身份。异常目标仅通过测试注入选项调用实际 UI handler 验证 SQL 外键拒绝；合成写锁验证四种写失败；不同进程与 SQLite 全字段快照验证持久化。STEP 8 WebDriver helper 增加显式期望 identifier 参数，默认仍为 STEP 8，拒绝跨测试身份操作。
- TaskListView 与 ListControls 使用不同前缀的 sibling key，避免切换清单时重复 key 导致旧任务 DOM 残留；DOM 与原生验收均要求当前标题唯一。当前选择不持久化，重启默认 Inbox。

## STEP 10：标签、关联与标签视图

- Tag Domain 保存纯类型与名称/ID 校验：trim、1–100 Unicode 标量、正安全整数，拒绝 NUL 和孤立代理字符。名称原样保存，判重由现有 SQLite `COLLATE NOCASE UNIQUE` 执行；第一版只承诺 SQLite 的 ASCII 大小写语义，不做完整 Unicode 大小写折叠或重命名/层级功能。
- 单个 TagRepository 包含 `list/listTaskTags/create/assign/remove/delete` 和 Row Mapping。创建用针对 name 的 `ON CONFLICT(name) DO NOTHING`，0 行转为明确的 TagConflictError，不预查名称制造竞态，也不吞其他约束/写入错误。创建仍读取本次 execute 返回的 insert ID。
- 分配用 `ON CONFLICT(task_id,tag_id) DO NOTHING`，只有已存在的同一关系视为幂等；不存在的正整数父记录交由真实外键拒绝。移除只删指定关系，0 行报告 TaskTagNotFoundError；不存在的标签删除报告 TagNotFoundError。非法 ID 在获取数据库前拒绝。全部关系操作为单条绑定 SQL，不做多语句替换标签或前端事务。
- TaskRepository 的 tagId 通过参数绑定 EXISTS 查询筛选，可跨 Inbox/清单，也可与 listId/status 组合，不在 UI 过滤任务或用 JOIN 制造重复行。Query key 使用既有 tag 视图和 tagId 维度。
- 标签与任务关联由 Ready 后的 Query 缓存提供，业务数据不进入 local state/Zustand。成功分配/移除/删除使清单、标签元数据/关联、任务列表/详情/计数失效；任务删除也刷新关联缓存，体现 FK 级联。写入不重试，失败保留草稿和实际查询结果。
- Inbox/清单任务行支持一次分配或移除一个标签，允许重复分配同一标签用于验证幂等。标签任务视图只查看与操作已有任务，新建入口在 Inbox/清单，不实现需要多写原子性的“创建并分配标签”。删除标签有确认，说明只移除关联、不删除任务；删除当前标签后返回 Inbox。
- 复用 Migration 1 的两个 ON DELETE CASCADE 外键，不改已应用 Migration 或权限；隔离验收 identifier 为 `com.todoa.desktop.test.step10`。对关联的写入不修改任务记录字段，使用真实 SQL/原生界面和进程重启验证判重、级联、过滤及持久化。

## STEP 11：Main 最小 Capability

- 按锁定 Tauri 2.12.1 / JS API 的真实调用保留 `core:event:allow-listen`、`core:event:allow-unlisten`（Main onFocusChanged 内部监听 focus/blur）、`main-database-boot-status`（Ready）、`sql:allow-select` / `sql:allow-execute`（Repository）。`invoke` 和 `getCurrentWindow` 的元数据读取不需要额外 core 默认权限。删除 `core:default`，Main 不授予 load/close、事件发送或窗口操作。
- 当前自动加载的 Capability 只有 default.json，精确 windows=[main]，无 remote/webviews 通配与显式配置叠加。唯一受控自定义 command database_boot_status 在 AppManifest、handler、手写 permission 中一致。历史自动生成 restart_after_boot_failure permission 未被任何 Capability 引用，也没有 handler，不产生授权。
- NativeSession 用已授权 SQL select 的 PRAGMA database_list 核对隔离路径，不为了测试保留 app identifier 权限。STEP 11 的 acl-probe 只在测试配置添加，没有 Capability；拒绝测试保持生产 Main 原始授权。
- 能力审计同时检查全部 Capability、生成 Schema 的 permission identifier、AppManifest、handler 和手写 custom permission 的精确集合。实际原生 UI 验证 Task/List/Tag 回归及拒绝；测试仅使用 com.todoa.desktop.test.step11。

## STEP 12：独立 Quick Add、窄创建命令与事件

- Rust setup 只创建一次 quick-add WebviewWindow，加载 quick-add.html，初始 hidden/focused=false；固定尺寸 480×180。Main 的临时按钮调用 show_quick_add，Rust 只查找既有窗口、unminimize/show/set_focus。Escape 调用 hide_quick_add；原生 CloseRequested 阻止销毁并隐藏。重复显示不重新创建，草稿只在当前 renderer state 保留，不持久化业务副本。
- src/windows/quick-add.tsx 独立入口只挂 QuickAdd，复用纯 UI/Input/Button/Task title 校验。无 MainQueryProvider/DatabaseGate/SQL adapter；Vite 双 HTML 输入。audit_quick_entry.py 检查实际 Quick 入口及全部引用 JS chunk，确认没有 SQL、database_boot_status 或 show_quick_add。
- 新增 commands/quick_add 和 services/quick_add 模块都承载真实职责；没有占位模块。create_quick_task 只有 title:String 业务参数，调用窗口由 Tauri 注入，必须 quick-add 且 BootState Ready；服务再次检查标题 trim 1–500 Unicode 标量、拒绝 NUL。Rust 的 trim 字符集与 ECMAScript String.trim 一致；前端任务标题补充 NUL/孤立代理拒绝。
- db::shared_pool 返回 plugin-sql 已 preload 的同一 SQLx pool clone，Boot verify 也复用该 helper；不新建生产连接池。单条绑定 INSERT 自动提交，只写标题和相同 UTC 毫秒 created_at/updated_at，其他字段使用 Schema 的 Inbox/defaults。本条语句的 last_insert_rowid 返回 id，无跨池查询 insert id 或 JS 事务。Migration/Schema 不变。
- 提交之后 emit_to(main, task-created, id)。发送失败只记录静态错误码、仍返回已提交 id；Main 在 Ready 内监听，校验最小 id 并失效 task/list/tag/detail/count 缓存。既有 focus/visibility active refetch 为丢事件补偿。监听注销支持异步注册完成晚于卸载；不记录标题/真实路径。
- Quick 提交使用同步 ref 与 pending 禁用防双提交；composition ref、isComposing、229 防 IME Enter。创建失败保留草稿，成功先清空再隐藏，隐藏失败明确显示“已创建”并不重试创建。Escape/原生关闭保留未提交草稿；成功后的同一窗口重新显示输入为空并聚焦。
- AppManifest/handler/手写 permissions 共四个 command 严格一致。Main 保留 STEP 11 五项权限，仅增 main-show-quick-add；Quick 精确 windows=[quick-add]，只有 core:event:allow-listen/unlisten、quick-create-task、quick-hide-window；没有 SQL、Ready/show Main command、core:default、事件发送或任意窗口操作。Rust 对各 command 来源再校验，不能由 JS 参数选择窗口/数据库/SQL。
- 实际原生验收用 com.todoa.desktop.test.step12、相同生产 Capability。WebDriver 输入/点击/Enter/Escape、Win32 只核对同一测试 PID 的可见性/系统前台窗口，WM_CLOSE 只发送给该 PID 的 Quick HWND 验证原生关闭；不控制其他应用。IME 用 composition/keyboard DOM 事件验证 guard，并由真实 Enter 提交到 Rust/SQLite，未声称人工操作系统输入法验收。

## STEP 14：固定全局快捷键与当前退出边界

- 仅在 Rust 接入官方 tauri-plugin-global-shortcut 2.4.0（global-hotkey 0.8.0），固定 CONTROL|SHIFT + Space。依据 https://v2.tauri.app/plugin/global-shortcut/ 与锁定源码。没有 JS guest binding、快捷键编辑器或前端 register/unregister 权限。Cargo lock 新增 7 项依赖；Windows 实际新增构建 global-hotkey/keyboard-types，Linux 专属传递依赖只锁定不声明 Windows 功能。
- Quick 创建后注册；ShortcutStatus.initialized 原子防重复初始化。只处理 Pressed，pressed latch 防重复 Pressed；Released 仅清 latch。锁定 global-hotkey Windows 注册还使用 MOD_NOREPEAT。stopping 防退出时继续响应；registered 记录本应用成功拥有的注册，不用插件 is_registered 的本地表推断其他进程冲突。
- Rust shortcut callback 与 Main show_quick_add 都调用 show_existing：固定查找 quick-add、unminimize/show/set_focus，不创建另一窗口。向 Quick 发 quick-add-shown 最小通知以在已聚焦窗口里也聚焦输入；前端仍监听焦点变化，两个 listener 都处理异步注册后卸载清理。没有新增 Quick 权限。
- 注册失败保留应用运行与 Main 按钮；Main ShortcutNotice 先订阅 global-shortcut-status，再读取 global_shortcut_status，防漏启动结果。固定只读 command 在 AppManifest/handler/permission 一致，只有 Main 的 main-global-shortcut-status 可调用。失败明确显示“注册失败，可能已被其他应用占用”；状态不伪装 registered。窗口显示/焦点失败单独反馈。
- RunEvent ExitRequested/Exit 调用幂等 shutdown，停止接收快捷键，只有 registered=true 才注销固定快捷键，不注销冲突宿主的注册。当前未实现 Tray 的阶段，关闭 Main 正常退出；修复 Main 关闭后留下隐藏 Quick 与快捷键的孤立进程。STEP 15 的关闭隐藏/统一 Quit 与在途写入收尾未实现，不把此清理视为完整 Tray 生命周期。
- 用户本次明确只授权 STEP 14；STEP 13 Single Instance 尚未实施，不擅自补做、不标为 PASS。STEP 14 的当前主机验收限制同一时间一套应用实例；后续依赖单实例的步骤应先完成 STEP 13，跨进程拦截未获得本步证明。
- 原生验收 com.todoa.desktop.test.step14：独立 Python 进程的测试宿主 HWND 取得真实前台焦点，系统 keybd_event 发送固定组合；监听生产 quick-add-shown 计数验证一次按下/held-repeat/释放合计只显示一次。Win32 RegisterHotKey 在宿主真实占用制造冲突，正常 Main WM_CLOSE 退出后同一注册可重新占用；通过三次不同 PID 启动/正常退出，不把强制 taskkill 当退出注销证明。只针对自建宿主与隔离应用操作。

## STEP 15：Tray、必要单实例前置与统一退出

- 用户要求重复启动无第二个托盘，原 STEP 13 缺失，因此本次作为必要前置补齐 single-instance；不额外实现未来步骤。官方 tauri-plugin-single-instance 2.5.2 是 Builder 首个插件，在 SQL/Quick/快捷键/Tray setup 之前拦截。callback 不处理 args/cwd，固定 show/unminimize/focus Main；Main 尚未创建时 pending_activation 合并等待 setup 完成，Optional 窗口不 unwrap。原生隐藏/最小化后再次启动均只有首进程长期运行、同一 Main/Tray HWND，STEP 13 对应 Gate 在本次通过。依据 https://v2.tauri.app/plugin/single-instance/ 。
- Tray 使用 Tauri 2.12.1 core tray-icon feature，不添加独立 Tray 插件或 JS guest。锁定 tray-icon 0.25.1 / muda 0.20.0。固定 ID todoa-main-tray、应用图标、tooltip Todoa；菜单只有显示主窗口、快速添加、退出，复用已有窗口和 Rust Quit 路径。依据 https://v2.tauri.app/learn/system-tray/ 与锁定 Rust 源码。
- tray-icon Windows backend 在 Shell 未接受图标时也可能 build Ok，因此以 tray.rect() 的真实 Shell 可用性确认成功；失败移除未确认的 Tray，Main 明确提示关闭将退出。Close 时还核对当前 Tray 可用性；只有可找回才隐藏。隐藏不销毁 renderer 或关闭 SQL 池。
- Lifecycle 管理 quitting/ready_to_exit、活动写入与 owner-bound lease。Main 原有 SQL Repository 不改变业务 SQL，Ready adapter execute 前调用 begin_main_write，finally 调 finish_main_write；开始与退出在同一 Mutex 下判定，禁止 check-then-act 竞态。Quick Rust command 使用 RAII guard（取得现有池前登记），成功/失败/未来取消均释放。finish 只能由 Main 释放其自己的 token，不能释放 Quick 的 guard。通用 Main SQL 权限仍不是逐 SQL 安全沙箱；生命周期约束适用于产品 Repository 路径，不虚构 plugin-sql 的 SQL 拦截能力。
- Quit 设置 quitting 并通知两窗口，Main 移除 Mutation UI、Quick 禁用提交；Rust 拒绝新 lease/创建/显示。先停止当前快捷键回调，再 drain 活动写入，随后注销固定快捷键、await 同一 SQLx pool.close()、标记 ready_to_exit、app.exit。丢 renderer ack 最多等 10 秒，之后仍 await pool.close 等待实际借出连接，不强杀执行中的 SQL。缓存/ack 丢失不把已提交写入标为失败或自动重试。
- RunEvent ExitRequested 在清理完成前 prevent_exit 并进入同一幂等 Quit，ready_to_exit 后放行。CloseRequested 在 quitting 时不 prevent_close、不 hide；正常运行 Main 关闭仅在 Tray 已确认存在时隐藏，失败走可见退出；Quick 正常关闭仍隐藏保留草稿。对 Main/Quick 的在途 SQL、quitting 时关闭两个窗口、正常真正退出与热键释放均有原生证据。
- Scheduler 尚未接入；当前 stop_events 是已有后台快捷键的明确停止钩子，后续 Scheduler 在同一 Quit 阶段接入，不创建空 Scheduler 或声称停止它已测试。现无已安装窗口状态服务/文件，无必要状态可保存；Main size/position/maximized 持久化按 STEP 19 实现，本步隐藏仍保留当前进程内窗口状态。
- 新增三个窄 Main-only command lifecycle_status/begin_main_write/finish_main_write，在 AppManifest/handler/permissions 一致；新增两个 Main permission，Quick 无新增 grant，没有 core:tray/core:menu/global-shortcut 管理权限或 wildcard。
- debug-only test-tray-failure Cargo feature 只做原生故障注入，默认关闭，Release 不生效；测试配置 identifier com.todoa.desktop.test.step15.no-tray，不提供运行时测试 command。默认原生验证 identifier com.todoa.desktop.test.step15。Win32 点击真实 Shell 图标/菜单，读取本 PID 图标和 popup，截图仅裁切本菜单；第二进程是真实启动同一 exe。写锁只用于合成等待，不由 Python 写业务行，失败夹具只用明确选项通过 Main UI 清理。


## STEP 16：Reminder Service、事务完成与 Rust Scheduler

- 复用 Migration 1 的 reminders、索引与 ON DELETE CASCADE；没有改写已应用 Migration 或新建无需要的 Schema。ReminderRepository 的查询走 plugin-sql，创建/编辑/删除调用固定用途 Rust command；Query 仅在 Main Ready 后挂载，networkMode=always、Mutation retry=0。组件只保存面板、时间输入、编辑 ID 与错误，不保存数据库权威副本。
- Service 校验正安全整数 ID、有效带时区时间和未来时刻，统一 UTC 毫秒格式；INSERT SELECT / 条件 UPDATE 同时验证任务未完成、提醒未触发。已触发提醒不能编辑重发，可删除或明确新增。due_at 不参与提醒时间计算。
- TaskRepository.updateStatus 已切换为唯一的业务完成入口 update_task_status；SQLx 同一连接事务内更新任务状态并删除未触发提醒，已触发记录保留，失败整体回滚。取消完成不自动恢复提醒。其他常规 CRUD 仍走既有 TS SQL 路径；删除任务后调用窄 reconcile_reminders，失败仅记录唤醒错误，已提交的删除不伪装失败；30 秒恢复循环负责兜底。
- Rust Ready 后只启动一个调度循环。Notify 变更唤醒合并为一次重建；串行 Mutex 控制所有 Reconcile。SQLite 按 remind_at/id 排序，下一到期时刻决定 timer，等待最多 30 秒作周期恢复。没有声称实现 Windows resume/时钟变化事件；依靠 periodic recovery 重新计算 UTC。正式出口未启用时每 30 秒保持循环但不投递、不写 triggered_at。
- 可注入墙钟与单调时钟：UTC 决定到期，单调时间决定每秒最多一次尝试及指数退避（首次 2 秒、最高 5 分钟）。再次读数据库确认 ID/时间仍匹配、未触发且任务未完成，使用最新任务标题；不保留每提醒线程或旧标题。修改或删除使旧计划/退避/已接受待标记状态失效。
- 出口成功后条件写 triggered_at/updated_at；API 错误不标记、保留错误状态并重试。成功但标记失败时保留同进程 accepted 状态，优先重试标记而不重复调用 API。通知与 SQLite 不能一个原子事务，极端重启重复仍可能发生；已交给 OS 的通知与并发完成/删除竞争无法绝对撤回。
- 当前生产构造器只选择 Disabled 出口；fake 类型只在 cfg(test) 模块，以 tempfile 创建的 reminder-test.db 注入，不接受 AppHandle、正式 identifier、外部路径或环境变量，应用无启用 fake 的 command/feature。正式库不会因为 fake 成功被写 triggered_at。UI 明确提示“提醒发送尚未启用”、补发可能多条、进程退出后不发送。
- Quit 先设置 Lifecycle.quitting，拒绝新的 Reminder/任务完成写入，停止调度器并唤醒 timer；异步等待 worker 结束，再排空既有写入、注销快捷键、关闭共享 SQLx pool、退出。无强杀替代正常退出。Service 使用既有 RAII 写入 lease，Boot 未 Ready 拒绝 command。
- Main 仅新增 main-reminders permission，六个固定 command（CRUD、完成事务、唤醒、状态）；manifest/handler/permissions 三者共 14 个 command 一致。Main 共 10 个 grant，Quick Add 仍原 4 个 grant，没有 notification、任意 SQL Rust command、窗口/托盘管理或通配权限。Main 的原 plugin-sql execute grant 仍为常规 Repository 所需，事务完成路径约束不意味着 SQL grant 成为恶意 Main 代码的逐语句沙箱。
- 隔离原生配置 com.todoa.desktop.test.step16，真实调用前核对 PRAGMA database_list。日期输入采用 DOM 原生 setter+input/change，实际保存/编辑/删除/完成用 WebDriver 点击；Exit 使用实际托盘菜单，托盘失败时验证可见 Main 原生 WM_CLOSE 回退。驱动在应用确实退出后释放，每次新端口规避 EdgeDriver TIME_WAIT；不得把测试驱动清理视为应用 Quit PASS。

实现依据：[Tokio Notify 1.53.2](https://docs.rs/tokio/1.53.2/tokio/sync/struct.Notify.html)、[SQLx Transaction 0.8.6](https://docs.rs/sqlx/0.8.6/sqlx/struct.Transaction.html)。STEP 17 的系统通知尚未接入。


## STEP 17：实际 Windows 通知与 API 接受语义

- 初始化官方 notification Rust 插件，生产 Scheduler 改用 SystemNotification。STEP 16 Disabled 与 FakeNotification 仅留在 cfg(test) 回归测试，不存在正式 fake command/feature，仍沿用 SQLite 唯一真相、到期/串行/重试/退出机制。只发送最新任务标题，不加 Action、Snooze、富通知、重复提醒或点击导航。
- 锁定 tauri-plugin-notification 2.5.1 源码的 desktop.show 会 spawn 后立即返回，后台 notify-rust.show 错误被 let _ 丢弃；permission_state 固定 Granted。直接使用这个返回值不满足“API 接受后才标记”的固定手册，因此将同版官方源码置于 src-tauri/vendor/tauri-plugin-notification，用 Cargo patch.crates-io 固定本地补丁；许可证、上游文件及 TODOA_PATCH.md 保留。
- 补丁让 desktop.show 等待 notify-rust / WinRT Show 并传播 Delivery 错误。Scheduler 在 spawn_blocking 中调用并 await 结果，避免同步桌面 API 阻塞 async 调度线程；成功返回之后取 UTC 时间，再条件写 triggered_at/updated_at。标记失败继续只重试标记，不重复调用通知 API；Quit 等待这个 worker 后才关闭 pool。
- 补丁以 Windows ToastNotifier.Setting 检查真实可用性，使用与发送一致的 App ID；Enabled→Granted，明确禁用→Denied，其他错误传播。仅 Setting 返回 HRESULT 0x80070490 时报告 Prompt/Unknown，UI 明确“设置暂无法确认”，允许尝试实际 Show，绝不把 Unknown 标记 Granted 或通知成功。真实 Show 的结果仍是是否写触发状态的唯一依据。
- 开发 App ID 检测扩展了 Cargo 的 target-triple/debug/release 目录；此时使用锁定 WinRT 后端的完整 PowerShell App ID（不是凭空简写）。正常安装位置使用正式配置 identifier。开发环境的 PowerShell 来源身份与正式安装名称/图标不能混为一谈。
- Scheduler 状态/错误通过既有 Main reminder_scheduler_status 和 reminders-changed invalidation 刷新；待重试的错误不因其他提醒成功而清除，删除/变更使旧错误计划失效。UI 从原“尚未启用”切换为系统可用性/错误状态，触发标签写“API 已接受”，明确“API 接受不代表已看到；关闭通知/勿扰可能抑制显示；应用退出后不发送”。
- 没有安装 notification JS 包，没有授予 Main/Quick Add 任何 notification 权限；Rust plugin 初始化不会自动授予插件 default。Main 仍 10 grant、Quick Add 仍 4 grant，自定义 command 仍 14 个。原生拒绝测试证明两窗口均不能直接调用 plugin notification.notify，Quick 也不能读 notification.permission_state 或 Main Scheduler 状态。
- 真实开发验收仅运行 com.todoa.desktop.test.step17 的隔离库；通过实际 Main Service 创建提醒，用非法 XML 控制字符测试真实 WinRT API 错误，再恢复数据库标题验证退避重试；退出期间 pending 保持 NULL，重启补发后标记。正式库未触碰。测试库清理走 Main UI 删除任务及外键级联。

依据：[官方 Notification 指南](https://v2.tauri.app/plugin/notification/)、[锁定插件 desktop 源码](https://docs.rs/tauri-plugin-notification/2.5.1/src/tauri_plugin_notification/desktop.rs.html)、[Microsoft ToastNotifier.Setting](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotifier.setting)。后续插件升级必须重审本地补丁，不能静默恢复吞错/立即返回语义。API 成功不代表 Toast 已显示或用户已阅读；安装版 Gate 见 PROJECT_STATE 的 STEP 22 待验收表。

## STEP 18：SQLite 快照、日志恢复与启动失败收尾

- ADR-008 落地：Rust 官方 dialog 2.8.1 选择路径，Main-only 三个 command；renderer 无路径参数、dialog/fs grant 或重启 grant。Main 11 grant、Quick 4 grant、manifest/handler/custom permissions 共 17 command。
- 共享 SQLx pool 参数绑定 VACUUM INTO，同目录唯一临时文件；校验/显式关闭/flush 后 Windows MoveFileEx(REPLACE_EXISTING + WRITE_THROUGH) 发布，取消与失败不表示成功，既有目标要求明确覆盖确认。拒绝在线 DB/WAL/SHM、别名/硬链接及恢复操作目录。
- 只接受 Schema 1：当前版本以唯一 Migration 的 checksum、完整 sqlite_master 定义（含迁移表/列/约束/index/trigger）、application_id、user_version、integrity_check 和 foreign_key_check 校验。没有已测试旧 Schema 升级路径；因此旧版本拒绝，不能声称旧库恢复 PASS。源带 WAL/SHM/journal 的文件拒绝，复制到受控 stage 后再次校验。
- 小型 serde 日志仅存枚举操作编号、阶段、受控历史文件名，拒绝额外路径、非顺序 moves、非法阶段与超过 8 KiB 的日志。每次 rename 前持久化 intent、后持久化状态；非 pending 的中断恢复统一逆序回滚，不猜测完成。回滚本身可重复中断；失败保持不可用，成功 phase=failed，不在后续启动自动重试。
- pending 在 Single Instance 后、SQL preload 前处理；原 DB/WAL/SHM 作为组移动，新库侧文件与旧组隔离。启动失败先 await 新 pool.close，再逆序恢复。成功后用原组只读连接 VACUUM INTO 保留经过验证的 backups/restore-before-*.db，之后才持久化 committed 和清理旧组。清理失败只保留残留，不回滚已经 committed 的新库；下次启动重试清理。
- 生命周期沿用写 lease、停 Scheduler、排空在途写入、注销热键和 await pool.close；ready_to_exit 后 request_restart。旧进程退出后新进程才能替换，失败自动重启可手动重开 pending。新 QueryClient/选择状态/调度器来自完整进程重建。
- 锁定 SQL 插件 2.5.0 setup 在迁移错误时会 Drop 未注册的 pool，其异步释放无法由应用 await；完整官方包保留许可证 vendored，并仅补错误分支显式 await close。不得在后续升级丢掉此保证。debug-only test-restore-startup-failure + 精确测试 identifier/marker 触发真实迁移 checksum 错误；默认/Release 不启用，无生产故障命令。
- 隔离测试真实 Windows 文件锁/只读权限；磁盘满为线程局部 OS error 112 注入，未填满实际用户磁盘。替换和回滚 17 个边界由测试子进程真实 abort 验证；测试 env hook 只在 cfg(test)。生产没有 fake 通知出口。

依据：[SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html)、[官方 Rust Dialog](https://v2.tauri.app/plugin/dialog/)。原生驱动采用 Microsoft 官方 WebView2 attach 模式，确保 Rust 重启后重新附着新进程；所有 SQLite 检查句柄显式关闭。

## STEP 19：窗口与系统启动边界（2026-10-05）

- 官方 window-state 2.5.0 仅 SIZE/POSITION/MAXIMIZED、filter Main。官方缓存仍序列化其他默认字段，但这些 flags 不跟踪/恢复隐藏、最小化或装饰状态；Quick 不在文件中。物理像素与当前工作区比对，完全在外才中心回退，负坐标有效；托盘隐藏窗口只搬位置，不擅自显示。
- 官方 autostart 2.7.0 Rust manager 实际读取 OS 状态。用户启用之前不调用 enable；Windows HKCU Run 精确参数 --autostart。完整官方包 vendored 最小两行修补：可执行路径加引号、WindowsEnableMode::CurrentUser，避免空格路径错误与默认先写 HKLM。
- 插件无 JS grants；Main-only autostart_status/set_autostart 两 command。返回 OS 观测值而非用户请求值，界面失读不假称关闭，失写后再次读取。
- Main 初始不可见/不聚焦；等待真实 Tray 最多 3 秒后完成启动。--autostart 且 Tray 成功才隐藏；失败显示 Main。二次启动精确区分参数，手动激活记录 sticky visible_requested，防止就绪期间的手动唤醒被后续隐藏覆盖。
- Windows 实测 Shell_NotifyIconGetRect：关闭隐藏区域时已登记图标返回 S_FALSE=1 与有效 chevron 边界，展开后 S_OK 且真实菜单可用。tray-icon 0.25.1 官方代码仅 S_OK，误判后删除有效托盘；完整包仅将该检查改为成功 HRESULT + 正边界，错误仍拒绝。补丁须升级重审，不新增外部权限。
- 生命周期状态 starting 时不挂载业务消费者，完成后 tray-ready/unavailable；退出仍通过原统一停写/停调度/关闭连接/注销热键流程。物理登录与安装版行为为 STEP 22，不以传入参数模拟冒充真实登录。

## STEP 20：任务编辑、日历查询与界面草稿（2026-10-05）

- getById 返回 Task 或 null；update 只允许 title/notes/dueAt/listId，单条绑定 UPDATE + updated_at 后读取 Row Mapping。清单外键与其他字段一起提交；不在 JS 池连接上伪装事务。完成取消提醒仍走既有窄 Rust 事务。
- ADR-006：本地当日 setHours(0,0,0,0)，下一日用 setDate(+1)，转规范 UTC 边界。Domain 拒绝倒置/缺失/错误日期范围，日期视图强制 todo。Repository 真实 WHERE due_at >= ? / < ? 与 due_at 升序，无日期与已完成不进入日期视图。
- Query key 含日期视图/状态/UTC范围；每秒日历 clock、focus/visibility 重算，午夜与系统时区变化不改变已存 UTC。编辑成功失效所有任务 lists/date scopes、对应 detail、counts、lists/tags/reminders；networkMode=always，写操作不自动重试。恢复由完整新进程重建 QueryClient 和 Scheduler。
- 原生 datetime-local 同时输入日期和时间，保留毫秒；不存在的本地时间（含 DST gap）拒绝。修改后的重叠输入按 ECMAScript Date 的较早时刻解释，界面明确提示；未修改的日期保留原 UTC，避免丢失毫秒或将重叠另一侧重新解释。详情打开期间时区改变必须显式采用，标题/备注/清单草稿不清空。
- TaskDetails 位于整个 TaskListView 而非单个 row 内，避免保存改变筛选后 row 移除而提前丢失弹窗。详情读取独立 query；refetch 不重新初始化编辑草稿或抢焦点；外部更新告知用户重新载入/当前输入保存选择。保存失败保留全部输入，关闭未保存内容有 Base UI 嵌套确认、默认继续编辑、焦点返回触发器或已移除行时的视图标题。
- 新任务草稿由 Workspace 保存，外部删除清单后保留到 Inbox；显式导航用 Base UI 确认丢弃。清单/标签创建表单隐藏但不卸载，输入保留；清单重命名草稿导航确认，写入时阻止导航。WebView window.confirm 不作为可靠确认出口。
- Inbox/Today/Upcoming/Lists/Tags/Settings 都有实际数据/动作；设置仅备份恢复和 OS 自启，固定快捷键沿用现有实际状态。任务详情可操作标签/提醒，各自即时保存，未保存提醒输入关闭要确认；任务备注保持纯文本。只用现有 Base UI 1.8.0 和 shadcn base-nova Dialog/Textarea，不增 Calendar/富文本/未实现入口。
- 标签/提醒异步操作纳入详情 busy 保护；IMEs 与重复提交使用事件状态/229/引用防重入。真实 Windows 中文输入法通过 Win32 SendInput + trusted composition 验证，组合确认 Enter 不提交，中文候选 Space 后单独 Enter 创建一次；只在隔离 test.step20 窗口发送键，失去前台时拒绝输入，恢复原 HKL 后退出。
- 自动验证与原生证据独立；日期模拟只在测试 renderer，Rust 和生产无 fake 时钟或通知出口。真实 Tauri 原生文件对话框恢复后，日期筛选/标签/提醒调度重新读取恢复库；长路径及大字体、小窗口通过截图和 DOM 宽度/可滚动保存操作核对。安装版与 OS 登录类既有发布 Gate 仍为 STEP 22。
