// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { journalFollowUpRepository } from "@/data/repositories/JournalFollowUpRepository";
import { taskRepository } from "@/data/repositories/TaskRepository";
import { dateKey, emptyJournal, type JournalItem } from "@/domain/journal";
import { JournalWorkspace } from "./JournalWorkspace";
import type { Task } from "@/domain/task";

vi.mock("@/data/repositories/JournalRepository", async importOriginal => {
  const module = await importOriginal<typeof import("@/data/repositories/JournalRepository")>();
  return { ...module, journalRepository: new module.JournalRepository(undefined, () => true, () => localStorage, "bank-ui-test") };
});
vi.mock("@/data/repositories/JournalFollowUpRepository", async importOriginal => {
  const module = await importOriginal<typeof import("@/data/repositories/JournalFollowUpRepository")>();
  return { ...module, journalFollowUpRepository: { create: vi.fn() } };
});
vi.mock("@/data/repositories/TaskRepository", () => ({ taskRepository: { list: vi.fn(), updateStatus: vi.fn() } }));
let client: ReturnType<typeof createLocalQueryClient>;
const today = () => dateKey(new Date());
const item = (id: string, clientName: string, title: string): JournalItem => ({ id, client: clientName, title, notes: "已沟通", business: "续贷管理", activity: "phone", status: "waiting_client", taskId: null, completedAt: null, theme: "", important: false });
function setup() {
  client = createLocalQueryClient();
  return render(<QueryClientProvider client={client}><JournalWorkspace lists={[]} onDirtyChange={() => {}} onBusyChange={() => {}} /></QueryClientProvider>);
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(taskRepository.list).mockResolvedValue([]); vi.mocked(journalFollowUpRepository.create).mockResolvedValue(12); });
afterEach(() => { cleanup(); client?.clear(); vi.restoreAllMocks(); });
it("shows live automatic snapshots separately while preserving an unsaved handwritten summary", async () => {
  const task: Task = { id:91,listId:null,title:"完成授信材料提交",notes:"仍待审批",status:"todo",completedAt:null,dueAt:null,sortOrder:0,createdAt:new Date(`${today()}T09:00:00`).toISOString(),updatedAt:new Date().toISOString() };
  journalRepository.recordBrowserTaskStatus(task,"completed",new Date().toISOString());
  setup();
  await screen.findByRole("heading",{ name:task.title });
  fireEvent.click(screen.getByRole("button",{ name:`编辑${today()}日记` }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("总结正文"),{ target:{ value:"正在编辑的客户反馈，不能丢失" } });
  journalRepository.recordBrowserTaskStatus({ ...task,id:92,title:"完成开户资料核对" },"completed",new Date().toISOString());
  await act(async () => { await client.invalidateQueries({ queryKey:["journal"] }); });
  expect(await within(dialog).findByRole("heading",{ name:"完成开户资料核对" })).toBeTruthy();
  expect((within(dialog).getByLabelText("总结正文") as HTMLTextAreaElement).value).toBe("正在编辑的客户反馈，不能丢失");
  expect(within(dialog).queryByLabelText("工作条目1标题")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button",{ name:"保存日记" }));
  await within(dialog).findByText("已保存到本地。");
  const record = (await journalRepository.list())[0];
  expect(record.text).toBe("正在编辑的客户反馈，不能丢失"); expect(record.items).toHaveLength(2);
});
it("saves one quick entry and can retry a failed follow-up without duplicating the diary", async () => {
  setup();
  fireEvent.change(await screen.findByLabelText("记录事项"), { target: { value: "确认续贷资料" } });
  fireEvent.change(screen.getByLabelText("快捷记录客户"), { target: { value: "华兴制造" } });
  fireEvent.change(screen.getByLabelText("快捷记录状态"), { target: { value: "waiting_client" } });
  fireEvent.click(screen.getByText("补充沟通内容与下一步"));
  fireEvent.change(screen.getByLabelText("快捷记录下一步"), { target: { value: "催收财报" } });
  fireEvent.input(screen.getByLabelText("快捷记录跟进时间"), { target: { value: `${today()}T15:00` } });
  vi.mocked(journalFollowUpRepository.create).mockRejectedValueOnce(new Error("模拟写入失败"));
  fireEvent.submit(screen.getByRole("form", { name: "快捷工作记录" }));
  await screen.findByRole("button", { name: "重试创建跟进" });
  expect((await journalRepository.list())[0].items).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "重试创建跟进" }));
  await screen.findByText("跟进已加入待办。");
  expect(journalFollowUpRepository.create).toHaveBeenCalledTimes(2);
  const record = (await journalRepository.list())[0]; expect(record.items).toHaveLength(1); expect(record.items[0].status).toBe("waiting_client"); expect(record.items[0].followUpAt).toBeTruthy();
});
it("searches across months and opens the complete record when editing a filtered result", async () => {
  await journalRepository.save({ ...emptyJournal("day", "2026-01-06"), items: [item("a", "华兴制造", "一月补齐资料"), item("b", "远航贸易", "另一客户事项")] }, 0);
  setup();
  fireEvent.change(await screen.findByLabelText("筛选客户"), { target: { value: "华兴制造" } });
  await screen.findByRole("heading", { name: "一月补齐资料" });
  expect(screen.queryByRole("heading", { name: "另一客户事项" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑2026-01-06日记" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByLabelText("工作条目2标题")).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("工作条目1成果说明"), { target: { value: "已确认收齐" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存日记" }));
  await within(dialog).findByText("已保存到本地。");
  const record = (await journalRepository.list())[0]; expect(record.items).toHaveLength(2); expect(record.items[1].client).toBe("远航贸易");
});
it("flushes the last keystroke on unmount and recovers it without changing the selected date", async () => {
  const first = setup();
  fireEvent.change(await screen.findByLabelText("记录事项"), { target: { value: "未提交的客户沟通" } });
  fireEvent.change(screen.getByLabelText("快捷记录客户"), { target: { value: "青禾物流" } });
  first.unmount(); client.clear();
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "恢复草稿" }));
  expect((screen.getByLabelText("记录事项") as HTMLInputElement).value).toBe("未提交的客户沟通");
  expect((screen.getByLabelText("快捷记录客户") as HTMLInputElement).value).toBe("青禾物流");
  expect((await journalRepository.list())).toHaveLength(0);
});
it("retains input and saved records when writing fails", async () => {
  await journalRepository.save({ ...emptyJournal("day", today()), text: "已有日记" }, 0);
  setup();
  fireEvent.change(await screen.findByLabelText("记录事项"), { target: { value: "不能丢的沟通" } });
  vi.spyOn(journalRepository, "append").mockRejectedValueOnce(new Error("空间不足"));
  fireEvent.submit(screen.getByRole("form", { name: "快捷工作记录" }));
  await screen.findByText(/保存失败：空间不足/);
  expect((screen.getByLabelText("记录事项") as HTMLInputElement).value).toBe("不能丢的沟通");
  expect((await journalRepository.list())[0].text).toBe("已有日记");
});
it("does not offer an old draft after the user clears the quick entry", async () => {
  const first = setup();
  fireEvent.change(await screen.findByLabelText("记录事项"), { target: { value: "后来主动清空的内容" } });
  await screen.findByText("草稿已保存在本机");
  fireEvent.change(screen.getByLabelText("记录事项"), { target: { value: "" } });
  first.unmount(); client.clear(); setup();
  await screen.findByLabelText("记录事项");
  expect(screen.queryByRole("button", { name: "恢复草稿" })).toBeNull();
});
it("does not submit while Chinese input composition is active", async () => {
  setup();
  const input = await screen.findByLabelText("记录事项");
  fireEvent.change(input, { target: { value: "客户沟通" } }); fireEvent.compositionStart(input);
  fireEvent.submit(screen.getByRole("form", { name: "快捷工作记录" }));
  await waitFor(() => expect((input as HTMLInputElement).value).toBe("客户沟通"));
  expect(await journalRepository.list()).toHaveLength(0);
});
