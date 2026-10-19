import { useEffect, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { dateKey, fromKey, type JournalRecord } from "@/domain/journal";

export function JournalCalendar({ selected, anchor, today, records, disabled, range, onSelect }: {
  selected: string | null; anchor: string; today: string; records: JournalRecord[];
  disabled: boolean; onSelect: (date: string) => void;
  range?: { start: string; end: string };
}) {
  const [month, setMonth] = useState(anchor.slice(0, 7));
  useEffect(() => { setMonth(anchor.slice(0, 7)); }, [anchor]);
  const first = fromKey(`${month}-01`), year = first.getFullYear(), index = first.getMonth();
  const offset = (first.getDay() + 6) % 7, count = new Date(year, index + 1, 0).getDate();
  const recorded = new Set(records.filter(record => record.kind === "day" && !record.deletedAt).map(record => record.start));
  function shift(delta: number) { setMonth(dateKey(new Date(year, index + delta, 1)).slice(0, 7)); }
  return <section className="daily-calendar-card" aria-label="日记月历">
    <div className="daily-calendar-brand"><span><BookOpen size={21} aria-hidden="true" /></span><div><strong>客户工作日记</strong><small>对公客户经理工作台</small></div></div>
    <div className="daily-calendar-heading"><h2>{year}年 {index + 1}月</h2><div>
      <button type="button" aria-label="日历上个月" disabled={month === "1000-01"} onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <button type="button" aria-label="日历回到今天" disabled={disabled} onClick={() => { setMonth(today.slice(0, 7)); onSelect(today); }}>今天</button>
      <button type="button" aria-label="日历下个月" disabled={month === "9999-12"} onClick={() => shift(1)}><ChevronRight size={16} /></button>
    </div></div>
    <div className="daily-calendar-grid">
      {"一二三四五六日".split("").map(day => <small key={day}>{day}</small>)}
      {Array.from({ length: offset }, (_, position) => <span key={`blank-${position}`} aria-hidden="true" />)}
      {Array.from({ length: count }, (_, position) => {
        const key = dateKey(new Date(year, index, position + 1)), hasEntry = recorded.has(key);
        return <button type="button" key={key} aria-label={`查看${key}日记`} aria-pressed={selected === key}
          aria-current={key === today ? "date" : undefined} data-has-entry={hasEntry || undefined}
          data-in-range={range && key >= range.start && key <= range.end || undefined}
          title={`${key}${hasEntry ? " · 有日记" : ""}`} disabled={disabled || key > today}
          onClick={() => onSelect(key)}>{position + 1}{hasEntry && <span className="daily-calendar-dot" aria-hidden="true" />}</button>;
      })}
    </div>
  </section>;
}
