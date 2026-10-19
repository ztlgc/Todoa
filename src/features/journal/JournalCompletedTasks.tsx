import { Check } from "lucide-react";
import { completedJournalTasks } from "@/domain/journalContent";
import type { JournalRecord } from "@/domain/journal";

export const completionTime = (value?: string | null) => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
export function JournalCompletedTasks({ record, headingId = "daily-completed-heading" }: { record?: JournalRecord; headingId?: string }) {
  const tasks = completedJournalTasks(record);
  return <section className="daily-completed" aria-labelledby={headingId}>
    <div className="daily-section-heading"><h2 id={headingId}>当天完成 <span>{tasks.filter(item => !item.revokedAt).length}</span></h2><span className="daily-auto-label">自动记录</span></div>
    {tasks.length ? <ul className="daily-task-list">{tasks.map(item => <li key={item.id} className={item.revokedAt ? "is-revoked" : ""}>
      <Check size={17} aria-hidden="true" /><details><summary><span>{item.title}</span><time dateTime={item.completedAt ?? undefined}>{completionTime(item.completedAt)}</time></summary>
      {item.notes && <p>{item.notes}</p>}{item.revokedAt && <p>完成已撤销 · {new Date(item.revokedAt).toLocaleString("zh-CN")}</p>}{!item.notes && !item.revokedAt && <p>完成于 {completionTime(item.completedAt)}</p>}
      </details></li>)}</ul> : <p className="daily-empty">当天暂无完成任务，完成后会自动出现在这里。</p>}
  </section>;
}
