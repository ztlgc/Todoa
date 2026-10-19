import { Button } from "@/components/ui/button";
import { fromKey, type JournalRecord } from "@/domain/journal";
import { JournalCompletedTasks } from "./JournalCompletedTasks";
import { JournalContentPreview } from "./JournalContentPreview";

export function JournalPeriodView({ records, onOpen }: { records: JournalRecord[]; onOpen: (date: string) => void }) {
  return <section className="daily-range" aria-label="时间范围内的日记">
    {records.length ? records.map(record => <article className="daily-range-entry" aria-label={`${record.start}日记`} key={record.start}>
      <header className="daily-range-heading"><h2>{fromKey(record.start).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</h2><Button size="sm" variant="ghost" aria-label={`打开${record.start}日记`} onClick={() => onOpen(record.start)}>打开日记</Button></header>
      <JournalCompletedTasks record={record} headingId={`completed-${record.start}`} />
      <div className="daily-range-supplement"><h3>工作补充</h3><JournalContentPreview record={record} /></div>
    </article>) : <p className="daily-empty">这段时间还没有日记。</p>}
  </section>;
}
