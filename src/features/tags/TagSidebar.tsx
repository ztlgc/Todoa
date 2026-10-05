import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { parseTagName, TagConflictError, TagValidationError } from "@/domain/tag";
import { useCreateTag, useDeleteTag, useTags } from "./queries";

export function TagSidebar({ selectedId, onSelect, onDeleted }: { selectedId: number | null; onSelect: (id: number) => void; onDeleted: (id: number) => void }) {
  const tags = useTags();
  const create = useCreateTag();
  const remove = useDeleteTag();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const writing = useRef(false);
  const composing = useRef(false);
  const pending = create.isPending || remove.isPending;
  const confirmed = tags.data?.find((tag) => tag.id === confirming);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (writing.current || composing.current || !tags.isSuccess) return;
    let name: string;
    try { name = parseTagName(draft); } catch (cause) { setError(cause instanceof TagValidationError ? cause.message : "标签名称无效。"); return; }
    writing.current = true;
    setError(undefined);
    try {
      await create.mutateAsync(name);
      setDraft("");
      setCreating(false);
    } catch (cause) { setError(cause instanceof TagConflictError ? "标签名称已存在，请使用其他名称。" : "创建标签失败，输入已保留。请重试。"); }
    finally { writing.current = false; }
  }

  async function deleteTag(id: number) {
    if (writing.current) return;
    writing.current = true;
    setError(undefined);
    try {
      await remove.mutateAsync(id);
      setConfirming(null);
      onDeleted(id);
    } catch { setError("删除标签失败，标签和关联仍保留。请重试。"); }
    finally { writing.current = false; }
  }

  return <section aria-labelledby="tags-heading" className="space-y-3 border-t border-border pt-5">
    <div className="flex items-center justify-between gap-2">
      <h2 id="tags-heading" className="text-sm font-medium">标签</h2>
      <Button variant="ghost" size="icon-sm" aria-label="新建标签" aria-expanded={creating} aria-controls="create-tag-form" onClick={() => { setCreating((value) => !value); setError(undefined); }}><Plus aria-hidden="true" className="size-4" /></Button>
    </div>
    <nav aria-label="按标签查看任务" className="space-y-1">
      {tags.data?.map((tag) => <div key={tag.id} className="flex min-w-0 items-center gap-1">
        <Button className="h-auto min-w-0 flex-1 justify-start whitespace-normal break-all text-left" variant={selectedId === tag.id ? "secondary" : "ghost"} aria-label={`打开标签：${tag.name}`} aria-current={selectedId === tag.id ? "page" : undefined} onClick={() => onSelect(tag.id)}># {tag.name}</Button>
        <Button variant="ghost" size="sm" disabled={pending} aria-label={`删除标签：${tag.name}`} onClick={() => { setConfirming(tag.id); setError(undefined); }}>删除</Button>
      </div>)}
    </nav>
    {tags.isPending && <p role="status" className="text-sm text-muted-foreground">正在读取标签…</p>}
    {tags.isError && <div role="alert" className="space-y-2 text-sm"><p>标签读取失败。</p><Button variant="outline" disabled={tags.isFetching} onClick={() => void tags.refetch()}>重试标签</Button></div>}
    {confirmed && <div role="group" aria-label="确认删除标签" className="space-y-2 rounded-lg bg-muted p-3">
      <p className="break-words text-sm">删除标签“{confirmed.name}”？关联会被移除，任务不会被删除。</p>
      <Button variant="destructive" size="sm" disabled={pending} aria-label={`确认删除标签：${confirmed.name}`} onClick={() => void deleteTag(confirmed.id)}>确认删除标签</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => { setConfirming(null); setError(undefined); }}>取消删除标签</Button>
    </div>}
    {creating && <form id="create-tag-form" aria-label="创建标签" onSubmit={(event) => void add(event)} className="space-y-2 rounded-lg border border-border p-3">
      <label htmlFor="new-tag-name" className="text-sm">新标签名称</label>
      <Input id="new-tag-name" placeholder="例如：工作" value={draft} disabled={pending || !tags.isSuccess} onChange={(event) => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="outline" disabled={pending || !tags.isSuccess}>{create.isPending ? "正在创建…" : "创建标签"}</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => { setCreating(false); setDraft(""); setError(undefined); }}>取消</Button></div>
    </form>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
