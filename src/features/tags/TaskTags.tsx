import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Tag } from "@/domain/tag";
import type { Task } from "@/domain/task";
import { Input } from "@/components/ui/input";
import { useAssignTag, useRemoveTag, useCreateTag } from "./queries";

export function TaskTags({ task, tags, assignedIds, disabled, onBusyChange }: { task: Task; tags: Tag[]; assignedIds: number[]; disabled: boolean; onBusyChange?: (busy: boolean) => void }) {
  const assign = useAssignTag();
  const remove = useRemoveTag();
  const create = useCreateTag();
  const [candidate, setCandidate] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string>();
  const writing = useRef(false);
  const pending = assign.isPending || remove.isPending || create.isPending;

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
  async function add() {
    if (candidate !== "" && candidate !== "new") { await write(Number(candidate), false); return; }
    if (writing.current || disabled || !newName.trim()) return;
    writing.current = true; onBusyChange?.(true); setError(undefined);
    try {
      const name = newName.trim();
      const tag = tags.find(tag => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? await create.mutateAsync(name);
      await assign.mutateAsync({ taskId: task.id, tagId: tag.id });
      setNewName(""); setCandidate("");
    } catch { setError("添加标签失败，请重试。"); }
    finally { writing.current = false; onBusyChange?.(false); }
  }

  return <div className="space-y-2" aria-label={`任务标签：${task.title}`}>
    <div className="flex flex-wrap gap-2">
      {tags.filter((tag) => assignedIds.includes(tag.id)).map((tag) => <span key={tag.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
        <span className="break-all">{tag.name}</span>
        <Button variant="ghost" size="sm" className="h-5 px-1 text-xs" disabled={disabled || pending} aria-label={`移除标签：${task.title}：${tag.name}`} onClick={() => void write(tag.id, true)}>移除</Button>
      </span>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {tags.length > 0 && <select id={`task-tag-${task.id}`} aria-label={`分配标签：${task.title}`} value={candidate} disabled={disabled || pending}
        onChange={(event) => setCandidate(event.target.value)} className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm">
        <option value="">选择标签</option>
        {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        <option value="new">新建标签…</option>
      </select>}
      {(tags.length === 0 || candidate === "new") && <Input autoComplete="off" aria-label="新标签名称" placeholder="输入新标签名称" value={newName} onChange={event => setNewName(event.target.value)} disabled={disabled || pending} className="h-8 min-w-0 flex-1" />}
      <Button variant="outline" size="sm" disabled={disabled || pending || ((tags.length === 0 || candidate === "new") ? !newName.trim() : candidate === "")} aria-label={`分配所选标签：${task.title}`} onClick={() => void add()}>添加标签</Button>
    </div>
    {pending && <p role="status" className="text-xs text-muted-foreground">正在保存标签…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
