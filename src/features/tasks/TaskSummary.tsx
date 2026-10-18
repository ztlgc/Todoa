import { useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { Checkbox } from "@/components/ui/checkbox";
import { plainText } from "@/data/repositories/ContentRepository";
import { readSubtasks, type Subtask } from "@/domain/subtask";
import type { Task } from "@/domain/task";

function readSummary(contentJson: Task["contentJson"], notes: string): { items: Subtask[]; body: string } {
  if (contentJson) {
    try {
      const doc: JSONContent = JSON.parse(contentJson);
      const items = readSubtasks(doc);
      if (items.length) return { items, body: plainText({ ...doc, attrs: { ...doc.attrs, subtasks: undefined } }) };
    } catch { /* Keep the readable notes when a document cannot be decoded. */ }
  }
  return { items: [], body: notes };
}

export function TaskSummary({ task, disabled, onToggle }: { task: Task; disabled: boolean; onToggle: (id: string, completed: boolean) => void }) {
  const { items, body } = useMemo(() => readSummary(task.contentJson, task.notes), [task.contentJson, task.notes]);
  return <>
    {items.length > 0 && <div className="space-y-1 pt-1">
      <ul aria-label={`子任务：${task.title}`} className="space-y-1">
        {items.slice(0, 3).map(item => <li key={item.id} className="flex min-h-6 items-start gap-2 text-sm">
          <Checkbox checked={item.completed} disabled={disabled} aria-label={`${item.completed ? "取消完成子任务" : "完成子任务"}：${item.title}`} className="mt-1 size-3.5 after:inset-0" onCheckedChange={checked => onToggle(item.id, checked)} />
          <span className={`min-w-0 flex-1 break-all leading-6 ${item.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.title}</span>
        </li>)}
      </ul>
      {items.length > 3 && <p className="pl-5.5 text-xs text-muted-foreground">另有 {items.length - 3} 项子任务</p>}
    </div>}
    {body && <p className="line-clamp-2 break-all whitespace-pre-wrap text-sm text-muted-foreground">{body}</p>}
  </>;
}
