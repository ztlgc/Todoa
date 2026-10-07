import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateTask } from "@/features/tasks/queries";
import { ShortcutNotice } from "./ShortcutNotice";
import { parseTaskTitle, TaskValidationError } from "@/domain/task";
import { parseNaturalTaskInput } from "@/domain/naturalTaskInput";
import { TaskInputFeedback } from "@/features/tasks/TaskInputFeedback";

export function QuickAddLauncher() {
  const showing = useRef(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [ignoreRecognition, setIgnoreRecognition] = useState(false);
  const composing = useRef(false), submitting = useRef(false);
  const parsed = title.trim() && !ignoreRecognition ? parseNaturalTaskInput(title) : null;
  const create = useCreateTask();
  async function show() {
    if (isBrowserDebug()) { setOpen(true); return; }
    if (showing.current) return;
    showing.current = true;
    setError("");
    try { await invoke("show_quick_add"); }
    catch { setError("无法打开快速添加窗口。请重试。"); }
    finally { showing.current = false; }
  }
  return <div className="flex flex-wrap items-center justify-end gap-3">
    <ShortcutNotice />
    {error && !open && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button id="show-quick-add" variant="outline" onClick={() => { void show(); }}>快速添加</Button>
    <Dialog open={open} onOpenChange={next => { if (!create.isPending && !composing.current) setOpen(next); }}><DialogContent className="sm:max-w-xl" onKeyDownCapture={event => { if (event.key === "Escape" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); } }}>
      <DialogTitle>快速添加任务</DialogTitle>
      <DialogDescription>添加到收件箱。</DialogDescription>
      <form autoComplete="off" aria-label="快速新增任务" className="space-y-2 rounded-xl border border-border bg-card p-4" onSubmit={async event => {
        event.preventDefault(); if (composing.current || submitting.current) return;
        let taskTitle: string;
        try { taskTitle = parseTaskTitle(parsed?.title ?? title); } catch (cause) { setError(cause instanceof TaskValidationError ? cause.message : "任务标题无效。"); return; }
        submitting.current = true; setError("");
        try { await create.mutateAsync({ title: taskTitle, ...(parsed?.dueAt ? { dueAt: parsed.dueAt } : {}), ...(parsed?.repeatRule ? { repeatRule: parsed.repeatRule } : {}), ...(parsed?.remindAt.length ? { remindAt: parsed.remindAt, reminderOffsets: parsed.reminderOffsets } : {}) }); setTitle(""); setIgnoreRecognition(false); setOpen(false); }
        catch (cause) { setError(cause instanceof Error && cause.message.includes("提醒时间") ? "提醒时间已过去，请调整输入的日期或时间。" : "新增失败，输入已保留。请稍后重试。"); }
        finally { submitting.current = false; }
      }}>
        <div className="flex flex-wrap gap-2">
          <Input autoComplete="off" aria-label="任务名称" className="min-w-0 flex-1" placeholder="例如：明天下午3点开会" value={title} disabled={create.isPending} aria-invalid={!!error} aria-describedby={error ? "quick-create-error" : undefined} onChange={event => { setTitle(event.target.value); setIgnoreRecognition(false); setError(""); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} autoFocus />
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "正在添加…" : "添加任务"}</Button>
        </div>
        <TaskInputFeedback draft={title} parsed={parsed} ignoreRecognition={ignoreRecognition} onIgnoreChange={setIgnoreRecognition} />
        {error && <p id="quick-create-error" role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    </DialogContent></Dialog>
  </div>;
}
