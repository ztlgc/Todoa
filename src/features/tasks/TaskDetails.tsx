import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { parseUpdateTaskInput, type Task } from "@/domain/task";
import { fromLocalInput, toLocalInput } from "@/domain/taskDates";
import type { TaskList } from "@/domain/list";
import type { Tag, TaskTag } from "@/domain/tag";
import { TaskTags } from "@/features/tags/TaskTags";
import { TaskReminders } from "@/features/reminders/TaskReminders";
import { useTask, useUpdateTask } from "./queries";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

export function TaskDetails({ id, lists, listsUnavailable, tags, taskTags, tagsUnavailable, returnTo, onClosed }: {
  id: number; lists: TaskList[]; listsUnavailable: boolean; tags?: Tag[]; taskTags: TaskTag[]; tagsUnavailable: boolean;
  returnTo: HTMLElement | null; onClosed: () => void;
}) {
  const query = useTask(id);
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const dirty = useRef(false), busy = useRef(false), composing = useRef(false);
  const initialFocus = useRef<HTMLInputElement>(null);
  const close = () => { if (busy.current || composing.current) return; if (dirty.current) setConfirming(true); else setOpen(false); };
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }} onOpenChangeComplete={next => { if (!next) onClosed(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" initialFocus={initialFocus}
      finalFocus={() => returnTo?.isConnected ? returnTo : document.getElementById("inbox-heading")}
      showCloseButton={false} onKeyDownCapture={event => { if ((event.key === "Escape" || event.key === "Enter") && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); } }}>
      <div className="flex items-center justify-between gap-3"><DialogTitle>任务详情</DialogTitle><DialogClose render={<Button variant="ghost" aria-label="关闭任务详情" />}>关闭</DialogClose></div>
      <DialogDescription>编辑内容以本地时间显示，保存后生效。备注为纯文本。</DialogDescription>
      {query.isPending && <p role="status">正在读取任务详情…</p>}
      {query.isError && <div role="alert">详情读取失败。<Button onClick={() => void query.refetch()}>重试详情</Button></div>}
      {query.isSuccess && !query.data && <p role="alert">任务已被删除。</p>}
      {query.data && <TaskEditor task={query.data} lists={lists} listsUnavailable={listsUnavailable} tags={tags} taskTags={taskTags} tagsUnavailable={tagsUnavailable}
        initialFocus={initialFocus} dirty={dirty} busy={busy} composing={composing} onSaved={() => { dirty.current = false; setOpen(false); }} />}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}><DialogTitle>放弃未保存的修改？</DialogTitle><DialogDescription>任务与提醒输入尚未保存。可以继续编辑，或放弃输入并关闭。</DialogDescription>
          <Button onClick={() => setConfirming(false)}>继续编辑</Button>
          <Button variant="destructive" onClick={() => { dirty.current = false; setConfirming(false); setOpen(false); }}>放弃修改并关闭</Button>
        </DialogContent>
      </Dialog>
    </DialogContent>
  </Dialog>;
}

function TaskEditor({ task, lists, listsUnavailable, tags, taskTags, tagsUnavailable, initialFocus, dirty, busy, composing, onSaved }: {
  task: Task; lists: TaskList[]; listsUnavailable: boolean; tags?: Tag[]; taskTags: TaskTag[]; tagsUnavailable: boolean;
  initialFocus: React.RefObject<HTMLInputElement | null>; dirty: React.RefObject<boolean>; busy: React.RefObject<boolean>; composing: React.RefObject<boolean>; onSaved: () => void;
}) {
  const [baseline, setBaseline] = useState(task);
  const [baselineDue, setBaselineDue] = useState(() => toLocalInput(task.dueAt));
  const [title, setTitle] = useState(task.title), [notes, setNotes] = useState(task.notes), [due, setDue] = useState(toLocalInput(task.dueAt)), [listId, setListId] = useState(task.listId);
  const [error, setError] = useState<string>(); const [reminderDirty, setReminderDirty] = useState(false);
  const [draftZone, setDraftZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const update = useUpdateTask();
  const { confirm, confirmation } = useConfirmDialog();
  const childBusy = useRef({ tags: false, reminders: false });
  function setBusy(child: "tags" | "reminders", value: boolean) {
    childBusy.current[child] = value;
    busy.current = update.isPending || childBusy.current.tags || childBusy.current.reminders;
  }
  useEffect(() => { initialFocus.current?.focus(); }, [initialFocus]);
  function changed(values: { title?: string; notes?: string; due?: string; listId?: number | null } = {}, reminder = reminderDirty) {
    dirty.current = reminder || (values.title ?? title) !== baseline.title || (values.notes ?? notes) !== baseline.notes || (values.due ?? due) !== baselineDue || (values.listId === undefined ? listId : values.listId) !== baseline.listId;
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy.current || composing.current) return;
    if (zone !== draftZone) { setError("系统时区已改变，请先核对本地截止时间并采用当前时区。"); return; }
    if (reminderDirty) { setError("请先保存或清空提醒输入，再保存任务。"); return; }
    let input;
    try { input = parseUpdateTaskInput({ title, notes, dueAt: due === baselineDue ? baseline.dueAt : fromLocalInput(due), listId }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "输入无效。"); return; }
    busy.current = true; setError(undefined);
    try { await update.mutateAsync({ id: task.id, input }); onSaved(); }
    catch { setError("保存失败，草稿已保留。请重试。"); }
    finally { busy.current = false; }
  }
  const ime = { onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; } };
  return <div className="space-y-5">
    {confirmation}
    {zone !== draftZone && <div role="alert" className="space-y-2 rounded border p-3"><p>系统时区已改变，当前截止时间输入仍来自 {draftZone}。请核对后采用 {zone}；任务标题和备注保留。</p><Button variant="outline" onClick={() => { const next = toLocalInput(baseline.dueAt); if (due === baselineDue) setDue(next); setBaselineDue(next); setDraftZone(zone); dirty.current = reminderDirty || title !== baseline.title || notes !== baseline.notes || due !== baselineDue || listId !== baseline.listId; }}>采用当前时区</Button></div>}
    {task.updatedAt !== baseline.updatedAt && <p role="status" className="rounded-md bg-muted p-3">任务已更新，草稿保留。保存将采用当前输入。<Button variant="outline" onClick={async () => {
      if (dirty.current && !(await confirm("放弃当前任务输入并重新读取已保存内容？"))) return;
      setBaseline(task); setTitle(task.title); setNotes(task.notes); setDue(toLocalInput(task.dueAt)); setBaselineDue(toLocalInput(task.dueAt)); setDraftZone(zone); setListId(task.listId); dirty.current = reminderDirty;
    }}>重新载入内容</Button></p>}
    <form aria-label="编辑任务" onSubmit={event => void save(event)} className="space-y-4">
      <div className="space-y-2"><label htmlFor="edit-task-title">任务标题</label><Input ref={initialFocus} id="edit-task-title" value={title} disabled={update.isPending} {...ime} onChange={event => { setTitle(event.target.value); changed({ title: event.target.value }); }} /></div>
      <div className="space-y-2"><label htmlFor="edit-task-notes">备注</label><Textarea id="edit-task-notes" value={notes} disabled={update.isPending} {...ime} className="min-h-28" onChange={event => { setNotes(event.target.value); changed({ notes: event.target.value }); }} /></div>
      <div className="space-y-2"><label htmlFor="edit-task-due">截止日期与时间（本地时间）</label><Input id="edit-task-due" type="datetime-local" step="0.001" value={due} disabled={update.isPending} onChange={event => { setDue(event.target.value); changed({ due: event.target.value }); }} />
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={update.isPending || !due} onClick={() => { setDue(""); changed({ due: "" }); }}>清空截止时间</Button><span className="text-xs text-muted-foreground">{Intl.DateTimeFormat().resolvedOptions().timeZone} · 夏令时重叠时，修改后的输入取较早时刻。</span></div>
      </div>
      <div className="space-y-2"><label htmlFor="edit-task-list">所属清单</label><select id="edit-task-list" className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={listId ?? "inbox"} disabled={update.isPending || listsUnavailable} onChange={event => { const next = event.target.value === "inbox" ? null : Number(event.target.value); setListId(next); changed({ listId: next }); }}><option value="inbox">收件箱</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button type="submit" disabled={update.isPending || listsUnavailable}>{update.isPending ? "正在保存…" : "保存任务"}</Button>
    </form>
    <div className="space-y-3 border-t pt-3">
      <h3 className="font-medium">标签与提醒</h3>
      {tags && !tagsUnavailable ? <TaskTags task={task} tags={tags} assignedIds={taskTags.filter(link => link.taskId === task.id).map(link => link.tagId)} disabled={update.isPending} onBusyChange={value => setBusy("tags", value)} /> : <p className="text-muted-foreground">标签暂不可用，请在标签视图重试读取。</p>}
      <TaskReminders task={task} disabled={update.isPending} onDraftChange={value => { setReminderDirty(value); changed({}, value); }} onBusyChange={value => setBusy("reminders", value)} />
      <p className="text-xs text-muted-foreground">标签与提醒操作各自即时保存。</p>
    </div>
  </div>;
}
