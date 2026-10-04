import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { parseTaskTitle, TaskValidationError, type Task, type TaskFilters } from "@/domain/task";
import type { TaskList } from "@/domain/list";
import type { Tag, TaskTag } from "@/domain/tag";
import { TaskDetails } from "./TaskDetails";
import { useCreateTask, useDeleteTask, useTasks, useUpdateTaskStatus } from "./queries";

function TaskItem({ task, now, onEdit }: { task: Task; now: Date; onEdit: (task: Task, returnTo: HTMLElement | null) => void }) {
  const update = useUpdateTaskStatus(), remove = useDeleteTask();
  const [confirming, setConfirming] = useState(false), [error, setError] = useState<string>();
  const writing = useRef(false), deleteButton = useRef<HTMLButtonElement>(null), cancelButton = useRef<HTMLButtonElement>(null);
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
  return <li className="space-y-3 px-4 py-4" data-task-id={task.id}>
    <div className="flex items-start gap-3">
      <Checkbox checked={task.status === "completed"} onCheckedChange={checked => void changeStatus(checked)} disabled={pending} aria-label={`${task.status === "completed" ? "取消完成" : "完成"}：${task.title}`} className="mt-1" />
      <div className="min-w-0 flex-1 space-y-1">
        <Button variant="ghost" className={`h-auto w-full justify-start whitespace-normal break-all px-0 text-left ${task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}`} aria-label={`编辑任务：${task.title}`} onClick={event => onEdit(task, event.currentTarget)} disabled={pending}>{task.title}</Button>
        {task.status === "completed" && <span className="text-xs text-muted-foreground">已完成</span>}
        {task.notes && <p className="line-clamp-2 break-all whitespace-pre-wrap text-sm text-muted-foreground">{task.notes}</p>}
        {task.dueAt && <p className="text-xs text-muted-foreground"><time dateTime={task.dueAt}>{new Date(task.dueAt).toLocaleString()}</time>{task.status === "todo" && task.dueAt < now.toISOString() && <span className="ml-2 rounded bg-destructive/10 px-2 py-0.5 text-destructive">逾期</span>}</p>}
      </div>
      <Button ref={deleteButton} variant="ghost" size="sm" disabled={pending || confirming} onClick={() => { setConfirming(true); requestAnimationFrame(() => cancelButton.current?.focus()); }} aria-label={`删除：${task.title}`}>删除</Button>
    </div>
    {confirming && <div role="group" aria-label={`确认删除：${task.title}`} className="space-y-3 rounded-lg bg-muted p-3" onKeyDown={event => { if (event.key === "Escape" && !pending) { event.stopPropagation(); setConfirming(false); deleteButton.current?.focus(); } }}>
      <p className="break-all text-sm">永久删除“{task.title}”？此操作无法撤销。</p>
      <div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={pending} onClick={() => void deleteTask()}>{remove.isPending ? "正在删除…" : "永久删除"}</Button><Button ref={cancelButton} variant="outline" disabled={pending} onClick={() => { setConfirming(false); setError(undefined); deleteButton.current?.focus(); }}>取消</Button></div>
    </div>}
    {pending && <p role="status" className="text-xs text-muted-foreground">正在保存…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </li>;
}
export function Inbox() { return <TaskListView listId={null} name="收件箱" />; }
export function TaskListView({ listId, tagId, name, lists = [], listsUnavailable = false, tags, taskTags = [], tagsUnavailable = false, dateFilters, now = new Date(), onDraftChange, onBusyChange, initialDraft = "" }: {
  listId?: number | null; tagId?: number; name: string; lists?: TaskList[]; listsUnavailable?: boolean; tags?: Tag[]; taskTags?: TaskTag[]; tagsUnavailable?: boolean;
  dateFilters?: TaskFilters; now?: Date; onDraftChange?: (dirty: boolean, draft: string) => void; onBusyChange?: (busy: boolean) => void; initialDraft?: string;
}) {
  const tasks = useTasks(dateFilters ?? (tagId === undefined ? { listId } : { tagId })), create = useCreateTask();
  const [draft, setDraft] = useState(initialDraft), [error, setError] = useState<string>();
  const [detail, setDetail] = useState<{ id: number; returnTo: HTMLElement | null }>();
  const composing = useRef(false), submitting = useRef(false);
  const unavailable = tasks.isPending || tasks.isError;
  const canCreate = tagId === undefined && !dateFilters;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (composing.current || submitting.current || unavailable || !canCreate) return;
    let title: string;
    try { title = parseTaskTitle(draft); } catch (cause) { setError(cause instanceof TaskValidationError ? cause.message : "任务标题无效。"); return; }
    submitting.current = true; onBusyChange?.(true); setError(undefined);
    try { await create.mutateAsync(listId == null ? { title } : { title, listId }); setDraft(""); onDraftChange?.(false, ""); }
    catch { setError("新增失败，输入已保留。请稍后重试。"); }
    finally { submitting.current = false; onBusyChange?.(false); }
  }
  return <section aria-labelledby="inbox-heading" className="space-y-6">
    <header className="space-y-2"><h1 id="inbox-heading" tabIndex={-1} className="break-all text-3xl font-semibold tracking-tight outline-none">{name}</h1><p className="text-sm text-muted-foreground">{dateFilters ? "只显示未完成且有截止时间的任务 · 本地日期" : "记录待办，按自己的节奏完成。点击标题编辑详情。"}</p></header>
    {canCreate ? <form aria-label="新增任务" onSubmit={event => void submit(event)} className="space-y-2 rounded-xl border border-border bg-card p-4">
      <label htmlFor="task-title" className="text-sm font-medium">新任务</label>
      <div className="flex flex-wrap gap-2"><Input id="task-title" placeholder="接下来要做什么？" className="min-w-0 flex-1" value={draft} onChange={event => { setDraft(event.target.value); onDraftChange?.(!!event.target.value, event.target.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} disabled={create.isPending || unavailable} aria-invalid={!!error} aria-describedby={error ? "create-error" : undefined} /><Button type="submit" disabled={create.isPending || unavailable}>{create.isPending ? "正在添加…" : "添加任务"}</Button></div>
      {error && <p id="create-error" role="alert" className="text-sm text-destructive">{error}</p>}
    </form> : <p className="text-sm text-muted-foreground">请在收件箱或清单中新建任务。</p>}
    {tasks.isPending && <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在读取{name}…</p>}
    {tasks.isError && <div role="alert" className="space-y-3 rounded-xl border border-border p-4"><p className="text-sm">{name}读取失败。请重试。</p><Button variant="outline" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>重新读取</Button></div>}
    {tasks.isSuccess && tasks.data.length === 0 && <div className="rounded-xl border border-dashed border-border p-10 text-center"><p className="break-all font-medium">{name}为空</p><p className="mt-2 text-sm text-muted-foreground">{canCreate ? "在上方添加第一项任务。" : "当前没有符合筛选条件的任务。"}</p></div>}
    {tasks.isSuccess && tasks.data.length > 0 && <div className="space-y-3"><p role="status" className="text-sm text-muted-foreground">{tasks.data.length} 项任务 · {tasks.data.filter(task => task.status === "completed").length} 项已完成</p><ul aria-label={`${name}任务`} className="divide-y divide-border rounded-xl border border-border bg-card">{tasks.data.map(task => <TaskItem key={task.id} task={task} now={now} onEdit={(value, returnTo) => setDetail({ id: value.id, returnTo })} />)}</ul></div>}
    {detail && <TaskDetails key={detail.id} {...detail} lists={lists} listsUnavailable={listsUnavailable} tags={tags} taskTags={taskTags} tagsUnavailable={tagsUnavailable} onClosed={() => setDetail(undefined)} />}
  </section>;
}
