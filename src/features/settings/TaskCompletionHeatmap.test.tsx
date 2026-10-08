// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Task } from "@/domain/task";
import { buildCompletionHeatmap, TaskCompletionHeatmap } from "./TaskCompletionHeatmap";

const now = new Date(2026, 9, 7, 12);
const time = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString();
const task = (id: number, completedAt: string | null, extra: Partial<Task> = {}): Task => ({
  id, listId: null, title: `Task ${id}`, notes: "", status: "completed", dueAt: null,
  completedAt, sortOrder: id, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...extra,
});
afterEach(cleanup);

it("groups retained completions by local date and calendar year, excluding reopened, trashed and future tasks", () => {
  const data = buildCompletionHeatmap([
    task(1, time(2026, 1, 1)), task(2, time(2025, 12, 31)),
    task(3, time(2026, 10, 7, 0)), task(4, time(2026, 10, 7, 23)),
    task(5, time(2026, 10, 8)), task(6, time(2026, 10, 7), { status: "todo" }),
    task(7, time(2026, 10, 7), { deletedAt: now.toISOString() }),
    task(8, null), task(9, "invalid"),
  ], now);
  expect(data.days).toHaveLength(365);
  expect(data.days[0]).toMatchObject({ key: "2026-01-01", count: 1 });
  expect(data.months[9].days[6]).toMatchObject({ key: "2026-10-07", count: 2 });
  expect(data.months[9].days[7]).toMatchObject({ count: 0, future: true });
  expect(data.days.reduce((sum, day) => sum + day.count, 0)).toBe(3);
});

it("builds twelve chronological months, including leap day and correct month endings", () => {
  const data = buildCompletionHeatmap([], now, 2024);
  expect(data.months.map(month => month.month)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(data.days).toHaveLength(366);
  expect(data.months[1].days[28].key).toBe("2024-02-29");
  expect(data.months[3].days).toHaveLength(30);
  expect(data.days[365].key).toBe("2024-12-31");
});

it("switches year/month views, keeps the selected month, and navigates across year boundaries", () => {
  render(<TaskCompletionHeatmap tasks={[task(1, now.toISOString()), task(2, time(2026, 1, 1))]} now={now} />);
  expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(Array.from({ length: 12 }, (_, index) => `${index + 1}月`));
  const january = screen.getByRole("group", { name: "2026年1月每日完成数量" });
  expect(within(january).getAllByRole("button").map(button => button.getAttribute("data-date"))).toEqual(Array.from({ length: 31 }, (_, index) => `2026-01-${String(index + 1).padStart(2, "0")}`));
  fireEvent.click(screen.getByRole("button", { name: "2026-01-01：完成 1 项" }));
  fireEvent.click(screen.getByRole("button", { name: "月视图" }));
  expect(screen.getByRole("button", { name: "月视图" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("group", { name: /每日完成数量/ })).toHaveLength(1);
  expect(screen.getByText("2026 年 1 月")).toBeTruthy();
  expect(screen.getByRole("button", { name: "2026-01-01：完成 1 项" }).textContent).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "上个月" }));
  expect(screen.getByText("2025 年 12 月")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "本月" }));
  expect(screen.getByText("2026 年 10 月")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "年视图" }));
  fireEvent.click(screen.getByRole("button", { name: "上一年" }));
  expect(screen.getByText("2025 年")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "今年" }));
  expect(screen.getByText("2026 年")).toBeTruthy();
});

it("follows grid rows with arrow keys, crossing month boundaries and refreshing counts", () => {
  const { rerender } = render(<TaskCompletionHeatmap tasks={[task(1, now.toISOString())]} now={now} />);
  const today = screen.getByRole("button", { name: "2026-10-07：完成 1 项" });
  fireEvent.click(today);
  fireEvent.keyDown(today, { key: "ArrowLeft" });
  expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-06");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-01");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  expect(document.activeElement?.getAttribute("data-date")).toBe("2026-09-30");
  fireEvent.click(today);
  rerender(<TaskCompletionHeatmap tasks={[]} now={now} />);
  expect(screen.getByRole("status").textContent).toBe("2026-10-07：完成 0 项");
  expect(screen.getAllByRole("button").filter(button => button.hasAttribute("data-date") && button.tabIndex === 0)).toHaveLength(1);
});

it("uses the current rendered column count for vertical keyboard movement", () => {
  render(<TaskCompletionHeatmap tasks={[]} now={now} />);
  fireEvent.click(screen.getByRole("button", { name: "月视图" }));
  const grid = screen.getByRole("group", { name: "2026年10月每日完成数量" });
  grid.style.gridTemplateColumns = Array(10).fill("40px").join(" ");
  const day = screen.getByRole("button", { name: "2026-10-15：完成 0 项" });
  fireEvent.keyDown(day, { key: "ArrowUp" });
  expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-05");
  grid.style.gridTemplateColumns = Array(6).fill("40px").join(" ");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-11");
});
