import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { parseTaskTitle, TaskValidationError, type Task, type TaskFilters } from "@/domain/task";
import { parseNaturalTaskInput, repeatRuleLabel } from "@/domain/naturalTaskInput";
import type { TaskList } from "@/domain/list";
import type { Tag, TaskTag } from "@/domain/tag";
import { TaskDetails } from "./TaskDetails";
import { TaskInputFeedback } from "./TaskInputFeedback";
import { Flag, Trash2 } from "lucide-react";
import { priorityMeta } from "./taskPriority";
import { taskPriorities } from "./taskPriority";
import { useCreateTask, useDeleteTask, useRestoreTask, useTasks, useTrashTask, useUpdateTask, useUpdateTaskStatus } from "./queries";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fromLocalInput, toLocalInput } from "@/domain/taskDates";
import type { TaskPriority } from "@/domain/task";
import { Check } from "lucide-react";

function TaskItem({ task, now, onEdit }: { task: Task; now: Date; onEdit: (task: Task, returnTo: HTMLElement | null) => void }) {
  const priority = priorityMeta(task.priority);
  const update = useUpdateTaskStatus(), updateTask = useUpdateTask(), remove = useTrashTask();
  const [error, setError] = useState<string>();
  const [priorityOpen, setPriorityOpen] = useState(false);
  const writing = useRef(false);
  const dueInput = useRef<HTMLInputElement>(null);
  const pending = update.isPending || remove.isPending;
  async function changeStatus(checked: boolean) {
    if (writing.current) return;
    writing.current = true; setError(undefined);
    const focused = document.activeElement;
    try { await update.mutateAsync({ id: task.id, status: checked ? "completed" : "todo" }); if (!focused?.isConnected) document.getElementById("inbox-heading")?.focus(); }
    catch { setError("状态更改失败，请重试。"); }
    finally { writing.current = false; }
  }
  async function deleteTask() {
    if (writing.current) return;
    writing.current = true; setError(undefined);
    try { await remove.mutateAsync(task.id); document.getElementById("inbox-heading")?.focus(); }
    catch { setError("删除失败，任务仍保留，请重试。"); }
    finally { writing.current = false; }
  }
  async function savePriority(value: TaskPriority) {
    if (pending || updateTask.isPending) return;
    setError(undefined);
    try { await updateTask.mutateAsync({ id: task.id, input: { priority: value } }); setPriorityOpen(false); }
    catch { setError("优先级保存失败，请重试。"); }
  }
  async function saveDue(value: string) {
    if (pending || updateTask.isPending) return;
    setError(undefined);
    try { await updateTask.mutateAsync({ id: task.id, input: { dueAt: fromLocalInput(value) } }); }
    catch { setError("时间保存失败，请重试。"); }
  }
  function openDetails(event: MouseEvent<HTMLLIElement>) {
    if ((event.target as HTMLElement).closest("button,input,[role=checkbox]")) return;
    onEdit(task, event.currentTarget.querySelector<HTMLButtonElement>("[data-task-title]"));
  }
  return <li className="space-y-3 rounded-xl border border-border bg-card px-4 py-4" data-task-id={task.id} onClick={openDetails}>
    <div className="flex items-start gap-3">
      <Checkbox checked={task.status === "completed"} onCheckedChange={checked => void changeStatus(checked)} disabled={pending} aria-label={`${task.status === "completed" ? "取消完成" : "完成"}：${task.title}`} className={`mt-1 ${priority.checkbox}`} />
      <div className="min-w-0 flex-1 space-y-1">
        <Button data-task-title variant="ghost" className={`h-auto w-full justify-start whitespace-normal break-all px-0 text-left ${task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}`} aria-label={`编辑任务：${task.title}`} onClick={event => onEdit(task, event.currentTarget)} disabled={pending}>{task.title}</Button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {task.status === "completed" && <span className="text-muted-foreground">已完成</span>}
          <Button type="button" variant="ghost" size="sm" className={`h-7 shrink-0 gap-1 px-1.5 text-xs ${priority.color}`} aria-label={`更改优先级：${priority.label}`} disabled={pending || updateTask.isPending} onClick={() => setPriorityOpen(true)}><Flag aria-hidden="true" className="size-3.5" fill={priority.value === "none" ? "none" : "currentColor"} />{priority.label}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-1.5 text-xs text-muted-foreground" aria-label={task.dueAt ? `更改时间：${new Date(task.dueAt).toLocaleString()}` : "设置时间"} disabled={pending || updateTask.isPending} onClick={() => { const input = dueInput.current; if (!input) return; if (!input.value) { const next = new Date(); next.setSeconds(0, 0); input.value = toLocalInput(next.toISOString()).slice(0, 16); } try { input.showPicker?.(); } catch { input.focus(); input.click(); } }}>{task.dueAt ? <><time dateTime={task.dueAt}>{new Date(task.dueAt).toLocaleString()}</time>{task.status === "todo" && task.dueAt < now.toISOString() && <span className="ml-2 rounded bg-destructive/10 px-2 py-0.5 text-destructive">逾期</span>}</> : "设置时间"}</Button>
          <input ref={dueInput} type="datetime-local" step="60" aria-label={`截止时间：${task.title}`} className="sr-only" value={toLocalInput(task.dueAt).slice(0, 16)} onChange={event => { if (event.target.value) void saveDue(event.target.value); }} />
          {task.repeatRule && <span className="shrink-0 text-muted-foreground">重复：{repeatRuleLabel(task.repeatRule)}</span>}
        </div>
        {task.notes && <p className="line-clamp-2 break-all whitespace-pre-wrap text-sm text-muted-foreground">{task.notes}</p>}
      </div>
      <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => void deleteTask()} aria-label={`移入回收站：${task.title}`} title="移入回收站"><Trash2 aria-hidden="true" className="size-4" /></Button>
    </div>
    {pending && <p role="status" className="text-xs text-muted-foreground">正在保存…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={priorityOpen} onOpenChange={setPriorityOpen}><DialogContent>
      <DialogTitle>切换任务优先级</DialogTitle>
      <div className="grid gap-2">{taskPriorities.map(option => <Button key={option.value} type="button" variant="outline" className={`justify-between ${option.color}`} onClick={() => void savePriority(option.value)} disabled={pending || updateTask.isPending}>{option.label}{priority.value === option.value && <Check aria-label="当前优先级" className="size-4" />}</Button>)}</div>
    </DialogContent></Dialog>
  </li>;
}
export function Inbox() { return <TaskListView listId={null} name="收件箱" />; }
export function TaskListView({ listId, tagId, name, lists = [], listsUnavailable = false, tags, taskTags = [], tagsUnavailable = false, dateFilters, now = new Date(), onDraftChange, onBusyChange, onDetailDirtyChange, initialDraft = "" }: {
  listId?: number | null; tagId?: number; name: string; lists?: TaskList[]; listsUnavailable?: boolean; tags?: Tag[]; taskTags?: TaskTag[]; tagsUnavailable?: boolean;
  dateFilters?: TaskFilters; now?: Date; onDraftChange?: (dirty: boolean, draft: string) => void; onBusyChange?: (busy: boolean) => void; onDetailDirtyChange?: (dirty: boolean) => void; initialDraft?: string;
}) {
  const tasks = useTasks(dateFilters ?? (tagId === undefined ? { listId } : { tagId })), create = useCreateTask();
  const [draft, setDraft] = useState(initialDraft), [error, setError] = useState<string>();
  const [ignoreRecognition, setIgnoreRecognition] = useState(false);
  const [detail, setDetail] = useState<{ id: number; returnTo: HTMLElement | null }>();
  const detailDirty = useRef(false);
  const { confirm: confirmSwitch, confirmation: switchConfirmation } = useConfirmDialog();
  const composing = useRef(false), submitting = useRef(false);
  const unavailable = tasks.isPending || tasks.isError;
  const canCreate = tagId === undefined && !dateFilters;
  const analysis = draft.trim() ? parseNaturalTaskInput(draft, now) : null;
  const parsed = ignoreRecognition ? null : analysis;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (composing.current || submitting.current || unavailable || !canCreate) return;
    let title: string;
    try { title = parseTaskTitle(parsed?.title ?? draft); } catch (cause) { setError(cause instanceof TaskValidationError ? cause.message : "任务标题无效。"); return; }
    submitting.current = true; onBusyChange?.(true); setError(undefined);
    try { await create.mutateAsync({ title, ...(listId == null ? {} : { listId }), ...(parsed?.dueAt ? { dueAt: parsed.dueAt } : {}), ...(parsed?.repeatRule ? { repeatRule: parsed.repeatRule } : {}), ...(parsed?.remindAt.length ? { remindAt: parsed.remindAt, reminderOffsets: parsed.reminderOffsets } : {}) }); setDraft(""); setIgnoreRecognition(false); onDraftChange?.(false, ""); }
    catch (cause) { setError(cause === "REMINDER_MUST_BE_FUTURE" || (cause instanceof Error && cause.message.includes("提醒时间")) ? "提醒时间已过去，请调整输入的日期或时间。" : "新增失败，输入已保留。请稍后重试。"); }
    finally { submitting.current = false; onBusyChange?.(false); }
  }
  return <section aria-labelledby="inbox-heading" className={`space-y-6 ${detail ? "min-[1100px]:pr-[min(456px,38vw)]" : ""}`}>
    {switchConfirmation}
    <header className="space-y-2"><h1 id="inbox-heading" tabIndex={-1} className="break-all text-3xl font-semibold tracking-tight outline-none">{name}</h1><p className="text-sm text-muted-foreground">{dateFilters?.status === "completed" ? "显示收件箱和所有清单中已完成的任务。" : dateFilters ? "只显示未完成且有截止时间的任务 · 本地日期" : "记录待办，按自己的节奏完成。点击标题编辑详情。"}</p></header>
    {canCreate ? <form aria-label="新增任务" onSubmit={event => void submit(event)} className="space-y-2 rounded-xl border border-border bg-card p-4">
      <label htmlFor="task-title" className="sr-only">新任务</label>
      <div className="flex flex-wrap gap-2"><Input id="task-title" placeholder="例如：明天下午3点开会" className="min-w-0 flex-1" value={draft} onChange={event => { setDraft(event.target.value); setIgnoreRecognition(false); onDraftChange?.(!!event.target.value, event.target.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} disabled={create.isPending || unavailable} aria-invalid={!!error} aria-describedby={error ? "create-error" : undefined} /><Button type="submit" disabled={create.isPending || unavailable}>{create.isPending ? "正在添加…" : "添加任务"}</Button></div>
      <TaskInputFeedback draft={draft} parsed={parsed} ignoreRecognition={ignoreRecognition} onIgnoreChange={setIgnoreRecognition} />
      {error && <p id="create-error" role="alert" className="text-sm text-destructive">{error}</p>}
    </form> : dateFilters?.status === "completed" ? null : <p className="text-sm text-muted-foreground">请在收件箱或清单中新建任务。</p>}
    {tasks.isPending && <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在读取{name}…</p>}
    {tasks.isError && <div role="alert" className="space-y-3 rounded-xl border border-border p-4"><p className="text-sm">{name}读取失败。请重试。</p><Button variant="outline" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>重新读取</Button></div>}
    {tasks.isSuccess && tasks.data.length === 0 && <div className="rounded-xl border border-dashed border-border p-10 text-center"><p className="break-all font-medium">{name}为空</p><p className="mt-2 text-sm text-muted-foreground">{canCreate ? "在上方添加第一项任务。" : "当前没有符合筛选条件的任务。"}</p></div>}
    {tasks.isSuccess && tasks.data.length > 0 && <div className="space-y-3"><p role="status" className="text-sm text-muted-foreground">{tasks.data.length} 项任务 · {tasks.data.filter(task => task.status === "completed").length} 项已完成</p><ul aria-label={`${name}任务`} className="space-y-2">{tasks.data.map(task => <TaskItem key={task.id} task={task} now={now} onEdit={(value, returnTo) => { void (async () => { if (detail?.id === value.id) return; if (detailDirty.current && !(await confirmSwitch("当前任务详情尚未保存。放弃修改并打开另一项任务？"))) return; detailDirty.current = false; onDetailDirtyChange?.(false); setDetail({ id: value.id, returnTo }); })(); }} />)}</ul></div>}
    {detail && <TaskDetails key={detail.id} {...detail} lists={lists} listsUnavailable={listsUnavailable} tags={tags} taskTags={taskTags} tagsUnavailable={tagsUnavailable} onDirtyChange={value => { detailDirty.current = value; onDetailDirtyChange?.(value); }} onClosed={() => setDetail(undefined)} />}
  </section>;
}

export function TrashView() {
  const tasks = useTasks({ deleted: true });
  return <section aria-labelledby="inbox-heading" className="space-y-6">
    <header className="space-y-2"><h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">回收站</h1><p className="text-sm text-muted-foreground">移入回收站的任务可以恢复；永久删除会同时移除关联的标签和提醒。</p></header>
    {tasks.isPending && <p role="status">正在读取回收站…</p>}
    {tasks.isError && <div role="alert">回收站读取失败。<Button variant="outline" onClick={() => void tasks.refetch()}>重新读取</Button></div>}
    {tasks.isSuccess && tasks.data.length === 0 && <p className="rounded-xl border border-dashed p-10 text-center">回收站为空</p>}
    {tasks.isSuccess && tasks.data.length > 0 && <ul aria-label="回收站任务" className="divide-y rounded-xl border bg-card">{tasks.data.map(task => <TrashItem key={task.id} task={task} />)}</ul>}
  </section>;
}

function TrashItem({ task }: { task: Task }) {
  const restore = useRestoreTask(), remove = useDeleteTask();
  const [confirming, setConfirming] = useState(false), [error, setError] = useState<string>();
  const deleteButton = useRef<HTMLButtonElement>(null), cancelButton = useRef<HTMLButtonElement>(null);
  const pending = restore.isPending || remove.isPending;
  async function act(action: "restore" | "delete") {
    setError(undefined);
    try { await (action === "restore" ? restore : remove).mutateAsync(task.id); document.getElementById("inbox-heading")?.focus(); }
    catch { setError(action === "restore" ? "恢复失败，请重试。" : "永久删除失败，请重试。"); }
  }
  return <li className="space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="break-all font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{task.deletedAt && `移入时间：${new Date(task.deletedAt).toLocaleString()}`}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={pending} onClick={() => void act("restore")}>恢复</Button><Button ref={deleteButton} variant="ghost" size="sm" disabled={pending || confirming} onClick={() => { setConfirming(true); requestAnimationFrame(() => cancelButton.current?.focus()); }}>永久删除</Button></div></div>
    {confirming && <div role="group" aria-label={`确认永久删除：${task.title}`} className="space-y-3 rounded-lg bg-muted p-3" onKeyDown={event => { if (event.key === "Escape" && !pending) { event.stopPropagation(); setConfirming(false); deleteButton.current?.focus(); } }}><p className="break-all text-sm">永久删除“{task.title}”？任务及关联的标签和提醒将被删除，此操作无法撤销。</p><div className="flex gap-2"><Button variant="destructive" disabled={pending} onClick={() => void act("delete")}>{remove.isPending ? "正在删除…" : "确认永久删除"}</Button><Button ref={cancelButton} variant="outline" disabled={pending} onClick={() => { setConfirming(false); deleteButton.current?.focus(); }}>取消</Button></div></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </li>;
}
