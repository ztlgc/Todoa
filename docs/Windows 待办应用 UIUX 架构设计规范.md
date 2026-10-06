# Windows 待办应用 UI/UX 架构设计规范

> **文档定位**：本规范是《Windows 待办应用 AI 开发执行手册》的 UI/UX 配套规范。<br>
> **目标平台**：Windows 11 x64。<br>
> **技术栈**：Tauri 2 + Vite + React + TypeScript + Tailwind CSS + shadcn/ui Base UI。<br>
> **界面语言**：默认简体中文。<br>
> **产品定位**：Windows 单平台、本地使用、离线可用的桌面待办应用；SQLite 是唯一业务数据源，不需要云同步或用户账户。<br>
> **设计参考**：可参考滴答清单等成熟任务管理应用的信息层级和交互习惯，但不得复制其超出本项目范围的功能。<br>
> **优先级规则**：当本 UI/UX 规范与《AI 开发执行手册》发生冲突时，以开发执行手册为准。

> **阅读方式**：下文的“第一版”指开发手册 STEP 22 完成后的正式产品范围，不表示该功能今天已经实现；“当前实现”仅指本次审核时的源码和 `docs/PROJECT_STATE.md`。实际交付状态以 PROJECT_STATE 的最新记录和代码为准，不能凭本规范宣称某一步已验收。

## 当前实现基线（2026-10-05）

- `PROJECT_STATE.md` 记录 STEP 0–20 已通过各自的 Windows 10 开发 Gate。STEP 21–22 按本次用户要求暂缓；Windows 11 安装版、通知实际显示、真实登录自启、物理显示器/DPI 和发布签名仍待对应发布 Gate。
- Main 已有 Inbox、Today、Upcoming、Lists、Tags 和 Settings 六类真实视图，以及任务标题、纯文本备注、截止时刻、清单、标签和提醒的编辑链。Today/Upcoming 使用本地日界的实际 SQL 查询；备份恢复和开机启动已接入真实操作。
- 本轮把导航改为一级 Rail（任务/设置）与随工作区切换的 Context Sidebar；设置分为常规、数据、关于，关于页从运行中应用读取版本。STEP 21 暂缓，因此不展示更新入口。
- 当前任务详情在宽窗口以右侧非模态 Inspector 展示，在中等窗口以右侧覆盖层、紧凑窗口以全高覆盖层展示；小窗口 Sidebar 通过显式按钮打开 Overlay。详情草稿关闭或切换视图时需确认。宽窗口和中小窗口的真实 Windows 10 开发版布局及焦点返回已在隔离身份复核，证据见 `docs/PROJECT_STATE.md`；Windows 11 安装版仍待 STEP 22。
- `App` 仍使用内容驱动外框；主窗口初始配置 `800×600`，Quick Add 为独立 `480×180` 窗口。`Button`、`Input`、`Checkbox`、`Dialog`、`Textarea` 已落地；List 选择仍使用原生 `select`。业务数据由 Repository/Query 管理，临时导航及草稿状态留在 React 本地。

---

# 1. UI 设计边界

## 1.1 第一版允许出现的核心功能

开发手册最终第一版要求提供：

- Inbox。
- Today。
- Upcoming。
- Lists。
- Tags。
- Settings。
- 任务创建。
- 任务编辑。
- 完成 / 取消完成。
- 永久删除。
- Notes。
- 具体日期和具体时间组成的截止时刻。
- 多个一次性提醒。
- 标签。
- 清单归属。
- Quick Add 独立窗口。
- Tray。
- Global Shortcut。
- Backup / Restore。
- Window State。
- Autostart。
- 主动检查更新。

---

## 1.2 第一版禁止在 UI 中出现的未实现功能

不得为了“像滴答清单”而生成：

- 日历完整页面。
- 周视图 / 月视图。
- 看板。
- 四象限。
- 习惯打卡。
- 番茄钟 / 专注模式。
- 文件夹层级。
- Smart Filter Builder。
- 回收站。
- 子任务。
- Checklist。
- Priority。
- Pin。
- Assignment。
- Collaboration。
- Share。
- Attachments。
- Markdown。
- Rich Text。
- Recurrence / Repeat。
- Snooze。
- Notification Actions。
- 自然语言 NLP 任务解析。
- Command Palette。
- 拖拽排序。
- 拖拽移动任务。
- Swipe Actions。
- 大型动画系统。
- 云同步。
- 用户账户系统。

原则：

> **数据模型不存在的属性，UI 不得自行创造。**

本应用只管理本机数据；不设计登录/注册、账户资料、云同步状态、跨设备冲突、共享或协作入口。更新检查是用户主动触发的独立联网操作，不改变离线任务 CRUD 的可用性。备份/恢复是用户明确操作的本地 SQLite 快照流程，不是云同步。

---

# 2. 第一版业务数据与 UI 映射

第一版 Task 对 UI 可见的主要业务字段为：

```text
Task
├─ id
├─ title
├─ notes
├─ status
├─ list_id
├─ due_at
├─ completed_at
├─ sort_order
├─ created_at
└─ updated_at
```

任务还通过关系拥有：

```text
Task
├─ Tags[]
└─ Reminders[]
```

因此 Task Detail 中可以编辑：

```text
Title
Notes
Due Date + Time
List
Tags
Reminders
Status
```

不得出现：

```text
Priority
Subtasks
Repeat
Attachments
Start Date
Assignee
Pin
Location
```

---

# 3. 整体 UI 架构

正式主窗口采用四个明确职责的区域：

**Primary Navigation Rail + Context Sidebar + Main Task View / Settings View + Task Detail Inspector**

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            Windows Native Title Bar                              │
├────────┬─────────────────┬────────────────────────────────┬──────────────────────┤
│  Rail  │ Context Sidebar │ Main Task View / Settings View │ Task Detail Inspector│
│        │                 │                                │                      │
│  任务  │ Inbox           │ Header                         │ Title / Notes        │
│  设置  │ Today           │ Create Task                    │ Due Date + Time      │
│        │ Upcoming        │ Task List                      │ List / Tags          │
│        │ Lists / Tags    │                                │ Reminders            │
│        │                 │                                │ Save / Delete        │
└────────┴─────────────────┴────────────────────────────────┴──────────────────────┘
```

Rail 是正式 UI 的一级导航，只放 **任务** 与 **设置** 两个真实目的地。Rail 不重复摆放 Inbox、Today、Upcoming，也不放未授权模块或空入口。选择“任务”后，Sidebar 展示任务视图和用户清单/标签；选择“设置”后，Sidebar 仅展示已接通的设置分组。Inspector 只随选中的真实任务出现；Settings View 不展示任务 Inspector。这样保留 Rail，同时避免双重导航。

---

# 4. 主窗口职责划分

## Primary Navigation Rail

回答：当前处于任务工作区还是设置工作区？固定提供“任务”和“设置”的可访问名称、选中状态与键盘焦点。Rail 不承载单条任务、清单、标签数据，也不添加第二份 Inbox/Today/Upcoming 导航。

---

## Context Sidebar

回答：

> 当前查看哪一组任务？

负责：

```text
任务工作区：Inbox / Today / Upcoming / Lists / Tags
设置工作区：已实现的设置分组
```

---

## Main Task View

回答：

> 当前任务有哪些？

负责：

- 当前页面标题。
- 当前范围内任务列表。
- 新建任务。
- Loading / Empty / Error。
- 完成 / 取消完成。
- 打开任务详情。
- 删除入口。

---

## Task Detail Inspector

回答：

> 当前这条任务具体是什么？

负责：

- Title。
- Notes。
- Due Date / Time。
- List。
- Tags。
- Reminders。
- 完成状态。
- 永久删除。

---

# 5. Primary Navigation Rail 与 Context Sidebar

Rail 推荐宽度 `56–64px`，当前代码采用 64px 的一级 Rail。图标必须有“任务”“设置”的可访问名称、选中状态、Tooltip 或可见文本，以及键盘可见焦点；不能只靠图标形状表达目的地。Rail 顶部为任务，设置入口置于固定易发现位置；不增加未实现的一级模块。

选择“任务”时显示下面的 Context Sidebar。选择“设置”时，Sidebar 切换为第 37 节的真实设置分组；在相应能力完成前不显示占位项。Rail 与 Sidebar 不重复同一层导航。

推荐宽度：

```text
Default: 220px（沿用当前侧栏布局起点；STEP 20 可经 GUI 验收调整）
Min:     200px
Max:     300px
```

这是保留现有 220px 布局经验的表现层建议，不属于业务数据；Rail 与 Sidebar 的合计宽度必须在窄窗口验收。

结构：

```text
任务工作区 Sidebar

Inbox
Today
Upcoming

────────────

Lists
  Work
  Personal
  + 新建清单

────────────

Tags
  #工作
  #个人
  + 新建标签

```

---

# 6. Inbox

Inbox 是：

```text
task.list_id = NULL
```

它不是数据库中的特殊 List。

点击：

```text
Inbox
```

进入 Inbox Task View。

Inbox 创建任务时：

```text
list_id = NULL
```

第一版必须允许已经完成的 Inbox 任务继续可见，以便执行“取消完成”。

不得提供：

```text
Trash
Archive
```

---

# 7. Today

Today 不是独立数据实体，而是日期过滤视图。

规则：

```text
status = todo
AND
due_at >= 本地今天 00:00
AND
due_at < 本地明天 00:00
```

Today 中当天已经过期的任务：

```text
仍然留在 Today
+
显示 Overdue 状态
```

例如：

```text
○ 提交报告                         09:00  已逾期
```

---

# 8. Upcoming

Upcoming 同样是计算视图。

规则：

```text
status = todo
AND
due_at >= 本地明天 00:00
```

默认按：

```text
due_at ASC
```

展示。

可以按日期分组：

```text
明天
10 月 8 日
10 月 12 日
...
```

这里的“分组”只是 UI 表现。

不得因此增加新的业务字段。

---

# 9. Lists

Lists Section 展示用户创建的普通清单：

```text
Lists

Work
Personal
Shopping

+ 新建清单
```

第一版是：

```text
List
```

单层结构。

不支持：

```text
Folder
 └─ List
```

也不支持任意层级树。

---

# 10. List 操作

允许：

```text
Create
Rename
Delete
```

正式界面可通过可见操作入口访问；若增加右键菜单，它只复用相同命令：

```text
可见按钮 / ...
可选右键菜单
```

访问。

删除清单前必须明确提示：

```text
删除“工作”？

该清单中的任务不会被删除，
任务将移回 Inbox。

[取消] [删除清单]
```

不得描述为：

```text
任务也会一起删除
```

---

# 11. Tags

Tags 使用普通纵向列表，而不是 Tag Cloud。

例如：

```text
Tags

# 工作
# 个人
# 会议

+ 新建标签
```

点击标签：

```text
Tag View
```

展示拥有该标签的真实任务结果。

允许：

- 创建标签。
- 给任务添加标签。
- 从任务移除标签。
- 删除标签。

删除标签：

```text
只删除标签及关系
```

不得删除 Task。

---

# 12. Main Task View

结构：

```text
TaskView
├─ Header
├─ CreateTaskInput
└─ TaskList
```

---

# 13. Header

示例：

```text
Today
3 个任务
```

或者：

```text
Work
8 个任务
```

推荐布局：

```text
┌────────────────────────────────────────────────┐
│ Today                                          │
│ 3 个任务                                       │
└────────────────────────────────────────────────┘
```

第一版不要加入：

```text
View Switcher
Kanban
Calendar
Matrix
Sort Builder
Advanced Filter
```

除非后续开发手册明确增加这些能力。

---

# 14. 主窗口新增任务

任务页面顶部可以提供简单输入框：

```text
┌──────────────────────────────────────────────┐
│ + 添加任务                                   │
└──────────────────────────────────────────────┘
```

行为：

```text
输入标题
↓
Enter
↓
创建
```

需要处理：

- 空标题拒绝。
- IME composition 时 Enter 不提交。
- 提交 pending 时禁止重复提交。
- 成功后清空。
- 失败时保留输入内容。
- 显示可理解错误。

---

## 当前 List 页面创建

例如当前页面：

```text
Work
```

新建任务：

```text
list_id = Work.id
```

---

## Inbox 创建

当前页面：

```text
Inbox
```

新建：

```text
list_id = NULL
```

---

## Today / Upcoming

开发手册没有授权通过简单标题输入自动猜测截止日期。

因此不得出现：

```text
明天下午三点开会
↓
自动 NLP 解析
```

Today / Upcoming 不展示只能创建无截止时间却暗示会落入当前视图的假入口。若提供新增，必须进入明确的日期和时间编辑流程，成功后真实查询结果符合当前视图；否则引导到 Inbox/List 创建后再设置截止时刻。

---

# 15. Task List

第一版使用紧凑的：

```text
TaskRow
```

而不是大型 Card。

示例：

```text
○ 完成 UI 规范                        今天 15:00
```

或者：

```text
✓ Buy milk
```

推荐结构：

```text
TaskRow
├─ CompleteCheckbox
├─ Content
│  ├─ Title
│  └─ Metadata
└─ Optional MoreButton
```

---

# 16. TaskRow 信息范围

允许显示：

```text
Title
Due Time
Overdue State
Tag
List
Completed State
```

其中 Metadata 应保持低视觉权重。

例如：

```text
○ 产品评审
  明天 15:00 · #工作
```

不得显示不存在的数据：

```text
Priority
Subtask 2/5
Repeat
Attachment
Assignee
```

---

# 17. 完成 / 取消完成

使用标准 Checkbox。

未完成：

```text
☐ Task
```

完成：

```text
☑ Task
```

完成后可以：

- 降低标题视觉权重。
- 使用 Strike-through。

但不得依赖复杂动画。

状态写入失败时：

```text
UI 不得维持假成功状态
```

应恢复或重新查询真实数据库状态，并显示错误。

第一版不实现复杂 Optimistic Update。

---

# 18. Task View 状态

必须具有：

```text
Loading
Loaded
Empty
Error
```

---

## Empty

例如 Inbox：

```text
Inbox 为空

在上方输入一个任务开始使用。
```

Empty 文案必须按视图区分：Tag 视图没有直接创建入口，应提示到 Inbox/List 创建并分配该标签；Today/Upcoming 没有符合日期条件的任务时，不得指向不存在的上方输入框。当前无直接创建入口的视图使用“当前没有符合筛选条件的任务”；Tag 视图仍可进一步明确引导到 Inbox/List。

---

## Error

例如：

```text
无法读取任务

请重试。

[重试]
```

不能在数据库初始化失败时展示一个“空任务列表”，让用户误认为数据已经丢失。

---

# 19. Task Detail Inspector

推荐：

```text
Default Width: 360px（当前宽窗口面板采用最多 440px）
Min Width:     320px
Max Width:     440px
```

Task Detail 只在：

```text
selectedTaskId != null
```

时展示真实任务。

结构：

```text
TaskInspector
├─ Header
├─ Title
├─ Notes
├─ Due Date / Time
├─ List
├─ Tags
├─ Reminders
├─ Save State
└─ Delete
```

---

# 20. Task Detail Header

推荐：

```text
[Checkbox]                         [关闭]
```

低频危险操作：

```text
删除
```

放在 Inspector 下部或 `...` 中。

不得增加：

```text
Pin
Share
Duplicate
Priority
```

---

# 21. Title

使用普通文本输入。

约束：

```text
Trim 后 1–500 Unicode scalar values
```

UI：

```text
任务标题
[ 产品评审                         ]
```

必须有可访问的 Label。

---

# 22. Notes

Notes 第一版为：

```text
Plain Text
```

推荐：

```text
备注
┌─────────────────────────────────┐
│                                 │
│                                 │
│                                 │
└─────────────────────────────────┘
```

不得使用：

```text
Markdown Editor
Rich Text Toolbar
图片上传
附件
```

最大业务长度：

```text
100000
```

---

# 23. 截止时间

业务字段只有：

```text
due_at
```

其含义是：

> 一个具体的时间点。

因此 UI 必须同时编辑：

```text
Date
+
Time
```

例如：

```text
截止时间

日期
[ 2026-10-05 ]

时间
[ 15:00 ]

[清除截止时间]
```

禁止只选：

```text
2026-10-05
```

然后暗中解释为全天任务。

第一版不存在：

```text
All Day
Start Date
Time Zone Selection
Repeat
```

---

# 24. 日期存储与显示原则

UI 显示：

```text
用户本地时间
```

数据库保存：

```text
UTC RFC3339
```

例如：

```text
2026-10-03T12:34:56.789Z
```

UI 层不得直接把 locale 字符串作为数据库值。

跨：

- 午夜。
- 夏令时。
- 时区变化。

Today / Upcoming 必须重新计算本地日期边界。

按本地日历分别构造今天和明天的 00:00，再转换成 UTC 查询边界；夏令时日不能用固定加 24 小时计算。午夜、时区改变或恢复数据库后要重算边界/查询键。无 `due_at` 的任务不属于 Today 或 Upcoming。

---

# 25. List Selector

任务详情提供：

```text
清单

[ Inbox      ▾ ]
```

选项：

```text
Inbox
Work
Personal
...
```

其中：

```text
Inbox → list_id = NULL
```

移动任务通过明确选择器完成。

第一版**不实现拖拽任务到 Sidebar 改变清单**。

---

# 26. Tag Editor

示例：

```text
标签

[#工作] [#会议]

[+ 添加标签]
```

支持：

- 从已有标签中选择。
- 移除当前关系。
- 需要新标签时，使用已有的 Sidebar 创建标签入口，再在任务上分配；Inspector 不增加另一套标签创建流程。

不得实现：

- 层级标签。
- Tag Rule。
- 自动标签。
- Filter DSL。

---

# 27. Reminder Editor

一个任务允许：

```text
0..N
```

个一次性 Reminder。

示例：

```text
提醒

2026-10-05 14:30        [编辑] [删除]
2026-10-05 14:55        [编辑] [删除]

+ 添加提醒
```

---

## 新增提醒

要求：

```text
Date
+
Time
```

且必须是：

```text
未来时刻
```

---

## Reminder 与 Due Date 的关系

二者完全独立：

```text
due_at
!=
remind_at
```

修改 Due Date：

```text
不得自动修改 Reminder
```

修改 Reminder：

```text
不得自动修改 Due Date
```

---

# 28. Reminder 状态语义

只有未完成 Task 可以创建或修改待触发 Reminder。

任务完成后：

```text
所有未触发 Reminder 被删除
```

已触发 Reminder 记录保留；任务永久删除时所有 Reminder 及任务标签关系按外键级联删除。

取消完成：

```text
不会自动恢复之前删除的 Reminder
```

UI 不得显示：

```text
“取消完成后提醒自动恢复”
```

之类错误承诺。

---

# 29. Reminder 已触发状态

已经触发的 Reminder：

```text
不可直接修改时间再次发送
```

如需新的提醒：

```text
创建新的 Reminder
```

UI 可以将历史提醒弱化显示，或不作为主要编辑项，但不得把 `triggered_at` 描述为：

```text
用户已经看过通知
```

它只代表通知 API 接受了投递尝试，不代表系统已显示、用户已看到或已阅读。当前 STEP 17 只在 Windows 10 开发版验过实际 API 接受；通知关闭、勿扰和安装版身份/显示仍须按 STEP 22 验收。未触发的过期提醒在应用下次运行时按时间顺序补发，可能出现多条；应用完全退出或休眠期间不会发送，也不唤醒电脑。API 失败保持待触发并重试；已接受但数据库标记失败时优先重试标记，极端重启后仍可能重复通知。

---

# 30. 删除 Task

第一版 Task 删除是：

```text
Permanent Delete
```

没有 Trash。

因此必须确认：

```text
永久删除任务？

任务及关联的标签关系、提醒将被删除，此操作无法撤销。

[取消] [永久删除]
```

不得实现：

```text
先移动到 Trash
```

也不应提供：

```text
Undo Delete
```

除非后续开发手册明确加入相应持久化能力。已有完整备份的恢复属于替换整个数据库的独立操作，不是单条删除的撤销。

---

# 31. 编辑保存策略

当前 `TaskRepository` 已有 `getById/update`，标题、备注、截止时刻由详情表单显式保存，失败保留草稿。当前 Inspector 中的 List 选择、标签分配/移除、提醒编辑分别调用真实 Mutation；Inspector 复用这些明确操作，不把它们伪装成尚未提交的同一个大表单。标题、备注、截止时刻采用以下显式保存策略；完成状态和永久删除仍走各自独立的确认/Mutation。

开发手册明确要求：

```text
保存失败
→
保留用户草稿
```

同时：

```text
存在未保存修改时切换任务
→
不得静默丢弃
```

因此 UI 应具有明确 Draft State。

推荐采用：

```text
显式保存
```

方式：

```text
[取消] [保存]
```

状态：

```text
Clean
Dirty
Saving
SaveFailed
```

---

## 离开 Dirty Task

如果用户：

- 选择另一任务。
- 关闭 Inspector。
- 切换 Sidebar View。

需要明确处理：

```text
有尚未保存的修改

[继续编辑]
[放弃修改]
[保存]
```

不得直接销毁 Draft。

保存失败保留输入和 Inspector；如果选中任务因删除或恢复后不再存在，关闭失效详情并给出明确提示，不展示旧缓存对象。Refetch 不覆盖 Dirty Draft。离开确认使用可访问 Dialog，焦点进入和关闭后返回合理来源；保存操作 pending 时不得重复提交。

---

# 32. Quick Add 独立窗口

Quick Add **不是主窗口中的 NLP 输入组件**。

它是独立的：

```text
Tauri WebviewWindow
label = quick-add
```

职责只有：

> 快速向 Inbox 创建一个只有标题的新任务。

---

# 33. Quick Add UI

当前窗口固定 `480×180`、不可缩放；正式第一版保持极简标题输入、显式“添加”按钮和键盘/错误提示。示意结构：

```text
┌────────────────────────────────────────────┐
│  添加任务                                  │
│                                            │
│  [ 输入任务标题...                      ] │
│                                            │
│                    Enter 添加 · Esc 关闭  │
└────────────────────────────────────────────┘
```

不得出现：

```text
Date
List
Tag
Reminder
Priority
NLP
```

---

# 34. Quick Add 行为

固定：

```text
Ctrl + Shift + Space
↓
显示 quick-add
↓
自动 Focus 输入框
```

提交：

```text
Enter
```

但：

```text
IME composition
```

期间 Enter 不提交。

成功：

```text
Create Inbox Task
↓
清空 Input
↓
隐藏 Quick Add
↓
Main 刷新
```

创建通过 Quick Add 专属 Rust command 写入默认 Inbox Task，Main 通过定向事件失效任务/清单/标签相关 Query，并以窗口重获焦点后的 refetch 兜底。Quick Add 没有 SQL、数据库 Ready 查询或 Main 窗口权限。提交中禁止双击/重复 Enter；若任务已创建但隐藏窗口失败，应明确告知“已创建”，不可再次提交同一标题。

失败：

```text
保留输入
+
显示错误
```

---

# 35. Quick Add Escape

按：

```text
Esc
```

行为：

```text
隐藏 Quick Add
```

但：

```text
保留未提交草稿
```

再次打开仍可继续输入。

只有创建成功后才清空草稿。

---

# 36. Tray UI

Windows Tray Menu 固定为：

```text
显示主窗口
快速添加
────────
退出
```

不得擅自增加大量未实现菜单。

Main Window 点击关闭时：

```text
如果 Tray 正常可用
→
隐藏到 Tray
```

不等于真正退出。

正常情况下真正退出通过：

```text
Tray → 退出
```

或应用明确 Quit 行为。Tray 初始化或实际 Shell 图标不可用时，Main 必须可见地告知“关闭主窗口将退出”，并让关闭走统一 Quit；不得把窗口隐藏到无法找回的后台。第二次手动启动唤醒现有 Main；退出先拒绝新写入/新提醒投递，等待在途写入和调度停止，再关闭共享数据库连接。

---

# 37. Settings 信息架构

最终 Settings 由 Rail 的“设置”进入，Context Sidebar 展示真实设置分组，Main Content 展示选中分组的具体操作；Settings 不再作为任务 Sidebar 底部的重复入口。当前 Settings 已接入开机启动、备份恢复和运行版本；STEP 21 暂缓，不能提前展示更新占位开关/按钮。

最终第一版分组（每项须在对应 STEP 接通后才显示）：

```text
Settings
├─ General
│  └─ 开机启动
│
├─ Data
│  ├─ Backup
│  └─ Restore
│
├─ Updates
│  └─ Check for Updates
│
└─ About
   └─ Version
```

不得展示没有实现的占位设置。

---

# 38. 开机启动

UI：

```text
开机启动

[ Toggle ]

登录 Windows 后在后台启动应用。
```

默认：

```text
Off
```

Toggle 状态必须读取：

```text
实际 OS Autostart 状态
```

而不是仅显示本地 Settings 中的布尔值。

操作失败时：

```text
Toggle 回到实际状态
+
显示错误
```

不得假装成功。

当前已有 Autostart 插件和设置操作。手动启动应显示 Main；仅带项目明确定义的 `--autostart` 参数且 Tray 可用时后台启动。若 Tray 不可用，保持 Main 可见；不得把 OS 登录自启误写成 Tauri 自动拥有的能力。

---

# 39. Backup

Settings → Data：

```text
备份数据

创建当前待办数据的完整备份。

[创建备份]
```

执行中：

```text
正在创建备份…
```

完成：

```text
备份完成（未加密）
```

用户取消 Save Dialog：

```text
属于 Cancel
```

不得显示：

```text
备份失败
```

备份是经 Rust `VACUUM INTO` 生成并校验的完整 SQLite 一致性快照，包含业务表、提醒、设置及 Schema/Migration 元数据；不包含窗口状态文件、OS 自启项、程序或密钥。快照仅代表生成时的状态。Rust 打开保存对话框并校验目标；覆盖已有文件须明确确认，不能因备份失败损坏旧备份或在线数据库。STEP 18 已通过 Windows 10 开发主机 Gate；安装版与 Windows 11 验证仍属于 STEP 22，面板归入正式 Settings 属于 STEP 20。

---

# 40. Restore

UI 必须强调：

```text
恢复将替换当前全部待办数据。
```

流程：

```text
[恢复备份]
↓
先向用户显示替换全部数据的明确警告并取得确认
↓
Rust 文件对话框选择来源并验证
↓
暂存并记录 pending restore
↓
拒绝新写入、停止调度、等待在途写入、关闭连接并退出
↓
下次启动在 SQL preload 前替换、验证；失败回滚原数据库组
```

确认文案示例：

```text
恢复此备份？

恢复操作将替换当前任务、清单、标签、
提醒和设置。

应用将按受控退出与重启流程完成恢复；若无法自动重启，会提示手动重新打开。

[取消] [恢复]
```

恢复进行期间：

```text
禁止新的 Mutation
```

并展示明确状态。取消文件对话框是取消，不是假成功或恢复错误；成功后建立新 Query 缓存并清除失效选择，失败要说明原库是否已回滚。恢复前快照应按开发手册保留。STEP 18 的开发主机真实恢复链路已验收；这不替代 STEP 22 的安装版/Windows 11 发布验证。

---

# 41. Update

第一版采用：

```text
用户主动检查更新
```

而不是启动时强制检查。

Settings：

```text
应用更新

当前版本（读取应用实际版本）

[检查更新]
```

可能状态：

```text
Idle
Checking
NoUpdate
UpdateAvailable
Downloading
ReadyToInstall
Error
```

更新可用时展示实际版本、下载和安装的明确操作与失败状态；安装前按统一退出流程等待在途写入。没有真实端点、签名和已通过安装版验证时，不显示虚假的可用更新或成功安装状态。

---

## 无更新

```text
当前已是最新版本。
```

---

## 网络失败

```text
无法检查更新。

你的本地任务仍可正常使用。

[重试]
```

更新网络失败不得影响本地 CRUD。

---

# 42. Window State

Main Window 保存：

```text
Size
Position
Maximized
```

不恢复：

```text
Hidden
Minimized
```

因此用户手动启动应用时必须可以看到窗口。

Quick Add：

```text
不参与 Main Window State 恢复
```

这些是 STEP 19 的最终要求；当前 Main 初始配置为 800×600，并已接入位置、大小及最大化状态保存恢复。恢复位置若不在当前显示器工作区内，应回到可见区域，并在 DPI/拔显示器场景验证。

---

# 43. 小窗口响应式布局

本项目只针对 Windows Desktop，不设计 Mobile UI。

响应式依据：

```text
Window Width
```

而不是：

```text
Mobile / Tablet / Desktop
```

---

## Wide

建议：

```text
>= 1100px
```

显示：

```text
Primary Navigation Rail
+
Context Sidebar
+
Task View
+
Task Inspector
```

---

## Medium

建议：

```text
760px – 1099px
```

显示：

```text
Primary Navigation Rail
+
Context Sidebar
+
Task View
```

Task Inspector：

```text
Right Overlay
```

---

## Compact

建议：

```text
< 760px
```

优先：

```text
Primary Navigation Rail
+
Task View
```

Sidebar：

```text
Overlay
```

Task Inspector：

```text
Full-height Overlay
```

Rail 在三档窗口宽度中均保留“任务”“设置”两个真实入口；Compact 时保持窄宽度并提供键盘和可访问名称，不能改成移动端 Bottom Navigation。Sidebar 和 Inspector 的 Overlay 分别管理焦点与 Escape，不能同时遮挡主要操作。Settings 视图使用 Rail + Context Sidebar + Settings Main，不显示 Task Inspector。

这些数值属于 UI 表现层默认值，可根据真实 GUI 验收调整。

任何情况下：

```text
长标题
+
大字体
+
小窗口
```

都必须保持核心操作可访问。

---

# 44. 不使用 Mobile 交互

Windows 第一版禁止为了“响应式”引入：

```text
Bottom Navigation
Swipe Actions
Bottom Sheet
Mobile Gesture Navigation
```

主要交互方式是：

```text
Mouse
Keyboard
Tab
Context Menu
Dialog
Popover
```

---

# 45. Keyboard 与 Focus

必须保证：

- Input 有 Label。
- Focus Visible。
- Checkbox 可键盘操作。
- Dialog 打开后 Focus 进入 Dialog。
- Dialog 关闭后 Focus 返回合理来源。
- Tab 顺序符合视觉顺序。
- IME 输入正确。
- Refetch 不抢走 Focus。

主窗口级监听不得抢：

```text
Tab
Enter
Space
```

等属于当前编辑器 / 控件的按键。

---

# 46. Escape 优先级

Escape 应遵循：

```text
当前 Popover
↓
当前 Dialog
↓
当前 Inspector Overlay
↓
Quick Add Window Hide
```

不能让一个全局 Esc Handler 无条件关闭整个界面。

---

# 47. Right Click

Windows 可以使用 Context Menu 提高效率。

Task 可以提供：

```text
完成 / 取消完成
编辑
删除
```

List：

```text
重命名
删除
```

Tag：

```text
删除
```

但：

> Context Menu 只能是快捷入口，关键功能不能只存在于右键菜单。

---

# 48. Loading 与 Pending

任务 Query 使用 Loading / Loaded / Empty / Error；创建使用 Idle / Pending / Error；任务详情编辑使用 Clean / Dirty / Saving / SaveFailed。备份、恢复和开机启动等 Settings 操作使用 Idle / Pending / Success / Error，取消文件选择单独作为 Cancel；更新检查另使用第 41 节所列状态。这些是 UI 反馈，不新增数据库业务状态。

写操作必须提供：

```text
Pending State
```

例如任务创建：

```text
[添加任务]
→
disabled
```

避免重复提交。

保存：

```text
保存中…
```

失败：

```text
保存失败
```

并保留 Draft。

---

# 49. 错误提示原则

用户消息：

```text
中文
可理解
说明当前操作是否完成
```

例如：

```text
任务保存失败，请重试。
```

而不是直接输出：

```text
SQLITE_BUSY
```

技术错误进入日志。

UI 不得展示：

```text
假成功
```

特别是：

- 创建。
- 编辑。
- 删除。
- Reminder。
- Backup。
- Restore。
- Autostart。
- Update。

---

# 50. 离线状态

应用的业务功能完全离线。

因此主界面不应因为：

```text
navigator.onLine = false
```

而禁用：

```text
Task CRUD
Lists
Tags
Reminder Editing
```

更新检查失败也不能覆盖主任务区。

---

# 51. UI 状态与业务状态边界

当前选中 List/Tag、草稿和弹层状态由 React 本地管理，尚未创建 Zustand Store。未来如引入 Zustand，只保存纯 UI 状态，例如：

```text
currentView
selectedTaskId
sidebarOpen
inspectorOpen
dialogOpen
```

不得保存完整：

```text
tasks
lists
tags
reminders
settings
```

业务 UI 使用 TanStack Query 获取真实数据。

---

# 52. Task Selection

建议：

```text
selectedTaskId
```

作为选择状态。

不得复制：

```text
selectedTask
```

完整业务对象长期放在 Zustand 作为第二份真相。

Task Inspector 根据：

```text
selectedTaskId
```

读取 Query 数据。

---

# 53. Refetch 行为

Main：

- 重新显示。
- 获得 Focus。
- Quick Add 创建事件到达。

可以：

```text
invalidate / refetch
```

但：

```text
refetch
```

不得：

- 抢输入焦点。
- 清空 Draft。
- 自动关闭 Inspector。
- 覆盖未保存编辑。

---

# 54. shadcn/ui 使用规则

第一版统一采用：

```text
shadcn/ui Base UI
```

当前已实际落地的项目组件只有 `Button`、`Input`、`Checkbox`。后续按 STEP 20 的真实交互需要，从 shadcn/ui Base UI 添加并组合相应组件，例如：

```text
Button
Input
Checkbox
Dialog
Popover
Textarea
Calendar
Select
Switch
```

只在真实业务需要时添加组件。

禁止：

```text
创建完整自研 Design System
```

也不要修改大量 shadcn 底层代码只为了复刻其他应用外观。

---

# 55. Visual Style

整体视觉目标：

```text
Clean
Quiet
Dense enough for desktop
Windows-friendly
```

沿用现有 shadcn/Tailwind 基础主题变量、Geist 字体和组件样式。当前 CSS 含 `.dark` 变量，但没有已实现的暗色模式切换；本规范不新增第一版主题设置入口。布局可继续使用 Tailwind 的：

- Spacing。
- Typography。
- 宽度与窗口断点。

允许必要：

```text
Windows Font Fallback
```

但不得建立另一套 Token 系统与官方 Theme 并行。

---

# 56. 动画

第一版不建立 Animation System。

允许极轻量、不会改变业务含义的：

```text
Hover
Popover Open
Dialog Open
```

基础组件过渡。

不得加入：

```text
Task flying animation
Bounce
Spring
Complex list reorder animation
```

---

# 57. Accessibility

正式 UI 必须满足：

```text
Input Label
Keyboard Navigation
Focus Visible
Accessible Checkbox
Dialog Focus Management
Readable Contrast
```

Popover/Dialog 应由适当的 Base UI 组件管理焦点陷阱与返回；自定义确认区域不能仅因设置 `role="alertdialog"` 就视作已满足 Dialog 焦点行为。任务行、Checkbox、输入、选择器和危险操作要可按 Tab 到达并有可见焦点；错误与进度需可被辅助技术感知。键盘 Escape 先处理当前弹层/草稿，再执行窗口级隐藏。

并重点验证：

```text
中文 IME
长标题
大系统字体
小窗口
不同 DPI
```

---

# 58. Startup UI

数据库 Ready 前不得挂载正常业务 Task UI。

推荐：

```text
App Starting
```

短暂启动状态。

如果 Database Boot 失败：

```text
无法启动数据库

应用无法安全加载任务数据。

请完全关闭应用，确认问题已解决后再重新打开。
```

不得退化成：

```text
空白 Inbox
```

因为这会让用户误以为数据丢失。

---

# 59. 正式主界面结构

推荐最终结构：

```text
MainWindow
│
├─ PrimaryNavigationRail
│  ├─ TasksDestination
│  └─ SettingsDestination
│
├─ ContextSidebar
│  ├─ TasksContext: Inbox / Today / Upcoming / Lists / Tags
│  └─ SettingsContext: 已接通的设置分组
│
├─ MainContent
│  │
│  ├─ TaskView
│  │  ├─ TaskViewHeader
│  │  ├─ CreateTaskInput
│  │  ├─ TaskList
│  │  │  └─ TaskRow
│  │  ├─ EmptyState
│  │  └─ ErrorState
│  │
│  └─ SettingsView
│
└─ TaskInspector（仅选中真实任务时）
   ├─ TaskStatus
   ├─ TitleInput
   ├─ NotesTextarea
   ├─ DueDateTimeEditor
   ├─ ListSelector
   ├─ TagEditor
   ├─ ReminderEditor
   ├─ SaveActions
   └─ DeleteTaskAction
```

Quick Add 是另一窗口：

```text
QuickAddWindow
└─ QuickAddForm
   ├─ TitleInput
   ├─ ErrorMessage
   └─ KeyboardHint
```

---

# 60. 推荐最终界面示意

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Todoa                                                                      ─ □ × │
├────────┬─────────────────┬────────────────────────────────┬──────────────────────┤
│ 任务 ● │ Inbox           │ Today                          │ ☐ 产品评审           │
│        │ Today           │ 当前任务由真实日期查询得出     │ 标题 / 纯文本备注     │
│        │ Upcoming        │                                │ 截止日期 + 时间       │
│        │                 │ ☐ 产品评审         今天 15:00 │ 清单 / 标签 / 提醒    │
│        │ Lists           │ ☐ 回复邮件         今天 17:30 │ [取消] [保存]        │
│        │   Work          │                                │ 永久删除任务         │
│        │   Personal      │                                │                      │
│        │   + 新建清单    │                                │                      │
│        │ Tags            │                                │                      │
│        │   #工作         │                                │                      │
│        │   + 新建标签    │                                │                      │
│ 设置   │                 │                                │                      │
└────────┴─────────────────┴────────────────────────────────┴──────────────────────┘
```

图中 Rail 只负责“任务 / 设置”；Sidebar 负责具体任务视图。选中“设置”后，Sidebar 换成已实现设置分组，Main 显示对应设置，Inspector 隐藏。图中的日期、时间和任务数量均由真实 Query 取得，不是静态演示数据入口。

---

# 61. Quick Add 最终示意

```text
        Ctrl + Shift + Space

┌─────────────────────────────────────────────┐
│ 快速添加                                   │
│                                             │
│ [ 输入任务标题...                         ] │
│                                             │
│ Enter 添加                     Esc 关闭     │
└─────────────────────────────────────────────┘
```

它只创建：

```text
Inbox Task
```

不得扩展成完整任务编辑器。

---

# 62. UI 功能真值表

| UI 功能 | 第一版 |
|---|---|
| Inbox | ✅ |
| Primary Navigation Rail（任务 / 设置） | ✅ STEP 20 正式 UI |
| Today | ✅ |
| Upcoming | ✅ |
| Lists | ✅ |
| Tags | ✅ |
| Settings | ✅ |
| Task title | ✅ |
| Notes | ✅ 纯文本 |
| Due date + time | ✅ |
| Multiple one-time reminders | ✅ |
| Quick Add Window | ✅ |
| Global Shortcut | ✅ |
| Tray | ✅ |
| Backup / Restore | ✅ |
| Autostart | ✅ |
| Check Update | ✅ |
| Task Priority | ❌ |
| Subtasks | ❌ |
| Recurrence | ❌ |
| Attachments | ❌ |
| Markdown | ❌ |
| Trash | ❌ |
| Calendar View | ❌ |
| Kanban | ❌ |
| Matrix | ❌ |
| Habits | ❌ |
| Focus Timer | ❌ |
| Drag & Drop | ❌ |
| NLP Quick Add | ❌ |
| Cloud Sync | ❌ |
| Account | ❌ |

---

# 63. AI 代码生成强制约束

AI 根据本规范生成 UI 时必须遵守：

### 禁止扩需求

不得因为：

```text
“常见待办软件一般都有”
```

而自行加入功能。

---

### 组件不得直接访问 SQL

UI：

```text
Component
↓
Query Hook
↓
Repository
```

不得：

```text
Component
↓
db.select()
```

---

### 不复制业务数据到 Zustand

允许：

```text
selectedTaskId
```

禁止：

```text
taskStore.tasks = [...]
```

---

### 不实现复杂 Optimistic Update

Mutation 未确认成功时不得永久表现为成功。

---

### 不使用 Drag & Drop

即使：

```text
sort_order
```

存在，也不代表第一版授权拖拽。

`sort_order` 第一版仅用于稳定顺序。

---

### 不增加不存在的字段

禁止 UI Schema 出现：

```text
priority
repeat
subtasks
attachments
startDate
assignee
```

---

### 不提供假入口

Button、Menu、Settings Entry 只要显示，就必须具有真实行为。

禁止：

```text
“Coming Soon”
```

式大量占位功能进入正式 UI。

---

# 64. UI 验收重点

正式 UI 完成后至少人工验证：

### Task

```text
Create
Edit Title
Edit Notes
Set Due
Clear Due
Complete
Uncomplete
Permanent Delete
```

---

### Dates

```text
Today
Upcoming
Overdue
Midnight Boundary
Timezone Change
DST
No Due Date
```

---

### Lists

```text
Create
Rename
View
Move Task
Delete
Task returns Inbox
```

---

### Tags

```text
Create
Assign
Remove
Delete
Tag View
```

---

### Reminder

```text
Create
Edit
Delete
Complete Task
Cancel Complete
Restart Recovery
```

---

### Quick Add

```text
Ctrl+Shift+Space
Focus
IME
Enter
Pending
Failure Draft
Escape Draft
Main Refresh
```

---

### Windows

```text
Tray Hide
Tray Restore
Quit
Window Position
Maximized
DPI
Disconnected Monitor
Autostart
```

---

### Data

```text
Backup
Restore Confirmation
Restore Error
Restore Restart
```

---

### Update

```text
Check
No Update
Available
Offline
Cancel
Install
```

---

# 65. 最终 UI 原则

本项目第一版的 UI 目标：

> **为开发手册已经确定的功能提供清晰、稳定、符合 Windows 桌面习惯的界面。**

设计决策顺序固定为：

```text
1. 与开发执行手册一致
2. 数据正确性
3. 不丢用户输入
4. 桌面键鼠可用性
5. 信息架构清晰
6. 小窗口 / DPI / Accessibility
7. 视觉一致性
8. 动效与装饰
```

任何视觉设计如果要求新增数据库字段、新服务、新业务状态或新的系统能力，都不属于单纯 UI 工作，必须先修改开发执行手册，再修改本规范。

---

# 66. 与开发执行手册的最终对应关系

```text
STEP 8
→ Inbox 基础 Task UI

STEP 9
→ Lists UI

STEP 10
→ Tags UI

STEP 12
→ Quick Add Window

STEP 14
→ Ctrl + Shift + Space

STEP 15
→ Tray / Window Lifecycle

STEP 16–17
→ Reminder UI + Notification

STEP 18
→ Backup / Restore UI

STEP 19
→ Window State / Autostart

STEP 20
→ 正式 Main UI
→ Primary Navigation Rail + Context Sidebar
→ Task Detail
→ Today
→ Upcoming
→ Accessibility

STEP 21
→ Check Update UI

STEP 22
→ 安装版最终 Windows GUI 验收
```

UI 实现必须跟随这些 STEP 的实际完成状态。

不能因为本规范已经描述最终 UI，就提前在较早 STEP 中实现后续功能。

---

# 67. 按当前进度分批实施

下表是开发手册既有 STEP 内的 UI 交付批次，不新增 STEP、不改变数据库/Domain/Capability 边界，也不把尚未完成的按钮提前放进界面。当前 STEP 0–20 的真实能力直接复用；每批完成后更新 `PROJECT_STATE.md` 并以实际 Windows 交互验收，不能只凭构建或静态页面宣布完成。

| 批次 | 对应 STEP | 实施内容 | 完成判据 |
| --- | --- | --- | --- |
| A：系统设置基础 | STEP 19 | Main 位置/大小/最大化状态；真实 OS 开机启动读取与切换。先提供可操作的设置入口，正式 Rail/Sidebar 样式留到 STEP 20。 | 手动启动可见、自启仅在 Tray 可用时后台启动；拔显示器、DPI、状态读取/失败回退与登录启动按手册验收。 |
| B：任务编辑与日期数据链 | STEP 20 内部批次 | 补齐 Task `getById/update` 与 Hooks；标题、纯文本备注、截止日期+时间的显式保存；Today/Upcoming 本地日期边界 Repository 查询。先让数据链和异常状态真实可用，未接通前不显示对应导航。 | 编辑失败保留草稿；截止时刻清除/重启、Today/Upcoming 午夜/夏令时/无日期/逾期/完成状态测试通过。 |
| C：正式导航与布局 | STEP 20 内部批次 | 实现 Primary Navigation Rail（任务/设置）、Context Sidebar、Main Task View 和 Settings View；复用已有 Inbox/List/Tag、备份恢复与已完成的开机启动操作；窗口宽度驱动的窄屏布局。 | Rail 与 Sidebar 无重复入口、无空目的地；键盘/焦点/关闭弹层、窗口缩放、大字体和实际 GUI 路径可操作。 |
| D：任务 Inspector 与整合验收 | STEP 20 内部批次 | 选中任务后打开 Inspector；复用 List/Tag/Reminder 的真实 Mutation，加入标题/备注/截止时刻 Dirty Draft、离开确认、永久删除；统一 Loading/Empty/Error 和无障碍行为。 | 切换任务/关闭/刷新不丢草稿；提醒、清单删除、Quick Add、Tray、恢复后选择失效等回归通过。只有 B–D 全部通过才算 STEP 20 完成。 |
| E：主动检查更新 | STEP 21 | 在 Settings 的 Updates 分组接入真实检查/下载/安装状态；未配置真实端点和签名时不显示假成功。 | 断网不影响本地 CRUD；双版本安装、验签、失败/取消及统一退出按手册 Gate 验证。 |
| F：安装版发布验收 | STEP 22 | NSIS、代码签名及正式 Windows 11 x64 安装版的 UI/系统交互复核。 | 实际验证通知显示/身份、Tray、Quick Add、开机启动、窗口状态、备份恢复和更新；未验证项明确保留为待验收。 |

每批仅展示已接通的真实入口。B–D 是 STEP 20 的工作切分，不是三个独立完成的开发 STEP；不得因为某批的界面已出现，就将整个 STEP 20 标为通过。本地任务能力始终不依赖账户或云服务。
