// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskSubtasks } from "./TaskSubtasks";
import type { Subtask } from "@/domain/subtask";
afterEach(cleanup);

function setup(initial: Subtask[] = []) {
  const changed = vi.fn();
  function Harness() {
    const [items, setItems] = useState<Subtask[]>(initial);
    return <TaskSubtasks items={items} onChange={next => { changed(next); setItems(next); }} onComposition={() => {}} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "添加子任务" }));
  return changed;
}

it("creates consecutive subtasks on Enter and keeps an empty focused entry below them", () => {
  const changed = setup(), input = screen.getByLabelText("新子任务");
  for (const title of ["核对需求", "整理交付材料"]) {
    fireEvent.change(input, { target: { value: title } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect((input as HTMLInputElement).value).toBe("");
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByLabelText("完成子任务：核对需求"));
  expect(changed.mock.lastCall?.[0]).toEqual([
    expect.objectContaining({ title: "核对需求", completed: true }),
    expect.objectContaining({ title: "整理交付材料", completed: false }),
  ]);
});

it("does not submit IME composition and commits remaining text on blur only once", () => {
  const changed = setup(), input = screen.getByLabelText("新子任务");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "中文子任务" } });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(changed).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.blur(input);
  fireEvent.blur(input);
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("完成子任务：中文子任务")).toBeTruthy();
});

it("edits titles inline while retaining completion and date metadata", () => {
  const changed = setup([{ id: "one", title: "核对需求", completed: false, dueAt: "2026-10-20T01:30:00.000Z" }]);
  fireEvent.click(screen.getByLabelText("完成子任务：核对需求"));
  const title = screen.getByLabelText("子任务内容：核对需求");
  fireEvent.change(title, { target: { value: "核对验收需求" } });
  fireEvent.keyDown(title, { key: "Enter" });
  expect(changed.mock.lastCall?.[0]).toEqual([expect.objectContaining({ title: "核对验收需求", completed: true, dueAt: "2026-10-20T01:30:00.000Z" })]);
  fireEvent.change(title, { target: { value: " " } });
  fireEvent.blur(title);
  expect(screen.getByRole("alert").textContent).toContain("标题");
  expect(changed.mock.lastCall?.[0][0].title).toBe("核对验收需求");
});

it("applies independent dates and time, discards dismissed changes and clears a schedule", async () => {
  const changed = setup(), input = screen.getByLabelText("新子任务");
  for (const title of ["核对需求", "归档材料"]) {
    fireEvent.change(input, { target: { value: title } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
  const trigger = screen.getByLabelText("设置子任务日期：核对需求");
  fireEvent.click(trigger);
  let popup = await screen.findByRole("dialog", { name: "子任务日期" });
  fireEvent.click(within(popup).getByLabelText("子任务下个月"));
  fireEvent.click(within(popup).getByLabelText("子任务回到今天"));
  const today = new Date(), key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  expect(within(popup).getByLabelText(key).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(popup).getByRole("button", { name: "确定" }));
  expect(changed.mock.lastCall?.[0][0].dueDate).toBe(key);
  expect(changed.mock.lastCall?.[0][1].dueDate).toBeUndefined();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(trigger);
  popup = await screen.findByRole("dialog", { name: "子任务日期" });
  fireEvent.click(within(popup).getByLabelText("子任务时间"));
  fireEvent.change(within(popup).getByLabelText("子任务小时"), { target: { value: "14" } });
  fireEvent.change(within(popup).getByLabelText("子任务分钟"), { target: { value: "35" } });
  fireEvent.click(within(popup).getByRole("button", { name: "确定" }));
  expect(new Date(changed.mock.lastCall?.[0][0].dueAt).getHours()).toBe(14);
  expect(new Date(changed.mock.lastCall?.[0][0].dueAt).getMinutes()).toBe(35);
  expect(changed.mock.lastCall?.[0][0].dueDate).toBeUndefined();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(trigger);
  popup = await screen.findByRole("dialog", { name: "子任务日期" });
  fireEvent.click(within(popup).getByLabelText("子任务下个月"));
  fireEvent.keyDown(popup, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(trigger);
  popup = await screen.findByRole("dialog", { name: "子任务日期" });
  expect(within(popup).getByLabelText("子任务小时")).toHaveProperty("value", "14");
  fireEvent.click(within(popup).getByRole("button", { name: "清除" }));
  expect(changed.mock.lastCall?.[0][0]).not.toHaveProperty("dueAt");
  expect(changed.mock.lastCall?.[0][0]).not.toHaveProperty("dueDate");
});
