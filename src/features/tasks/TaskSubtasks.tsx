import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { parseTaskTitle } from "@/domain/task";
import type { Subtask } from "@/domain/subtask";
import { SubtaskSchedulePicker, subtaskDateLabel } from "./SubtaskSchedulePicker";

export type SubtaskInputHandle = { commit: () => boolean };
export const TaskSubtasks = forwardRef<SubtaskInputHandle, {
  items: Subtask[];
  onChange: (items: Subtask[]) => void;
  onComposition: (value: boolean) => void;
}>(function TaskSubtasks({ items, onChange, onComposition }, ref) {
  const [adding, setAdding] = useState(false), [draft, setDraft] = useState(""), [error, setError] = useState("");
  const composing = useRef(false), input = useRef<HTMLInputElement>(null), draftRef = useRef("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const titleDrafts = useRef<Record<string, string>>({}), latest = useRef(items);
  latest.current = items;
  function publish(next: Subtask[]) { latest.current = next; onChange(next); }
  function patch(id: string, update: Partial<Subtask>) {
    publish(latest.current.map(item => item.id === id ? { ...item, ...update } : item));
  }
  function commitTitles() {
    if (composing.current) return false;
    try {
      const next = latest.current.map(item => titleDrafts.current[item.id] === undefined ? item : { ...item, title: parseTaskTitle(titleDrafts.current[item.id]) });
      if (next.some((item, index) => item.title !== latest.current[index].title)) publish(next);
      titleDrafts.current = {};
      setTitles({});
      setError("");
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "子任务内容无效。"); return false; }
  }
  function add() {
    if (!commitTitles()) return false;
    if (!draftRef.current.trim()) return true;
    try {
      if (latest.current.length >= 500) throw new Error("子任务数量不能超过500项。");
      const title = parseTaskTitle(draftRef.current);
      publish([...latest.current, { id: crypto.randomUUID(), title, completed: false }]);
      draftRef.current = "";
      setDraft("");
      setError("");
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "子任务添加失败。"); return false; }
  }
  useImperativeHandle(ref, () => ({ commit: add }));
  return <section aria-label="子任务" className="mb-4 space-y-1">
    {items.map(item => <div key={item.id} className="group flex min-h-9 items-start gap-2 border-b border-transparent py-1 text-sm transition-colors focus-within:border-primary">
      <input type="checkbox" className="mt-1 size-3.5 shrink-0 accent-primary" aria-label={`完成子任务：${item.title}`} checked={item.completed} onChange={event => patch(item.id, { completed: event.target.checked })} />
      <div className="min-w-0 flex-1">
        <input aria-label={`子任务内容：${item.title}`} value={titles[item.id] ?? item.title} maxLength={1000} className={`h-6 w-full min-w-0 border-0 bg-transparent p-0 leading-6 outline-none ${item.completed ? "text-muted-foreground line-through" : ""}`}
          onChange={event => {
            const value = event.target.value;
            titleDrafts.current[item.id] = value;
            setTitles({ ...titleDrafts.current });
            setError("");
            try { const title = parseTaskTitle(value); if (title !== item.title) patch(item.id, { title }); } catch { /* Keep incomplete text editable until commit. */ }
          }}
          onBlur={commitTitles}
          onCompositionStart={() => { composing.current = true; onComposition(true); }} onCompositionEnd={() => { composing.current = false; onComposition(false); }}
          onKeyDown={event => { if (event.key === "Enter" && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (commitTitles()) event.currentTarget.blur(); } }} />
        {subtaskDateLabel(item) && <p className="pb-0.5 text-[11px] leading-4 text-muted-foreground tabular-nums">{subtaskDateLabel(item)}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <SubtaskSchedulePicker item={item} onChange={schedule => {
          publish(latest.current.map(value => { if (value.id !== item.id) return value; const next = { ...value }; delete next.dueAt; delete next.dueDate; return { ...next, ...schedule }; }));
        }} />
        <button type="button" aria-label={`删除子任务：${item.title}`} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { delete titleDrafts.current[item.id]; setTitles({ ...titleDrafts.current }); setError(""); publish(latest.current.filter(value => value.id !== item.id)); }}><Trash2 className="size-3.5" /></button>
      </div>
    </div>)}
    {adding ? <div className="flex min-h-8 items-center gap-2">
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
      <input ref={input} autoFocus aria-label="新子任务" placeholder="输入子任务，按回车添加" value={draft} maxLength={1000} className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground" onChange={event => { draftRef.current = event.target.value; setDraft(event.target.value); setError(""); }}
        onCompositionStart={() => { composing.current = true; onComposition(true); }} onCompositionEnd={() => { composing.current = false; onComposition(false); }}
        onBlur={add}
        onKeyDown={event => {
          if (event.key !== "Enter" || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          add();
          input.current?.focus();
        }} />
    </div> : <button type="button" className="inline-flex min-h-8 items-center gap-2 rounded text-sm text-muted-foreground hover:text-foreground" onClick={() => setAdding(true)}><Plus className="size-3.5" />添加子任务</button>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
});
