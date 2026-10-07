import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseTaskTitle } from "@/domain/task";
import { parseNaturalTaskInput } from "@/domain/naturalTaskInput";
import { TaskInputFeedback } from "@/features/tasks/TaskInputFeedback";

export function QuickAdd() {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [ignoreRecognition, setIgnoreRecognition] = useState(false);
  const parsed = draft.trim() && !ignoreRecognition ? parseNaturalTaskInput(draft) : null;

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let stopShown: (() => void) | undefined;
    let stopQuit: (() => void) | undefined;
    getCurrentWindow().listen("app-quitting", () => { if (!disposed) setQuitting(true); })
      .then((unlisten) => { if (disposed) unlisten(); else stopQuit = unlisten; })
      .catch(() => { if (!disposed) setError("无法监听退出状态，提交仍由本地服务校验。"); });
    getCurrentWindow().listen("quick-add-shown", () => {
      if (!disposed) input.current?.focus();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopShown = unlisten;
    }).catch(() => { if (!disposed) setError("无法监听显示通知，请点击输入框。"); });
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!disposed && focused) input.current?.focus();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    }).catch(() => { if (!disposed) setError("无法监听窗口焦点，请点击输入框。"); });
    return () => { disposed = true; stop?.(); stopShown?.(); stopQuit?.(); };
  }, []);

  async function hide() {
    try { await invoke("hide_quick_add"); }
    catch { setError("窗口未能隐藏，草稿已保留。请重试。"); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || composing.current || quitting) return;
    let title: string;
    try { title = parseTaskTitle(parsed?.title ?? draft); }
    catch { setError("请输入 1 至 500 个有效字符的任务标题。"); return; }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      if (parsed && (parsed.dueAt || parsed.repeatRule || parsed.remindAt.length)) {
        await invoke<number>("create_quick_scheduled_task", { input: { title, listId: null, notes: "", dueAt: parsed.dueAt, repeatRule: parsed.repeatRule, remindAt: parsed.remindAt, reminderOffsets: parsed.reminderOffsets } });
      } else await invoke<number>("create_quick_task", { title });
    } catch {
      setError("创建失败，输入已保留。请重试。");
      submitting.current = false;
      setPending(false);
      input.current?.focus();
      return;
    }
    // A committed task must never be retried because hiding failed.
    setDraft("");
    setIgnoreRecognition(false);
    try { await invoke("hide_quick_add"); }
    catch { setError("任务已创建，但窗口未能隐藏。请按 Escape 关闭。"); }
    finally { submitting.current = false; setPending(false); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault();
    } else if (event.key === "Escape" && !composing.current && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void hide();
    }
  }

  return (
    <main className="min-h-screen bg-background p-5 text-foreground">
      <h1 className="mb-4 text-lg font-semibold">快速添加</h1>
      <form aria-label="快速新增任务" className="space-y-2 rounded-xl border border-border bg-card p-4" onSubmit={(event) => { void submit(event); }} onKeyDown={onKeyDown}>
        <label htmlFor="quick-title" className="sr-only">任务标题</label>
        <div className="flex flex-wrap gap-2">
          <Input ref={input} autoFocus id="quick-title" className="min-w-0 flex-1" placeholder="例如：明天下午3点开会" value={draft}
            disabled={pending || quitting} aria-invalid={!!error} aria-describedby="quick-feedback"
            onChange={(event) => { setDraft(event.target.value); setIgnoreRecognition(false); setError(""); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }} />
          <Button type="submit" disabled={pending || quitting}>{quitting ? "退出中…" : pending ? "正在添加…" : "添加任务"}</Button>
        </div>
        <TaskInputFeedback draft={draft} parsed={parsed} ignoreRecognition={ignoreRecognition} onIgnoreChange={setIgnoreRecognition} />
        <p id="quick-feedback" className="mt-3 text-sm text-muted-foreground" role={error ? "alert" : undefined}>
          {quitting ? "正在退出，等待本地写入完成…" : error || "Enter 添加 · Escape 隐藏并保留草稿"}
        </p>
      </form>
    </main>
  );
}
