import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TaskList } from "@/domain/list";
import type { Tag, TaskTag } from "@/domain/tag";
import { TaskDetails } from "@/features/tasks/TaskDetails";
import { useTasks } from "@/features/tasks/queries";
import { CalendarMonth } from "./CalendarMonth";
import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";

export function CalendarView({ lists, listsUnavailable, tags, taskTags, tagsUnavailable, onDetailDirtyChange }: {
  lists: TaskList[]; listsUnavailable: boolean; tags: Tag[]; taskTags: TaskTag[]; tagsUnavailable: boolean; onDetailDirtyChange: (dirty: boolean) => void;
}) {
  const tasks = useTasks();
  const [detail, setDetail] = useState<{ id: number; returnTo: HTMLElement }>();
  const detailDirty = useRef(false);
  const { confirm, confirmation } = useConfirmDialog();
  return <section aria-labelledby="inbox-heading" className="space-y-5">
    {confirmation}
    <h1 id="inbox-heading" tabIndex={-1} className="text-3xl font-semibold outline-none">日历</h1>
    <p className="text-sm text-muted-foreground">按本地日期查看设置了截止时间的任务。点击日期查看当天任务，点击任务编辑详情。</p>
    {tasks.isPending && <p role="status">正在读取日历任务…</p>}
    {tasks.isError && <div role="alert" className="space-y-2"><p>日历任务读取失败。</p><Button variant="outline" onClick={() => void tasks.refetch()}>重新读取</Button></div>}
    {tasks.isSuccess && <CalendarMonth tasks={tasks.data} onTaskClick={(id, returnTo) => { void (async () => { if (detail?.id === id) return; if (detailDirty.current && !(await confirm("当前任务详情尚未保存。放弃修改并打开另一项任务？"))) return; detailDirty.current = false; onDetailDirtyChange(false); setDetail({ id, returnTo }); })(); }} />}
    {detail && <TaskDetails key={detail.id} {...detail} lists={lists} listsUnavailable={listsUnavailable} tags={tags} taskTags={taskTags} tagsUnavailable={tagsUnavailable} onDirtyChange={(value) => { detailDirty.current = value; onDetailDirtyChange(value); }} onClosed={() => { detailDirty.current = false; onDetailDirtyChange(false); setDetail(undefined); }} />}
  </section>;
}
