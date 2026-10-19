import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, History, MoreHorizontal, Search, X } from "lucide-react";
import { isBrowserDebug } from "@/app/browserDebug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { journalImageStore } from "@/data/repositories/JournalContentRepository";
import { dateKey, fromKey, journalPeriod, parseDateKey, type JournalKind, type JournalRecord } from "@/domain/journal";
import { completedJournalTasks, documentMarkdown, journalDocument, journalKindLabel, journalSearchText, periodJournalRecords } from "@/domain/journalContent";
import type { TaskList } from "@/domain/list";
import { useLocalClock } from "@/features/tasks/useLocalClock";
import { JournalNoteEditor, type JournalFlush } from "./JournalNoteEditor";
import { journalKey, useJournalRecords } from "./queries";
import { JournalCalendar } from "./JournalCalendar";
import { JournalCompletedTasks, completionTime as time } from "./JournalCompletedTasks";
import { JournalPeriodView } from "./JournalPeriodView";
import "./simple-journal.css";

const scopes = { day: "日", week: "周", month: "月", year: "年" } as const;
const previousNames = { day: "前一天", week: "上一周", month: "上个月", year: "上一年" };
const nextNames = { day: "后一天", week: "下一周", month: "下个月", year: "下一年" };
const currentNames = { day: "今天", week: "本周", month: "本月", year: "今年" };
export function JournalWorkspace({ onDirtyChange, onBusyChange, onBeforeLeave }: {
  lists: TaskList[]; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void; onBeforeLeave?: (flush: JournalFlush | null) => void;
}) {
  const recordsQuery = useJournalRecords(), client = useQueryClient(), today = dateKey(useLocalClock());
  const [selected, setSelected] = useState({ kind: "day" as JournalKind, start: today });
  const [scope, setScope] = useState<JournalKind>("day");
  const [history, setHistory] = useState(false), [query, setQuery] = useState(""), [more, setMore] = useState(false), [trash, setTrash] = useState(false);
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const flush = useRef<JournalFlush | null>(null), working = useRef(false), importing = useRef(false), followingToday = useRef(true);
  const callbacks = useRef({ onDirtyChange, onBusyChange, onBeforeLeave }); callbacks.current = { onDirtyChange, onBusyChange, onBeforeLeave };
  const { confirm, confirmation } = useConfirmDialog();
  const stored = recordsQuery.data ?? [], record = stored.find(value => value.kind === selected.kind && value.start === selected.start);
  const period = journalPeriod(scope, selected.start), ranged = periodJournalRecords(stored, scope, selected.start);
  const matches = stored.filter(value => trash ? !!value.deletedAt : !value.deletedAt).filter(value => !query.trim() || journalSearchText(value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => b.start.localeCompare(a.start) || a.kind.localeCompare(b.kind));
  async function prepareLeave() {
    if (working.current || importing.current || (flush.current && !await flush.current())) return false;
    callbacks.current.onDirtyChange(false); callbacks.current.onBusyChange(false); return true;
  }
  const latestLeave = useRef(prepareLeave); latestLeave.current = prepareLeave;
  useEffect(() => { callbacks.current.onBeforeLeave?.(() => latestLeave.current()); return () => { callbacks.current.onBeforeLeave?.(null); callbacks.current.onDirtyChange(false); callbacks.current.onBusyChange(false); }; }, []);
  useEffect(() => { if (followingToday.current && selected.kind === "day" && selected.start !== today) void prepareLeave().then(ok => { if (ok) setSelected({ kind: "day", start: today }); }); }, [today]);
  async function choose(kind: JournalKind, start: string, nextScope = scope) {
    if (kind !== "day") nextScope = "day";
    if (kind === selected.kind && start === selected.start && scope === nextScope || !await prepareLeave()) return;
    followingToday.current = kind === "day" && start === today; setSelected({ kind, start }); setScope(nextScope); setNotice(""); setMore(false);
  }
  function move(offset: number) {
    const date = fromKey(selected.start);
    if (scope === "year") { date.setMonth(0, 1); date.setFullYear(date.getFullYear() + offset); }
    else if (scope === "month") { date.setDate(1); date.setMonth(date.getMonth() + offset); }
    else date.setDate(date.getDate() + offset * (scope === "week" ? 7 : 1));
    void choose("day", dateKey(date));
  }
  async function action(run: () => Promise<void>) {
    if (!await prepareLeave()) return;
    working.current = true; setBusy(true); callbacks.current.onBusyChange(true); setNotice("");
    try { await run(); await client.invalidateQueries({ queryKey: journalKey }); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { working.current = false; setBusy(false); callbacks.current.onBusyChange(false); }
  }
  async function exportCurrent() {
    await action(async () => {
      const saved = await journalRepository.list();
      const entries = scope === "day" ? [saved.find(value => value.kind === selected.kind && value.start === selected.start)] : periodJournalRecords(saved, scope, selected.start);
      const sections: string[] = scope === "day" ? [] : [`# ${scopes[scope]}日记 ${period.start} — ${period.end}\n\n`];
      for (const entry of entries) {
        const kind = entry?.kind ?? selected.kind, start = entry?.start ?? selected.start, images = journalImageStore(kind, start);
        const note = await documentMarkdown(journalDocument(entry), async asset => {
          const blob = await images.image(asset);
          return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片导出失败，请重试。")); reader.readAsDataURL(blob); });
        });
        const completed = completedJournalTasks(entry).map(item => `- [${item.revokedAt ? " " : "x"}] ${item.title.replace(/[\r\n]/g, " ")} · ${time(item.completedAt)}${item.revokedAt ? "（完成已撤销）" : ""}${item.notes ? "\n  " + item.notes.replace(/\n/g, "\n  ") : ""}`).join("\n");
        sections.push(`# ${start} ${journalKindLabel[kind]}\n\n${kind === "day" ? `## 当天完成\n\n${completed || "当天暂无完成任务。"}\n\n` : ""}## 工作补充\n\n${note}\n`);
        if (new Blob(sections).size > 32 * 1024 * 1024) throw new Error("导出内容超过 32 MB，请减少图片后重试。");
      }
      const content = sections.join("\n");
      if (new Blob([content]).size > 32 * 1024 * 1024) throw new Error("导出内容超过 32 MB，请减少图片后重试。");
      const filename = scope === "day" ? `${selected.start}-${journalKindLabel[selected.kind]}.md` : `${period.start}-${period.end}-${scopes[scope]}日记.md`;
      if (isBrowserDebug()) { const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" })), a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("日记已导出。"); }
      else setNotice(await invoke<string>("export_journal_markdown", { content, filename }) === "cancelled" ? "已取消导出。" : "日记已导出。");
    });
  }
  async function restore(value: JournalRecord) { await action(async () => { await journalRepository.save(value, value.revision); setNotice("日记已恢复。"); }); }
  async function erase() {
    setMore(false);
    if (!await prepareLeave() || !await confirm("将这篇日记移入回收站？可以在回收站恢复。", "移入回收站")) return;
    await action(async () => { const value = (await journalRepository.list()).find(value => value.kind === selected.kind && value.start === selected.start); if (value) await journalRepository.remove(value); });
  }
  return <section className="daily-journal" aria-labelledby="inbox-heading">
    {confirmation}
    <header className="daily-header"><div><p className="daily-eyebrow">每日一页 · 工作日记</p><h1 id="inbox-heading" tabIndex={-1}>日记</h1></div><div className="daily-header-actions"><Button variant="ghost" aria-expanded={history} onClick={() => { setHistory(value => !value); setTrash(false); setQuery(""); }}><History size={16} />历史</Button><div className="daily-more"><Button variant="ghost" size="icon" aria-label="日记更多操作" aria-expanded={more} onClick={() => setMore(value => !value)}><MoreHorizontal size={20} /></Button>{more && <div className="daily-menu" role="group" aria-label="日记更多操作"><Button variant="ghost" disabled={busy || (scope === "day" && !!record?.deletedAt)} onClick={() => { setMore(false); void exportCurrent(); }}>导出 Markdown</Button><Button variant="ghost" onClick={() => { setTrash(true); setHistory(true); setMore(false); setQuery(""); }}>回收站</Button><Button variant="ghost" disabled={scope !== "day" || !record || !!record.deletedAt || busy} onClick={() => void erase()}>移入回收站</Button></div>}</div></div></header>
    <div className={`daily-layout ${history ? "has-history" : ""}`}>
      <div className="daily-sidebar">
      <JournalCalendar range={scope === "day" ? undefined : period} selected={selected.kind === "day" ? selected.start : null} anchor={selected.start} today={today} records={stored} disabled={busy} onSelect={date => { void choose("day", date); }} />
      <div className="daily-scope" role="group" aria-label="日记显示范围">{(Object.keys(scopes) as JournalKind[]).map(value => <button type="button" key={value} aria-pressed={scope === value} disabled={busy} onClick={() => { void choose("day", selected.start, value); }}>{scopes[value]}</button>)}</div>
      {history && <aside className="daily-history" aria-label={trash ? "日记回收站" : "日记历史"}><div className="daily-section-heading"><h2>{trash ? "回收站" : "历史日记"}</h2><Button variant="ghost" size="icon-sm" aria-label="收起历史日记" onClick={() => setHistory(false)}><X size={16} /></Button></div><div className="daily-search"><Search size={16} /><Input aria-label="搜索日记" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索日期、任务或补充" /></div><div className="daily-history-list">{matches.map(value => <div key={`${value.kind}:${value.start}`} className="daily-history-item"><button aria-current={value.kind === selected.kind && value.start === selected.start ? "date" : undefined} onClick={() => void choose(value.kind, value.start, "day")}><strong>{value.start}</strong><span>{journalKindLabel[value.kind]}{value.kind === "day" ? ` · ${completedJournalTasks(value).filter(task => !task.revokedAt).length} 项完成` : ""}</span></button>{trash && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void restore(value)}>恢复</Button>}</div>)}{!matches.length && <p className="daily-empty">{query ? "没有匹配的日记" : trash ? "回收站为空" : "还没有历史日记"}</p>}</div></aside>}
      </div>
      <article className="daily-page"><div className="daily-datebar"><div><h2>{scope === "day" ? fromKey(selected.start).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }) : `${scopes[scope]}日记`}</h2>{scope !== "day" ? <p>{period.start} — {period.end}</p> : selected.kind !== "day" && <p>{journalKindLabel[selected.kind]}</p>}</div>
        <nav aria-label="日记日期" className="daily-date-actions">{selected.kind === "day" && <><Button variant="ghost" size="icon-sm" aria-label={previousNames[scope]} disabled={busy} onClick={() => move(-1)}><ChevronLeft size={18} /></Button><label className="daily-date-picker" title="选择日期"><CalendarDays size={18} /><input type="date" aria-label="选择日记日期" value={selected.start} max={today} onChange={event => { try { void choose("day", parseDateKey(event.target.value)); } catch { /* Incomplete native input. */ } }} /></label><Button variant="ghost" size="icon-sm" aria-label={nextNames[scope]} disabled={period.start >= journalPeriod(scope, today).start || busy} onClick={() => move(1)}><ChevronRight size={18} /></Button></>}<Button size="sm" variant="outline" disabled={selected.kind === "day" && period.start === journalPeriod(scope, today).start} onClick={() => void choose("day", today)}>{currentNames[scope]}</Button></nav></div>
      {recordsQuery.isPending ? <p role="status" className="daily-empty">正在读取日记…</p> : recordsQuery.isError ? <div role="alert" className="daily-error">日记读取失败。<Button onClick={() => void recordsQuery.refetch()}>重试</Button></div> : scope !== "day" ? <JournalPeriodView records={ranged} onOpen={date => { void choose("day", date, "day"); }} /> : record?.deletedAt ? <div className="daily-empty"><p>这篇日记在回收站</p><Button variant="outline" disabled={busy} onClick={() => void restore(record)}>恢复日记</Button></div> : <>
        {selected.kind === "day" && <JournalCompletedTasks record={record} />}
        <JournalNoteEditor key={`${selected.kind}:${selected.start}`} kind={selected.kind} start={selected.start} record={record} onDirty={value => callbacks.current.onDirtyChange(value)} onBusy={value => { importing.current = value; callbacks.current.onBusyChange(value); }} onFlush={value => { flush.current = value; }} />
      </>}
      </article>
    </div>{notice && <p role="status" className="daily-notice">{notice}</p>}
  </section>;
}
