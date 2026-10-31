import { useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { journalReviewRepository } from "@/data/repositories/JournalReviewRepository";
import { parseDateKey, type JournalKind, type JournalRecord } from "@/domain/journal";
import { journalSearchText } from "@/domain/journalContent";

export interface JournalSearchProps {
  onOpen: (kind: JournalKind, start: string) => void;
  trash?: boolean;
  onRestore?: (record: JournalRecord) => Promise<void>;
}
const pageSize = 50;
const kindLabels: Record<JournalKind, string> = { day: "日记", week: "历史周总结", month: "月度回顾", year: "年度回顾" };

function searchableText(record: JournalRecord) {
  // Rich text takes precedence in journalSearchText. Preserve searchable legacy
  // fields separately so an old item hit is still visible beside newer content.
  return [...new Set([journalSearchText(record), record.title, record.theme, ...record.items.flatMap(item => [item.title, item.notes, item.theme, item.client, item.business, item.nextAction])].filter(Boolean))].join("\n");
}
function snippet(text: string, query: string) {
  const plain = text.replace(/\s+/g, " ").trim(), keyword = query.trim().toLocaleLowerCase();
  const hit = keyword ? plain.toLocaleLowerCase().indexOf(keyword) : 0;
  const start = Math.max(0, hit - 45), end = Math.min(plain.length, Math.max(start + 170, hit + keyword.length));
  return `${start ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}
function marked(text: string, query: string): ReactNode {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return text;
  const lower = text.toLocaleLowerCase(), parts: ReactNode[] = [];
  let cursor = 0, index = lower.indexOf(keyword);
  while (index >= 0) {
    parts.push(text.slice(cursor, index), <mark key={index}>{text.slice(index, index + keyword.length)}</mark>);
    cursor = index + keyword.length; index = lower.indexOf(keyword, cursor);
  }
  parts.push(text.slice(cursor));
  return parts;
}
function validDate(value: string) {
  try { return !value || parseDateKey(value) === value; } catch { return false; }
}

export function JournalSearch({ onOpen, trash = false, onRestore }: JournalSearchProps) {
  const [filters, setFilters] = useState({ query: "", from: "", to: "", important: false, offset: 0 });
  const [restoring, setRestoring] = useState<string | null>(null), [restoreError, setRestoreError] = useState("");
  const restoreLock = useRef(false), id = useId(), client = useQueryClient();
  const query = filters.query.trim(), { from, to, important, offset } = filters;
  const rangeError = !validDate(from) || !validDate(to) ? "请选择有效日期。" : from && to && from > to ? "开始日期不能晚于结束日期。" : "";
  const records = useQuery({
    queryKey: ["journal", "search", { query, from, to, offset, limit: pageSize, trash }],
    queryFn: async () => {
      const result = await journalRepository.search({ query, from: from || undefined, to: to || undefined, offset, limit: pageSize, trash });
      const missing = result.records.filter(record => query && record.kind === "day" && !searchableText(record).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      // A hit may exist only in a saved highlight. Fetch just those dates' text
      // excerpts; the record page never needs full documents from other days.
      const excerpts = await Promise.all(missing.map(async record => {
        const entries = await journalReviewRepository.list(record.start, record.start, { includeUnavailable: true });
        return [record.start, entries.filter(item => !item.deletedAt && !!item.sourceDeleted === trash).flatMap(item => [item.summary, item.result, item.theme]).join("\n")] as const;
      }));
      return { ...result, highlightText: Object.fromEntries(excerpts) as Record<string, string> };
    },
    enabled: !important && !rangeError, networkMode: "always",
  });
  const highlights = useQuery({
    queryKey: ["journal", "highlight-search", { from, to, trash }],
    queryFn: () => journalReviewRepository.list(from || "1000-01-01", to || "9999-12-31", { includeUnavailable: trash }),
    enabled: important && !rangeError, networkMode: "always",
  });
  const active = important ? highlights : records;
  const matches = (highlights.data ?? []).filter(item => !item.deletedAt && (trash ? item.sourceDeleted : !item.sourceDeleted) && (!query || [item.summary, item.result, item.theme].join("\n").toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const page = matches.slice(offset, offset + pageSize);
  const hasMore = important ? matches.length > offset + pageSize : !!records.data?.hasMore;
  const count = important ? page.length : records.data?.records.length ?? 0;
  function filter(change: Partial<typeof filters>) { setFilters(value => ({ ...value, ...change, offset: 0 })); setRestoreError(""); }
  async function restore(key: string, load: () => Promise<JournalRecord | undefined | null>) {
    if (!onRestore || restoreLock.current) return;
    restoreLock.current = true; setRestoring(key); setRestoreError("");
    try {
      const record = await load();
      if (!record?.deletedAt) throw new Error("来源已不在回收站，请刷新搜索结果。");
      await onRestore(record);
      await client.invalidateQueries({ queryKey: ["journal"] });
    } catch (cause) { setRestoreError(cause instanceof Error ? cause.message : String(cause)); }
    finally { restoreLock.current = false; setRestoring(null); }
  }

  return <section className="review-search" aria-labelledby={`${id}-heading`}>
    <div className="daily-section-heading"><h2 id={`${id}-heading`}>{trash ? "日记回收站" : "搜索日记"}</h2></div>
    <div className="review-search-filters">
      <label className="review-field" htmlFor={`${id}-query`}>关键词<div className="daily-search"><Search size={16} aria-hidden="true" /><Input id={`${id}-query`} type="search" value={filters.query} placeholder="搜索正文、任务、重点和回顾" onChange={event => filter({ query: event.target.value })} /></div></label>
      <label className="review-field" htmlFor={`${id}-from`}>开始日期<Input id={`${id}-from`} type="date" min="1000-01-01" max={to || "9999-12-31"} value={from} aria-invalid={!!rangeError} aria-describedby={rangeError ? `${id}-range-error` : undefined} onChange={event => filter({ from: event.target.value })} /></label>
      <label className="review-field" htmlFor={`${id}-to`}>结束日期<Input id={`${id}-to`} type="date" min={from || "1000-01-01"} max="9999-12-31" value={to} aria-invalid={!!rangeError} aria-describedby={rangeError ? `${id}-range-error` : undefined} onChange={event => filter({ to: event.target.value })} /></label>
      <label className="review-search-toggle"><input type="checkbox" checked={important} onChange={event => filter({ important: event.target.checked })} />只看重点</label>
    </div>
    <p className="daily-search-scope">{important ? "搜索重点摘要、结果说明和工作主题。" : "搜索日记正文、历史事项、任务快照、重点和回顾正文。"}图片中的文字不在搜索范围内。</p>
    {rangeError ? <p id={`${id}-range-error`} role="alert" className="daily-error">{rangeError}</p> : active.isPending ? <p className="daily-empty" role="status">正在搜索…</p> : active.isError ? <div className="daily-error" role="alert"><p>搜索失败，请重试。</p><Button type="button" variant="outline" size="sm" onClick={() => void active.refetch()}>重试搜索</Button></div> : <div className="review-search-results" aria-busy={active.isFetching}>
      <p className="review-search-count" role="status">{count ? `第 ${offset + 1}—${offset + count} 条结果${active.isFetching ? "，正在更新…" : ""}` : trash ? "回收站中没有匹配的记录。" : "没有找到匹配的记录，可调整关键词或日期范围。"}</p>
      <ul className="review-search-list">{important ? page.map(item => <li key={item.id} className="review-search-item">
        <Button type="button" variant="ghost" className="review-search-open" onClick={() => onOpen("day", item.date)} aria-label={`打开${item.date}重点：${item.summary}`}><time dateTime={item.date}>{item.date}</time><span>重点{item.theme ? ` · ${item.theme}` : ""}</span></Button>
        <p className="review-search-snippet">{marked(snippet([item.summary, item.result, item.theme].filter(Boolean).join("\n"), query), query)}</p>
        {(item.sourceDeleted || item.sourceChanged || item.sourceRevoked) && <p className="review-source">{[item.sourceDeleted && "来源在回收站", item.sourceRevoked && "任务完成已撤销", item.sourceChanged && "原文已更新"].filter(Boolean).join(" · ")}</p>}
        {trash && onRestore && <Button type="button" variant="outline" size="sm" disabled={restoring !== null} onClick={() => void restore(item.id, () => journalRepository.get("day", item.date))}>{restoring === item.id ? "正在恢复…" : "恢复来源日记"}</Button>}
      </li>) : records.data?.records.map(record => <li key={`${record.kind}:${record.start}`} className="review-search-item">
        <Button type="button" variant="ghost" className="review-search-open" aria-label={`打开${record.start}${kindLabels[record.kind]}${record.title ? `：${record.title}` : ""}`} onClick={() => onOpen(record.kind, record.start)}><time dateTime={record.start}>{record.start}</time><span>{kindLabels[record.kind]}{record.title ? ` · ${record.title}` : ""}</span></Button>
        <p className="review-search-snippet">{marked(snippet([searchableText(record), records.data?.highlightText[record.start]].filter(Boolean).join("\n"), query), query)}</p>
        {trash && onRestore && <Button type="button" variant="outline" size="sm" disabled={restoring !== null} aria-label={`恢复${record.start}${kindLabels[record.kind]}`} onClick={() => void restore(`${record.kind}:${record.start}`, async () => record)}>{restoring === `${record.kind}:${record.start}` ? "正在恢复…" : "恢复"}</Button>}
      </li>)}</ul>
      {(offset > 0 || hasMore) && <nav className="review-search-pagination" aria-label="搜索结果分页"><Button type="button" variant="outline" size="sm" disabled={offset === 0 || active.isFetching || restoring !== null} onClick={() => setFilters(value => ({ ...value, offset: Math.max(0, value.offset - pageSize) }))}>上一页</Button><span>第 {Math.floor(offset / pageSize) + 1} 页</span><Button type="button" variant="outline" size="sm" disabled={!hasMore || active.isFetching || restoring !== null} onClick={() => setFilters(value => ({ ...value, offset: value.offset + pageSize }))}>下一页</Button></nav>}
    </div>}
    {restoreError && <p role="alert" className="daily-error">{restoreError}</p>}
  </section>;
}
