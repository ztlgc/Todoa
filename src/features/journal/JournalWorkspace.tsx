import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, Download, FileText, PencilLine, Plus, Search, Sparkles, Star, Trash2, X } from "lucide-react";
import { isBrowserDebug } from "@/app/browserDebug";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { dateKey, emptyJournal, fromKey, isImportant, journalKinds, journalMarkdown, journalMatches, journalPeriod, summaryMaterials, type JournalInput, type JournalItem, type JournalKind, type JournalRecord } from "@/domain/journal";
import type { Task } from "@/domain/task";
import type { TaskList } from "@/domain/list";
import { useTasks } from "@/features/tasks/queries";
import { useLocalClock } from "@/features/tasks/useLocalClock";
import { useJournalRecords, useRemoveJournal, useSaveJournal } from "./queries";
import "./journal-preview.css";

const names: Record<JournalKind, string> = { day: "日", week: "周", month: "月", year: "年" };
const headings: Record<JournalKind, string> = { day: "当日记录", week: "本周记录", month: "月度回顾", year: "年度回顾" };
const recordNames: Record<JournalKind, string> = { day: "日记", week: "周总结", month: "月总结", year: "年度总结" };
const label = (key: string) => fromKey(key).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "操作失败，请重试。";

export function JournalWorkspace({ lists, onDirtyChange, onBusyChange }: { lists: TaskList[]; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const recordsQuery = useJournalRecords(), tasksQuery = useTasks(), remove = useRemoveJournal(), restore = useSaveJournal();
  const now = useLocalClock(), today = dateKey(now);
  const [mode, setMode] = useState<JournalKind>("week");
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [query, setQuery] = useState(""), [theme, setTheme] = useState("");
  const [important, setImportant] = useState(false);
  const [editing, setEditing] = useState<{ kind: JournalKind; key: string } | null>({ kind: "day", key: today });
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [sourceTask, setSourceTask] = useState<Task | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const { confirm, confirmation } = useConfirmDialog();
  const stored = recordsQuery.data ?? [], records = stored.filter(record => !record.deletedAt);
  const period = journalPeriod(mode, selected), anchor = fromKey(selected);
  const periodLabel = mode === "day" ? label(selected) : mode === "week" ? `${period.start} — ${period.end}` : mode === "month" ? `${anchor.getFullYear()}年${anchor.getMonth() + 1}月` : `${anchor.getFullYear()}年`;
  const days = records.filter(record => record.kind === "day");
  const visible = days.filter(record => record.start >= period.start && record.start <= period.end && journalMatches(record, query, theme, important)).sort((a, b) => b.start.localeCompare(a.start));
  const review = records.find(record => record.kind === mode && record.start === period.start);
  const childReviews = records.filter(record => record.kind !== "day" && record.kind !== mode && record.start >= period.start && record.end <= period.end && journalMatches(record, query, theme, important)).sort((a, b) => b.start.localeCompare(a.start));
  const themes = Array.from(new Set(records.flatMap(record => [record.theme, ...record.items.map(item => item.theme)]).filter(Boolean))).sort();
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy || exporting || remove.isPending || restore.isPending); }, [busy, exporting, remove.isPending, restore.isPending, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  async function guard() { return !busy && !exporting && !remove.isPending && !restore.isPending && (!dirty || await confirm("当前日记尚未保存，放弃修改并继续？")); }
  async function open(key: string, kind: JournalKind = "day", scroll = false) {
    if (editing?.kind === kind && journalPeriod(kind, editing.key).start === journalPeriod(kind, key).start) {
      if (scroll) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (!(await guard())) return;
    setDirty(false); setSelected(key); setEditing({ kind, key }); setNotice("");
    if (scroll && window.matchMedia("(max-width:1100px)").matches) requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  async function shift(amount: number) {
    if (!(await guard())) return;
    const next = fromKey(selected);
    if (mode === "year") next.setFullYear(next.getFullYear() + amount);
    else if (mode === "month") next.setMonth(next.getMonth() + amount, 1);
    else next.setDate(next.getDate() + amount * (mode === "week" ? 7 : 1));
    const key = dateKey(next);
    setDirty(false); setSelected(key); setMonth(new Date(next.getFullYear(), next.getMonth(), 1)); setEditing({ kind: "day", key });
  }
  async function changeMode(next: JournalKind) { if (await guard()) { setDirty(false); setMode(next); setEditing(null); } }
  async function erase(record: JournalRecord) {
    if (!(await guard()) || !(await confirm(`删除这份${recordNames[record.kind]}？可在日记回收站恢复，任务不会被删除。`, "删除记录"))) return;
    try { await remove.mutateAsync(record); setDirty(false); setEditing(null); setNotice("记录已移入日记回收站。"); } catch (cause) { setNotice(errorMessage(cause)); }
  }
  async function exportMarkdown() {
    if (dirty) { setNotice("请先保存当前记录，再导出。"); return; }
    setExporting(true); setNotice("");
    try {
      const content = journalMarkdown(records, mode, selected, query, theme, important), filename = `Todoa-工作回顾-${period.start}-${period.end}.md`;
      if (isBrowserDebug()) {
        const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("已下载当前筛选范围的 Markdown。");
      } else { const result = await invoke<string>("export_journal_markdown", { content, filename }); setNotice(result === "cancelled" ? "已取消导出。" : "Markdown 已导出。"); }
    } catch (cause) { setNotice(errorMessage(cause)); } finally { setExporting(false); }
  }
  const offset = (month.getDay() + 6) % 7, count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const [trashOpen, setTrashOpen] = useState(false);
  const editorPeriod = editing ? journalPeriod(editing.kind, editing.key) : null;
  const editorRecord = editorPeriod ? stored.find(record => record.kind === editorPeriod.kind && record.start === editorPeriod.start) : undefined;
  if (recordsQuery.isPending) return <p role="status">正在读取工作日记…</p>;
  if (recordsQuery.isError) return <div role="alert"><p>日记读取失败，未覆盖已有数据。</p><button onClick={() => void recordsQuery.refetch()}>重新读取</button></div>;
  return <section className="jp" aria-label="工作日记">{confirmation}
    <Dialog open={!!sourceTask} onOpenChange={open => { if (!open) setSourceTask(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogTitle>{sourceTask?.title || "原任务"}</DialogTitle><p className="whitespace-pre-wrap text-sm">{sourceTask?.notes || "暂无备注"}</p><p className="text-xs text-muted-foreground">{sourceTask?.status === "completed" ? "已完成" : "未完成"}{sourceTask?.completedAt ? ` · ${new Date(sourceTask.completedAt).toLocaleString("zh-CN")}` : ""}</p></DialogContent></Dialog>
    <aside className="jp-sidebar">
      <div className="jp-brand"><span><BookOpen size={19} /></span><div><strong>工作日记</strong><small>记录当下，回望成长</small></div></div>
      <div className="jp-calendar-heading"><strong>{month.getFullYear()}年 {month.getMonth() + 1}月</strong><div><button aria-label="日历上个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={15} /></button><button aria-label="日历下个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={15} /></button></div></div>
      <div className="jp-calendar">{"一二三四五六日".split("").map(day => <small key={day}>{day}</small>)}{Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: count }, (_, i) => {
        const key = dateKey(new Date(month.getFullYear(), month.getMonth(), i + 1));
        return <button key={key} aria-label={`查看${key}日记`} aria-pressed={key === selected} className={`${key === selected ? "selected" : ""} ${days.some(record => record.start === key) ? "has-entry" : ""}`} onClick={() => void open(key)}>{i + 1}</button>;
      })}</div>
      <button className="jp-today" onClick={() => { void open(today); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>回到今天 <span>{today.slice(5).replace("-", ".")}</span></button>
      <div className="jp-sidebar-section"><small>浏览记录</small><div className="jp-modes">{journalKinds.map(value => <button key={value} aria-pressed={mode === value} onClick={() => void changeMode(value)}>{names[value]}</button>)}</div></div>
      <label className="jp-search"><Search size={15} /><input aria-label="搜索日记" placeholder="搜索记录…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button className={`jp-filter ${important ? "active" : ""}`} aria-pressed={important} onClick={() => setImportant(!important)}><Star size={15} />重点成果<span>{days.reduce((sum, record) => sum + record.items.filter(item => item.important).length + Number(record.important), 0)}</span></button>
      <div className="jp-sidebar-section jp-themes"><small>工作主题</small>{["", ...themes].map(value => <button className={`jp-theme ${theme === value ? "active" : ""}`} key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}><i />{value || "全部主题"}</button>)}</div>
      <button className="jp-filter" onClick={() => setTrashOpen(!trashOpen)} aria-expanded={trashOpen}><Trash2 size={14} />日记回收站</button>

    </aside>
    <div className="jp-workspace">
      <header className="jp-header"><div><div className="jp-eyebrow">WORK JOURNAL <span>{isBrowserDebug() ? "浏览器本地日记" : "本地工作记录"}</span></div><h1 id="inbox-heading" tabIndex={-1}>{headings[mode]}</h1><div className="jp-period"><button aria-label="上一时间段" onClick={() => void shift(-1)}><ChevronLeft size={15} /></button><span>{periodLabel}</span><button aria-label="下一时间段" onClick={() => void shift(1)}><ChevronRight size={15} /></button></div></div><div className="jp-header-actions"><button aria-label="导出当前工作回顾" disabled={exporting || busy} onClick={() => void exportMarkdown()}><Download size={16} /></button><button className="jp-primary" onClick={() => void open(selected, "day", true)}><Plus size={16} />写一笔</button></div></header>
      {notice && <p className="jp-notice" role="status">{notice}</p>}
      <div className="jp-content"><main className="jp-timeline">
        {trashOpen ? <div className="jp-trash"><h2>日记回收站</h2>{stored.filter(record => record.deletedAt).map(record => <div key={`${record.kind}-${record.start}`}><span>{record.start} · {recordNames[record.kind]} · {record.title || "无标题"}</span><button disabled={restore.isPending || busy} onClick={() => { void restore.mutateAsync({ input: record, revision: record.revision }).then(() => setNotice("记录已恢复。")).catch(cause => setNotice(errorMessage(cause))); }}>恢复</button></div>)}{!stored.some(record => record.deletedAt) && <p>回收站为空。</p>}</div> : <>
        <div className="jp-overview"><div><strong>{visible.length}</strong><span>天有记录</span></div><div><strong>{visible.reduce((sum, record) => sum + record.items.length, 0)}</strong><span>项工作进展</span></div><div><strong>{visible.reduce((sum, record) => sum + record.items.filter(item => item.important).length + Number(record.important), 0)}</strong><span>项重点成果</span></div><Sparkles size={22} /></div>
        {mode !== "day" && <div className="jp-review"><div className="jp-review-label"><FileText size={16} /><strong>{recordNames[mode]}</strong>{review && <span>已保存</span>}</div><h2>{review?.title || `给${mode === "year" ? "这一年" : mode === "month" ? "这个月" : "这一周"}留下一份总结`}</h2><p>{review?.text || "回顾本期的工作记录，提炼成果、问题与下一步安排。"}</p><button onClick={() => void open(selected, mode, true)}><PencilLine size={13} />{review ? "编辑" : "撰写"}{recordNames[mode]}<ArrowUpRight size={13} /></button></div>}
        {mode === "year" && <div className="jp-year-months" aria-label="年度月份概览">{Array.from({ length: 12 }, (_, i) => {
          const prefix = `${anchor.getFullYear()}-${String(i + 1).padStart(2, "0")}`, total = days.filter(record => record.start.startsWith(prefix) && journalMatches(record, query, theme, important)).length;
          return <button key={i} onClick={() => { void (async () => { if (!(await guard())) return; setDirty(false); setSelected(`${prefix}-01`); setMonth(new Date(anchor.getFullYear(), i, 1)); setMode("month"); setEditing(null); })(); }}><span>{i + 1}月</span><small>{total ? `${total} 天记录` : "暂无记录"}</small><i className={total ? "filled" : ""} /></button>;
        })}</div>}
        {childReviews.length > 0 && <div className="jp-child-reviews"><h2>阶段总结</h2>{childReviews.map(record => <button key={`${record.kind}-${record.start}`} onClick={() => void open(record.start, record.kind, true)}><FileText size={14} /><span>{record.start} · {recordNames[record.kind]}<strong>{record.title || "无标题"}</strong></span><ArrowUpRight size={14} /></button>)}</div>}
        <div className="jp-list-heading"><span>{mode === "year" ? "年度工作足迹" : "每日工作足迹"}</span><small>最近的记录在前</small></div>
        {visible.map(record => <article key={record.start} className={`jp-entry ${selected === record.start ? "is-selected" : ""}`}><div className="jp-entry-date"><i /><strong>{label(record.start)}</strong>{isImportant(record) && <span><Star size={12} />重点成果</span>}</div><button className="jp-entry-text" onClick={() => void open(record.start, "day", true)}><h2>{record.title || "一天的工作记录"}</h2><p>{record.text}</p></button><ul>{record.items.map(item => <li key={item.id}><span>{item.important ? <Star size={12} /> : <Check size={12} />}</span><div>{item.title}{item.theme && <small className="jp-item-theme">{item.theme}</small>}{item.notes && <p className="jp-item-notes">{item.notes}</p>}</div></li>)}</ul><footer>{record.theme && <span className="jp-tag">{record.theme}</span>}<small>{record.items.length} 项工作进展</small><button aria-label={`编辑${record.start}日记`} onClick={() => void open(record.start, "day", true)}><PencilLine size={14} /></button></footer></article>)}
        {!visible.length && <div className="jp-empty"><BookOpen size={28} /><h2>这段时间还没有符合条件的记录</h2><p>换一个日期或筛选条件，或写下今天的一点进展。</p><button className="jp-primary" onClick={() => void open(selected, "day", true)}><Plus size={15} />写一笔</button></div>}
        <p className="jp-end">慢慢记录，也慢慢看见自己的成长。</p></>}
      </main>
      {editing && <JournalEditor key={`${editing.kind}-${editorPeriod?.start}`} record={editorRecord} kind={editing.kind} date={editing.key} records={records} tasks={tasksQuery.data ?? []} tasksPending={tasksQuery.isPending} tasksError={tasksQuery.isError} retryTasks={() => void tasksQuery.refetch()} lists={lists} onDirty={setDirty} onBusy={setBusy} onDelete={erase} onInspect={setSourceTask} panelRef={editorRef} onClose={() => { void (async () => { if (await guard()) { setDirty(false); setEditing(null); } })(); }} />}
      </div>
    </div>
  </section>;
}

function JournalEditor({ record, kind, date, records, tasks, tasksPending, tasksError, retryTasks, lists, onDirty, onBusy, onDelete, onInspect, onClose, panelRef }: {
  record?: JournalRecord; kind: JournalKind; date: string; records: JournalRecord[]; tasks: Task[]; tasksPending: boolean; tasksError: boolean; retryTasks: () => void; lists: TaskList[]; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onDelete: (record: JournalRecord) => Promise<void>; onInspect: (task: Task) => void; onClose: () => void; panelRef: React.RefObject<HTMLElement | null>;
}) {
  const save = useSaveJournal();
  const initial = record ?? emptyJournal(kind, date);
  const [draft, setDraft] = useState<JournalInput>(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [revision, setRevision] = useState(record?.revision ?? 0);
  const [notice, setNotice] = useState(record?.deletedAt ? "这份记录在回收站，保存后将恢复。" : "");
  const [includePending, setIncludePending] = useState(false), [taskSearch, setTaskSearch] = useState("");
  const writing = useRef(false);
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onBusy(save.isPending); }, [save.isPending, onBusy]);
  useEffect(() => {
    if (record && record.revision !== revision && !dirty && !save.isPending && !writing.current) {
      setDraft(record); setBaseline(JSON.stringify(record)); setRevision(record.revision);
    }
  }, [record, revision, dirty, save.isPending]);
  function change(patch: Partial<JournalInput>) { setDraft(current => ({ ...current, ...patch })); setNotice(""); }
  function changeItem(id: string, patch: Partial<JournalItem>) { change({ items: draft.items.map(item => item.id === id ? { ...item, ...patch } : item) }); }
  const materials = tasks.filter(task => !task.deletedAt && ((task.status === "completed" && task.completedAt && dateKey(new Date(task.completedAt)) === date) || (includePending && task.status === "todo")) && `${task.title}\n${task.notes}`.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()));
  function addTask(task: Task) {
    if (draft.items.some(item => item.taskId === task.id && item.taskCreatedAt === task.createdAt)) return;
    const item: JournalItem = { id: crypto.randomUUID(), title: task.title, notes: task.notes, taskId: task.id, taskCreatedAt: task.createdAt, completedAt: task.completedAt, theme: lists.find(list => list.id === task.listId)?.name ?? "", important: false };
    change({ items: [...draft.items, item] });
  }
  async function persist() {
    if (writing.current) return;
    writing.current = true; setNotice("");
    try {
      await save.mutateAsync({ input: draft, revision });
      setBaseline(JSON.stringify(draft)); setRevision(revision + 1); setNotice("已保存到本地。");
    } catch (cause) { setNotice(`保存失败：${errorMessage(cause)}`); } finally { writing.current = false; }
  }
  function appendMaterials() {
    const content = summaryMaterials(records, kind, date);
    if (!content) { setNotice("本期还没有可整理的记录。"); return; }
    if (draft.text.includes(content)) { setNotice("这些素材已经在草稿中。"); return; }
    change({ text: `${draft.text}${draft.text ? "\n\n" : ""}${content}` });
  }
  return <aside ref={panelRef} className="jp-editor" aria-label="日记编辑"><header><div><small>{recordNames[kind]}编辑</small><h2>{kind === "day" ? label(date) : `${draft.start} — ${draft.end}`}</h2></div><button aria-label="收起日记编辑" disabled={save.isPending} onClick={onClose}><X size={17} /></button></header>
    <fieldset disabled={save.isPending}>
    <label className="jp-field">标题<input aria-label="日记标题" placeholder="为这段工作写一个标题" maxLength={500} value={draft.title} onChange={event => change({ title: event.target.value })} /></label>
    <label className="jp-field">{kind === "day" ? "当天总结" : recordNames[kind]}<textarea aria-label="总结正文" placeholder="记录成果、进展、思考与下一步安排…" maxLength={200000} value={draft.text} onChange={event => change({ text: event.target.value })} /></label>
    <label className="jp-field">工作主题<input aria-label="日记主题" maxLength={100} placeholder="例如：Todoa、客户交付" value={draft.theme} onChange={event => change({ theme: event.target.value })} /></label>
    <label className="jp-important"><input type="checkbox" aria-label="标记整篇记录为重点" checked={draft.important} onChange={event => change({ important: event.target.checked })} /><Star size={13} />标记为重点成果</label>
    {kind === "day" ? <>
      <div className="jp-material-heading"><strong>已收录的工作</strong><span>{draft.items.length} 项</span></div>
      {draft.items.map((item, index) => <div className="jp-snapshot" key={item.id}><div><input aria-label={`工作条目${index + 1}标题`} maxLength={500} value={item.title} onChange={event => changeItem(item.id, { title: event.target.value })} /><button aria-label={`移除工作条目${index + 1}`} onClick={() => change({ items: draft.items.filter(value => value.id !== item.id) })}><X size={13} /></button></div><textarea aria-label={`工作条目${index + 1}成果说明`} maxLength={20000} placeholder="补充具体成果或阶段进展" value={item.notes} onChange={event => changeItem(item.id, { notes: event.target.value })} /><input aria-label={`工作条目${index + 1}主题`} maxLength={100} placeholder="工作主题" value={item.theme} onChange={event => changeItem(item.id, { theme: event.target.value })} /><label className="jp-important"><input type="checkbox" checked={item.important} aria-label={`工作条目${index + 1}重点成果`} onChange={event => changeItem(item.id, { important: event.target.checked })} />重点成果</label>{item.taskId && <small>来自任务 #{item.taskId}{item.completedAt ? ` · 完成于 ${new Date(item.completedAt).toLocaleString("zh-CN")}` : " · 阶段进展"}</small>}{item.taskId && tasks.some(task => task.id === item.taskId && (!item.taskCreatedAt || task.createdAt === item.taskCreatedAt)) && <button className="jp-add-manual" onClick={() => { const source = tasks.find(task => task.id === item.taskId && (!item.taskCreatedAt || task.createdAt === item.taskCreatedAt)); if (source) onInspect(source); }}>查看原任务<ArrowUpRight size={12} /></button>}</div>)}
      <button className="jp-add-manual" onClick={() => change({ items: [...draft.items, { id: crypto.randomUUID(), title: "新的工作进展", notes: "", taskId: null, completedAt: null, theme: draft.theme, important: false }] })}><Plus size={13} />手写一项工作</button>
      <div className="jp-material-heading"><strong>当天工作素材</strong><span>{materials.length} 项</span></div>
      <p className="jp-editor-tip">按实际完成日期展示。收录后保留快照，不随原任务改变。</p>
      <label className="jp-important"><input type="checkbox" checked={includePending} onChange={event => setIncludePending(event.target.checked)} />包含未完成任务</label>
      <input className="jp-task-search" aria-label="搜索任务素材" placeholder="搜索任务素材…" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} />
      {tasksPending && <p role="status">正在读取任务素材…</p>}{tasksError && <p role="alert">任务素材读取失败。<button onClick={retryTasks}>重试</button></p>}
      {materials.map(task => <div className="jp-material" key={task.id}><Check size={14} /><span>{task.title}</span><button aria-label={`收录任务：${task.title}`} disabled={draft.items.some(item => item.taskId === task.id && item.taskCreatedAt === task.createdAt)} onClick={() => addTask(task)}>{draft.items.some(item => item.taskId === task.id && item.taskCreatedAt === task.createdAt) ? <Check size={14} /> : <Plus size={14} />}</button></div>)}
      {!tasksPending && !tasksError && !materials.length && <p className="jp-editor-tip">没有符合条件的任务，可以直接手写工作进展。</p>}
    </> : <><div className="jp-material-heading"><strong>总结素材</strong></div><p className="jp-editor-tip">将本期日记和阶段总结追加到正文，再提炼重点。已有文字会保留。</p><button className="jp-add-manual" onClick={appendMaterials}><FileText size={13} />整理本期素材</button></>}
    </fieldset>
    <div className="jp-editor-bottom"><p role={notice.startsWith("保存失败") ? "alert" : "status"}>{notice || (dirty ? "有未保存的修改。" : "本地保存，按自己的节奏记录。")}</p><button className="jp-primary" disabled={save.isPending || (!dirty && !!record && !record.deletedAt)} onClick={() => void persist()}><Check size={15} />{save.isPending ? "正在保存…" : `保存${recordNames[kind]}`}</button>{record && !record.deletedAt && <button className="jp-delete" disabled={save.isPending} onClick={() => void onDelete({ ...record, revision })}><Trash2 size={13} />删除记录</button>}</div>
  </aside>;
}
