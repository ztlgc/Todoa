import { useEffect, useRef, useState } from "react";
import { Check, FileText, Plus, Star, Trash2, X } from "lucide-react";
import { emptyJournal, dateKey, parseJournalDraft, summaryMaterials, type JournalInput, type JournalItem, type JournalKind, type JournalRecord } from "@/domain/journal";
import type { Task } from "@/domain/task";
import type { TaskList } from "@/domain/list";
import { useSaveJournal } from "./queries";
import { newWorkItem, WorkItemFields } from "./WorkItemFields";
import { useJournalDraft } from "./useJournalDraft";
import { handwrittenJournal } from "@/domain/journalAutomation";
import { AutomaticTaskEntries } from "./AutomaticTaskEntries";

export const recordNames: Record<JournalKind, string> = { day: "日记", week: "周总结", month: "月总结", year: "年度总结" };
export function JournalEditor({ record, kind, date, initialItemId, records, tasks, tasksPending, tasksError, retryTasks, lists, clients, onDirty, onBusy, onDelete, onClose, onSaved }: {
  record?: JournalRecord; kind: JournalKind; date: string; initialItemId?: string; records: JournalRecord[]; tasks: Task[]; tasksPending: boolean; tasksError: boolean; retryTasks: () => void; lists: TaskList[]; clients: string[];
  onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onDelete: (record: JournalRecord) => Promise<boolean>; onClose: () => void; onSaved: () => void;
}) {
  const save = useSaveJournal();
  const initial = record ? handwrittenJournal(record) : emptyJournal(kind, date);
  const [draft, setDraft] = useState<JournalInput>(initial), [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [revision, setRevision] = useState(record?.revision ?? 0), [notice, setNotice] = useState("");
  const [taskSearch, setTaskSearch] = useState(""), [scope, setScope] = useState("completed");
  const writing = useRef(false), dirty = JSON.stringify(draft) !== baseline;
  const local = useJournalDraft(`editor:${kind}:${initial.start}`, draft, dirty, parseJournalDraft);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onBusy(save.isPending); }, [save.isPending, onBusy]);
  useEffect(() => {
    if (!initialItemId) return;
    const frame = requestAnimationFrame(() => {
      const item = document.getElementById(`journal-item-${encodeURIComponent(initialItemId)}`);
      item?.scrollIntoView?.({ block: "start" }); item?.querySelector("input")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialItemId]);
  useEffect(() => {
    if (record && record.revision !== revision && !dirty && !save.isPending && !writing.current) {
      const manual = handwrittenJournal(record);
      setDraft(manual); setBaseline(JSON.stringify(manual)); setRevision(record.revision);
    }
  }, [record, revision, dirty, save.isPending]);
  function change(patch: Partial<JournalInput>) { setDraft(current => ({ ...current, ...patch })); setNotice(""); }
  function changeItem(id: string, patch: Partial<JournalItem>) { change({ items: draft.items.map(item => item.id === id ? { ...item, ...patch } : item) }); }
  const automatic = record?.items.filter(item => item.origin === "task_auto") ?? [];
  const isCollected = (task: Task) => [...draft.items, ...automatic].some(item => item.taskId === task.id && item.taskCreatedAt === task.createdAt);
  const materials = tasks.filter(task => {
    if (task.deletedAt || !`${task.title}\n${task.notes}`.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase())) return false;
    if (scope === "completed") return task.status === "completed" && !!task.completedAt && dateKey(new Date(task.completedAt)) === date;
    if (task.status !== "todo") return false;
    if (scope === "today") return task.dueDate === date || (!!task.dueAt && dateKey(new Date(task.dueAt)) === date);
    if (scope === "recent") { const dayStart = new Date(`${date}T00:00:00`).getTime(); return new Date(task.updatedAt).getTime() >= dayStart - 6 * 86400000 && new Date(task.updatedAt).getTime() < dayStart + 86400000; }
    return true;
  });
  function addTask(task: Task) {
    if (isCollected(task)) return;
    change({ items: [...draft.items, { ...newWorkItem(), title: task.title, notes: task.notes, taskId: task.id, taskCreatedAt: task.createdAt, completedAt: task.completedAt, status: task.status === "completed" ? "completed" : "progress", activity: "business", occurredAt: task.completedAt, theme: lists.find(list => list.id === task.listId)?.name ?? "" }] });
  }
  async function persist() {
    if (writing.current) return;
    if (local.recovery) { setNotice("请先恢复或舍弃已有草稿。"); return; }
    writing.current = true; setNotice("");
    try { await save.mutateAsync({ input: draft, revision }); setBaseline(JSON.stringify(draft)); setRevision(revision + 1); local.clear(); setNotice("已保存到本地。"); onSaved(); }
    catch (cause) { setNotice(`保存失败：${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { writing.current = false; }
  }
  function appendMaterials() {
    const content = summaryMaterials(records, kind, date);
    if (!content) { setNotice("本期还没有可整理的每日记录。"); return; }
    if (draft.text.includes(content)) { setNotice("这些素材已经在草稿中。"); return; }
    change({ text: `${draft.text}${draft.text ? "\n\n" : ""}${content}` });
  }
  return <div className="jp-editor">
    <header><div><span className="jp-section-label">{recordNames[kind]}编辑</span><p>{draft.start}{kind !== "day" ? ` — ${draft.end}` : " · 客户沟通与业务进展"}</p></div><button type="button" aria-label="收起日记编辑" disabled={save.isPending} onClick={onClose}><X size={19} /></button></header>
    <div className="jp-editor-scroll">
      {local.recovery && <div className="jp-draft-recovery" role="status"><span>发现未保存草稿，恢复后请核对内容</span><button onClick={() => { const value = local.recover(); if (value) setDraft(handwrittenJournal(value)); }}>恢复草稿</button><button onClick={local.clear}>舍弃草稿</button></div>}
      <fieldset disabled={save.isPending}>
        {kind === "day" && <>
          <AutomaticTaskEntries items={automatic} />
          <div className="jp-material-heading"><strong>工作补充 · 手动填写</strong><span>{draft.items.length} 条</span></div>
          {draft.items.map((item, index) => <section className="jp-snapshot" id={`journal-item-${encodeURIComponent(item.id)}`} key={item.id}>
            <div className="jp-snapshot-heading"><strong>事项 {index + 1}</strong><button type="button" aria-label={`移除工作条目${index + 1}`} onClick={() => change({ items: draft.items.filter(value => value.id !== item.id) })}><X size={15} /></button></div>
            <label className="jp-field">事项<input aria-label={`工作条目${index + 1}标题`} maxLength={500} placeholder="本次沟通或业务推进的事项" value={item.title} onChange={event => changeItem(item.id, { title: event.target.value })} /></label>
            <WorkItemFields item={item} onChange={patch => changeItem(item.id, patch)} clients={clients} prefix={`工作条目${index + 1}`} />
            <label className="jp-field">沟通内容 / 阶段进展<textarea aria-label={`工作条目${index + 1}成果说明`} maxLength={20000} placeholder="客户反馈、当前进度与待解决的问题" value={item.notes} onChange={event => changeItem(item.id, { notes: event.target.value })} /></label>
            <div className="jp-snapshot-footer"><label className="jp-check"><input type="checkbox" checked={item.important} aria-label={`工作条目${index + 1}重点成果`} onChange={event => changeItem(item.id, { important: event.target.checked })} /><Star size={13} />重点事项</label><label className="jp-legacy-theme">主题<input aria-label={`工作条目${index + 1}主题`} maxLength={100} value={item.theme} onChange={event => changeItem(item.id, { theme: event.target.value })} /></label></div>
            {item.taskId && <small>来源任务 #{item.taskId}{item.completedAt ? ` · 完成于 ${new Date(item.completedAt).toLocaleString("zh-CN")}` : " · 收录时尚未完成"}</small>}
          </section>)}
          <button type="button" className="jp-secondary" onClick={() => change({ items: [...draft.items, newWorkItem()] })}><Plus size={15} />补充一条工作记录</button>
          <details className="jp-materials"><summary>从任务中收录进展</summary><label className="jp-field">任务范围<select aria-label="任务素材范围" value={scope} onChange={event => setScope(event.target.value)}><option value="completed">当天实际完成</option><option value="today">当天到期的待办</option><option value="recent">最近七天更新的待办</option><option value="all">全部未完成任务</option></select></label><input className="jp-task-search" aria-label="搜索任务素材" placeholder="按客户名或事项搜索任务…" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} />
            <p className="jp-editor-tip">收录时保存历史快照；原任务的后续变化不会改写日记。</p>
            {tasksPending && <p role="status">正在读取任务素材…</p>}{tasksError && <p role="alert">任务素材读取失败。<button onClick={retryTasks}>重试</button></p>}
            {materials.map(task => <div className="jp-material" key={task.id}><span className={`jp-status jp-status-${task.status === "completed" ? "completed" : "progress"}`}>{task.status === "completed" ? "已完成" : "未完成"}</span><span>{task.title}</span><button aria-label={`收录任务：${task.title}`} disabled={isCollected(task)} onClick={() => addTask(task)}>{isCollected(task) ? "已收录" : "收录"}</button></div>)}
            {!tasksPending && !tasksError && !materials.length && <p className="jp-editor-tip">没有符合条件的任务，可直接补充工作记录。</p>}
          </details>
        </>}
        <div className="jp-day-recap">
          <label className="jp-field">{kind === "day" ? "当天标题（可选）" : "总结标题"}<input aria-label="日记标题" placeholder={kind === "day" ? "例如：完成两户续贷资料沟通" : "本期客户维护与业务推进回顾"} maxLength={500} value={draft.title} onChange={event => change({ title: event.target.value })} /></label>
          {kind !== "day" && <button className="jp-secondary" type="button" onClick={appendMaterials}><FileText size={15} />整理本期素材</button>}
          <label className="jp-field">{kind === "day" ? "当天总结（可选）" : recordNames[kind]}<textarea aria-label="总结正文" placeholder={kind === "day" ? "下班前补充今天的收获、问题和明日重点" : "按已完成事项、在途业务、等待与阻塞、下一步跟进整理"} maxLength={200000} value={draft.text} onChange={event => change({ text: event.target.value })} /></label>
          <div className="jp-field-grid"><label className="jp-field">工作主题（可选）<input aria-label="日记主题" maxLength={100} placeholder="例如：四季度客户维护" value={draft.theme} onChange={event => change({ theme: event.target.value })} /></label><label className="jp-check"><input type="checkbox" aria-label="标记整篇记录为重点" checked={draft.important} onChange={event => change({ important: event.target.checked })} /><Star size={14} />整篇标记重点</label></div>
          {kind !== "day" && <p className="jp-editor-tip">素材按每日事项分类，不重复追加周／月总结。内容保留记录时的状态，请核对后形成总结。</p>}
        </div>
      </fieldset>
    </div>
    <footer className="jp-editor-bottom"><p role={notice.startsWith("保存失败") ? "alert" : "status"}>{notice || local.feedback || (dirty ? "有未保存的修改" : "已保存的记录保存在本机")}</p><div>{record && !record.deletedAt && <button type="button" className="jp-delete" disabled={save.isPending} onClick={() => void onDelete({ ...record, revision }).then(deleted => { if (deleted) local.clear(); })}><Trash2 size={15} />删除日记</button>}<button type="button" className="jp-primary" disabled={save.isPending || (!dirty && !!record && !record.deletedAt)} onClick={() => void persist()}><Check size={15} />{save.isPending ? "正在保存…" : `保存${recordNames[kind]}`}</button></div></footer>
  </div>;
}
