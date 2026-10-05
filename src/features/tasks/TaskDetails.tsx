import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { parseUpdateTaskInput, type Task } from "@/domain/task";
import { fromLocalInput, toLocalInput } from "@/domain/taskDates";
import type { TaskList } from "@/domain/list";
import type { Tag, TaskTag } from "@/domain/tag";
import { TaskTags } from "@/features/tags/TaskTags";
import { TaskReminders } from "@/features/reminders/TaskReminders";
import { useDeleteTask, useTask, useUpdateTask, useUpdateTaskStatus } from "./queries";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

const toMinuteInput = (utc: string | null) => toLocalInput(utc).slice(0, 16);

export function TaskDetails({ id, lists, listsUnavailable, tags, taskTags, tagsUnavailable, returnTo, onClosed, onDirtyChange }: {
  id: number; lists: TaskList[]; listsUnavailable: boolean; tags?: Tag[]; taskTags: TaskTag[]; tagsUnavailable: boolean;
  returnTo: HTMLElement | null; onClosed: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const query = useTask(id);
  const statusMutation = useUpdateTaskStatus(), deleteMutation = useDeleteTask();
  const [open, setOpen] = useState(true);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(min-width: 1100px)");
    const update = () => setWide(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const dirty = useRef(false), busy = useRef(false), composing = useRef(false);
  const closing = useRef(false);
  const aside = useRef<HTMLElement>(null);
  const replayTarget = useRef<HTMLElement | null>(null);
  const initialFocus = useRef<HTMLInputElement>(null);
  const finishClose = () => { if (closing.current) return; closing.current = true; onDirtyChange?.(false); onClosed(); requestAnimationFrame(() => { const target = replayTarget.current; replayTarget.current = null; if (target?.isConnected) target.click(); else (returnTo?.isConnected ? returnTo : document.getElementById("inbox-heading"))?.focus(); }); };
  const dismiss = () => { if (wide) finishClose(); else setOpen(false); };
  const close = () => { if (busy.current || composing.current) return; if (dirty.current) document.querySelector<HTMLFormElement>('form[aria-label="编辑任务"]')?.requestSubmit(); else dismiss(); };
  useEffect(() => {
    if (!wide) return;
    function outsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node) || closing.current || aside.current?.contains(target) || document.querySelector('[data-slot="dialog-content"]')) return;
      event.preventDefault(); event.stopPropagation();
      if (busy.current || composing.current) return;
      const element = target instanceof Element ? target : target.parentElement;
      replayTarget.current = element?.closest<HTMLElement>('button, a, input, select, [role="button"]') ?? null;
      close();
    }
    document.addEventListener("click", outsideClick, true);
    return () => document.removeEventListener("click", outsideClick, true);
  });
  const keyGuard = (event: React.KeyboardEvent) => {
    if ((event.key === "Escape" || event.key === "Enter") && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); return; }
    if (wide && event.key === "Escape") { event.preventDefault(); close(); }
  };
  async function changeStatus(checked: boolean) {
    if (busy.current || statusMutation.isPending || deleteMutation.isPending) return;
    setActionError(undefined);
    try { await statusMutation.mutateAsync({ id, status: checked ? "completed" : "todo" }); }
    catch { setActionError("任务状态更改失败，请重试。"); }
  }
  async function deleteTask() {
    if (busy.current || deleteMutation.isPending) return;
    busy.current = true;
    setActionError(undefined);
    try {
      await deleteMutation.mutateAsync(id);
      dirty.current = false;
      setConfirmingDelete(false);
      dismiss();
    } catch { setActionError("删除失败，任务仍保留，请重试。"); setConfirmingDelete(false); }
    finally { busy.current = false; }
  }
  const heading = (draftTitle ?? query.data?.title)?.trim() || "任务详情";
  const content = <>
      <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2">{query.data && <Checkbox checked={query.data.status === "completed"} disabled={statusMutation.isPending || deleteMutation.isPending} onCheckedChange={checked => void changeStatus(checked)} aria-label={query.data.status === "completed" ? "取消完成任务" : "完成任务"} />}{wide ? <h2 className="truncate font-medium" title={heading}>{heading}</h2> : <DialogTitle className="truncate" title={heading}>{heading}</DialogTitle>}</div><Button variant="ghost" aria-label="关闭任务详情" onClick={close}>关闭</Button></div>
      {wide ? <p className="text-muted-foreground">编辑内容以本地时间显示，离开详情时自动保存。备注为纯文本。</p> : <DialogDescription>编辑内容以本地时间显示，离开详情时自动保存。备注为纯文本。</DialogDescription>}
      {query.isPending && <p role="status">正在读取任务详情…</p>}
      {query.isError && <div role="alert">详情读取失败。<Button onClick={() => void query.refetch()}>重试详情</Button></div>}
      {query.isSuccess && !query.data && <p role="alert">任务已被删除。</p>}
      {query.data && <TaskEditor task={query.data} lists={lists} listsUnavailable={listsUnavailable} tags={tags} taskTags={taskTags} tagsUnavailable={tagsUnavailable}
        initialFocus={initialFocus} dirty={dirty} busy={busy} composing={composing} onTitleChange={setDraftTitle} onDirtyChange={onDirtyChange} onSaveFailed={() => { replayTarget.current = null; }} onSaved={() => { dirty.current = false; onDirtyChange?.(false); dismiss(); }} />}
      {query.data && <div className="border-t pt-4"><Button variant="destructive" disabled={deleteMutation.isPending || statusMutation.isPending} onClick={() => setConfirmingDelete(true)}>永久删除任务</Button></div>}
      {actionError && <p role="alert" className="text-destructive">{actionError}</p>}
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent showCloseButton={false}><DialogTitle>永久删除任务？</DialogTitle><DialogDescription>任务及关联的标签关系、提醒将被删除，此操作无法撤销。未保存的任务输入也会丢失。</DialogDescription>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={deleteMutation.isPending} onClick={() => setConfirmingDelete(false)}>取消</Button><Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => void deleteTask()}>{deleteMutation.isPending ? "正在删除…" : "永久删除"}</Button></div>
        </DialogContent>
      </Dialog>
    </>;
  return wide ? <aside ref={aside} aria-label="任务详情" className="fixed inset-y-0 right-0 z-20 w-[min(440px,36vw)] min-w-80 overflow-y-auto border-l bg-popover p-4 text-sm shadow-xl" onKeyDownCapture={keyGuard}>{content}</aside>
    : <Dialog open={open} onOpenChange={next => { if (!next) close(); }} onOpenChangeComplete={next => { if (!next) finishClose(); }}>
      <DialogContent layout="inspector" initialFocus={initialFocus} finalFocus={() => returnTo?.isConnected ? returnTo : document.getElementById("inbox-heading")} showCloseButton={false} onKeyDownCapture={keyGuard}>{content}</DialogContent>
    </Dialog>;
}

function TaskEditor({ task, lists, listsUnavailable, tags, taskTags, tagsUnavailable, initialFocus, dirty, busy, composing, onSaved, onSaveFailed, onTitleChange, onDirtyChange }: {
  task: Task; lists: TaskList[]; listsUnavailable: boolean; tags?: Tag[]; taskTags: TaskTag[]; tagsUnavailable: boolean;
  initialFocus: React.RefObject<HTMLInputElement | null>; dirty: React.RefObject<boolean>; busy: React.RefObject<boolean>; composing: React.RefObject<boolean>; onSaved: () => void; onSaveFailed: () => void; onTitleChange: (title: string) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [baseline, setBaseline] = useState(task);
  const [baselineDue, setBaselineDue] = useState(() => toMinuteInput(task.dueAt));
  const [title, setTitle] = useState(task.title), [notes, setNotes] = useState(task.notes), [due, setDue] = useState(toMinuteInput(task.dueAt)), [listId, setListId] = useState(task.listId);
  const [error, setError] = useState<string>(); const [reminderDirty, setReminderDirty] = useState(false);
  const [draftZone, setDraftZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const update = useUpdateTask();
  const saveReminder = useRef<(() => Promise<boolean>) | null>(null);
  const { confirm, confirmation } = useConfirmDialog();
  const childBusy = useRef({ tags: false, reminders: false });
  function setBusy(child: "tags" | "reminders", value: boolean) {
    childBusy.current[child] = value;
    busy.current = update.isPending || childBusy.current.tags || childBusy.current.reminders;
  }
  useEffect(() => { initialFocus.current?.focus(); }, [initialFocus]);
  function changed(values: { title?: string; notes?: string; due?: string; listId?: number | null } = {}, reminder = reminderDirty) {
    dirty.current = reminder || (values.title ?? title) !== baseline.title || (values.notes ?? notes) !== baseline.notes || (values.due ?? due) !== baselineDue || (values.listId === undefined ? listId : values.listId) !== baseline.listId;
    onDirtyChange?.(dirty.current);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy.current || composing.current) return;
    if (zone !== draftZone) { setError("系统时区已改变，请先核对本地截止时间并采用当前时区。"); onSaveFailed(); return; }
    if (reminderDirty && !(await saveReminder.current?.())) { setError("提醒未能保存，草稿已保留。请检查提醒输入。"); onSaveFailed(); return; }
    let input;
    try { input = parseUpdateTaskInput({ title, notes, dueAt: due === baselineDue ? baseline.dueAt : fromLocalInput(due), listId }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "输入无效。"); onSaveFailed(); return; }
    busy.current = true; setError(undefined);
    try { await update.mutateAsync({ id: task.id, input }); onSaved(); }
    catch { setError("保存失败，草稿已保留。请重试。"); onSaveFailed(); }
    finally { busy.current = false; }
  }
  const ime = { onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; } };
  return <div className="space-y-5">
    {confirmation}
    {zone !== draftZone && <div role="alert" className="space-y-2 rounded border p-3"><p>系统时区已改变，当前截止时间输入仍来自 {draftZone}。请核对后采用 {zone}；任务标题和备注保留。</p><Button variant="outline" onClick={() => { const next = toMinuteInput(baseline.dueAt); if (due === baselineDue) setDue(next); setBaselineDue(next); setDraftZone(zone); dirty.current = reminderDirty || title !== baseline.title || notes !== baseline.notes || due !== baselineDue || listId !== baseline.listId; onDirtyChange?.(dirty.current); }}>采用当前时区</Button></div>}
    {(task.title !== baseline.title || task.notes !== baseline.notes || task.dueAt !== baseline.dueAt || task.listId !== baseline.listId) && <p role="status" className="rounded-md bg-muted p-3">任务已更新，草稿保留。保存将采用当前输入。<Button variant="outline" onClick={async () => {
      if (dirty.current && !(await confirm("放弃当前任务输入并重新读取已保存内容？"))) return;
      setBaseline(task); setTitle(task.title); onTitleChange(task.title); setNotes(task.notes); setDue(toMinuteInput(task.dueAt)); setBaselineDue(toMinuteInput(task.dueAt)); setDraftZone(zone); setListId(task.listId); dirty.current = reminderDirty; onDirtyChange?.(dirty.current);
    }}>重新载入内容</Button></p>}
    <form aria-label="编辑任务" onSubmit={event => void save(event)} className="space-y-4">
      <div className="space-y-2"><label htmlFor="edit-task-title">任务标题</label><Input ref={initialFocus} id="edit-task-title" value={title} disabled={update.isPending} {...ime} onChange={event => { setTitle(event.target.value); onTitleChange(event.target.value); changed({ title: event.target.value }); }} /></div>
      <div className="space-y-2"><label htmlFor="edit-task-notes">备注</label><Textarea id="edit-task-notes" value={notes} disabled={update.isPending} {...ime} className="min-h-28" onChange={event => { setNotes(event.target.value); changed({ notes: event.target.value }); }} /></div>
      <div className="space-y-2"><label htmlFor="edit-task-due">截止日期与时间（本地时间）</label><Input id="edit-task-due" type="datetime-local" step="60" value={due} disabled={update.isPending} onClick={event => { try { event.currentTarget.showPicker?.(); } catch { /* Keep native field editing available. */ } }} onChange={event => { setDue(event.target.value); changed({ due: event.target.value }); }} />
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={update.isPending || !due} onClick={() => { setDue(""); changed({ due: "" }); }}>清空截止时间</Button><span className="text-xs text-muted-foreground">{Intl.DateTimeFormat().resolvedOptions().timeZone} · 夏令时重叠时，修改后的输入取较早时刻。</span></div>
      </div>
      <div className="space-y-2"><label htmlFor="edit-task-list">所属清单</label><select id="edit-task-list" className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={listId ?? "inbox"} disabled={update.isPending || listsUnavailable} onChange={event => { const next = event.target.value === "inbox" ? null : Number(event.target.value); setListId(next); changed({ listId: next }); }}><option value="inbox">收件箱</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button type="submit" disabled={update.isPending || listsUnavailable}>{update.isPending ? "正在保存…" : "保存任务"}</Button>
    </form>
    <div className="space-y-3 border-t pt-3">
      <h3 className="font-medium">标签与提醒</h3>
      {tags && !tagsUnavailable ? <TaskTags task={task} tags={tags} assignedIds={taskTags.filter(link => link.taskId === task.id).map(link => link.tagId)} disabled={update.isPending} onBusyChange={value => setBusy("tags", value)} /> : <p className="text-muted-foreground">标签暂不可用，请在标签视图重试读取。</p>}
      <TaskReminders task={task} disabled={update.isPending} onDraftChange={value => { setReminderDirty(value); changed({}, value); }} onBusyChange={value => setBusy("reminders", value)} onRegisterDraftSave={save => { saveReminder.current = save; }} />
      <p className="text-xs text-muted-foreground">标签与提醒操作各自即时保存。</p>
    </div>
  </div>;
}
