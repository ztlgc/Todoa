import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { journalReviewRepository } from "@/data/repositories/JournalReviewRepository";
import { dateKey, fromKey, journalPeriod, parseDateKey, type JournalItem, type JournalKind, type JournalRecord } from "@/domain/journal";
import { journalKindLabel } from "@/domain/journalContent";
import type { HighlightInput, JournalHighlight } from "@/domain/journalReview";
import type { TaskList } from "@/domain/list";
import { useLocalClock } from "@/features/tasks/useLocalClock";
import { JournalNoteEditor, type JournalFlush } from "./JournalNoteEditor";
import { journalKey, useJournalDetail, useJournalHighlights, useJournalIndex, useJournalMaterials, useJournalRange } from "./queries";
import { JournalCalendar } from "./JournalCalendar";
import { JournalCompletedTasks } from "./JournalCompletedTasks";
import { JournalPeriodView } from "./JournalPeriodView";
import { JournalHighlightPanel } from "./JournalHighlightPanel";
import { JournalReviewMaterials } from "./JournalReviewMaterials";
import { JournalSearch } from "./JournalSearch";
import { exportJournalRecords } from "./journalExport";
import "./simple-journal.css";

type View = "day" | "month" | "year" | "search";
type HighlightDraft = { input: HighlightInput; revision: number };
const viewNames = { day: "每日", month: "月度回顾", year: "年度回顾", search: "搜索" } as const;
const templates = {
  day: "主要工作\n\n进展与结果\n\n问题与体会\n",
  week: "本周主要工作\n\n进展与结果\n\n下周关注\n",
  month: "主要工作\n\n重要进展与成果\n\n问题与经验\n\n下月关注\n",
  year: "年度主要工作\n\n重要成果与关键事件\n\n能力与经验\n\n遗留问题\n\n下一年方向\n",
};
export function JournalWorkspace({ onDirtyChange, onBusyChange, onBeforeLeave }: {
  lists: TaskList[]; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void; onBeforeLeave?: (flush: JournalFlush | null) => void;
}) {
  const client = useQueryClient(), today = dateKey(useLocalClock());
  const [selected, setSelected] = useState({ kind: "day" as JournalKind, start: today });
  const [view, setView] = useState<View>("day"), [weekly, setWeekly] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [more, setMore] = useState(false), [trash, setTrash] = useState(false), [originals, setOriginals] = useState(false);
  const [rawMonth, setRawMonth] = useState<string | null>(null);
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [readyVersion, setReadyVersion] = useState(0);
  const [highlightDraft, setHighlightDraft] = useState<HighlightDraft | null>(null);
  const flush = useRef<JournalFlush | null>(null), working = useRef(false), importing = useRef(false), followingToday = useRef(true);
  const navigationVersion = useRef(0), mounted = useRef(true), noteDirty = useRef(false), draftRef = useRef(highlightDraft); draftRef.current = highlightDraft;
  const callbacks = useRef({ onDirtyChange, onBusyChange, onBeforeLeave }); callbacks.current = { onDirtyChange, onBusyChange, onBeforeLeave };
  const { confirm, confirmation } = useConfirmDialog();
  const isReview = view === "month" || view === "year";
  const period = journalPeriod(isReview ? view : weekly ? "week" : "day", selected.start);
  const editorKind = isReview ? view : selected.kind;
  const editorStart = isReview ? period.start : selected.start;
  const detail = useJournalDetail(editorKind, editorStart, view !== "search" && !weekly);
  const record = detail.data ?? undefined;
  const calendarRange = journalPeriod("month", `${calendarMonth}-01`);
  const indexRange = isReview ? period : calendarRange;
  const index = useJournalIndex(indexRange.start, indexRange.end);
  const highlights = useJournalHighlights(period.start, period.end);
  const materials = useJournalMaterials(isReview ? view : "month", period.start, isReview);
  const weekRecords = useJournalRange(period.start, period.end, view === "day" && weekly);
  const storedIndex = index.data ?? [];
  function draftChanged(value: HighlightDraft | null) { setHighlightDraft(value); callbacks.current.onDirtyChange(noteDirty.current || !!value); }
  async function prepareLeave() {
    if (working.current || importing.current || draftRef.current) return false;
    if (flush.current && !await flush.current()) return false;
    callbacks.current.onDirtyChange(false); callbacks.current.onBusyChange(false); return true;
  }
  const latestLeave = useRef(prepareLeave); latestLeave.current = prepareLeave;
  useEffect(() => {
    mounted.current = true;
    callbacks.current.onBeforeLeave?.(() => latestLeave.current());
    return () => { mounted.current = false; callbacks.current.onBeforeLeave?.(null); callbacks.current.onDirtyChange(false); callbacks.current.onBusyChange(false); };
  }, []);
  useEffect(() => {
    if (!followingToday.current || selected.kind !== "day" || view !== "day" || weekly || selected.start === today) return;
    const version = navigationVersion.current;
    void latestLeave.current().then(ok => {
      if (ok && mounted.current && followingToday.current && navigationVersion.current === version) {
        navigationVersion.current++; setSelected({ kind: "day", start: today });
      }
    });
  }, [today, selected.kind, selected.start, readyVersion, busy, view, weekly]);
  async function choose(kind: JournalKind, start: string, nextView: View = kind === "month" || kind === "year" ? kind : "day", nextWeekly = false) {
    const version = ++navigationVersion.current;
    followingToday.current = nextView === "day" && kind === "day" && start === today && !nextWeekly;
    if (draftRef.current) { setNotice("请先保存或取消正在编辑的重点后再切换。"); return; }
    if (!await prepareLeave() || !mounted.current || version !== navigationVersion.current) return;
    setSelected({ kind, start }); setView(nextView); setWeekly(nextWeekly); setMore(false); setNotice(""); setOriginals(false); setRawMonth(null); setTrash(false);
  }
  function move(offset: number) {
    const date = fromKey(selected.start);
    if (view === "year") { date.setMonth(0, 1); date.setFullYear(date.getFullYear() + offset); }
    else if (view === "month") { date.setDate(1); date.setMonth(date.getMonth() + offset); }
    else date.setDate(date.getDate() + offset * (weekly ? 7 : 1));
    void choose(view === "month" || view === "year" ? view : "day", dateKey(date), view, weekly);
  }
  async function action(run: () => Promise<void>) {
    if (!await prepareLeave()) return;
    working.current = true; setBusy(true); callbacks.current.onBusyChange(true); setNotice("");
    try { await run(); await client.invalidateQueries({ queryKey: journalKey }); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { working.current = false; setBusy(false); callbacks.current.onBusyChange(false); }
  }
  async function capture(text: string, task?: JournalItem) {
    if (draftRef.current) { setNotice("请先保存或取消正在编辑的重点。"); return; }
    if (!await prepareLeave()) return;
    const saved = await journalRepository.get("day", selected.start);
    const existing = task && (highlights.data ?? []).find(item => item.sourceType === "task" && item.sourceId === task.id);
    draftChanged(existing ? { input: existing, revision: existing.revision } : {
      input: { id: crypto.randomUUID(), date: selected.start, summary: text, result: "", theme: task?.theme ?? "", sourceType: task ? "task" : "note", sourceId: task?.id ?? crypto.randomUUID(), sourceRevision: task ? 0 : saved?.contentRevision ?? 0 }, revision: 0,
    });
  }
  async function saveHighlight(input: HighlightInput, revision: number) {
    // Save the note first so the source revision belongs to a durable document.
    if (flush.current && !await flush.current()) throw new Error("请先解决工作记录的保存问题，再保存重点。");
    const saved = await journalRepository.get("day", input.date);
    await journalReviewRepository.save({ ...input, sourceRevision: input.sourceType === "note" ? saved?.contentRevision ?? 0 : input.sourceRevision }, revision);
    await client.invalidateQueries({ queryKey: journalKey }); setNotice("重点已保存，可在月度和年度回顾中使用。");
  }
  async function addMaterial(source: { type: "highlight" | "month"; id: string }) {
    if (!isReview) return;
    await action(async () => {
      const saved = await journalRepository.get(view, period.start);
      await journalReviewRepository.addMaterial(view, period.start, source, saved?.contentRevision ?? 0);
      setNotice("素材已加入回顾。");
    });
  }
  async function exportCurrent(raw = false) {
    await action(async () => {
      const entries = raw || weekly ? (await journalRepository.range(period.start, period.end)).filter(value => !value.deletedAt) : [await journalRepository.get(editorKind, editorStart)].filter((value): value is JournalRecord => !!value && !value.deletedAt);
      if (!entries.length) { setNotice("当前范围还没有可导出的内容。"); return; }
      const name = raw || weekly ? `${period.start}-${period.end}-原始日记` : `${editorStart}-${isReview ? viewNames[view] : "日记"}`;
      setNotice(await exportJournalRecords(entries, `${name}.md`, name));
    });
  }
  async function restore(value: JournalRecord) { await action(async () => { await journalRepository.save(value, value.revision); setNotice("日记已恢复。"); }); }
  async function erase() {
    setMore(false);
    if (!record || !await prepareLeave() || !await confirm("将这篇记录移入回收站？可以在回收站恢复。", "移入回收站")) return;
    await action(async () => { const saved = await journalRepository.get(editorKind, editorStart); if (saved) await journalRepository.remove(saved); });
  }
  const heading = isReview ? `${editorStart.slice(0, 4)}年${view === "month" ? `${Number(editorStart.slice(5, 7))}月` : ""}${view === "month" ? "工作回顾" : "年度回顾"}` : weekly ? "本周工作记录" : fromKey(selected.start).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  return <section className="daily-journal" aria-labelledby="inbox-heading">
    {confirmation}
    <header className="daily-header"><div><h1 id="inbox-heading" tabIndex={-1}>工作日记</h1><p className="review-subtitle">记下每天的工作，留住值得回顾的进展。</p></div><div className="daily-more"><Button variant="ghost" size="icon" aria-label="日记更多操作" aria-expanded={more} onClick={() => setMore(value => !value)}><MoreHorizontal size={20} /></Button>{more && <div className="daily-menu" role="group" aria-label="日记更多操作">
      <Button variant="ghost" disabled={busy || view === "search" || !!record?.deletedAt} onClick={() => { setMore(false); void exportCurrent(); }}>{isReview ? "导出当前回顾" : weekly ? "导出本周原始日记" : "导出当前日记"}</Button>
      {isReview && <Button variant="ghost" disabled={busy} onClick={() => { setMore(false); void exportCurrent(true); }}>{view === "month" ? "导出本月原始日记" : "导出全年原始日记"}</Button>}
      <Button variant="ghost" onClick={() => { void prepareLeave().then(ok => { if (ok) { setTrash(true); setView("search"); setMore(false); } }); }}>回收站</Button>
      <Button variant="ghost" disabled={!record || !!record.deletedAt || busy || weekly || view === "search"} onClick={() => void erase()}>移入回收站</Button>
    </div>}</div></header>
    <nav className="review-tabs" aria-label="日记工作区">{(Object.keys(viewNames) as View[]).map(value => <Button key={value} variant={view === value && !trash ? "secondary" : "ghost"} aria-current={view === value && !trash ? "page" : undefined} onClick={() => void choose(value === "month" || value === "year" ? value : "day", selected.start, value)}>{value === "search" && <Search size={15} />}{viewNames[value]}</Button>)}</nav>
    {notice && <p className="daily-notice" role="status">{notice}</p>}
    {view === "search" ? <JournalSearch key={trash ? "trash" : "search"} trash={trash} onOpen={(kind, start) => { void choose(kind, start); }} onRestore={restore} /> : <div className={`daily-layout ${isReview ? "review-layout" : ""}`}>
      {!isReview && <aside className="daily-sidebar"><JournalCalendar selected={selected.start} anchor={selected.start} today={today} records={storedIndex} disabled={busy} range={weekly ? period : undefined} onMonthChange={setCalendarMonth} onSelect={date => { void choose("day", date, "day", weekly); }} /><div className="review-daily-tools"><Button variant={weekly ? "secondary" : "ghost"} onClick={() => void choose("day", selected.start, "day", !weekly)}>{weekly ? "回到每日编辑" : "查看本周记录"}</Button></div></aside>}
      <article className="daily-page"><div className="daily-datebar"><div><h2>{heading}</h2>{(isReview || weekly) && <p>{period.start} — {period.end}{view === "year" && selected.start.slice(0, 4) === today.slice(0, 4) ? `（记录截至 ${today}）` : ""}</p>}{!isReview && selected.kind !== "day" && <p>{journalKindLabel[selected.kind]}</p>}</div>
        <nav aria-label="日记日期" className="daily-date-actions"><Button variant="ghost" size="icon-sm" aria-label={view === "year" ? "上一年" : view === "month" ? "上个月" : weekly ? "上一周" : "前一天"} disabled={busy} onClick={() => move(-1)}><ChevronLeft size={18} /></Button><label className="daily-date-picker" title="选择日期"><CalendarDays size={18} /><input type={view === "month" || view === "year" ? "month" : "date"} aria-label="选择日记日期" value={isReview ? selected.start.slice(0, 7) : selected.start} max={isReview ? today.slice(0, 7) : today} onChange={event => { try { void choose(isReview ? view : "day", parseDateKey(isReview ? `${event.target.value}-01` : event.target.value), view, weekly); } catch { /* Incomplete native input. */ } }} /></label><Button variant="ghost" size="icon-sm" aria-label={view === "year" ? "下一年" : view === "month" ? "下个月" : weekly ? "下一周" : "后一天"} disabled={period.start >= journalPeriod(isReview ? view : weekly ? "week" : "day", today).start || busy} onClick={() => move(1)}><ChevronRight size={18} /></Button><Button variant="outline" size="sm" onClick={() => void choose(isReview ? view : "day", today, view, weekly)}>{view === "year" ? "今年" : view === "month" ? "本月" : weekly ? "本周" : "今天"}</Button></nav>
      </div>
      {weekly ? weekRecords.isPending ? <p role="status" className="daily-empty">正在读取本周记录…</p> : weekRecords.isError ? <div className="daily-error" role="alert">读取失败。<Button onClick={() => void weekRecords.refetch()}>重试</Button></div> : <JournalPeriodView records={(weekRecords.data ?? []).filter(value => !value.deletedAt)} onOpen={date => { void choose("day", date); }} /> : detail.isPending ? <p className="daily-empty" role="status">正在读取记录…</p> : detail.isError ? <div role="alert" className="daily-error">日记读取失败。<Button onClick={() => void detail.refetch()}>重试</Button></div> : record?.deletedAt ? <div className="daily-empty"><p>这篇记录在回收站</p><Button variant="outline" disabled={busy} onClick={() => void restore(record)}>恢复日记</Button></div> : <>
        <div className={isReview ? "review-composition" : ""}>
          <JournalNoteEditor key={`${editorKind}:${editorStart}`} kind={editorKind} start={editorStart} record={record} title={isReview ? "回顾正文" : selected.kind === "week" ? "历史周总结" : "今日工作记录"} label={isReview ? "回顾正文" : "日记工作记录"} template={templates[editorKind]} onCapture={!isReview && selected.kind === "day" ? text => { void capture(text).catch(cause => setNotice(String(cause))); } : undefined} onReady={() => setReadyVersion(value => value + 1)} onDirty={value => { noteDirty.current = value; callbacks.current.onDirtyChange(value || !!draftRef.current); }} onBusy={value => { importing.current = value; callbacks.current.onBusyChange(value); }} onFlush={value => { flush.current = value; }} />
          {isReview && <aside className="review-materials-side">{highlights.isError || materials.isError ? <div className="daily-error" role="alert">素材读取失败。<Button onClick={() => { void highlights.refetch(); void materials.refetch(); }}>重试</Button></div> : highlights.isPending || materials.isPending ? <p role="status">正在读取回顾素材…</p> : <JournalReviewMaterials kind={view} start={period.start} highlights={highlights.data ?? []} materials={materials.data ?? []} busy={busy} onAdd={addMaterial} onOpen={(kind, start) => { void choose(kind, start); }} />}</aside>}
        </div>
        {!isReview && selected.kind === "day" && <><JournalCompletedTasks record={record} onCapture={item => { void capture(item.title, item).catch(cause => setNotice(String(cause))); }} />{highlights.isError ? <div className="daily-error" role="alert">重点读取失败。<Button onClick={() => void highlights.refetch()}>重试</Button></div> : <JournalHighlightPanel date={selected.start} highlights={highlights.data ?? []} draft={highlightDraft} contentRevision={record?.contentRevision ?? 0} onDraftChange={draftChanged} onSave={saveHighlight} onRemove={async (item: JournalHighlight) => { await journalReviewRepository.remove(item); await client.invalidateQueries({ queryKey: journalKey }); }} onOpen={date => { void choose("day", date); }} onBusy={value => { working.current = value; setBusy(value); callbacks.current.onBusyChange(value); }} />}</>}
      </>}
      {isReview && <section className="review-originals"><Button variant="outline" aria-expanded={originals} onClick={() => setOriginals(value => !value)}>{originals ? "收起原始日记" : view === "month" ? "查看本月全部原始日记" : "按月查看全年原始日记"}</Button>{originals && <div>{index.isError ? <p role="alert">原始日记索引读取失败。<Button onClick={() => void index.refetch()}>重试</Button></p> : index.isPending ? <p role="status">正在读取日记索引…</p> : view === "year" ? Array.from({ length: 12 }, (_, month) => `${period.start.slice(0, 4)}-${String(month + 1).padStart(2, "0")}`).filter(month => month <= today.slice(0, 7)).map(month => <div key={month} className="review-raw-month"><Button variant="ghost" aria-expanded={rawMonth === month} onClick={() => setRawMonth(value => value === month ? null : month)}>{Number(month.slice(5))}月原始日记</Button>{rawMonth === month && <DayIndex entries={storedIndex.filter(entry => entry.start.startsWith(month))} onOpen={date => { void choose("day", date); }} />}</div>) : <DayIndex entries={storedIndex} onOpen={date => { void choose("day", date); }} />}</div>}</section>}
      </article>
    </div>}
  </section>;
}
function DayIndex({ entries, onOpen }: { entries: { kind: JournalKind; start: string; deletedAt: string | null; completionCount: number }[]; onOpen: (date: string) => void }) {
  const days = entries.filter(entry => entry.kind === "day" && !entry.deletedAt);
  return days.length ? <ul className="review-day-index">{days.map(entry => <li key={entry.start}><Button variant="ghost" onClick={() => onOpen(entry.start)}>{entry.start}<span>{entry.completionCount ? `${entry.completionCount} 条完成记录` : "工作记录"}</span></Button></li>)}</ul> : <p className="daily-empty">这段时间还没有原始日记，可以回到每日页补记。</p>;
}
