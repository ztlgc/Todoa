import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { dateKey, journalPeriod, type JournalKind } from "@/domain/journal";
import type { JournalHighlight, JournalReviewMaterial } from "@/domain/journalReview";

export interface JournalReviewMaterialsProps {
  kind: "month" | "year";
  start: string;
  highlights: JournalHighlight[];
  materials: JournalReviewMaterial[];
  busy: boolean;
  onAdd: (source: { type: "highlight" | "month"; id: string }) => Promise<void>;
  onOpen: (kind: JournalKind, start: string) => void;
}

function sourceStatus(source: { sourceDeleted: boolean; sourceChanged: boolean; sourceRevoked: boolean }) {
  return [source.sourceDeleted && "来源在回收站", source.sourceRevoked && "任务完成已撤销", source.sourceChanged && "来源已更新"].filter(Boolean).join(" · ");
}
export function JournalReviewMaterials({ kind, start, highlights, materials, busy, onAdd, onOpen }: JournalReviewMaterialsProps) {
  const [theme, setTheme] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const adding = useRef(false);
  const id = useId(), period = journalPeriod(kind, start), today = dateKey(new Date());
  const entries = highlights.filter(item => !item.deletedAt && item.date >= period.start && item.date <= period.end);
  const themes = [...new Set(entries.map(item => item.theme.trim()))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const activeTheme = theme !== null && themes.includes(theme) ? theme : null;
  const shown = entries.filter(item => activeTheme === null || item.theme.trim() === activeTheme);
  const groups = [...new Set(shown.map(item => item.theme.trim()))].sort((a, b) => a ? b ? a.localeCompare(b, "zh-CN") : -1 : 1);
  const selected = new Set(materials.map(item => `${item.sourceType}:${item.sourceId}`));
  const unavailable = materials.filter(item => item.sourceDeleted || item.sourceChanged || item.sourceRevoked);
  const locked = busy || pending !== null;
  async function add(source: { type: "highlight" | "month"; id: string }) {
    if (locked || adding.current) return;
    adding.current = true; setPending(`${source.type}:${source.id}`);
    // The workspace owns persistence and its error notice.
    try { await onAdd(source); } catch { /* The parent displays the failure. */ }
    finally { adding.current = false; setPending(null); }
  }

  return <section className="review-materials" aria-labelledby={`${id}-heading`} aria-busy={locked}>
    <div className="daily-section-heading"><h3 id={`${id}-heading`}>{kind === "month" ? "本月素材" : "全年素材"}</h3></div>
    <p className="daily-search-scope">选择值得回顾的重点加入正文，已加入的文字会保留当时的摘录。</p>
    {kind === "year" && <section className="review-months" aria-labelledby={`${id}-months`}>
      <h4 id={`${id}-months`}>按月份查看回顾</h4>
      <ul className="review-month-list">{Array.from({ length: 12 }, (_, index) => {
        const monthStart = `${period.start.slice(0, 4)}-${String(index + 1).padStart(2, "0")}-01`;
        const future = monthStart > today, added = selected.has(`month:${monthStart}`);
        return <li key={monthStart} className="review-month-item"><Button type="button" variant="ghost" size="sm" disabled={locked || future} aria-label={`打开${monthStart.slice(0, 7)}月度回顾`} onClick={() => onOpen("month", monthStart)}>{index + 1} 月回顾</Button><Button type="button" variant="outline" size="sm" disabled={locked || future || added} aria-label={`${added ? "已加入" : "加入"}${monthStart.slice(0, 7)}月度回顾`} onClick={() => void add({ type: "month", id: monthStart })}>{added ? "已加入" : pending === `month:${monthStart}` ? "正在加入…" : "加入月度回顾"}</Button>{future && <span className="review-source">尚未到来</span>}</li>;
      })}</ul>
    </section>}
    <div className="review-theme-filter" role="group" aria-label="按工作主题筛选">
      <Button type="button" size="sm" variant={activeTheme === null ? "outline" : "ghost"} aria-pressed={activeTheme === null} onClick={() => setTheme(null)}>全部主题</Button>
      {themes.filter(Boolean).map(value => <Button key={value} type="button" size="sm" variant={activeTheme === value ? "outline" : "ghost"} aria-pressed={activeTheme === value} onClick={() => setTheme(value)}>{value}</Button>)}
      {themes.includes("") && <Button type="button" size="sm" variant={activeTheme === "" ? "outline" : "ghost"} aria-pressed={activeTheme === ""} onClick={() => setTheme("")}>未分类</Button>}
    </div>
    {!entries.length && <p className="daily-empty">{kind === "month" ? "先查看本月日记，选择值得回顾的内容。" : "可直接从全年日记收录重点，也可选用已有月度回顾。"}</p>}
    {groups.map((group, index) => <section key={group} className="review-material-group" aria-labelledby={`${id}-theme-${index}`}>
      <h4 id={`${id}-theme-${index}`}>{group || "未分类"}</h4>
      <ul className="review-material-list">{shown.filter(item => item.theme.trim() === group).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map(item => {
        const added = selected.has(`highlight:${item.id}`), unavailable = item.sourceDeleted || item.sourceRevoked;
        return <li key={item.id} className="review-material-item"><div className="review-item-heading"><time dateTime={item.date}>{item.date}</time><strong>{item.summary}</strong></div>{item.result && <p className="review-item-result">{item.result}</p>}{sourceStatus(item) && <p className="review-source" role="status">{sourceStatus(item)}</p>}<div className="review-item-actions"><Button type="button" size="sm" variant="ghost" disabled={locked} aria-label={`查看${item.date}重点原文：${item.summary}`} onClick={() => onOpen("day", item.date)}>查看原文</Button><Button type="button" size="sm" variant="outline" disabled={locked || added || unavailable} aria-label={`${added ? "已加入回顾" : "加入回顾"}：${item.summary}`} onClick={() => void add({ type: "highlight", id: item.id })}>{added ? "已加入回顾" : pending === `highlight:${item.id}` ? "正在加入…" : "加入回顾"}</Button></div></li>;
      })}</ul>
    </section>)}
    {!!unavailable.length && <section className="review-material-status" aria-labelledby={`${id}-status`}><h4 id={`${id}-status`}>已选素材的来源状态</h4><ul className="review-material-list">{unavailable.map(item => <li key={`${item.sourceType}:${item.sourceId}`} className="review-material-item"><p>{item.snapshot || (item.sourceType === "month" ? `${item.sourceId.slice(0, 7)} 月度回顾` : "已选重点")}</p><p className="review-source">{sourceStatus(item)} · 回顾中的摘录已保留</p></li>)}</ul></section>}
  </section>;
}
