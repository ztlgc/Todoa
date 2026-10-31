// @vitest-environment jsdom
import { useEffect, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { dateKey, emptyJournal } from "@/domain/journal";
import { plainDocument, plainText } from "@/domain/contentDocument";
import type { Task } from "@/domain/task";
import type { JSONContent } from "@tiptap/react";
import type { JournalFlush } from "./JournalNoteEditor";
import { JournalWorkspace } from "./JournalWorkspace";

vi.mock("@/data/repositories/JournalRepository", async importOriginal => {
  const module = await importOriginal<typeof import("@/data/repositories/JournalRepository")>();
  return { ...module, journalRepository: new module.JournalRepository(undefined, () => true, () => localStorage, "simple-ui-test") };
});
// Exercise real autosave/repository behavior; browser QA covers Tiptap itself.
vi.mock("@/features/tasks/TaskContentEditor", () => ({ ContentEditor: function MockEditor(props: { initial: JSONContent; label: string; editable: boolean; onChange: (doc: JSONContent) => void; onEditor: (value: unknown) => void; onComposition: (value: boolean) => void }) {
  const [text, setText] = useState(plainText(props.initial)), latest = useRef(props); latest.current = props;
  useEffect(() => { latest.current.onEditor({ commands: { setContent: (doc: JSONContent) => setText(plainText(doc)), focus: () => {} }, getJSON: () => plainDocument(text) }); }, [text]);
  return <textarea aria-label={props.label} disabled={!props.editable} value={text} onChange={event => { setText(event.target.value); props.onChange(plainDocument(event.target.value)); }} onCompositionStart={() => props.onComposition(true)} onCompositionEnd={() => props.onComposition(false)} />;
} }));
let client: ReturnType<typeof createLocalQueryClient>;
let leave: JournalFlush | null;
const today = () => dateKey(new Date());
const task = (id: number, title: string): Task => ({ id, listId: null, title, notes: "任务备注", status: "todo", completedAt: null, dueAt: null, sortOrder: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
function setup() { client = createLocalQueryClient(); return render(<QueryClientProvider client={client}><JournalWorkspace lists={[]} onDirtyChange={() => {}} onBusyChange={() => {}} onBeforeLeave={value => { leave = value; }} /></QueryClientProvider>); }
beforeEach(() => { localStorage.clear(); leave = null; });
afterEach(() => { cleanup(); client?.clear(); vi.restoreAllMocks(); });

it("shows one inline note area, archives task rows live and saves without overwriting either section", async () => {
  journalRepository.recordBrowserTaskStatus(task(1, "甲公司材料提交"), "completed", new Date().toISOString());
  setup();
  const input = await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.change(input, { target: { value: "客户财务反馈，明日继续回访" } });
  journalRepository.recordBrowserTaskStatus(task(2, "乙公司账户核对"), "completed", new Date().toISOString());
  await act(() => client.invalidateQueries({ queryKey: ["journal"] }));
  expect(await screen.findByText("乙公司账户核对")).toBeTruthy();
  await waitFor(async () => expect((await journalRepository.list())[0].text).toBe("客户财务反馈，明日继续回访"));
  expect((await journalRepository.list())[0].items).toHaveLength(2);
  expect(screen.queryByLabelText("业务类型")).toBeNull(); expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
});
it("flushes the last keystroke before date or app navigation", async () => {
  setup(); fireEvent.change(await screen.findByRole("textbox", { name: "日记工作记录" }), { target: { value: "切换前的最后一个字" } });
  fireEvent.click(screen.getByRole("button", { name: "前一天" }));
  await waitFor(() => expect((screen.getByLabelText("选择日记日期") as HTMLInputElement).value).not.toBe(today()));
  expect((await journalRepository.list()).find(value => value.start === today())?.text).toBe("切换前的最后一个字");
  fireEvent.change(screen.getByRole("textbox", { name: "日记工作记录" }), { target: { value: "昨天补记" } });
  await act(async () => { expect(await leave?.()).toBe(true); });
  expect((await journalRepository.list()).some(value => value.text === "昨天补记")).toBe(true);
});
it("restores calendar day markers and flushes notes before selecting another day", async () => {
  const previous = new Date(); previous.setDate(previous.getDate() - 1); const yesterday = dateKey(previous);
  await journalRepository.saveContent("day", yesterday, plainDocument("昨天的客户沟通"), 0);
  journalRepository.recordBrowserTaskStatus(task(1, "今日完成的任务"), "completed", new Date().toISOString());
  setup(); const input = await screen.findByRole("textbox", { name: "日记工作记录" });
  const calendar = within(screen.getByRole("region", { name: "日记月历" }));
  expect(calendar.getByRole("button", { name: `查看${today()}日记` }).getAttribute("aria-pressed")).toBe("true");
  expect(calendar.getByRole("button", { name: `查看${today()}日记` }).getAttribute("data-has-entry")).toBe("true");
  fireEvent.change(input, { target: { value: "月历切换前的最后输入" } });
  // Also works on the first day of a month, when yesterday is in the previous month.
  if (yesterday.slice(0, 7) !== today().slice(0, 7)) fireEvent.click(calendar.getByRole("button", { name: "日历上个月" }));
  const day = calendar.getByRole("button", { name: `查看${yesterday}日记` });
  expect(day.getAttribute("data-has-entry")).toBe("true"); fireEvent.click(day);
  await waitFor(() => expect((screen.getByRole("textbox", { name: "日记工作记录" }) as HTMLTextAreaElement).value).toBe("昨天的客户沟通"));
  expect((await journalRepository.list()).find(value => value.start === today())?.text).toBe("月历切换前的最后输入");
  expect(calendar.getByRole("button", { name: `查看${yesterday}日记` }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(calendar.getByRole("button", { name: "日历回到今天" }));
  await waitFor(() => expect(calendar.getByRole("button", { name: `查看${today()}日记` }).getAttribute("aria-pressed")).toBe("true"));
});
it("browses calendar months without changing the open diary and excludes trashed date markers", async () => {
  const previous = new Date(); previous.setDate(1); previous.setMonth(previous.getMonth() - 1); const oldDate = dateKey(previous);
  await journalRepository.saveContent("day", oldDate, plainDocument("回收站记录"), 0);
  await journalRepository.remove((await journalRepository.list())[0]);
  setup(); const input = await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.change(input, { target: { value: "浏览月份时保持编辑" } });
  const calendar = within(screen.getByRole("region", { name: "日记月历" }));
  fireEvent.click(calendar.getByRole("button", { name: "日历上个月" }));
  expect(calendar.getByRole("button", { name: `查看${oldDate}日记` }).getAttribute("data-has-entry")).toBeNull();
  expect((screen.getByLabelText("选择日记日期") as HTMLInputElement).value).toBe(today());
  expect((input as HTMLTextAreaElement).value).toBe("浏览月份时保持编辑");
  fireEvent.click(calendar.getByRole("button", { name: "日历回到今天" }));
  expect(calendar.getByRole("button", { name: `查看${today()}日记` })).toBeTruthy();
});
it("serializes slow saves while retaining text typed during the first request", async () => {
  const original = journalRepository.saveContent.bind(journalRepository);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = vi.spyOn(journalRepository, "saveContent").mockImplementationOnce(async (...args) => { await gate; return original(...args); });
  setup(); const input = await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.change(input, { target: { value: "第一段" } });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "第一段，接着输入第二段" } });
  await act(async () => { release(); });
  await waitFor(async () => expect((await journalRepository.list())[0]?.text).toBe("第一段，接着输入第二段"));
  expect(save).toHaveBeenCalledTimes(2);
});
it("retains failed writes as a recoverable draft after reopening", async () => {
  vi.spyOn(journalRepository, "saveContent").mockRejectedValue(new Error("存储空间不足"));
  const first = setup(); fireEvent.change(await screen.findByRole("textbox", { name: "日记工作记录" }), { target: { value: "不能丢失的工作补充" } });
  await screen.findByText("存储空间不足");
  first.unmount(); client.clear(); vi.restoreAllMocks(); setup();
  fireEvent.click(await screen.findByRole("button", { name: "恢复草稿" }));
  expect((screen.getByRole("textbox", { name: "日记工作记录" }) as HTMLTextAreaElement).value).toBe("不能丢失的工作补充");
  await act(async () => { expect(await leave?.()).toBe(true); });
  expect((await journalRepository.list())[0].text).toBe("不能丢失的工作补充");
});
it("clears a deliberately discarded last keystroke instead of resurrecting an old draft", async () => {
  const first = setup(); const input = await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.change(input, { target: { value: "稍后删除的输入" } }); fireEvent.change(input, { target: { value: "" } });
  first.unmount(); client.clear(); setup(); await screen.findByRole("textbox", { name: "日记工作记录" });
  expect(screen.queryByRole("button", { name: "恢复草稿" })).toBeNull(); expect(await journalRepository.list()).toHaveLength(0);
});
it("does not submit partially composed Chinese input during navigation", async () => {
  const save = vi.spyOn(journalRepository, "saveContent");
  setup(); const input = await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: "中文沟通内容" } });
  await act(async () => { expect(await leave?.()).toBe(false); }); expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await act(async () => { expect(await leave?.()).toBe(true); }); expect((await journalRepository.list())[0].text).toBe("中文沟通内容");
});
it("opens a legacy monthly summary without replacing it and preserves daily rich notes through trash restore", async () => {
  await journalRepository.save({ ...emptyJournal("month", "2026-09-01"), title: "九月回顾", text: "旧总结正文" }, 0);
  await journalRepository.saveContent("day", today(), plainDocument("完整格式补充"), 0);
  setup(); await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.change(screen.getByLabelText("选择日记日期"), { target: { value: "2026-09-01" } });
  await waitFor(() => expect((screen.getByLabelText("选择日记日期") as HTMLInputElement).value).toBe("2026-09-01"));
  fireEvent.click(screen.getByRole("button", { name: "月度回顾" }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "回顾正文" }) as HTMLTextAreaElement).value).toContain("旧总结正文"));
  fireEvent.click(screen.getByRole("button", { name: /^每日$/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^今天$/ }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "日记工作记录" }) as HTMLTextAreaElement).value).toBe("完整格式补充"));
  fireEvent.click(screen.getByRole("button", { name: "日记更多操作" })); fireEvent.click(screen.getByRole("button", { name: "移入回收站" }));
  const dialog = await screen.findByRole("dialog"); fireEvent.click(within(dialog).getByRole("button", { name: "移入回收站" }));
  fireEvent.click(await screen.findByRole("button", { name: "恢复日记" }));
  // The full suite runs this file alongside forty-eight others. Wait for the
  // refetched detail rather than the default one-second find timeout.
  await waitFor(() => expect(screen.getByRole("textbox", { name: "日记工作记录" })).toBeTruthy(), { timeout: 10000 });
  expect((await journalRepository.list()).find(value => value.kind === "day")?.contentJson).toBe(JSON.stringify(plainDocument("完整格式补充")));
});

it("shows daily journals for a selected week while excluding trash and legacy summaries", async () => {
  for (const [date, note] of [["2026-10-19", "周一拜访记录"], ["2026-10-18", "上周日走访记录"], ["2026-10-01", "月初沟通记录"]]) await journalRepository.saveContent("day", date, plainDocument(note), 0);
  await journalRepository.saveContent("day", "2026-10-17", plainDocument("回收站中的记录"), 0);
  await journalRepository.remove((await journalRepository.list()).find(value => value.start === "2026-10-17")!);
  await journalRepository.save({ ...emptyJournal("month", "2026-10-01"), text: "历史月总结单独保留" }, 0);
  setup(); await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.change(screen.getByLabelText("选择日记日期"), { target: { value: "2026-10-19" } });
  await waitFor(() => expect((screen.getByLabelText("选择日记日期") as HTMLInputElement).value).toBe("2026-10-19"));
  fireEvent.click(screen.getByRole("button", { name: "查看本周记录" }));
  await screen.findByRole("heading", { name: "本周工作记录" });
  expect(screen.getByText("2026-10-19 — 2026-10-25")).toBeTruthy();
  expect(await screen.findByText("周一拜访记录")).toBeTruthy(); expect(screen.queryByText("上周日走访记录")).toBeNull();
  expect(screen.queryByText("回收站中的记录")).toBeNull(); expect(screen.queryByText("历史月总结单独保留")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "日记工作记录" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "打开2026-10-19日记" }));
  expect(await screen.findByRole("textbox", { name: "日记工作记录" })).toBeTruthy();
});

it("preserves the daily editor when switching to a review fails to save, then opens the review after retry", async () => {
  const original = journalRepository.saveContent.bind(journalRepository);
  const save = vi.spyOn(journalRepository, "saveContent").mockRejectedValueOnce(new Error("日记保存失败"));
  setup(); fireEvent.change(await screen.findByRole("textbox", { name: "日记工作记录" }), { target: { value: "切换范围前的最后补充" } });
  fireEvent.click(screen.getByRole("button", { name: "月度回顾" })); await screen.findByText("日记保存失败");
  expect((screen.getByRole("textbox", { name: "日记工作记录" }) as HTMLTextAreaElement).value).toBe("切换范围前的最后补充");
  save.mockImplementation(original); fireEvent.click(screen.getByRole("button", { name: "月度回顾" }));
  expect(await screen.findByRole("textbox", { name: "回顾正文" })).toBeTruthy();
  expect((await journalRepository.list())[0].text).toBe("切换范围前的最后补充");
});

it("moves between weeks and opens a listed date back in the daily editor", async () => {
  await journalRepository.saveContent("day", "2026-10-18", plainDocument("上周日补充内容"), 0);
  setup(); await screen.findByRole("textbox", { name: "日记工作记录" });
  fireEvent.change(screen.getByLabelText("选择日记日期"), { target: { value: "2026-10-19" } });
  await waitFor(() => expect((screen.getByLabelText("选择日记日期") as HTMLInputElement).value).toBe("2026-10-19"));
  fireEvent.click(screen.getByRole("button", { name: "查看本周记录" })); await screen.findByRole("heading", { name: "本周工作记录" });
  fireEvent.click(screen.getByRole("button", { name: "上一周" }));
  expect(await screen.findByText("2026-10-12 — 2026-10-18")).toBeTruthy(); expect(await screen.findByText("上周日补充内容")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "打开2026-10-18日记" }));
  expect((await screen.findByRole("textbox", { name: "日记工作记录" }) as HTMLTextAreaElement).value).toBe("上周日补充内容");
  expect(screen.getByRole("button", { name: "查看本周记录" })).toBeTruthy();
});
