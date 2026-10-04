import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Tag } from "@/domain/tag";
import type { Task } from "@/domain/task";
import { useAssignTag, useRemoveTag } from "./queries";

export function TaskTags({ task, tags, assignedIds, disabled, onBusyChange }: { task: Task; tags: Tag[]; assignedIds: number[]; disabled: boolean; onBusyChange?: (busy: boolean) => void }) {
  const assign = useAssignTag();
  const remove = useRemoveTag();
  const [candidate, setCandidate] = useState("");
  const [error, setError] = useState<string>();
  const writing = useRef(false);
  const pending = assign.isPending || remove.isPending;

  async function write(tagId: number, removing: boolean) {
    if (writing.current || disabled) return;
    writing.current = true;
    onBusyChange?.(true);
    setError(undefined);
    try {
      await (removing ? remove : assign).mutateAsync({ taskId: task.id, tagId });
      if (!removing) setCandidate("");
    } catch { setError(removing ? "移除标签失败，请重试。" : "分配标签失败，请重试。"); }
    finally { writing.current = false; onBusyChange?.(false); }
  }

  return <div className="space-y-2 pl-7" aria-label={`任务标签：${task.title}`}>
    <div className="flex flex-wrap gap-2">
      {tags.filter((tag) => assignedIds.includes(tag.id)).map((tag) => <span key={tag.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
        <span className="break-all">{tag.name}</span>
        <Button variant="ghost" size="sm" className="h-5 px-1 text-xs" disabled={disabled || pending} aria-label={`移除标签：${task.title}：${tag.name}`} onClick={() => void write(tag.id, true)}>移除</Button>
      </span>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <select id={`task-tag-${task.id}`} aria-label={`分配标签：${task.title}`} value={candidate} disabled={disabled || pending || tags.length === 0}
        onChange={(event) => setCandidate(event.target.value)} className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm">
        <option value="">{tags.length ? "选择标签" : "暂无标签"}</option>
        {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </select>
      <Button variant="outline" size="sm" disabled={disabled || pending || candidate === ""} aria-label={`分配所选标签：${task.title}`} onClick={() => void write(Number(candidate), false)}>添加标签</Button>
    </div>
    {pending && <p role="status" className="text-xs text-muted-foreground">正在保存标签…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
