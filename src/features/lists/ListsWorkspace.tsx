import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListValidationError, parseListName, type TaskList } from "@/domain/list";
import { TaskListView } from "@/features/tasks/Inbox";
import { useCreateList, useDeleteList, useLists, useRenameList } from "./queries";
import { TagSidebar } from "@/features/tags/TagSidebar";
import { useTags, useTaskTags } from "@/features/tags/queries";
import { localDayRange } from "@/domain/taskDates";
import { useLocalClock } from "@/features/tasks/useLocalClock";
import { BackupRestorePanel } from "@/features/settings/BackupRestorePanel";
import { AutostartSettings } from "@/features/settings/AutostartSettings";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

function nameError(cause: unknown) {
  return cause instanceof ListValidationError ? cause.message : "清单名称无效。";
}

function ListControls({ list, onDeleted, onDraftChange, onBusyChange, beforeDelete }: { list: TaskList; onDeleted: () => void; onDraftChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void; beforeDelete: () => Promise<boolean> }) {
  const rename = useRenameList();
  const remove = useDeleteList();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(list.name);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const writing = useRef(false);
  const composing = useRef(false);
  const pending = rename.isPending || remove.isPending;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (writing.current || composing.current) return;
    let name: string;
    try { name = parseListName(draft); } catch (cause) { setError(nameError(cause)); return; }
    writing.current = true;
    onBusyChange(true);
    setError(undefined);
    try {
      await rename.mutateAsync({ id: list.id, name });
      setEditing(false);
      onDraftChange(false);
    } catch { setError("重命名失败，输入已保留。请重试。"); }
    finally { writing.current = false; onBusyChange(false); }
  }

  async function deleteList() {
    if (writing.current) return;
    writing.current = true;
    if (!(await beforeDelete())) { writing.current = false; return; }
    writing.current = true;
    onBusyChange(true);
    setError(undefined);
    try {
      await remove.mutateAsync(list.id);
      onDeleted();
    } catch { setError("清单删除失败，任务和清单仍保留。请重试。"); }
    finally { writing.current = false; onBusyChange(false); }
  }

  return <div className="space-y-3 rounded-xl border border-border p-4">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={pending || confirming} onClick={() => { setDraft(list.name); setEditing(true); setError(undefined); }}>重命名清单</Button>
      <Button variant="ghost" disabled={pending || editing} onClick={() => { setConfirming(true); setError(undefined); }}>删除清单</Button>
    </div>
    {editing && <form aria-label="重命名清单" onSubmit={(event) => void save(event)} className="space-y-2">
      <label htmlFor="rename-list" className="text-sm">清单名称</label>
      <Input id="rename-list" value={draft} onChange={(event) => { setDraft(event.target.value); onDraftChange(event.target.value !== list.name); }} disabled={pending}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{rename.isPending ? "正在保存…" : "保存名称"}</Button>
        <Button variant="outline" disabled={pending} onClick={() => { setEditing(false); setError(undefined); onDraftChange(false); }}>取消重命名</Button>
      </div>
    </form>}
    {confirming && <div role="group" aria-label="确认删除清单" className="space-y-3 rounded-lg bg-muted p-3">
      <p className="break-words text-sm">删除清单“{list.name}”？任务会回到收件箱，不会被删除。</p>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={pending} onClick={() => void deleteList()}>{remove.isPending ? "正在删除…" : "确认删除清单"}</Button>
        <Button variant="outline" disabled={pending} onClick={() => { setConfirming(false); setError(undefined); }}>取消删除清单</Button>
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

type View = "inbox" | "today" | "upcoming" | "lists" | "list" | "tags" | "settings";
export function ListsWorkspace() {
  const lists = useLists(), create = useCreateList(), tags = useTags(), taskTags = useTaskTags();
  const [view, setView] = useState<View>("inbox");
  const [selectedId, setSelectedId] = useState<number | null>(null), [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [draft, setDraft] = useState(""), [error, setError] = useState<string>();
  const [taskDraft, setTaskDraft] = useState("");
  const writing = useRef(false), composing = useRef(false), taskDirty = useRef(false), renameDirty = useRef(false), childBusy = useRef(false);
  const now = useLocalClock(), range = localDayRange(now);
  const { confirm, confirmation } = useConfirmDialog();
  const selected = lists.data?.find(list => list.id === selectedId), selectedTag = tags.data?.find(tag => tag.id === selectedTagId);
  const activeView = view === "list" && lists.isSuccess && !selected ? "inbox" : view;
  async function navigate(next: View, id: number | null = null, tag: number | null = null, afterWrite = false) {
    if (childBusy.current || (writing.current && !afterWrite)) return;
    if (next === view && id === selectedId && tag === selectedTagId) return;
    if ((taskDirty.current || renameDirty.current) && !(await confirm("当前任务输入或清单名称尚未保存。放弃输入并切换视图？"))) return;
    taskDirty.current = false; renameDirty.current = false;
    setTaskDraft("");
    setSelectedId(id); setSelectedTagId(tag); setView(next);
    requestAnimationFrame(() => document.getElementById("inbox-heading")?.focus());
  }
  async function addList(event: FormEvent) {
    event.preventDefault(); if (writing.current || composing.current || !lists.isSuccess) return;
    let name: string;
    try { name = parseListName(draft); } catch (cause) { setError(nameError(cause)); return; }
    writing.current = true; setError(undefined);
    try { const list = await create.mutateAsync(name); setDraft(""); navigate("list", list.id, null, true); }
    catch { setError("创建清单失败，输入已保留。请重试。"); }
    finally { writing.current = false; }
  }
  const nav: { view: View; name: string }[] = [{ view: "inbox", name: "收件箱" }, { view: "today", name: "今天" }, { view: "upcoming", name: "即将到来" }, { view: "lists", name: "清单" }, { view: "tags", name: "标签" }, { view: "settings", name: "设置" }];
  return <div className="grid min-w-0 gap-8 md:grid-cols-[210px_minmax(0,1fr)]">
    {confirmation}
    <aside className="min-w-0 space-y-6 rounded-xl border border-border bg-card p-3 md:self-start" aria-label="导航与管理">
      <nav aria-label="主导航" className="grid grid-cols-2 gap-1 md:grid-cols-1">{nav.map(item => <Button key={item.view} className="w-full justify-start" variant={activeView === item.view || (item.view === "lists" && activeView === "list") ? "secondary" : "ghost"} aria-current={activeView === item.view ? "page" : undefined} aria-label={`打开${item.name}`} onClick={() => navigate(item.view)}>{item.name}</Button>)}</nav>
      <div hidden={activeView !== "lists" && activeView !== "list"} className="space-y-4">
        <nav aria-label="任务清单" className="space-y-1">{lists.data?.map(list => <Button key={list.id} className="h-auto w-full justify-start whitespace-normal break-all text-left" variant={selected?.id === list.id ? "secondary" : "ghost"} aria-label={`打开清单：${list.name}`} aria-current={selected?.id === list.id ? "page" : undefined} onClick={() => navigate("list", list.id)}>{list.name}</Button>)}</nav>
        {lists.isPending && <p role="status">正在读取清单…</p>}
        {lists.isError && <p role="alert">清单读取失败。<Button onClick={() => void lists.refetch()}>重试清单</Button></p>}
        <form aria-label="创建清单" onSubmit={event => void addList(event)} className="space-y-2 border-t pt-4">
          <label htmlFor="new-list-name" className="text-sm font-medium">新清单名称</label><Input id="new-list-name" value={draft} placeholder="例如：工作" disabled={create.isPending || !lists.isSuccess} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
          <Button type="submit" variant="outline" disabled={create.isPending || !lists.isSuccess}>{create.isPending ? "正在创建…" : "创建清单"}</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </div>
      <div hidden={activeView !== "tags"}><TagSidebar selectedId={selectedTag?.id ?? null} onSelect={id => navigate("tags", null, id)} onDeleted={id => setSelectedTagId(current => current === id ? null : current)} /></div>
      <p className="border-t pt-3 text-xs text-muted-foreground">任务保存在此电脑</p>
    </aside>
    <div className="min-w-0 space-y-5">
      {activeView === "settings" ? <section aria-labelledby="inbox-heading"><h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">设置</h1><p className="mt-2 text-sm text-muted-foreground">管理本地数据与系统启动。</p><BackupRestorePanel /><AutostartSettings /></section> : activeView === "lists" ? <section aria-labelledby="inbox-heading" className="space-y-5"><h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">清单</h1><p className="text-sm text-muted-foreground">在左侧创建清单，打开清单后可重命名或删除。</p>{lists.data?.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center">还没有清单</p>}<div className="grid gap-3 sm:grid-cols-2">{lists.data?.map(list => <Button key={list.id} variant="outline" className="h-auto justify-start whitespace-normal break-all p-4 text-left" onClick={() => navigate("list", list.id)}>{list.name}</Button>)}</div></section> : activeView === "tags" && !selectedTag ? <section aria-labelledby="inbox-heading" className="space-y-5"><h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">标签</h1><p className="text-sm text-muted-foreground">创建标签，或选中标签查看已关联的任务。任务详情中可分配和移除标签。</p>{tags.isSuccess && tags.data.length === 0 && <p className="rounded-xl border border-dashed p-8">还没有标签</p>}</section> : <>
        {taskTags.isError && <p role="alert">任务标签读取失败。<Button onClick={() => void taskTags.refetch()}>重试任务标签</Button></p>}
        <TaskListView key={`${activeView}-${selected?.id ?? "inbox"}-${selectedTag?.id ?? "none"}`} name={activeView === "today" ? "今天" : activeView === "upcoming" ? "即将到来" : activeView === "tags" ? `标签：${selectedTag?.name}` : activeView === "list" ? selected?.name ?? "清单" : "收件箱"}
          listId={activeView === "inbox" ? null : activeView === "list" ? selected?.id : undefined} tagId={activeView === "tags" ? selectedTag?.id : undefined}
          dateFilters={activeView === "today" ? { dateView: "today", dateRange: range } : activeView === "upcoming" ? { dateView: "upcoming", dateRange: { from: range.to } } : undefined}
          lists={lists.data ?? []} listsUnavailable={!lists.isSuccess} tags={tags.data ?? []} taskTags={taskTags.data ?? []} tagsUnavailable={!tags.isSuccess || !taskTags.isSuccess} now={now}
          initialDraft={taskDraft} onDraftChange={(value, text) => { taskDirty.current = value; setTaskDraft(text); }} onBusyChange={value => { childBusy.current = value; }} />
        {activeView === "list" && selected && <ListControls key={`controls-${selected.id}`} list={selected} beforeDelete={() => taskDirty.current ? confirm("此清单有未保存的新任务输入。删除清单后输入将保留在收件箱，是否继续？", "继续删除清单") : Promise.resolve(true)} onDeleted={() => { renameDirty.current = false; setSelectedId(null); setView("inbox"); }} onDraftChange={value => { renameDirty.current = value; }} onBusyChange={value => { childBusy.current = value; }} />}
      </>}
    </div>
  </div>;
}
