import { Button } from "@/components/ui/button";
import type { Task } from "@/domain/task";
import { useTasks } from "@/features/tasks/queries";
import { useLocalClock } from "@/features/tasks/useLocalClock";
import { TaskCompletionHeatmap } from "./TaskCompletionHeatmap";

export function summarizeTasks(tasks: Task[], now: Date) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayStart = today.toISOString();
  const tomorrowStart = tomorrow.toISOString();
  const currentTime = now.toISOString();
  const completed = tasks.filter(task => task.status === "completed").length;
  const pending = tasks.length - completed;
  const overdue = tasks.filter(task => task.status === "todo" && task.dueAt !== null && task.dueAt < currentTime).length;
  const dueToday = tasks.filter(task => task.status === "todo" && task.dueAt !== null && task.dueAt >= todayStart && task.dueAt < tomorrowStart).length;
  return { total: tasks.length, completed, pending, overdue, dueToday, completionRate: tasks.length ? Math.round(completed / tasks.length * 100) : 0 };
}

export function TaskStatistics() {
  const tasks = useTasks();
  const now = useLocalClock();
  if (tasks.isPending) return <p role="status" className="mt-6 text-sm text-muted-foreground">正在读取任务统计…</p>;
  if (tasks.isError) return <div role="alert" className="mt-6 space-y-3 rounded-xl border border-border p-5"><p>任务统计读取失败。</p><Button variant="outline" onClick={() => void tasks.refetch()}>重新读取</Button></div>;

  const summary = summarizeTasks(tasks.data, now);
  const cards = [
    { label: "全部任务", value: summary.total },
    { label: "待办任务", value: summary.pending },
    { label: "已完成", value: summary.completed },
    { label: "已逾期", value: summary.overdue },
  ];
  return <div className="mt-6 space-y-5">
    <p className="text-sm text-muted-foreground">统计当前保留的全部任务，包含收件箱和所有清单。</p>
    <TaskCompletionHeatmap tasks={tasks.data} now={now} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(card => <div key={card.label} className="rounded-xl border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{card.label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{card.value}</p></div>)}
    </div>
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold">完成进度</h2><p className="mt-1 text-xs text-muted-foreground">已完成任务占全部任务的比例</p></div><strong className="text-2xl tabular-nums">{summary.completionRate}%</strong></div>
      <div role="progressbar" aria-label="任务完成率" aria-valuenow={summary.completionRate} aria-valuemin={0} aria-valuemax={100} className="mt-4 h-2.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${summary.completionRate}%` }} /></div>
    </div>
    <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-base font-semibold">今天到期</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{summary.dueToday} <span className="text-sm font-normal text-muted-foreground">项待办任务</span></p><p className="mt-2 text-xs text-muted-foreground">按本地日期统计；逾期指截止时刻已过且尚未完成。</p></div>
  </div>;
}
