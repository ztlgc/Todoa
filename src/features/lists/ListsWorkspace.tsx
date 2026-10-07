import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isBrowserDebug } from "@/app/browserDebug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListValidationError, parseListName, type TaskList } from "@/domain/list";
import { TaskListView, TrashView } from "@/features/tasks/Inbox";
import { useCreateList, useDeleteList, useLists, useRenameList } from "./queries";
import { TagSidebar } from "@/features/tags/TagSidebar";
import { useTags, useTaskTags } from "@/features/tags/queries";
import { localDayRange } from "@/domain/taskDates";
import { useLocalClock } from "@/features/tasks/useLocalClock";
import { BackupRestorePanel } from "@/features/settings/BackupRestorePanel";
import { AutostartSettings } from "@/features/settings/AutostartSettings";
import { AboutSettings } from "@/features/settings/AboutSettings";
import { TaskStatistics } from "@/features/settings/TaskStatistics";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { BarChart3, CalendarDays, CalendarClock, CalendarCheck2, CheckCheck, Database, Info, Inbox, List, ListTodo, MoreHorizontal, Plus, Settings2, SlidersHorizontal, Tags, Trash2 } from "lucide-react";
import { JournalWorkspace } from "@/features/journal/JournalWorkspace";
import { BookOpen } from "lucide-react";
import { CalendarView } from "@/features/calendar/CalendarView";

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

  return <div className="space-y-3 border-t border-border pt-3">
    <div className="flex flex-wrap gap-1">
      <Button variant="outline" size="sm" disabled={pending || confirming} onClick={() => { setDraft(list.name); setEditing(true); setError(undefined); }}>重命名清单</Button>
      <Button variant="ghost" size="sm" disabled={pending || editing} onClick={() => { setConfirming(true); setError(undefined); }}>删除清单</Button>
    </div>
    {editing && <form autoComplete="off" aria-label="重命名清单" onSubmit={(event) => void save(event)} className="space-y-2">
      <label htmlFor="rename-list" className="text-sm">清单名称</label>
      <Input autoComplete="off" id="rename-list" value={draft} onChange={(event) => { setDraft(event.target.value); onDraftChange(event.target.value !== list.name); }} disabled={pending}
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

type View = "inbox" | "today" | "upcoming" | "calendar" | "journal" | "lists" | "list" | "tags" | "completed" | "trash" | "settings";
type SettingsGroup = "general" | "statistics" | "data" | "about";
export function ListsWorkspace() {
  const lists = useLists(), create = useCreateList(), tags = useTags(), taskTags = useTaskTags();
  const [view, setView] = useState<View>("inbox");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null), sidebarTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (sidebarOpen) requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLButtonElement>('button[aria-label="关闭视图导航"]')?.focus()); }, [sidebarOpen]);
  function closeSidebar() { setSidebarOpen(false); requestAnimationFrame(() => sidebarTrigger.current?.focus()); }
  function sidebarKeys(event: KeyboardEvent<HTMLElement>) {
    if (!sidebarOpen) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSidebar(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? [])].filter(element => element.getClientRects().length > 0);
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
    else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
  }
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("general");
  const [version, setVersion] = useState<string>();
  useEffect(() => { if (isBrowserDebug()) { setVersion("浏览器调试"); return; } void getVersion().then(setVersion).catch(() => setVersion("读取失败")); }, []);
  const [selectedId, setSelectedId] = useState<number | null>(null), [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [draft, setDraft] = useState(""), [error, setError] = useState<string>();
  const [creatingList, setCreatingList] = useState(false), [managingList, setManagingList] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const writing = useRef(false), composing = useRef(false), taskDirty = useRef(false), renameDirty = useRef(false), detailDirty = useRef(false), childBusy = useRef(false);
  const now = useLocalClock(), range = localDayRange(now);
  const { confirm, confirmation } = useConfirmDialog();
  const selected = lists.data?.find(list => list.id === selectedId), selectedTag = tags.data?.find(tag => tag.id === selectedTagId);
  const activeView = view === "list" && lists.isSuccess && !selected ? "inbox" : view;
  async function navigate(next: View, id: number | null = null, tag: number | null = null, afterWrite = false) {
    if (childBusy.current || (writing.current && !afterWrite)) return;
    if (next === view && id === selectedId && tag === selectedTagId) return;
    if ((taskDirty.current || renameDirty.current || detailDirty.current) && !(await confirm("当前任务输入或清单名称尚未保存。放弃输入并切换视图？"))) return;
    taskDirty.current = false; renameDirty.current = false; detailDirty.current = false;
    setTaskDraft("");
    setSelectedId(id); setSelectedTagId(tag); setView(next); setManagingList(false);
    setSidebarOpen(false);
    requestAnimationFrame(() => document.getElementById("inbox-heading")?.focus());
  }
  async function addList(event: FormEvent) {
    event.preventDefault(); if (writing.current || composing.current || !lists.isSuccess) return;
    let name: string;
    try { name = parseListName(draft); } catch (cause) { setError(nameError(cause)); return; }
    writing.current = true; setError(undefined);
    try { const list = await create.mutateAsync(name); setDraft(""); setCreatingList(false); void navigate("list", list.id, null, true); }
    catch { setError("创建清单失败，输入已保留。请重试。"); }
    finally { writing.current = false; }
  }
  const nav = [{ view: "inbox", name: "收件箱", icon: Inbox }, { view: "today", name: "今天", icon: CalendarCheck2 }, { view: "upcoming", name: "即将到来", icon: CalendarClock }, { view: "lists", name: "清单", icon: List }, { view: "tags", name: "标签", icon: Tags }] as const;
  return <div className={`grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 ${(activeView === "calendar" || activeView === "journal") ? "" : "md:grid-cols-[64px_210px_minmax(0,1fr)]"}`}>
    {confirmation}
    <nav aria-label="一级导航" className="flex flex-col gap-1 self-start rounded-xl border border-border bg-card p-2">
      <Button className="h-auto min-h-12 min-w-0 w-full flex-col gap-1 px-1 py-2 text-xs" variant={activeView !== "settings" && activeView !== "calendar" && activeView !== "journal" ? "secondary" : "ghost"} aria-current={activeView !== "settings" && activeView !== "calendar" && activeView !== "journal" ? "page" : undefined} onClick={() => void navigate("inbox")}><ListTodo aria-hidden="true" className="size-4" />任务</Button>
      <Button className="h-auto min-h-12 min-w-0 w-full flex-col gap-1 px-1 py-2 text-xs" variant={activeView === "calendar" ? "secondary" : "ghost"} aria-current={activeView === "calendar" ? "page" : undefined} onClick={() => void navigate("calendar")}><CalendarDays aria-hidden="true" className="size-4" />日历</Button>
      <Button className="h-auto min-h-12 min-w-0 w-full flex-col gap-1 px-1 py-2 text-xs" variant={activeView === "journal" ? "secondary" : "ghost"} aria-current={activeView === "journal" ? "page" : undefined} onClick={() => void navigate("journal")}><BookOpen aria-hidden="true" className="size-4" />日记</Button>
      <Button className="h-auto min-h-12 min-w-0 w-full flex-col gap-1 px-1 py-2 text-xs" variant={activeView === "settings" ? "secondary" : "ghost"} aria-current={activeView === "settings" ? "page" : undefined} onClick={() => void navigate("settings")}><Settings2 aria-hidden="true" className="size-4" />设置</Button>
    </nav>
    {sidebarOpen && <button className="fixed inset-0 z-30 bg-black/30 md:hidden" aria-label="关闭视图导航背景" tabIndex={-1} onClick={closeSidebar} />}
    {activeView !== "calendar" && activeView !== "journal" && <aside ref={sidebarRef} onKeyDown={sidebarKeys} className={`${sidebarOpen ? "fixed inset-y-4 left-4 z-40 block w-[min(280px,calc(100vw-2rem))] overflow-y-auto" : "hidden"} min-w-0 space-y-6 rounded-xl border border-border bg-card p-3 md:static md:block md:w-auto md:self-start`} aria-label={activeView === "settings" ? "设置分组" : "任务导航与管理"}>
      <Button variant="ghost" aria-label="关闭视图导航" className="w-full md:hidden" onClick={closeSidebar}>关闭导航</Button>
      {activeView === "settings" ? <nav aria-label="设置分组" className="space-y-1">
        {([{ id: "general", label: "常规", icon: SlidersHorizontal }, { id: "statistics", label: "统计", icon: BarChart3 }, { id: "data", label: "数据", icon: Database }, { id: "about", label: "关于", icon: Info }] as const).map(group => <Button key={group.id} className="w-full justify-start" variant={settingsGroup === group.id ? "secondary" : "ghost"} aria-current={settingsGroup === group.id ? "page" : undefined} onClick={() => { setSettingsGroup(group.id); setSidebarOpen(false); requestAnimationFrame(() => document.getElementById("inbox-heading")?.focus()); }}><group.icon aria-hidden="true" className="size-4 shrink-0" />{group.label}</Button>)}
      </nav> : <nav aria-label="任务视图" className="grid grid-cols-2 gap-1 md:grid-cols-1">{nav.map(item => <Button key={item.view} className="w-full justify-start" variant={activeView === item.view || (item.view === "lists" && activeView === "list") ? "secondary" : "ghost"} aria-current={activeView === item.view || (item.view === "lists" && activeView === "list") ? "page" : undefined} aria-label={`打开${item.name}`} onClick={() => void navigate(item.view)}><item.icon aria-hidden="true" className="size-4 shrink-0" />{item.name}</Button>)}</nav>}
      <div hidden={activeView === "settings"} className="space-y-4 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-medium">我的清单</h2><Button variant="ghost" size="icon-sm" aria-label="新建清单" aria-expanded={creatingList} aria-controls="create-list-form" onClick={() => { setCreatingList(value => !value); setError(undefined); }}><Plus aria-hidden="true" className="size-4" /></Button></div>
        {creatingList && <form autoComplete="off" id="create-list-form" aria-label="创建清单" onSubmit={event => void addList(event)} className="space-y-2 rounded-lg border border-border p-3">
          <label htmlFor="new-list-name" className="text-sm font-medium">新清单名称</label><Input autoComplete="off" id="new-list-name" value={draft} placeholder="例如：工作" disabled={create.isPending || !lists.isSuccess} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
          <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" variant="outline" disabled={create.isPending || !lists.isSuccess}>{create.isPending ? "正在创建…" : "创建清单"}</Button><Button type="button" size="sm" variant="ghost" disabled={create.isPending} onClick={() => { setCreatingList(false); setDraft(""); setError(undefined); }}>取消</Button></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>}
        <nav aria-label="任务清单" className="space-y-1">{lists.data?.map(list => <div key={list.id} className="flex min-w-0 items-center gap-1"><Button className="h-auto min-w-0 flex-1 justify-start whitespace-normal break-all text-left" variant={selected?.id === list.id ? "secondary" : "ghost"} aria-label={`打开清单：${list.name}`} aria-current={selected?.id === list.id ? "page" : undefined} onClick={() => void navigate("list", list.id)}>{list.name}</Button>{activeView === "list" && selected?.id === list.id && <Button variant="ghost" size="icon-sm" aria-label={`管理清单：${list.name}`} aria-expanded={managingList} onClick={() => setManagingList(value => !value)}><MoreHorizontal aria-hidden="true" className="size-4" /></Button>}</div>)}</nav>
        {activeView === "list" && selected && managingList && <ListControls key={`controls-${selected.id}`} list={selected} beforeDelete={() => taskDirty.current ? confirm("此清单有未保存的新任务输入。删除清单后输入将保留在收件箱，是否继续？", "继续删除清单") : Promise.resolve(true)} onDeleted={() => { renameDirty.current = false; setManagingList(false); setSelectedId(null); setView("inbox"); }} onDraftChange={value => { renameDirty.current = value; }} onBusyChange={value => { childBusy.current = value; }} />}
        {lists.isPending && <p role="status">正在读取清单…</p>}
        {lists.isError && <p role="alert">清单读取失败。<Button onClick={() => void lists.refetch()}>重试清单</Button></p>}
      </div>
      <div hidden={activeView === "settings"}><TagSidebar selectedId={selectedTag?.id ?? null} onSelect={id => navigate("tags", null, id)} onDeleted={id => setSelectedTagId(current => current === id ? null : current)} /></div>
      {activeView !== "settings" && <nav aria-label="任务归档" className="space-y-1 border-t border-border pt-3">
        <Button className="w-full justify-start" variant={activeView === "completed" ? "secondary" : "ghost"} aria-current={activeView === "completed" ? "page" : undefined} aria-label="打开已完成" onClick={() => void navigate("completed")}><CheckCheck aria-hidden="true" className="size-4 shrink-0" />已完成</Button>
        <Button className="w-full justify-start" variant={activeView === "trash" ? "secondary" : "ghost"} aria-current={activeView === "trash" ? "page" : undefined} aria-label="打开回收站" onClick={() => void navigate("trash")}><Trash2 aria-hidden="true" className="size-4 shrink-0" />回收站</Button>
      </nav>}
    </aside>}
    <div className="min-w-0 space-y-5">
      {activeView !== "calendar" && activeView !== "journal" && <Button ref={sidebarTrigger} variant="outline" className="md:hidden" onClick={() => setSidebarOpen(true)}>打开{activeView === "settings" ? "设置分组" : "任务视图"}</Button>}
      {activeView === "journal" ? <JournalWorkspace lists={lists.data ?? []} onDirtyChange={value => { detailDirty.current = value; }} onBusyChange={value => { childBusy.current = value; }} /> : activeView === "settings" ? <section aria-labelledby="inbox-heading"><h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">{settingsGroup === "general" ? "常规" : settingsGroup === "statistics" ? "统计" : settingsGroup === "data" ? "数据" : "关于"}</h1>{settingsGroup === "general" ? <AutostartSettings /> : settingsGroup === "statistics" ? <TaskStatistics /> : settingsGroup === "data" ? <BackupRestorePanel /> : <AboutSettings version={version} />}</section> : activeView === "calendar" ? <CalendarView lists={lists.data ?? []} listsUnavailable={!lists.isSuccess} tags={tags.data ?? []} taskTags={taskTags.data ?? []} tagsUnavailable={!tags.isSuccess || !taskTags.isSuccess} onDetailDirtyChange={value => { detailDirty.current = value; }} /> : activeView === "trash" ? <TrashView /> : activeView === "lists" ? <section aria-labelledby="inbox-heading" className="space-y-5"><h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">清单</h1><p className="text-sm text-muted-foreground">在左侧创建清单，打开清单后可重命名或删除。</p>{lists.data?.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center">还没有清单</p>}<div className="grid gap-3 sm:grid-cols-2">{lists.data?.map(list => <Button key={list.id} variant="outline" className="h-auto justify-start whitespace-normal break-all p-4 text-left" onClick={() => navigate("list", list.id)}>{list.name}</Button>)}</div></section> : activeView === "tags" && !selectedTag ? <section aria-labelledby="inbox-heading" className="space-y-5"><h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">标签</h1><p className="text-sm text-muted-foreground">创建标签，或选中标签查看已关联的任务。任务详情中可分配和移除标签。</p>{tags.isSuccess && tags.data.length === 0 && <p className="rounded-xl border border-dashed p-8">还没有标签</p>}</section> : <>
        {taskTags.isError && <p role="alert">任务标签读取失败。<Button onClick={() => void taskTags.refetch()}>重试任务标签</Button></p>}
        <TaskListView key={`${activeView}-${selected?.id ?? "inbox"}-${selectedTag?.id ?? "none"}`} name={activeView === "completed" ? "已完成" : activeView === "today" ? "今天" : activeView === "upcoming" ? "即将到来" : activeView === "tags" ? `标签：${selectedTag?.name}` : activeView === "list" ? selected?.name ?? "清单" : "收件箱"}
          listId={activeView === "inbox" ? null : activeView === "list" ? selected?.id : undefined} tagId={activeView === "tags" ? selectedTag?.id : undefined}
          dateFilters={activeView === "completed" ? { status: "completed" } : activeView === "today" ? { dateView: "today", dateRange: range } : activeView === "upcoming" ? { dateView: "upcoming", dateRange: { from: range.to } } : undefined}
          lists={lists.data ?? []} listsUnavailable={!lists.isSuccess} tags={tags.data ?? []} taskTags={taskTags.data ?? []} tagsUnavailable={!tags.isSuccess || !taskTags.isSuccess} now={now}
          initialDraft={taskDraft} onDraftChange={(value, text) => { taskDirty.current = value; setTaskDraft(text); }} onDetailDirtyChange={value => { detailDirty.current = value; }} onBusyChange={value => { childBusy.current = value; }} />
      </>}
    </div>
  </div>;
}
