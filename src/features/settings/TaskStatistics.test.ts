import { expect, it } from "vitest";
import type { Task } from "@/domain/task";
import { summarizeTasks } from "./TaskStatistics";

const now = new Date(2026, 9, 6, 12);
const localDue = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const task = (id: number, status: Task["status"], dueAt: string | null): Task => ({
  id, listId: null, title: `Task ${id}`, notes: "", status, dueAt,
  completedAt: status === "completed" ? now.toISOString() : null,
  sortOrder: id, createdAt: now.toISOString(), updatedAt: now.toISOString(),
});

it("counts completion, overdue tasks and local-day due tasks", () => {
  const tasks = [
    task(1, "todo", localDue(5, 23)),
    task(2, "todo", localDue(6, 9)),
    task(3, "todo", localDue(6, 18)),
    task(4, "completed", localDue(6, 8)),
  ];
  expect(summarizeTasks(tasks, now)).toEqual({ total: 4, pending: 3, completed: 1, overdue: 2, dueToday: 2, completionRate: 25 });
  expect(summarizeTasks([], now).completionRate).toBe(0);
});
