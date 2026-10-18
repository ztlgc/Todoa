import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, BookOpen, Building2, CalendarCheck2, Check, ChevronLeft, ChevronRight, Clock3, Download, FileText, PencilLine, Plus, Search, Star, Trash2, Users, X } from "lucide-react";
import { isBrowserDebug } from "@/app/browserDebug";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { activityNames, dateKey, filterJournalRecords, fromKey, journalKinds, journalMarkdown, journalPeriod, statusNames, workStatus, type JournalItem, type JournalKind, type WorkStatus } from "@/domain/journal";
import type { Task } from "@/domain/task";
import type { TaskList } from "@/domain/list";
import { useTasks, useUpdateTaskStatus } from "@/features/tasks/queries";
import { useLocalClock } from "@/features/tasks/useLocalClock";
import { findFollowUp } from "@/data/repositories/JournalFollowUpRepository";
import { useCreateJournalFollowUp, useJournalRecords, useRemoveJournal, useSaveJournal } from "./queries";
import { JournalEditor, recordNames } from "./JournalEditor";
import { QuickWorkEntry } from "./QuickWorkEntry";
import { AutomaticTaskEntries } from "./AutomaticTaskEntries";
import "./journal-preview.css";

const names: Record<JournalKind, string> = { day: "日", week: "周", month: "月", year: "年" };
const label = (key: string) => fromKey(key).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function JournalWorkspace({ lists, onDirtyChange, onBusyChange }: { lists: TaskList[]; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const recordsQuery = useJournalRecords(), tasksQuery = useTasks(), remove = useRemoveJournal(), restore = useSaveJournal(), followUp = useCreateJournalFollowUp(), updateStatus = useUpdateTaskStatus();
  const now = useLocalClock(), today = dateKey(now);
  const [mode, setMode] = useState<JournalKind>("week"), [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [query, setQuery] = useState(""), [theme, setTheme] = useState(""), [clientFilter, setClientFilter] = useState(""), [business, setBusiness] = useState("");
  const [status, setStatus] = useState<WorkStatus | "">(""), [important, setImportant] = useState(false), [periodOnly, setPeriodOnly] = useState(false);
  const [editing, setEditing] = useState<{ kind: JournalKind; key: string; itemId?: string } | null>(null);
  const [quickDirty, setQuickDirty] = useState(false), [editorDirty, setEditorDirty] = useState(false), [quickBusy, setQuickBusy] = useState(false), [editorBusy, setEditorBusy] = useState(false);
  const [notice, setNotice] = useState(""), [exporting, setExporting] = useState(false), [trashOpen, setTrashOpen] = useState(false);
  const [sourceTask, setSourceTask] = useState<Task | null>(null), [quickTarget, setQuickTarget] = useState({ date: today, sequence: 0 });
  const [taskNotice, setTaskNotice] = useState("");
  const creation = useRef(false);
  const { confirm, confirmation } = useConfirmDialog();
  const stored = recordsQuery.data ?? [], records = stored.filter(record => !record.deletedAt), tasks = tasksQuery.data ?? [];
  const days = records.filter(record => record.kind === "day"), period = journalPeriod(mode, selected), anchor = fromKey(selected);
  const allHistory = !periodOnly && !!(query.trim() || clientFilter);
  const filters = { query, theme, important, client: clientFilter, business, status };
  const visible = filterJournalRecords(days.filter(record => allHistory || (record.start >= period.start && record.start <= period.end)), filters).sort((a, b) => b.start.localeCompare(a.start));
  const filtered = !!(query.trim() || theme || important || clientFilter || business || status);
  const items = visible.flatMap(record => record.items);
  const clients = Array.from(new Set(days.flatMap(record => record.items.map(item => item.client?.trim()).filter((value): value is string => !!value)))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const businesses = Array.from(new Set(days.flatMap(record => record.items.map(item => item.business).filter((value): value is string => !!value)))).sort();
  const themes = Array.from(new Set(records.flatMap(record => [record.theme, ...record.items.map(item => item.theme)]).filter(Boolean))).sort();
  const review = records.find(record => record.kind === mode && record.start === period.start);
  const childReviews = records.filter(record => record.kind !== "day" && record.kind !== mode && record.start >= period.start && record.end <= period.end);
  const busy = quickBusy || editorBusy || exporting || remove.isPending || restore.isPending || followUp.isPending || updateStatus.isPending;
  const dirty = quickDirty || editorDirty;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { setTaskNotice(""); }, [sourceTask?.id]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  async function closeEditor() {
    if (editorBusy || (editorDirty && !(await confirm("当前日记尚未保存，关闭后将保留本地草稿。", "关闭编辑")))) return;
    setEditorDirty(false); setEditing(null);
  }
  function open(key: string, kind: JournalKind = "day", itemId?: string) { if (!busy) { setEditorDirty(false); setEditing({ kind, key, itemId }); setNotice(""); } }
  function selectDate(key: string) { setSelected(key); setMonth(new Date(fromKey(key).getFullYear(), fromKey(key).getMonth(), 1)); setTrashOpen(false); }
  function targetQuick(date: string) { setQuickTarget(current => ({ date, sequence: current.sequence + 1 })); setTrashOpen(false); }
  function shift(amount: number) {
    const next = fromKey(selected);
    if (mode === "year") next.setFullYear(next.getFullYear() + amount);
    else if (mode === "month") next.setMonth(next.getMonth() + amount, 1);
    else next.setDate(next.getDate() + amount * (mode === "week" ? 7 : 1));
    selectDate(dateKey(next));
  }
  async function erase(record: import("@/domain/journal").JournalRecord): Promise<boolean> {
    if (editorBusy || !(await confirm(`删除这份${recordNames[record.kind]}？可在日记回收站恢复，任务不会被删除。`, "删除记录"))) return false;
    try { await remove.mutateAsync(record); setEditorDirty(false); setEditing(null); setNotice("日记已移入回收站，跟进任务保留。"); return true; }
    catch (cause) { setNotice(errorMessage(cause)); return false; }
  }
  async function createFollowUp(date: string, item: JournalItem) {
    if (creation.current) return;
    creation.current = true;
    try { await followUp.mutateAsync({ date, item }); setNotice("跟进已加入待办，可在「任务」中继续处理。"); }
    catch (cause) { setNotice(`跟进创建失败：${errorMessage(cause)}`); }
    finally { creation.current = false; }
  }
  async function toggleSourceStatus(task: Task) {
    setTaskNotice("");
    try { await updateStatus.mutateAsync({ id: task.id, status: task.status === "completed" ? "todo" : "completed" }); }
    catch (cause) { setTaskNotice(`任务更新失败：${errorMessage(cause)}`); }
  }
  async function exportMarkdown() {
    if (dirty) { setNotice("请先保存当前草稿，再导出。"); return; }
    setExporting(true); setNotice("");
    try {
      const content = journalMarkdown(records, mode, selected, query, theme, important, { allHistory, client: clientFilter, business, status });
      const filename = `Todoa-对公工作回顾-${allHistory ? "全部历史" : `${period.start}-${period.end}`}.md`;
      if (isBrowserDebug()) {
        const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("已导出当前筛选范围的记录。");
      } else { const result = await invoke<string>("export_journal_markdown", { content, filename }); setNotice(result === "cancelled" ? "已取消导出。" : "Markdown 已导出。"); }
    } catch (cause) { setNotice(errorMessage(cause)); } finally { setExporting(false); }
  }
  const offset = (month.getDay() + 6) % 7, count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const editorPeriod = editing ? journalPeriod(editing.kind, editing.key) : null;
  const editorRecord = editorPeriod ? stored.find(record => record.kind === editorPeriod.kind && record.start === editorPeriod.start) : undefined;
  const periodLabel = mode === "day" ? label(selected) : mode === "week" ? `${period.start} — ${period.end}` : mode === "month" ? `${anchor.getFullYear()}年${anchor.getMonth() + 1}月` : `${anchor.getFullYear()}年`;
  const liveSource = sourceTask ? tasks.find(task => task.id === sourceTask.id && task.createdAt === sourceTask.createdAt) ?? sourceTask : null;
  if (recordsQuery.isPending) return <p role="status">正在读取客户工作日记…</p>;
  if (recordsQuery.isError) return <div role="alert"><p>日记读取失败，已有数据保留。</p><button onClick={() => void recordsQuery.refetch()}>重新读取</button></div>;
  return <section className="jp" aria-label="工作日记">{confirmation}
    <aside className="jp-sidebar">
      <div className="jp-brand"><span><BookOpen size={21} /></span><div><strong>客户工作日记</strong><small>对公客户经理工作台</small></div></div>
      <div className="jp-calendar-heading"><strong>{month.getFullYear()}年 {month.getMonth() + 1}月</strong><div><button aria-label="日历上个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><button className="jp-today" onClick={() => selectDate(today)}>今天</button><button aria-label="日历下个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button></div></div>
      <div className="jp-calendar">{"一二三四五六日".split("").map(day => <small key={day}>{day}</small>)}{Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: count }, (_, index) => {
        const key = dateKey(new Date(month.getFullYear(), month.getMonth(), index + 1));
        return <button key={key} aria-label={`查看${key}日记`} aria-pressed={key === selected} className={`${key === selected ? "selected" : ""} ${days.some(record => record.start === key) ? "has-entry" : ""}`} onClick={() => selectDate(key)}>{index + 1}</button>;
      })}</div>
      <div className="jp-sidebar-section"><small>回顾周期</small><div className="jp-modes">{journalKinds.map(value => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setTrashOpen(false); }}>{names[value]}</button>)}</div></div>
      <label className="jp-field jp-client-filter"><span><Building2 size={14} />按客户查看</span><select aria-label="筛选客户" value={clientFilter} onChange={event => setClientFilter(event.target.value)}><option value="">全部客户</option>{clients.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className={`jp-filter ${important ? "active" : ""}`} aria-pressed={important} onClick={() => setImportant(!important)}><Star size={15} />仅看重点事项</button>
      {themes.length > 0 && <label className="jp-field jp-theme-filter">工作主题<select aria-label="筛选工作主题" value={theme} onChange={event => setTheme(event.target.value)}><option value="">全部主题</option>{themes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      <button className={`jp-filter jp-trash-link ${trashOpen ? "active" : ""}`} onClick={() => setTrashOpen(!trashOpen)} aria-expanded={trashOpen}><Trash2 size={15} />日记回收站</button>
    </aside>
    <div className="jp-workspace">
      <header className="jp-header"><div><div className="jp-eyebrow">客户沟通 · 业务推进 · 跟进安排</div><h1 id="inbox-heading" tabIndex={-1}>{clientFilter ? `${clientFilter}的工作记录` : "客户跟进与工作记录"}</h1><div className="jp-period"><button aria-label="上一时间段" onClick={() => shift(-1)}><ChevronLeft size={16} /></button><span>{periodLabel}</span><button aria-label="下一时间段" onClick={() => shift(1)}><ChevronRight size={16} /></button></div></div><div className="jp-header-actions"><button className="jp-icon-button" title="导出当前工作回顾" aria-label="导出当前工作回顾" disabled={busy} onClick={() => void exportMarkdown()}><Download size={17} /></button><button className="jp-primary" onClick={() => targetQuick(today)}><Plus size={16} />记录今天</button></div></header>
      {notice && <p className="jp-notice" role={notice.includes("失败") ? "alert" : "status"}>{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></button></p>}
      <div className="jp-content">
        <QuickWorkEntry target={quickTarget} clients={clients} onDirty={setQuickDirty} onBusy={setQuickBusy} onSaved={date => { selectDate(date); setQuery(""); setClientFilter(""); setStatus(""); setBusiness(""); setTheme(""); setImportant(false); }} />
        {trashOpen ? <div className="jp-trash"><h2>日记回收站</h2>{stored.filter(record => record.deletedAt).map(record => <div key={`${record.kind}-${record.start}`}><span>{record.start} · {recordNames[record.kind]} · {record.title || "无标题"}</span><button disabled={restore.isPending || busy} onClick={() => { void restore.mutateAsync({ input: record, revision: record.revision }).then(() => setNotice("记录已恢复。")).catch(cause => setNotice(errorMessage(cause))); }}>恢复</button></div>)}{!stored.some(record => record.deletedAt) && <p>回收站为空。</p>}</div> : <>
          <div className="jp-browse-heading"><h2>{allHistory ? "客户历史记录" : "工作时间线"}</h2><div><button onClick={() => open(selected)}>整理当天日记</button>{selected !== today && <button onClick={() => targetQuick(selected)}>补记 {selected.slice(5).replace("-", "/")}</button>}</div></div>
          <div className="jp-filterbar"><label className="jp-search"><Search size={17} /><input aria-label="搜索全部工作记录" placeholder="搜索客户、事项或沟通内容…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="清除搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label><select aria-label="筛选事项状态" value={status} onChange={event => setStatus(event.target.value as WorkStatus | "")}><option value="">全部状态</option>{Object.entries(statusNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select><select aria-label="筛选业务类型" value={business} onChange={event => setBusiness(event.target.value)}><option value="">全部业务</option>{businesses.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="jp-scope"><span>{allHistory ? "正在搜索全部历史" : "当前周期"} · {visible.length} 天 / {items.length} 条事项</span>{(query.trim() || clientFilter) && <label className="jp-check"><input type="checkbox" checked={periodOnly} onChange={event => setPeriodOnly(event.target.checked)} />仅当前周期</label>}{filtered && <button onClick={() => { setQuery(""); setTheme(""); setClientFilter(""); setBusiness(""); setStatus(""); setImportant(false); }}>清除筛选</button>}</div>
          <div className="jp-overview"><div><Users size={17} /><strong>{new Set(items.map(item => item.client).filter(Boolean)).size}</strong><span>涉及客户</span></div><div><CalendarCheck2 size={17} /><strong>{items.filter(item => workStatus(item) === "completed").length}</strong><span>已完成事项</span></div><div><Clock3 size={17} /><strong>{items.filter(item => ["waiting_client", "waiting_internal"].includes(workStatus(item))).length}</strong><span>等待回复</span></div><div><FileText size={17} /><strong>{items.filter(item => item.nextAction).length}</strong><span>有后续安排</span></div></div>
          {!filtered && mode !== "day" && <details className="jp-review"><summary><FileText size={16} /><strong>{recordNames[mode]}</strong><span>{review ? "已保存 · 展开查看" : "整理本期客户维护与业务进展"}</span></summary>{review?.title && <h2>{review.title}</h2>}{review?.text && <p>{review.text}</p>}<button className="jp-text-button" onClick={() => open(selected, mode)}><PencilLine size={15} />{review ? "编辑" : "撰写"}{recordNames[mode]}<ArrowUpRight size={14} /></button>{mode === "year" && <div className="jp-year-months">{Array.from({ length: 12 }, (_, index) => <button key={index} onClick={() => { selectDate(`${anchor.getFullYear()}-${String(index + 1).padStart(2, "0")}-01`); setMode("month"); }}>{index + 1}月<small>{days.filter(record => record.start.startsWith(`${anchor.getFullYear()}-${String(index + 1).padStart(2, "0")}`)).length} 天记录</small></button>)}</div>}{childReviews.length > 0 && <div className="jp-child-reviews">{childReviews.sort((a, b) => b.start.localeCompare(a.start)).map(record => <button key={`${record.kind}-${record.start}`} onClick={() => open(record.start, record.kind)}>{record.start} · {recordNames[record.kind]} · {record.title || "无标题"}<ArrowUpRight size={13} /></button>)}</div>}</details>}
          <main className="jp-timeline">{visible.map(record => <article key={record.start} className="jp-entry"><header className="jp-entry-date"><h2>{label(record.start)}</h2><button aria-label={`编辑${record.start}日记`} onClick={() => open(record.start)}>查看完整日记<ArrowUpRight size={14} /></button></header>
            <AutomaticTaskEntries items={record.items.filter(item => item.origin === "task_auto")} tasks={tasks} onOpenTask={setSourceTask} />
            {(record.items.some(item => item.origin !== "task_auto") || ((!filtered || !record.items.length) && (record.title || record.text))) && <div className="jp-material-heading jp-manual-heading"><strong>工作补充 · 手动填写</strong><span>{record.items.some(item => item.origin !== "task_auto") ? `${record.items.filter(item => item.origin !== "task_auto").length} 条` : "当天总结"}</span></div>}
            {(!filtered || !record.items.length) && (record.title || record.text) && <div className="jp-day-note">{record.title && <h3>{record.title}</h3>}{record.text && <p>{record.text}</p>}</div>}
            {record.items.filter(item => item.origin !== "task_auto").map(item => { const task = findFollowUp(tasks, record.start, item), source = tasks.find(task => task.id === item.taskId && (!item.taskCreatedAt || task.createdAt === item.taskCreatedAt)); return <section className="jp-work-item" key={item.id}><div className="jp-work-item-meta"><span className={`jp-status jp-status-${workStatus(item)}`}>{statusNames[workStatus(item)]}</span>{item.client && <button className="jp-client-chip" onClick={() => setClientFilter(item.client!)}><Building2 size={13} />{item.client}</button>}{item.business && <span>{item.business}</span>}{item.activity && <span>{activityNames[item.activity]}</span>}{item.occurredAt && <time>{new Date(item.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>}{item.important && <Star className="jp-important-star" size={14} aria-label="重点事项" />}</div><h3>{item.title}</h3>{item.notes && (item.notes.length > 160 ? <details className="jp-long-notes"><summary>{item.notes.slice(0, 95)}…<span>展开进展</span></summary><p>{item.notes}</p></details> : <p className="jp-item-notes">{item.notes}</p>)}
              {item.nextAction && <div className="jp-next-action"><ArrowUpRight size={15} /><div><strong>下一步</strong><span>{item.nextAction}</span>{item.followUpAt && <small>{new Date(item.followUpAt).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>}</div><button disabled={followUp.isPending || tasksQuery.isPending || tasksQuery.isError} onClick={() => task ? setSourceTask(task) : void createFollowUp(record.start, item)}>{task ? task.status === "completed" ? "跟进已完成" : "查看跟进" : "创建跟进待办"}</button></div>}
              <footer>{item.theme && <span>{item.theme}</span>}{source && <button onClick={() => setSourceTask(source)}>查看原任务<ArrowUpRight size={12} /></button>}<button aria-label={`编辑事项：${item.title}`} onClick={() => open(record.start, "day", item.id)}><PencilLine size={13} />编辑</button></footer>
            </section>; })}
          </article>)}{!visible.length && <div className="jp-empty"><BookOpen size={28} /><h2>{filtered ? "没有找到符合条件的记录" : mode === "day" ? `${selected === today ? "今日" : "当日"}暂无完成任务` : "本期还没有工作记录"}</h2><p>{filtered ? "调整客户、状态或搜索条件，也可切换到全部历史。" : "完成任务后会自动记入当天，也可在上方补充客户沟通或业务进展。"}</p><button className="jp-secondary" onClick={() => targetQuick(today)}>记录今天</button></div>}</main>
        </>}
      </div>
    </div>
    <Dialog open={!!editing} onOpenChange={value => { if (!value) void closeEditor(); }}><DialogContent className="jp-editor-dialog" showCloseButton={false}><DialogTitle className="sr-only">{editing ? recordNames[editing.kind] : "日记"}编辑</DialogTitle>{editing && <JournalEditor key={`${editing.kind}-${editorPeriod?.start}`} record={editorRecord} kind={editing.kind} date={editing.key} initialItemId={editing.itemId} records={records} tasks={tasks} tasksPending={tasksQuery.isPending} tasksError={tasksQuery.isError} retryTasks={() => void tasksQuery.refetch()} lists={lists} clients={clients} onDirty={setEditorDirty} onBusy={setEditorBusy} onDelete={erase} onClose={() => void closeEditor()} onSaved={() => setEditorDirty(false)} />}</DialogContent></Dialog>
    <Dialog open={!!sourceTask} onOpenChange={value => { if (!value && !updateStatus.isPending) setSourceTask(null); }}><DialogContent className="jp-source-dialog"><DialogTitle>{liveSource?.title || "跟进任务"}</DialogTitle><span className={`jp-status jp-status-${liveSource?.status === "completed" ? "completed" : "progress"}`}>{liveSource?.status === "completed" ? "已完成" : "待跟进"}</span>{liveSource?.dueAt && <p>计划时间：{new Date(liveSource.dueAt).toLocaleString("zh-CN")}</p>}<p className="jp-source-notes">{liveSource?.notes || "暂无备注"}</p>{taskNotice && <p role="alert">{taskNotice}</p>}{liveSource && <button className="jp-primary" disabled={updateStatus.isPending} onClick={() => void toggleSourceStatus(liveSource)}><Check size={15} />{liveSource.status === "completed" ? "恢复为待跟进" : "标记跟进完成"}</button>}</DialogContent></Dialog>
  </section>;
}
