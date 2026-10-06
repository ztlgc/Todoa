# Windows 待办应用 AI 开发执行手册（最终修订版）

> **用途**：作为编程 AI 的项目总控规范，按 STEP 逐步执行。  
> **目标**：从零开发 Windows 单平台、离线可用、简单可维护的待办应用。  
> **核验日期**：2026-10-04。本版已查阅官方文档；执行时仍须以项目锁定版本的类型、源码和配置 Schema 为准。  
> **核验范围**：这是文档与官方接口核验，不代表应用代码已经编译或 Windows 行为已经实测；各 STEP 的实现验收仍须执行。  
> **执行边界**：阅读本手册不代表获准开发。只有收到“执行 STEP X”才实施该步骤；本手册中的命令和提示词是供后续开发使用的内容。

---

# 0. 本次审校后的关键修订

1. 固定 Rust 复用 `plugin-sql` 的公开 SQLx 连接池，统一数据库、Migration 和启动门，避免重复连接初始化。
2. 明确连接池不能通过分散的 `BEGIN/COMMIT` IPC 调用实现事务；多语句原子操作走窄 Rust command。
3. 修正自定义 command 默认可被所有窗口调用的风险，加入 `AppManifest::commands`、独立权限和拒绝测试。
4. 明确连接级 PRAGMA、SQLite 数值及时间边界，增加 Schema 身份和版本约定。
5. 补齐任务编辑、清单移动、标签视图、提醒 CRUD 和完成任务取消提醒的实际实现步骤。
6. 固定提醒补发、重复、失败重试和进程退出后的产品边界，区分通知 API 成功与用户实际收到。
7. 固定一致性备份、恢复前启动拦截、WAL 配套处理、崩溃恢复和失败回滚流程。
8. 明确 shadcn 的 Base UI 是本项目选择，按当前 Vite/Tailwind 安装流程配置，避免混用旧版教程。
9. 保留 STEP 0–22，解决通知安装版验收和 Updater 双版本安装包测试的前置依赖。
10. 增加可执行验收、隔离测试、版本记录和外部资源缺失状态，禁止把构建成功当成功能完成。

---

# 1. 固定技术架构

## 1.1 前端

固定使用 Tauri 2、Vite、React、TypeScript、Tailwind CSS、shadcn/ui；包管理器为 pnpm。

- 本项目选择 shadcn 的 **Base UI** 体系；这是一项项目决策，不宣称所有版本都默认使用它。
- 初始化现有 Tauri/Vite 项目，不再用 shadcn 创建第二个应用。
- 使用官方预设的颜色、圆角、字体和间距；允许正常业务布局、Windows 字体回退和必要无障碍调整。
- 不混用 Base UI 与 Radix 版本的同名组件；底层包名、CLI 参数以实际安装版本为准。
- Tailwind 按当前官方 Vite 流程安装，不机械套用 Tailwind 3 的配置文件或指令。
- 界面默认简体中文；资源和字体本地提供，不依赖在线 CDN。

安装依据：[shadcn Vite 指南](https://ui.shadcn.com/docs/installation/vite)、[shadcn CLI](https://ui.shadcn.com/docs/cli)。

第一版产品范围：任务创建、编辑、完成/取消完成、永久删除；清单和标签；具体时刻的截止时间；多个一次性提醒；Quick Add；托盘；全局快捷键；备份恢复；窗口状态；可选开机启动；签名更新和 NSIS 安装。

默认目标为 Windows 11 x64。其他 Windows 版本或架构未经实测不声称支持。业务功能完全离线；更新检查是可选联网功能，断网不能阻止启动或 CRUD。

## 1.2 状态管理

**TanStack Query** 管理 SQLite 业务数据的查询、缓存、Mutation、失效和重新查询。缓存可随时丢弃，不进行业务缓存持久化。

**Zustand** 只存纯 UI 状态，如当前视图、选中任务 ID、侧栏开关、Dialog 开关。禁止保存 `tasks`、`lists`、`tags`、`taskTags`、`reminders`、`settings` 或其完整副本。

组件可以持有输入文本、表单草稿和提交状态；未保存草稿不是第二份持久化业务真相。数据库中的设置通过 SettingsRepository 和 Query 读取，不能复制到 Zustand 作为权威状态。

---

# 2. 数据访问边界

## 2.1 主窗口数据链

```text
React Component → TanStack Query Hook → TS Repository
                                      → plugin-sql → SQLite
```

- 前端业务 SQL 只放在 `src/data/repositories/` 及其明确的数据访问子模块。
- `src/data/db/` 可以执行初始化、Schema 检查和 PRAGMA，不放任务 CRUD。
- 组件和 Hook 不直接调用 `db.select/db.execute`，不拼 SQL。
- 所有外部值参数绑定；动态排序字段和列名使用固定白名单，不能通过参数占位符或字符串输入任意指定。
- 查询明确列名、稳定排序；不把数据库 Row 直接交给 UI。

**有限例外**：需要多条 SQL 原子执行或系统服务协调时，TS Repository 调用固定用途的 Rust command：

```text
Hook → TS Repository → narrow Rust command → Service → Rust DB Module
```

此例外只适用于已明确的事务操作、提醒服务等，不得据此将全部前端 CRUD 改写为 Rust，也不得暴露通用 SQL/任意路径 command。

## 2.2 Rust 系统功能数据链

```text
Rust Service / Scheduler / Command → Rust DB Module → SQLite
```

- Command Handler 只接收和校验参数、验证调用窗口、调用 Service、返回结构化结果。
- Rust SQL 集中在 `src-tauri/src/db/`；Scheduler 不散落 SQL。
- Rust 使用与插件兼容的 SQLx 版本，复用插件公开连接池，具体见 ADR-001。
- SQL 文件是唯一 Schema 定义；跨语言业务规则和输入边界必须一致。
- Rust 异步查询不阻塞 GUI 主线程；耗时文件操作使用合适的后台执行方式。

## 2.3 SQLite 是唯一 Source of Truth

```text
SQLite                  唯一持久化业务真相
TanStack Query          可丢弃的前端业务缓存
Zustand / React state   UI 状态和未保存草稿
Rust Scheduler          可从 SQLite 重建的运行时状态
```

禁止使用 localStorage、IndexedDB、JSON、第二份 SQLite 保存业务副本。

窗口状态插件的文件、OS 开机启动配置、恢复操作日志属于系统运行配置，允许存在；它们不能保存任务或取代 SQLite `settings`。备份文件是用户明确导出的快照，不是在线业务数据库。

---

# 3. Quick Add 架构

窗口 label 固定为 `quick-add`，不授予 SQL 权限，不挂载主窗口 QueryProvider 或数据库启动逻辑。

```text
快捷键/托盘 → Rust 显示并聚焦 quick-add → React 输入
→ invoke 固定创建 command → Rust Service → Rust DB Module
→ SQLite 提交 → 通知 main 数据已变 → 返回任务 ID
→ 前端清空输入 → Rust 隐藏 quick-add
```

- 默认只创建 Inbox 中的任务，不在 Quick Add 增加清单、标签、提醒或日期编辑。
- Rust 必须再次校验标题，不能仅信任前端。
- 提交期间禁用重复提交；中文输入法组合输入的 Enter 不触发创建。
- SQL 成功与事件发送/隐藏窗口成功分开处理。提交已成功而事件或隐藏失败时，不返回“创建失败”诱导重复创建。
- 错误时保留文本；Escape 隐藏但保留未提交草稿，成功才清空。
- 创建成功后向 `main` 发送项目事件 `task-created`，载荷只含 ID 等最小字段。
- 事件不是数据真相或可靠消息队列。Main 监听后 invalidate；启动、重新显示或聚焦时也 refetch，补偿丢失事件。
- 窗口复用；显示、焦点和隐藏由 Rust 控制。前端监听显示通知/焦点变化后聚焦输入框，并清理事件监听器。

---

# 4. Rust 侧职责

Rust 负责 Migration 注册、数据库启动与检查、Rust DB Module、事务命令、Reminder CRUD/Scheduler/Reconcile、Quick Add 窗口、Global Shortcut、Tray、Single Instance、Backup/Restore、必要 Windows 系统行为及后台任务。

前端负责界面、Query、Repository 调用及可理解的错误展示。不要因为 Rust 有系统职责，就在 Rust 内存长期维护完整任务库。

---

# 5. 架构决策记录（ADR）

以下为已固定的第一版决定。STEP 5 前必须记录实现细节和锁定版本，不需要非技术用户再选择数据库方案。

## ADR-001：SQLite 访问模型

数据库 URL 固定为 `sqlite:todo.db`；文件名固定为 `todo.db`。

主窗口使用 `@tauri-apps/plugin-sql`；Rust DB Module 通过插件公开的 `DbInstances` 查找同 URL 的 `DbPool::Sqlite`，克隆池句柄并执行 SQLx 查询。克隆句柄不建立第二个池。官方公开接口见 [DbInstances](https://docs.rs/tauri-plugin-sql/latest/tauri_plugin_sql/struct.DbInstances.html)、[DbPool](https://docs.rs/tauri-plugin-sql/latest/tauri_plugin_sql/enum.DbPool.html)。

- `sqlx` 的直接依赖版本必须与锁定的插件依赖兼容；检查 Cargo 依赖树，避免不同版本造成类型和 SQLite 链接冲突。
- 不使用插件私有函数，不修改插件源码，不另引入 rusqlite 作为运行时业务驱动。
- 取池时短暂持有 `DbInstances` 锁，克隆后释放，再执行 SQL/await；不要长期占用状态锁。
- 当前插件 SQLite 相对路径落在 AppConfig。Rust 使用 `app.path().app_config_dir()`；不能照抄文档中遗留的 Tauri 1 `tauri::api::path` 写法。实现依据：[插件路径解析源码](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/sql/src/wrapper.rs)。
- 用 `PRAGMA database_list` 核对实际路径；不要凭 URL 字符串相同就认定测试通过。
- 应用 identifier 在 STEP 1 固定，后续改名不能静默改变数据库目录。开发测试使用隔离配置/目录，正式数据库不得作为测试夹具。

允许恢复验证或测试短暂打开独立 SQLx 连接，但必须指向隔离文件、正确配置并及时关闭，不能形成第二份在线业务真相。

## ADR-002：Migration 与数据库启动顺序

Migration 只由 Rust 注册到 `tauri-plugin-sql`：`Migration`、`MigrationKind::Up`、`add_migrations()`、`include_str!()`。所有注册 URL 和预加载 URL 必须完全相同。

本项目固定使用 `plugins.sql.preload`，让 Migration 在 SQL 插件初始化时执行；不是只注册却等待某个 React 组件触发。官方支持预加载及 `load()` 两种触发方式：[SQL Migration 文档](https://v2.tauri.app/plugin/sql/)。

```json
{
  "plugins": {
    "sql": {
      "preload": ["sqlite:todo.db"]
    }
  }
}
```

这是需要合并的配置片段，不是完整 `tauri.conf.json`。

启动顺序固定：

```text
Single Instance 拦截第二实例（STEP 13 接入）
→ Rust 启动前置检查 / pending restore（STEP 18 接入）
→ 检查已有 DB 身份和版本，关闭检查连接
→ 注册并初始化 SQL 插件，preload + Migration
→ 获取共享池，配置/验证 PRAGMA 和 Schema
→ Rust Database Ready
→ 启动后台服务
→ Main initDatabase() 等待 Ready，绑定已加载数据库
→ 启用 TanStack Query 和业务 UI
```

为保证恢复在预加载前发生，SQL 插件在应用 setup 的前置检查之后，通过当前 Tauri 支持的动态插件注册方式初始化。不要先静态注册并预加载 SQL，再在 setup 覆盖数据库。STEP 5 就建立该启动顺序；STEP 18 仅填充恢复逻辑。

前端通过窄只读 command 获取 Ready；成功后使用锁定版本支持的 `Database.get('sqlite:todo.db')` 绑定已预加载池，不重复 `Database.load()`。`get()` 本身不能证明数据库已加载；必须先通过 Ready 和 Schema 检查。[官方 JS 实现](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/sql/guest-js/index.ts)。

- `initDatabase()` 缓存同一个 Promise，React Strict Mode 不重复初始化。
- Rust Ready 是可信启动状态；不能接受前端“我已就绪”事件后直接开始调度。
- 失败进入启动错误页面，不展示空任务列表，不悄悄切到内存数据或删除数据库。
- 数据库初始化失败后的安全重试默认受控重启；不能随意重复执行部分失败的 Migration 流程。
- 已发布 Migration 永不改动，只新增递增版本；保留插件管理的迁移记录，不手工改表或跳过错误。
- 单个迁移的原子性、连续多个迁移的回滚边界按锁定插件/SQLx 实测记录；禁止笼统承诺全部历史迁移共同回滚。
- 只有明确未应用的迁移才应执行；不要用大量 `IF NOT EXISTS` 掩盖 Schema 漂移。

## ADR-003：连接配置与事务

目标：`foreign_keys=ON`、`journal_mode=WAL`、`busy_timeout=5000`，保留默认可靠的同步策略，不为追求速度改成 `OFF`。

`foreign_keys` 和 `busy_timeout` 是连接级配置。当前 SQLx 默认开启外键、超时为 5 秒；默认不主动更改 journal mode。必须核对锁定版本，并记录这些默认值如何覆盖新建池连接。[SQLx SQLite 连接选项](https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html)。

- Rust 在开放业务访问前设置 WAL，并检查返回值；WAL 持久性见 [SQLite PRAGMA](https://sqlite.org/pragma.html)。
- 不在一个随机池连接执行外键 PRAGMA 后宣称全部连接已生效。
- 测试同时持有多条池连接、验证各自 PRAGMA，并覆盖释放后新建连接；结合锁定版本连接初始化证据及非法外键行为测试。
- 如果锁定版本默认值不同且无法通过官方支持方式满足要求，STEP 5 标记阻塞并说明原因，不编造 Builder 参数或 TOML 字段。
- 池等待超时与 SQLite `busy_timeout` 不同；锁冲突必须有错误，不能无限等待或无限重试写入。

**事务规则**：

- `plugin-sql` 多次 `execute()` 不保证使用同一连接。禁止分别发送 `BEGIN`、业务 SQL、`COMMIT` 作为事务。[插件命令实现](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/sql/src/commands.rs)。
- 单条 SQL 可完成的写操作保持单语句；级联交给外键。
- 真正需要多语句原子完成的操作，TS Repository 调用固定用途 Rust command，Rust DB Module 使用 SQLx transaction，在同一事务对象上执行并提交。[SQLx Pool API](https://docs.rs/sqlx/latest/sqlx/pool/struct.Pool.html)。
- 不提供“传任意 SQL 数组”“事务 ID 跨多次 IPC”的通用桥接。
- 事务不等待用户、不跨窗口交互、不包含通知或文件对话框；只有 commit 后发送变更事件。
- 插入 ID 使用本次执行返回的 `lastInsertId`；禁止在后续随机连接查询 `last_insert_rowid()`。

## ADR-004：Inbox / List 删除语义

`tasks.list_id=NULL` 表示 Inbox，Inbox 是虚拟视图，不是 `lists` 中的特殊行。

`tasks.list_id → lists.id ON DELETE SET NULL`。删除清单保留任务并回 Inbox；删除前明确提示这个结果。

过滤必须区分：未传 `listId` 表示不限清单；`listId=null` 表示 Inbox；正整数表示某个清单。禁止通过真假值判断混淆这些语义。

## ADR-005：主键策略

`tasks/lists/tags/reminders` 使用 `INTEGER PRIMARY KEY`；`task_tags` 使用 `(task_id,tag_id)` 联合主键。不引入 UUID、ULID、分布式 ID。

跨 IPC 的 ID 限制为正整数且不超过 JavaScript `Number.MAX_SAFE_INTEGER`；TS 使用 `Number.isSafeInteger`，Rust 相同校验。SQLite 整数可超出 JS 安全范围，不能无限范围直接映射为 JS number。[SQLite 类型说明](https://sqlite.org/datatype3.html)。

不把 ID 当连续序号或永久外部身份；允许删除后重用，恢复后必须重建 Query 缓存并清空失效的选中 ID。

## ADR-006：时间格式与日期视图

所有具体时刻存为固定精度 UTC TEXT，例如 `2026-10-03T12:34:56.789Z`，固定 24 字符、毫秒、`Z`。

- 包括 `due_at/remind_at/completed_at/created_at/updated_at/triggered_at`。
- TS 使用统一 helper，Rust 使用统一 RFC3339 毫秒 UTC helper；输入的合法时区偏移先解析，再标准化为上述形式。
- 不混入 SQLite `CURRENT_TIMESTAMP` 默认格式，不用 locale 字符串存库。
- 系统生成时间取当前时刻；用户输入非法时间直接报错。Schema 的长度/后缀检查不能取代实际日期解析。
- 截止时间只表示具体时刻；没有 date-only、浮动时区或重复规则。
- 日期选择器必须配套时间输入，展示“本地时间”，转换后存 UTC；不静默将纯日期当全天任务。

STEP 20 的日期视图固定：

| 视图 | 规则 |
|---|---|
| Today | 未完成、截止时间在当前本地日的 `[00:00, 次日00:00)` |
| Upcoming | 未完成、截止时间从本地明日00:00起，按时刻升序 |
| 逾期提示 | 未完成且 `due_at < now`；Today 同日逾期任务仍保留，并显示逾期标记 |

按本地日历构造两个边界后转 UTC，不能用“UTC 日期相同”或固定加 24 小时处理夏令时。跨午夜、恢复和时区改变后重算边界与 Query key；不改变已存 UTC 时刻。

## ADR-007：测试策略

- Vitest：纯业务规则、Row Mapping、校验、时间边界、Query key、Repository 对 fake adapter 的协议、Hook 对 mock Repository 的行为。
- Rust 临时文件数据库：真实 SQL、Migration、外键、事务回滚、Reminder 和恢复状态机。
- Tauri 实际运行：真实 `plugin-sql` IPC、Capability、跨窗口刷新、持久化。
- Windows GUI/安装版：托盘、焦点、快捷键、通知、自启、安装升级。

普通 Node/Vitest 不等于真实 Tauri。禁止为了测试安装第二套前端 SQLite 驱动并声称验证生产链路。Rust SQL 测试同样不能代替前端 IPC 验证。

需要自动化原生 WebView 时采用官方 Windows WebDriver 路线，并核对 WebView2/驱动版本；不要假设普通 Playwright 浏览器测试等于桌面窗口测试。[Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)。

所有破坏性测试使用临时目录/隔离配置。WAL、锁冲突和重启测试使用临时文件数据库，不仅使用 `:memory:`。

## ADR-008：备份格式与 Schema 身份

第一版备份是一个完整 SQLite 一致性快照，包含业务表、`settings`、Schema 元数据和插件 Migration 记录；不包含窗口状态文件、OS 自启项、程序和签名密钥。

为明确兼容性，本项目从 Migration 1 开始维护：

- `PRAGMA application_id = 0x57544431`，作为固定应用数据库身份，不再更改。
- `PRAGMA user_version = N`，N 等于该迁移版本；每个新增迁移在同一迁移内更新。
- 插件/SQLx 管理的 Migration 历史；其表结构以锁定版本为准，应用只读检查，不自己写迁移记录。

`user_version` 不是插件自动管理，本项目明确维护它；应用发布版本不是 Schema 版本。

恢复接受本应用且存在已测试升级路径的旧 Schema、当前 Schema；拒绝未来 Schema、未知来源、缺失/不一致迁移记录、损坏或外键不一致的文件。检查 `integrity_check` 结果为 `ok`，`foreign_key_check` 无结果；再检查必要列、约束、版本和 Migration 历史。

拒绝把一份仍被其他进程打开、依赖外部 WAL 的主库文件当独立备份；备份输入必须是可独立打开的快照。不引入 ZIP/manifest 或未经设计的应用版本检查。

## ADR-009：错误与日志

错误携带稳定类别和操作上下文，例如验证失败、记录不存在、锁冲突、存储不可用、权限拒绝、Schema 不兼容。UI 使用中文可理解消息，技术原因进日志，不显示假成功。

- 不因失效/refetch/事件错误重复执行已成功的写入。
- Mutation 默认不自动重试，尤其是创建；查询可有限重试，初始化错误不能靠 Query 反复重试。
- 日志默认不记任务标题、Notes、完整用户路径、备份内容和密钥；调试路径诊断在隔离环境显式启用。
- TS 和 Rust 校验标题去首尾空白后为 1–500 Unicode 标量值，Notes 最多 100000，清单/标签名称 1–100；拒绝 NUL。前端不要只用 UTF-16 `length` 与 Rust 字符数硬比。
- 写入更新 `updated_at`；清单删除导致 `list_id` 自动变化时，用 Schema trigger 更新任务时间，保持统一 UTC 毫秒格式，并在 SQL 测试中验证。

---

# 6. Tauri Capability 权限模型

## 6.1 Main

固定 label 为 `main`，精确匹配，不使用 `windows:["*"]`。按实际调用列出 API→permission 对照。

本项目采用 Rust preload + 前端 `Database.get`，业务 SQL 的候选最小权限为已核验的 `sql:allow-select`、`sql:allow-execute`；不因教程用了 `sql:default` 就额外授予 load/close。具体权限表：[SQL 权限](https://v2.tauri.app/plugin/sql/)。

事件监听、窗口焦点等 core 权限按实际用法添加；Rust 内部调用系统插件不等于前端需要获得其调用权限。`core:default` 不是可长期代替权限清单的万能选项。

通用 SQL 权限本身允许执行 SQL；Repository 是代码组织边界，不是阻止受攻击 main 执行任意 SQL 的安全沙箱。不编造 SQL 插件的逐表、逐 SQL 或数据库 URL scope。

## 6.2 Quick Add

独立 Capability，仅允许创建任务、隐藏自己的窄 command 和必要事件监听；无 SQL、备份恢复、更新、自启、任意窗口创建能力。

**应用自定义 command 的关键规则**：默认通过 `invoke_handler` 注册的应用命令可被所有应用窗口调用。必须在 `src-tauri/build.rs` 使用 `tauri_build::AppManifest::commands` 将需受控命令纳入 ACL，再定义 TOML permission 并按窗口授权。[Tauri Capability 官方说明](https://v2.tauri.app/security/capabilities/)。

- 从 STEP 5 第一个自定义 command 开始做，不等到 STEP 12。
- 每次新增命令，同步更新 AppManifest、permissions、capabilities 和权限测试。
- 应用自定义权限使用本项目真实定义的 identifier；不是自动出现的 `quick-add:...` 插件前缀。
- permission 的 `commands.allow` 必须匹配注册 command 名；前端 `invoke` 导入来自 `@tauri-apps/api/core`。
- Rust 从 Tauri 注入的调用 WebviewWindow 验证 label；不信任 JS 参数传来的窗口名。此检查是额外防线，不能代替 ACL。
- 多个匹配 Capability 的权限会合并；检查默认文件、通配窗口和显式启用列表，避免权限意外叠加。
- UI 入口路由不构成安全边界；加载同一前端资源也不授予另一个窗口权限。

发布仅加载本地应用资源，不为远程页面配置 IPC Capability；配置与实际打包匹配的 CSP，不为解决报错整体关闭它。[Tauri CSP](https://v2.tauri.app/security/csp/)。

**必须做拒绝测试**：quick-add 直接调用 SQL、Main-only command 应被拒绝；main 正常 CRUD 继续成功。只做 `cargo check` 不能证明授权边界正确。

---

# 7. 数据库 Schema

以下是 Migration 1 的完整业务表基线。时间和输入长度还必须在 TS/Rust 边界校验；Schema 最后防线不能取代业务校验。

## 7.1 lists

```sql
CREATE TABLE lists (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

名称写入前 trim；第一版允许清单重名。`sort_order` 只用于稳定顺序，不实现拖拽。

## 7.2 tasks

```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
  list_id INTEGER,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 100000),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'completed')),
  due_at TEXT,
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE SET NULL,
  CHECK ((status = 'todo' AND completed_at IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL))
);
```

完成与 `completed_at` 必须在同一 SQL/事务变更，取消完成清空它。重复设置为 completed 不刷新原完成时刻。任务删除为永久删除，UI 明确提示；本版没有回收站和附件。

## 7.3 tags

```sql
CREATE TABLE tags (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(trim(name)) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

名称 trim；SQLite 内建 NOCASE 主要处理 ASCII 大小写，不是完整 Unicode 大小写折叠。第一版按这个规则判重，不能承诺所有语言忽略大小写。

## 7.4 task_tags

```sql
CREATE TABLE task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
```

重复分配同一标签是幂等操作；不存在的任务/标签必须失败。使用针对联合主键的冲突处理，不用宽泛 `INSERT OR IGNORE` 吞掉其他约束错误。

## 7.5 reminders

```sql
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  triggered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

一个任务可有多个一次性提醒。`triggered_at` 表示通知 API 接受了本次尝试，不表示用户阅读。已触发提醒不可直接改时间重发；新增一个提醒。待触发提醒可以编辑和删除。

## 7.6 settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

只维护实际使用的白名单 key 和对应校验，不建通用 typed settings framework。OS 自启实际状态由插件查询，不将 SQLite 布尔值当作 OS 注册已成功的证据。

## 7.7 核心索引与附加约束

```sql
CREATE INDEX idx_tasks_list ON tasks(list_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_at);
CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);
CREATE INDEX idx_reminders_pending ON reminders(triggered_at, remind_at);
CREATE INDEX idx_reminders_task ON reminders(task_id);
PRAGMA application_id = 0x57544431;
PRAGMA user_version = 1;
```

Migration 同时实现：

- 所有时刻列的基本格式 CHECK：非空值长度为 24，末尾为 `Z`，位置符合统一格式；实际日期合法性在边界校验。
- 清单删除使任务 `list_id` 变化时更新 `updated_at` 的 trigger；使用统一 SQL UTC 毫秒格式，并验证与 TS/Rust helper 一致。
- 可变整数 `sort_order` 限制在 JS 安全整数范围内。

这些补充属于 Migration 1 的要求，不能因为正文 DDL 保持可读就遗漏。不要为了未来性能预建大量索引。

---

# 8. Reminder 架构

## 8.1 数据、编辑与完成语义

SQLite reminders 是唯一真相；React 不跑定时器发送系统通知。

前端 ReminderRepository：查询走 plugin-sql，创建/编辑/删除走 Rust Reminder Service command；TanStack Query 管理结果。Rust 提交后直接唤醒自己的 Scheduler，并通知 Main invalidate。

- 只能给未完成任务创建或编辑待触发提醒；UI 要求未来时刻，Rust 再验证。
- 修改 `due_at` 不自动改变 `remind_at`，它们是独立时刻。
- 完成任务：STEP 16 起由 Rust 事务更新任务状态，并删除其所有未触发提醒；已触发记录保留。
- 取消完成不自动重建已取消的提醒；用户明确新增。
- 删除任务级联删除全部提醒；删除提醒使对应运行时计划失效。

## 8.2 Scheduler 与 Reconcile

一个 Rust 调度循环管理下一到期时刻，不为每条提醒永久创建独立线程。

Reconcile 在 Rust Ready 后启动，在提醒变更、任务完成/删除、启动以及每 30 秒兜底时触发。可靠的 Windows resume/时钟变化监听可补充；没有实现就明确标记，不虚构 Tauri 事件。

- 以 SQLite UTC 时刻计算；使用 timer 等待最近到期，30 秒扫描负责校正，不能只靠扫描冒充精确 timer。
- 重建计划取消旧计划；同一 ID 不得并发投递。
- 每次投递前重新查数据库确认提醒仍存在、未触发且任务未完成；不依赖旧标题和旧任务状态。
- 测试可注入时间源，验证边界不必等待真实数分钟。

## 8.3 补发与投递语义

固定为：未完成任务的所有过期未触发提醒，在启动/恢复后补发，按时间顺序；发送节流最多每秒一个，UI 明确可出现多条补发。

```text
重新确认符合条件 → 调用 Notification API
→ API 返回成功 → 条件更新 triggered_at / updated_at
→ 移除运行时计划 → Main invalidate
```

- API 立即失败不标记 triggered；指数退避，最大 5 分钟，保留数据库待触发状态并显示错误。
- 同进程内“通知成功、写标记失败”优先重试写标记，避免每 30 秒重发；重启后的极端重复仍可能发生。
- 单实例 + 串行调度抑制正常重复；通知成功与数据库记录不能做一个原子事务，不承诺 Exactly Once。
- 系统勿扰/关闭通知可能抑制显示；API 成功不代表看到了弹窗。
- 进程完全退出、电脑关机或休眠期间不执行通知，也不唤醒电脑；下一次运行时按上述规则补发。
- 完成/删除与通知竞争时，已交给 OS 的通知可能无法撤回，不能承诺瞬时绝对取消。

---

# 9. Backup / Restore

## 9.1 Backup

第一版固定由 Rust DB Module 使用参数绑定的 `VACUUM INTO` 生成 SQLite 快照；最低实际 SQLite 版本须支持此功能。它生成一致性快照，目标文件要求不存在或为空；禁止在已开始事务的连接上执行。[SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html)。

```text
Main 请求 → Rust 显示保存对话框 → 用户选目标
→ 同目录唯一临时文件 → VACUUM INTO → 校验
→ 关闭验证连接、刷新文件 → 发布最终文件 → 报告成功
```

- 不直接复制打开中的 `todo.db`，不依赖“刚做 checkpoint 所以应该安全”。
- 若覆盖已有备份，必须明确确认；发布临时文件失败时保留旧备份和原数据库。
- 验证身份、Schema、integrity、foreign keys；异常时清理本次临时文件，不删其他文件。
- 拒绝目标为在线数据库、其 WAL/SHM、恢复暂存或回滚文件。
- 目标路径由 Rust 对话框获得和校验；不开放前端任意路径写入 API，不为此授予广泛 filesystem 权限。
- 备份可包含用户内容，第一版不加密；UI 不宣称加密安全。
- 快照反映生成时的一致数据库状态，不承诺包含生成后的写入。

## 9.2 Restore

恢复替换全部 SQLite 数据；Main 必须先展示具体警告并让用户确认。这是产品中的数据替换确认，不是让非技术用户选择架构。

```text
Rust 打开文件对话框 → 校验源 → 复制到应用管理的暂存目录
→ 再次校验暂存 → 写 pending restore 操作日志
→ 禁用新 Mutation、停止 Scheduler、完成在途写入
→ 关闭共享池 → 确认真正退出 → 重启
→ Single Instance 后、SQL 插件 preload 前执行替换
→ Migration 和 Ready 验证 → 成功 / 回滚
```

恢复操作日志可使用小型 JSON 文件，只保存阶段和受控相对路径；不是业务数据仓库。禁止任意命令或从日志接受任意绝对路径。

启动替换必须做到：

1. 没有 main/plugin/Rust 业务连接。迁移前的验证连接用完关闭。
2. 将原数据库以及仍存在的 `-wal/-shm` 作为同一组保存在受控回滚位置；不得删除可能尚含提交数据的原 WAL。
3. 在同一文件系统、受控目录内放置新快照；避免让原 WAL 和新主库组合。
4. 校验身份、兼容性，初始化插件并运行允许的迁移，验证 Ready。
5. 任一步失败，先关闭新数据库的全部连接，移走新数据库及其侧文件，恢复原数据库组；失败的新库不能继续启动。
6. 成功后保留一份明确标识的“恢复前快照”供用户恢复；旧 WAL/SHM 仅在该快照校验成功后清理。
7. 每次文件替换前后持久化操作阶段；覆盖在中间阶段崩溃的重启测试。多文件 rename 不是天然原子事务。

回滚成功后将本次恢复标记为失败并停止自动重试，避免每次启动再次覆盖；向用户展示原库已恢复及失败原因。启动阶段插件初始化失败也必须进入此收尾流程，不能直接退出跳过回滚。

Ready 前有 pending restore 时不得启动调度、Query 或写入。恢复成功后重启形成新 QueryClient，清空失效选中 ID，Reconcile。不得仅 invalidate 旧 ID 缓存后继续假定对象身份相同。

无法可靠自动重启时，提示关闭并重新启动，仍保留 pending 流程；禁止在连接未关闭时退回直接覆盖。

---

# 10. 发布方式

只做 Windows x64、NSIS、Windows Authenticode 代码签名、Tauri Updater 及更新产物签名。

第一版 NSIS 固定按当前用户安装；普通运行不要求管理员权限。卸载默认保留用户数据库，重新安装可继续使用；不偷偷删除数据目录。

不做 MSI、账户、服务器、云同步、插件系统、FullCalendar、复杂重复任务或自研整库加密。

Windows 代码签名与 Updater 签名是两套独立机制。正式签名发布需要真实证书/签名服务和更新托管地址；AI 不购买、不捏造证书、不填假 URL。缺资源时交付本地测试构建、准备好的配置及阻塞说明，正式发布状态保持未完成。

---

# 11. AI 总工作规则

1. 收到具体 STEP 后先 Inspect，读取项目状态、相关源码、依赖、lockfile、配置和权限。
2. 官方网页可能描述不同版本；以锁定版本 API/源码核验，记录差异，不混用 `latest` 示例。
3. 不联网且缺乏可核验本地证据时，标注“需查官方文档确认”。安全、迁移、恢复关键项未确认不得实现猜测版或报通过。
4. 自主处理本手册已授权的常规实现选择，不向非技术用户追问架构；缺少证书、托管地址、管理员权限或实际 GUI 环境时如实记录外部依赖。
5. 只完成当前 STEP，不能提前做后续业务功能或无关重构、依赖升级。
6. 新增依赖说明用途，不能因“以后可能需要”安装。
7. 仅新增具体用途的函数/模块，不建立 GenericRepository、DI 框架或复杂层级。
8. 保留正确行为；不能通过削弱断言、吞错误或删除测试获得 PASS。
9. 某项必需验收未做，记“实现完成、验收待完成”，不得记整步完成。
10. 每步更新 `docs/PROJECT_STATE.md`，报告后停止；开发阶段的 STOP 不约束本手册审阅工作。

---

# 12. 依赖管理规则

- 跟踪 `pnpm-lock.yaml`、`Cargo.lock`，在 `packageManager` 记录已验证 pnpm 版本。
- 记录 Node、Rust、Tauri CLI/core/API、每个实际使用插件、SQLx 和 SQLite 运行版本。
- Tauri 2 主版本统一；JS/Rust 插件使用兼容版本，不机械要求所有插件相同 minor。
- 使用 `rust-toolchain.toml` 固定验证版本；依赖最低 Rust 版本必须满足。
- shadcn CLI 生成组件后记录 CLI 版本和 `components.json`，后续不反复用不同 `latest` 重新初始化。
- 系统插件只在 Rust 使用时不必安装 JS guest bindings；检查 `tauri add` 自动加入的权限，移除未使用前端权限。
- CI/可重复验证使用已锁定依赖，不悄悄重解版本。

---

# 13. Git 规则

一个 STEP 通常对应一个逻辑 commit，但未经直接授权不执行 commit、push、tag 或发布。已有明确授权不重复询问。

可提供建议 commit message；提交只能包含本步已验证变更。不要覆盖用户改动或擅自 `git add -A`。

忽略数据库/WAL/SHM、测试运行数据、备份、日志、签名密钥和构建产物。Migration SQL、配置及 lockfile 应跟踪。测试夹具只使用明确无用户内容的合成样本。

---

# 14. AI 上下文管理

维护 `docs/PROJECT_STATE.md`，STEP 0 可只创建环境记录；不存在时明确首次创建，不假定已经有仓库。

记录当前步骤的“未开始/实现中/验收待完成/已验收/阻塞”，依赖版本、固定 ADR、实际命令和结果摘要、GUI 待验收项、隔离测试位置、已知问题、下一步及外部发布依赖。

另用简短 `docs/ADR.md` 记录本手册决策对应的实现细节和来源。不保存密钥、完整用户路径、聊天转录或大量原始日志。

---

# 15. 每一步固定验证规则

项目根目录运行 pnpm；Cargo 命令始终显式指向 Rust manifest，避免在根目录找不到 `Cargo.toml`。

```powershell
pnpm build
pnpm lint
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri dev
```

- `pnpm build` 必须包含 TS 类型检查，不允许只调用 Vite 打包而漏掉类型错误。
- `pnpm test` 使用一次性执行模式，例如 `vitest run`，不让 AI 等待 watch。
- lint 只在脚本已建立后执行；测试“0 项”不等于业务测试通过。
- 修改 TS 跑 build、已配置 lint 和相关测试；修改 Rust 跑 fmt/check、相关测试，稳定阶段跑 clippy。
- 实际 SQLite/IPC/权限行为必须用 Tauri 运行验证；启动进程不等于操作成功。
- 合理执行相关检查，不为微小文案变更扩大成全部系统测试。

## GUI 验收规则

没有真实 GUI 操作证据时，只能记录“构建 PASS”“进程启动成功”“GUI 待验收”。不能声称焦点、托盘、快捷键、通知已 PASS。

每个人工项给出操作、预期结果和通过标准；实际桌面自动化能完成时直接验证。保留截图/日志的路径及测试环境，不把截图当数据持久化证明。

存在外部依赖的验收可按明确的“后续验收项”推迟到本手册指定 STEP；其他必需 Gate 未通过不能进入依赖它的下一步。

---

# 16. 总开发顺序

| STEP | 内容 |
|---|---|
| 0 | Windows 环境检查 |
| 1 | 创建 Tauri + React + TypeScript 项目 |
| 2 | Tailwind + shadcn/ui |
| 3 | 架构目录与边界 |
| 4 | 第一阶段依赖与测试基础 |
| 5 | SQLite + Migration + Database Boot |
| 6 | Domain + TS Repository |
| 7 | TanStack Query |
| 8 | 第一个 Task 垂直切片 |
| 9 | Lists |
| 10 | Tags |
| 11 | Main Capability 收紧 |
| 12 | Quick Add Window + Capability |
| 13 | Single Instance |
| 14 | Global Shortcut |
| 15 | Tray + Window 生命周期 |
| 16 | Reminder CRUD + Rust Scheduler |
| 17 | Notification |
| 18 | Backup / Restore |
| 19 | Window State + Autostart |
| 20 | 正式 UI + 任务编辑 + 日期视图 |
| 21 | Updater |
| 22 | NSIS + Code Signing + Release Checklist |

编号不变。STEP 5 已有最小权限，STEP 11 是审计；STEP 16 使用 fake 通知测试调度，STEP 17 接 OS；STEP 21 可以构建必要 NSIS 测试包，STEP 22 汇总安装版、签名和更新验收。

---

# STEP 0 —— Windows 开发环境检查

**目标**：检查准备条件，不创建应用或业务代码，不声称已经证明 Tauri 窗口能运行。

执行 `node --version`、`pnpm --version`、`rustc --version`、`cargo --version`、`rustup show`、`git --version`；记录输出。

检查 MSVC C++ Build Tools、Windows SDK、WebView2 Runtime、x64 MSVC Rust toolchain；用 VS Installer/vswhere 等可靠方式，不因 `cl.exe` 不在普通 shell PATH 就断言缺失。[Tauri Windows 前置依赖](https://v2.tauri.app/start/prerequisites/)。

缺失时只安装必要组件；需要外部安装权限时记录阻塞，不安装 Electron、Flutter、Docker 或数据库服务器。Node 版本须满足将使用的 Vite/shadcn 要求。

**验收**：逐项输出 PASS/FAIL/待人工确认及证据；环境就绪记录到 PROJECT_STATE。真实编译和窗口运行留给 STEP 1。完成后停止。

---

# STEP 1 —— 创建基础 Tauri 2 项目

使用当前官方 create-tauri-app，选择 pnpm、React、TypeScript/Vite。检查目标目录，存在项目时先 Inspect，不覆盖或再次嵌套生成。

固定 productName、应用 identifier、`main` label、x64 目标和开发/测试数据隔离方式；固定工具版本。保留默认安全配置并移除不用的模板演示 command/权限。

**验收**：`pnpm install`、含类型检查的 `pnpm build`、Rust check 成功；`pnpm tauri dev` 实际窗口启动。确认基础窗口显示，无法操作 GUI 时记待验收。不得安装数据库或业务库。停止。

---

# STEP 2 —— Tailwind + shadcn/ui

按官方现有 Vite 项目流程初始化 Tailwind/shadcn，选择 Base UI；配置 Vite 与 TS 路径别名，核对 `components.json` 和生成 CSS。

第一批只加 Button、Input、Checkbox，制作临时验证页；不设计完整待办 UI、不修改官方主题 token、不安装全部组件。

**验收**：build 成功；输入、按钮、Checkbox 样式和键盘操作正常，记录 CLI/底层库版本。停止。

---

# STEP 3 —— 建立目录与边界

按实际文件创建目录，不为架构图建大量空文件：

```text
src/
  app/                 启动、providers
  components/ui/       shadcn 组件
  domain/              纯类型、校验和规则
  data/db/             初始化和状态
  data/repositories/   SQL、Row Mapping、窄 command 调用
  features/            tasks、lists、tags、reminders 的 UI/Query
  stores/              仅 UI 状态
  windows/             main、quick-add 入口
src-tauri/
  migrations/
  permissions/
  capabilities/
  src/db/              Rust SQL、池适配、Schema 检查
  src/services/        Quick Add、Reminder、Backup/Restore
  src/commands/        薄 IPC adapter
docs/
  ADR.md
  PROJECT_STATE.md
```

记录依赖方向和 SQL 例外边界；不引入 GenericRepository、Service Locator、DI 或自研 Event Bus。

**验收**：build/check 成功，原窗口行为保留。停止。

---

# STEP 4 —— 第一阶段依赖与测试基础

加入 `@tanstack/react-query`、`zustand`、`zod`、Vitest；加入 SQL 插件 Rust/JS 绑定并开启 Rust `sqlite` feature。Rust SQLx 直接依赖与插件依赖兼容；仅在实际使用时加入时间库和日志插件。

配置一次性 `pnpm test`、类型检查 build、lint。延后通知、快捷键、托盘相关代码、自启、dialog、updater、window-state、single-instance、日期组件和复杂表单库。

**验收**：至少一项有实际断言的测试成功，build/lint/check 成功；审查工具自动加入的权限，不能预先授权未来窗口。停止。

---

# STEP 5 —— SQLite + Migration + Database Boot

## 5.1 Migration 文件

创建 `src-tauri/migrations/0001_initial.sql`，完整实现第 7 节的六张表、索引、约束、trigger、application_id 和 user_version。Rust 注册 `Up` Migration，SQL 文件为唯一来源。

## 5.2 数据库和连接池

按 ADR 固定 `sqlite:todo.db`、AppConfig 路径、共享插件池；记录依赖树和路径诊断。先只实现 Rust DB 初始化和测试，不提前做 Quick Add/Reminder Service。

## 5.3 Database Boot

实现前置检查→动态 SQL 插件初始化/preload→Schema/PRAGMA 验证→Rust Ready；前端缓存 `initDatabase()`，等 Ready 后 `Database.get()`。

建立第一个窄状态 command 的 AppManifest、permission 和 Main Capability；初始化错误有真实错误页与安全重启路径，不创建第二库。

## 5.4 PRAGMA 和约束验证

在隔离数据库验证：非法 reminder 外键失败；删除任务级联删除 reminder/task_tags；删除清单保留任务且 list_id 为空；标签删除无孤儿；状态/completed_at 配对；时间格式和安全 ID。

同时持有多池连接验证 FK/timeout/WAL，释放后新建连接再测。人为持锁测试等待、超时和 UI 错误；不能只看 PRAGMA 文本。

## 5.5 Migration 验证

全新库→初始化；重启→不重复执行；旧 Schema→升级；模拟失败→实际回滚边界；未来 Schema/身份错误→拒绝。保留迁移记录，不能删除数据库解决失败。

**验收**：build、fmt/check、相关 Rust tests 和 Tauri 实际初始化通过；报告创建位置、Schema、池连接证据和 Migration 行为。本步不做 Task UI、Query 业务、Scheduler、Backup 或 Quick Add。停止。

---

# STEP 6 —— Domain + TS Repository

建立 Task、TaskStatus、CreateTaskInput、UpdateTaskInput、TaskRow；状态仅 `todo/completed`。

TaskRepository 首批 API：`list(filters)`、`create(input)`、`updateStatus(id,status)`、`delete(id)`。`getById/update` 在 STEP 20 加入；清单分配在 STEP 9 加入。

- 明确 snake_case→camelCase 映射，null 不转 undefined 或空串。
- 标题、时间、ID 等统一校验；参数绑定；稳定按 sort_order、id 排序。
- 创建用执行返回的插入 ID；更新/删除检查 rowsAffected，区分不存在和成功。
- updateStatus 原子更新 status/completed_at/updated_at，重复完成不重写完成时刻。

**验收**：Vitest 覆盖映射、非法输入、参数绑定和 fake adapter 协议；真实 Tauri create→list→状态切换→delete 成功。Rust SQL 测试不能冒充 plugin IPC 测试。build/test/lint/check 通过。停止。

---

# STEP 7 —— TanStack Query

建立 QueryClientProvider，业务 UI 仅在 DB Ready 后挂载或启用；Query key 集中定义，包含视图、listId、tagId、状态和日期范围。

首批 Hook：`useTasks`、`useCreateTask`、`useUpdateTaskStatus`、`useDeleteTask`。Mutation 经 Repository，成功后 invalidate 对应任务列表、详情和计数；不做复杂 Optimistic Update。

配置本地 query/mutation 的 `networkMode:'always'`，避免离线标志暂停 SQLite 或 Rust command。查询有限重试、写入默认不重试；Tauri Main 显示/焦点时显式 refetch，不只依赖浏览器默认焦点识别。[TanStack Query Network Mode](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)。

**验收**：DB 未 Ready 无真实查询；写入失败不更新成假成功；成功后 UI 重新查询；断网 CRUD 不暂停。相关测试/build/lint 通过。停止。

---

# STEP 8 —— 第一个 Task 垂直切片

只做 Inbox 列表、新增、完成/取消完成、永久删除。区分 Loading/Empty/Error，完成任务在 Inbox 内仍可见，便于取消完成。

输入用 React local state；Enter 创建但忽略 IME 组合输入；pending 防重复；成功清空，失败保留；删除提示永久删除，使用简单确认交互。

不做拖拽、动画系统、日历、提醒、标签选择、Command Palette、Quick Add、Tray 或全局快捷键。

**必测**：空库；新建 Buy milk；退出进程重新打开仍存在；完成后重启仍完成；取消完成后重启仍未完成；删除后重启不回来；空标题失败；数据库写入失败保留输入；离线可用。

**第一阶段 Gate**：必须有真实证据证明 UI→Query→Repository→plugin-sql→SQLite，以及 Migration→Schema→重启持久化。未通过不进入 STEP 9。停止。

---

# STEP 9 —— Lists

实现 Inbox、创建/重命名/删除清单、按清单查看任务、新建到当前清单、把现有任务移动到其他清单或 Inbox。

建立 ListRepository/Domain/Query；TaskRepository 加 `setList` 与明确的 listId filter。清单删除提示“任务回到收件箱”，靠外键 SET NULL 完成；失效清单、任务、计数缓存并修正当前视图。

**验收**：清单 CRUD、任务移动、删除清单任务保留并回 Inbox、updated_at 正确、重启持久化、失败不假成功。停止。

---

# STEP 10 —— Tags

实现创建、分配、移除、删除标签及按标签查看任务。一个简单 TagRepository 可包含关系操作，不要求拆出多个空 Repository。

重复分配同一关系幂等；冲突提示正确；删除关系不删除任务；删除任务/标签级联删除关联。批量“替换全部标签”若需要多语句，必须走 Rust 事务；第一版优先单标签操作。

**验收**：ASCII 大小写重名、中文名称、重复关系、非法 ID、删除无孤儿、标签视图真实过滤、重启保存；不做层级/规则引擎。停止。

---

# STEP 11 —— Main Capability 收紧

这是对已有最小权限的复核，不是首次设置安全边界。

列出真实 API、command、permission；检查自动启用的 Capability 叠加，删除 unused/core 大权限和通配窗口；复核 AppManifest 与命令列表一致。

**验收**：真实 Task/List/Tag CRUD 和 Ready 正常；未授权插件/command 调用被拒绝；运行构建配置 Schema 检查和 Tauri smoke。禁止为解决错误直接加 all/default 大集合。停止。

---

# STEP 12 —— Quick Add Window + Capability

由 Rust 创建一次 `quick-add` WebviewWindow，初始隐藏；独立前端入口只加载输入 UI，不执行主窗口 DB 初始化。

实现固定创建、隐藏 command 和 main-only 显示入口；此时可用 Main 临时按钮验收，STEP 14 再接全局快捷键。

遵守第 3、6 节：Rust 验证调用来源和输入，共享池写入，提交后 emit_to Main；UI 成功清空再隐藏，失败保留；Close/Escape 隐藏；事件监听清理。

**验收**：显示聚焦输入、Enter 创建 Inbox 任务、Main 刷新、Escape 保留草稿、IME Enter 不误提交、重复打开仍一个窗口、pending 防重复；直接 SQL/Main-only 调用被拒绝。未完成拒绝测试不能标记 Capability 完成。停止。

---

# STEP 13 —— Single Instance

接官方 single-instance 插件，并**首先注册**，先于 SQL、窗口状态和其他系统插件；官方要求见 [Single Instance](https://v2.tauri.app/plugin/single-instance/)。

第二实例回调先确认已有 Main 可用，show、unminimize、focus；启动窗口尚未创建时排队处理，不能 unwrap 崩溃。不从第二实例参数接受任意 SQL、恢复路径或命令。

本步以前的开发测试只运行一个实例；本步以后不得启动第二套长期池、快捷键、托盘或调度。

**验收**：两次启动同一个测试应用时仅一进程长期运行，已有隐藏/最小化 Main 被唤醒。Tray/Scheduler 的无重复检查在相应步骤补测。停止。

---

# STEP 14 —— Global Shortcut

Rust 使用官方 global-shortcut 注册固定默认 `Ctrl+Shift+Space`，仅处理 Pressed，忽略 Released；显示并聚焦已有 Quick Add。[官方插件](https://v2.tauri.app/plugin/global-shortcut/)。

注册冲突或失败要明确提示，应用继续运行，Main 按钮仍可 Quick Add；不假装已注册。退出时注销，重复初始化不重复注册；前端不获得注册任意快捷键能力。

**验收**：其他应用有焦点时快捷键打开输入；按下一次不会重复执行两次；冲突有反馈；退出后注销。此时不做编辑快捷键 UI。停止。

---

# STEP 15 —— Tray + Window 生命周期

Tray 使用 Tauri 2 core tray API，按当前文档启用 `tray-icon` Cargo feature，不杜撰独立 Tray 插件。[官方托盘指南](https://v2.tauri.app/learn/system-tray/)。

菜单：显示主窗口、快速添加、退出。Main Close 在托盘创建成功后隐藏；托盘失败时保持明确可退出路径，不能把应用隐藏得无法找回。

Quit 使用统一生命周期流程：设置 quitting→拒绝新提交→停止后台服务→处理在途写入→注销快捷键→保存必要窗口状态→关闭池→退出。Close handler 不拦截真正 Quit；隐藏窗口不关闭数据库。

**验收**：关闭到托盘、显示/聚焦、Quick Add、真正退出、再启动正常；二次启动不重复托盘。Scheduler 尚未接入时仅保留明确关闭钩子，不声称停止 Scheduler 已测试。停止。

---

# STEP 16 —— Reminder Rust Scheduler

本步同时补齐提醒数据入口：最小任务提醒面板、ReminderRepository/Query、Rust 创建/编辑/删除 command。不能只造 Scheduler 却没有用户创建提醒的办法。

按第 8 节实现串行循环、精确 timer、30 秒 Reconcile、启动补发、删除/变更唤醒、投递前重查。

将 TaskRepository.updateStatus 切换为窄 Rust Service 事务，原子完成“更新完成状态＋删除未触发提醒”；删除任务后唤醒 Reconcile。保持 Hook/UI API 清晰，不同时保留可绕过服务的第二条完成写入路径。

本步使用 fake 通知出口验证调度：**fake 成功不能写正式库 triggered_at**；可在临时测试库验证投递协议。OS 通知未接入时，真实待触发提醒保持未触发，并显示提醒发送尚未启用。

**验收**：提醒 CRUD 持久化；时钟测试验证到期、补发、改时间、删除、完成/取消完成语义、并发 Reconcile 无重复、错误重试、Quit 停止。无可靠 resume API 时准确记录使用 periodic recovery。停止。

---

# STEP 17 —— Notification

接官方 notification Rust 插件，替换 fake 出口，按第 8 节更新 triggered_at。按当前 Windows/插件 API 检查通知可用状态；拒绝或失败不吞掉，也不标假成功。

只做任务标题通知，不做 Snooze、Action、富通知、重复提醒或通知点击导航。Rust 发送不要求 Quick Add 获得 notification 权限。

**开发验收**：Service/错误/写标记测试、Tauri 运行链路通过；不能承诺用户实际收到。官方说明 Windows 正式行为依赖安装应用，开发环境可能显示 PowerShell 身份：[Notifications](https://v2.tauri.app/plugin/notification/)。

**指定后续验收**：在 STEP 22 的安装版验证应用名称/图标、真实弹窗、通知关闭、勿扰、重启补发和睡眠恢复。本步可在记录这个发布 Gate 后继续；正式发布前必须补测。停止。

---

# STEP 18 —— Backup / Restore

接官方 dialog Rust 插件，Main-only Backup/Restore command 由 Rust 打开对话框；前端只展示进度、错误和替换确认，不获得任意文件系统能力。

完整实现第 9 节的 snapshot、暂存、pending 日志、受控重启、preload 前替换、原 DB/WAL/SHM 保存、失败回滚及崩溃恢复。耗时操作不阻塞 UI；恢复期间不接受新写入。

**必测（全部隔离数据）**：

- 正在写库时的备份仍完整；备份包含任务、关系、提醒和设置。
- 当前/已支持旧 Schema 恢复成功；未来/错误身份/损坏/外键错误文件被拒绝。
- 对话框取消不报失败成功；目标覆盖确认；磁盘满、权限不足、文件锁不会摧毁原库/旧备份。
- 恢复在各文件阶段崩溃，再启动能继续或回滚；旧 WAL 不污染新库。
- 恢复后新 Query 缓存和 Scheduler 正确，任务计数、关系、设置及触发状态符合快照。

**验收**：Rust 文件数据库故障注入测试、真实 Tauri 备份恢复链路通过；恢复关键失败项未验证不算完成。停止。

---

# STEP 19 —— Window State + Autostart

**Window State**：官方 window-state 仅保存 Main 的 size/position/maximized；排除 Quick Add，不恢复上次隐藏或最小化状态导致手动启动看不到窗口。用当前 Builder 的 flags/filter/denylist 控制，不虚构字段。[Window State Builder](https://docs.rs/tauri-plugin-window-state/latest/tauri_plugin_window_state/struct.Builder.html)。

保存坐标与当前显示器工作区不相交时回到可见区域；核对物理/逻辑像素、DPI。插件文件只存窗口状态。

**Autostart**：默认关闭，使用官方插件；用户开启后传本项目明确实现的 `--autostart` 参数。它是应用自定义启动参数，不是 Tauri 神奇开关。[Autostart](https://v2.tauri.app/plugin/autostart/)。

- 手动启动显示 Main；自启仅在 Tray 成功后隐藏 Main，Rust DB/Scheduler 仍自主完成启动，不依赖 WebView 用户操作。
- 设置页读取实际 OS 启用状态，切换成功后重新查询；失败不把开关显示成成功。
- 二次自启不无故抢焦点，手动二次启动唤醒 Main；明确区分参数。

**验收**：重启位置/最大化、拔显示器/off-screen、DPI、开关启用/禁用、真实登录启动、无重复后台实例。实际 OS 登录验收可记 STEP 22 安装版发布 Gate。停止。

---

# STEP 20 —— 正式 UI + 日期视图

统一已有功能的 shadcn Base UI 界面；实际提供 Inbox、Today、Upcoming、Lists、Tags、Settings，任务详情可编辑 title、notes、due_at、list，显示和编辑提醒/标签。

补齐 TaskRepository.getById/update 和 Query Hooks；Notes 用纯文本编辑，不增加 Markdown/富文本范围。保存成功后更新 Query，失败保留草稿；切换有未保存草稿时明确处理，不静默丢弃。

实现 ADR-006 的真实 Repository 日期过滤，本地日期＋时间输入→UTC。按需要加入 date-fns、shadcn Calendar 所需 day-picker，复杂表单才加 react-hook-form，不手工覆盖 CLI 的底层版本。

**验收**：编辑、清空截止时间、重启保持；Today/Upcoming 午夜边界、逾期、无日期、完成任务、时区/夏令时、恢复后正确；所有设置入口有真实行为，不展示假功能。

**Accessibility**：输入有 label；Tab 顺序和 focus visible；Checkbox 可键盘操作；Dialog 焦点进入/返回；IME Enter；Escape 先关闭当前弹层再隐藏 Quick Add；编辑器内部按键优先，主窗口全局监听不抢 Tab/Enter/Space；refetch 不抢焦点；长标题、大字体、小窗口仍可操作。

不做自建 Design System、大量渐变、复杂动画、拖拽或 Calendar 全屏产品。build/lint/相关测试与实际 GUI 通过。停止。

---

# STEP 21 —— Updater

接官方 updater，第一版采用用户主动“检查更新”，应用启动不依赖更新网络。Updater 操作仅允许 Main。

固定 HTTPS 静态更新元数据，版本策略为递增 SemVer，目标只含实际构建的 Windows x64 NSIS；不允许强制安装旧版本或未来 Schema 不兼容版本。

- 设置 `bundle.createUpdaterArtifacts=true`；设置真实 `plugins.updater.pubkey` 公钥内容和 `endpoints`。
- 签名私钥由构建环境变量 `TAURI_SIGNING_PRIVATE_KEY` 注入；可选密码变量同样只从 Secret Store 注入，`.env` 不代替官方要求的构建环境。
- 当前 v2 NSIS 更新产物通常是安装器 `.exe` 和对应 `.sig`，不要机械使用 v1 ZIP 路线；实际文件以锁定版本构建输出为准。[Updater 官方文档](https://v2.tauri.app/plugin/updater/)。
- Windows Authenticode 签名完成后再生成对应更新签名；最终被下载的字节必须与 `.sig` 一致。
- 下载失败、检查断网、拒绝更新或无更新都不能影响离线任务库。
- 安装前等待在途写入，走统一退出流程；由 Windows Updater 安装行为接管退出/重启，不在提交中突然结束进程。
- 签名验证不可关闭，不启用不安全生产 HTTP，不提交私钥，不输出密钥到日志。

本步允许为更新测试生成 vA/vB NSIS 测试包，属于必需验证，不算提前完成 STEP 22。

**验收**：真实安装 vA→检查 vB→下载→验签→安装→新版本启动；数据保留/Migration 正确；错误签名与被改动产物拒绝；断网/取消正常。

没有真实端点或签名资源时，完成可验证实现与受控本地测试，记录“外部发布验收阻塞”，不得填虚假值或称升级成功。STEP 22 可继续包装检查，但正式发布 Gate 不可通过。停止。

---

# STEP 22 —— NSIS + Code Signing + Release Checklist

只构建 NSIS：

```powershell
pnpm tauri build --bundles nsis
```

核对产品名、版本一致性、publisher、稳定 identifier、图标、当前用户安装/升级、卸载保留数据策略。

安装包采用官方 WebView2 `offlineInstaller` 方案，使无 Runtime 的测试机也可离线安装；包体会增加，构建时仍可能需要下载官方资源。只对实际生成并测试的产物承诺离线安装。[Windows Installer](https://v2.tauri.app/distribute/windows-installer/)。

接真实 Windows 代码签名与可信时间戳，验证 EXE/安装包签名；证书缺失时交付明确标识的未签名测试包，正式签名发布未完成。代码签名不保证立即无 SmartScreen 提示。[Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)。

## Release Checklist

所有测试注明版本、OS、安装方式、隔离数据和证据；状态用 PASS/FAIL/待验收/阻塞，不用笼统“全部正常”。

| 范围 | 必须验证 |
|---|---|
| Database | 新装 Migration、旧库升级、未来版本拒绝、重启持久化、FK/CASCADE/SET NULL、时间/状态约束、多池连接 PRAGMA、WAL、锁超时、启动错误 |
| Tasks | 新建、编辑标题/Notes/截止、完成/取消、永久删除、失败保留草稿、离线操作 |
| Lists | 新建、改名、移动任务、删除后回 Inbox、重启保持 |
| Tags | 创建、分配、移除、删除、判重语义、真实标签视图、无孤儿 |
| Quick Add | 快捷键→显示→输入焦点→输入→Enter→保存→清空/隐藏→Main 刷新；IME/pending/事件丢失补偿 |
| Permissions | Quick Add SQL/Main-only command 被拒绝；Main 正常；无通配 Capability 意外叠加 |
| Single Instance | 二次启动、隐藏/最小化唤醒；无重复 Tray、快捷键、Scheduler |
| Tray/Quit | 关闭隐藏、托盘显示、快速添加、真正退出、注销快捷键、池和在途写入收尾 |
| Reminder | 创建/编辑/删除、未来提醒、重启/过期补发、完成取消、取消完成不重建、失败退避、正常无重复、睡眠和时钟恢复 |
| Notification | 安装版真实应用名称/图标和弹窗，关闭通知/勿扰语义；不把 API 成功当用户收到 |
| Backup/Restore | 并发写入快照、旧/当前兼容、未来/损坏拒绝、磁盘/文件锁失败保原库、中间崩溃恢复、WAL 隔离、Query/Scheduler 重建 |
| Window State | 重启、最大化、DPI、拔显示器、off-screen 恢复、手动启动可见 |
| Autostart | 默认关闭、启用/禁用、实际 Windows 登录、仅后台且可找回、无重复实例 |
| Updater | vA→vB 安装升级、错误签名/改动拒绝、离线不影响 CRUD、数据和迁移保留 |
| Installer | 干净 Windows、无开发环境、无 Runtime 离线安装、普通用户运行、路径中文/空格、升级及卸载/重装数据策略 |
| Security/Release | 真实代码签名/时间戳、更新签名匹配最终产物、无密钥/用户库进入版本控制、正式 CSP |

用户机器不需要 Node、pnpm、Rust、Cargo 或独立 SQLite 服务。安装程序必须有明确绝对产物路径、大小、版本、SHA-256、签名状态和剩余限制。

打包失败必须报告真正失败环节；前端 build 或 Rust compile 成功不是安装包交付。所有发布 Gate 通过、获得发布授权后才发布；测试包交付不等于正式发布完成。停止。

---

# 17. 整个项目禁止的架构漂移

未经明确变更本手册，禁止业务数据进入 Zustand/Redux/Context/localStorage/IndexedDB/JSON；禁止组件直接 SQL、Command Handler 散落 SQL、绕开 Repository/Rust DB Module、前后端两套 Migration。

禁止引入 Electron、Next.js、Prisma、Drizzle、服务器数据库、Firebase/Supabase、账户/云同步、MSI、FullCalendar、复杂重复引擎或自研加密。

禁止为未来猜测增加 GenericRepository、DI 框架、跨 IPC 通用事务会话、任意 SQL command、完整任务事件同步、自研消息系统。系统状态文件和恢复日志的明确例外见第 2 节，不能扩大为业务存储例外。

---

# 18. 重点监控 AI 的行为

以下情况应停止当前实现并修正，再恢复本 STEP：

- 组件/Hook 出现 `db.execute/select` 或 SQL；Zustand 出现业务数组。
- Main/Quick Add 各自初始化数据库、另建 Rust 业务库或池、动态更改 identifier 导致“数据消失”。
- JS 多次 `execute` 拼事务；随机连接 `last_insert_rowid()`；一次 PRAGMA 冒充全池配置。
- Quick Add 获得 SQL/备份/更新权限；自定义 command 未纳入 AppManifest；只拆 Capability 没做拒绝测试。
- Reminder 没有 CRUD，或 fake 通知消费正式提醒，或声称退出后还能提醒。
- 直接复制活跃主库作为备份，或连接未关闭就覆盖恢复，或只删 WAL 解决锁冲突。
- 修改已发布 Migration、删除数据库解决启动错误、吞掉写错误、反复重试创建任务。
- 浏览器/Vitest/mock 测试被称为原生 IPC 或安装版验证；未操作 GUI 却报告 PASS。
- 用假端点/假证书宣称发布完成，泄露密钥，未经授权 commit/push/release。
- 当前 Gate 未通过就进入依赖它的后续 STEP，或把实现完成写成已验收。

---

# 19. AI 每次执行 STEP 的固定格式

## 1. Inspect

读取 PROJECT_STATE、ADR、相关源码、package/Cargo manifests、lockfile、配置、Capability、permissions 和 Migration；不存在的文件明确说明，不补造历史。

## 2. Scope

修改前简短说明当前目标、必要文件、新增依赖及不在本步的功能。遇到本手册内部矛盾先按安全且不扩大范围的方案修正记录，不向非技术用户追问实现细节。

## 3. Implement

只完成当前 STEP。必要的前置安全配置属于本步；后续功能不提前开发。

## 4. Verify

运行相关检查和行为验收，区分自动/GUI/安装版测试。失败先修复；缺外部条件明确记录。

## 5. Report

```text
STEP X 状态：已验收 / 实现完成、验收待完成 / 阻塞

完成行为：
- ...
修改文件：
- ...
新增依赖及锁定版本：
- ...
ADR 落地/变更：
- 无 / 实现细节与依据
执行命令及退出结果：
- ...
自动/实际运行验证：
- 检查项：PASS / FAIL，证据
GUI 或指定后续验收：
- 操作 → 预期 → 当前状态 → 指定 STEP
外部依赖与遗留问题：
- ...
PROJECT_STATE 更新：
- ...
建议 Commit Message：
- ...
下一步：
- Gate 通过后可执行 STEP X+1 / 先补齐当前验收
```

报告后停止，等待用户明确启动下一步。不得报告不存在的测试、提交、安装包或截图。

---

# 20. 第一次给 AI 的指令

将本文件作为项目规范交给编程 AI，再给以下指令：

```text
执行 STEP 0。
先 Inspect，严格遵守本手册。
只检查 Windows 环境并记录 PROJECT_STATE，不创建应用或修改业务代码。
自主处理已明确的常规选择，不向我追问技术架构。
缺失条件如实报告，不把未运行的 Tauri 窗口标记 PASS。
按固定 Report 输出并停止，不执行 STEP 1。
```

环境 Gate 通过后：

```text
执行 STEP 1。
先读取本手册、PROJECT_STATE 和当前目录。
遵守固定 ADR，只创建和验证基础 Tauri/React/TypeScript 项目。
已有文件不得覆盖；自动验证和 GUI 验收分别报告。
完成后停止，不提前执行 STEP 2。
```

后续逐步给出“执行 STEP X”。若前一步仅实现完成，先补齐其 Gate；不得用“继续”自动跨过未验收项。发布阶段外部资源缺失按本手册记录阻塞，不编造。

---

# 21. 当前应该做什么

**本手册修订完成后，开发执行从 STEP 0 开始。**

STEP 0 只核对环境；STEP 1 才用真实项目验证编译与窗口启动。数据库、系统功能和发布按表中的 STEP 顺序实施。

本节是交给后续编程 AI 的启动说明，不要求审阅本手册的 AI 在输出修订版时开始开发。
