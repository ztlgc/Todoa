// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { JournalRepository } from "@/data/repositories/JournalRepository";
import { plainDocument } from "@/domain/contentDocument";
import type { HighlightInput, JournalHighlight, JournalReviewMaterial } from "@/domain/journalReview";
import { JournalHighlightPanel } from "@/features/journal/JournalHighlightPanel";
import { JournalReviewMaterials } from "@/features/journal/JournalReviewMaterials";
import { JournalSearch } from "@/features/journal/JournalSearch";

const state = vi.hoisted(() => ({ repository: null as unknown, review: null as unknown }));
vi.mock("@/data/repositories/JournalRepository", async importOriginal => {
  const module = await importOriginal<typeof import("@/data/repositories/JournalRepository")>();
  return { ...module, journalRepository: new Proxy({}, { get: (_, key) => { const repository = state.repository as Record<PropertyKey, unknown>; const value = repository[key]; return typeof value === "function" ? value.bind(repository) : value; } }) };
});
vi.mock("@/data/repositories/JournalReviewRepository", () => ({ journalReviewRepository: new Proxy({}, { get: (_, key) => (state.review as Record<PropertyKey, unknown>)[key] }) }));

function highlight(overrides: Partial<JournalHighlight> = {}): JournalHighlight {
  return {
    id: "highlight-1", date: "2026-10-12", summary: "完成 A 项目首轮方案评审", result: "明确两个待修改问题", theme: "A 项目",
    sourceType: "note", sourceId: "source-1", sourceRevision: 2, revision: 1,
    createdAt: "2026-10-12T02:00:00.000Z", updatedAt: "2026-10-12T02:00:00.000Z", deletedAt: null,
    sourceDeleted: false, sourceChanged: false, sourceRevoked: false, ...overrides,
  };
}
const input = (overrides: Partial<HighlightInput> = {}): HighlightInput => ({
  id: "highlight-1", date: "2026-10-12", summary: "完成 A 项目首轮方案评审", result: "明确两个待修改问题", theme: "A 项目",
  sourceType: "note", sourceId: "source-1", sourceRevision: 2, ...overrides,
});
function PanelHarness(props: { save?: (input: HighlightInput, revision: number) => Promise<void>; remove?: (item: JournalHighlight) => Promise<void>; highlights?: JournalHighlight[]; initialDraft?: boolean }) {
  const [draft, setDraft] = useState(props.initialDraft ? { input: input(), revision: 1 } : null);
  return <JournalHighlightPanel date="2026-10-12" contentRevision={2} highlights={props.highlights ?? []} draft={draft} onDraftChange={setDraft}
    onSave={props.save ?? (async () => {})} onRemove={props.remove ?? (async () => {})} onOpen={() => {}} onBusy={() => {}} />;
}
let client: ReturnType<typeof createLocalQueryClient>;
const wrapper = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
beforeEach(() => {
  localStorage.clear();
  state.repository = new JournalRepository(undefined, () => true, () => localStorage, "review-ui-test");
  state.review = { list: vi.fn(async () => []) };
  client = createLocalQueryClient();
});
afterEach(() => { cleanup(); client?.clear(); vi.restoreAllMocks(); });

it("shows only a small add action when a day has no highlights", () => {
  render(wrapper(<PanelHarness />));
  expect(screen.getByRole("button", { name: "添加重点" })).toBeTruthy();
  expect(screen.queryByText("本日重点")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "添加重点" }));
  expect(screen.getByRole("group", { name: "收录重点" })).toBeTruthy();
  expect(screen.getByLabelText("重点摘要（必填）")).toBeTruthy();
});

it("keeps the draft and displays the error when saving fails", async () => {
  const save = vi.fn(async () => { throw new Error("存储暂不可用"); });
  render(wrapper(<PanelHarness save={save} initialDraft />));
  fireEvent.change(screen.getByLabelText("重点摘要（必填）"), { target: { value: "待保存的重点" } });
  fireEvent.click(screen.getByRole("button", { name: "保存重点" }));
  expect(await screen.findByText("存储暂不可用")).toBeTruthy();
  expect((screen.getByLabelText("重点摘要（必填）") as HTMLInputElement).value).toBe("待保存的重点");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ summary: "待保存的重点" }), 1);
});

it("saves trimmed fields with the held revision and clears the form only after success", async () => {
  const save = vi.fn(async () => {}), remove = vi.fn();
  render(wrapper(<PanelHarness save={save} remove={remove} highlights={[highlight()]} />));
  fireEvent.click(screen.getByRole("button", { name: "编辑重点：完成 A 项目首轮方案评审" }));
  fireEvent.change(screen.getByLabelText("工作主题（可选）"), { target: { value: " A 项目 " } });
  fireEvent.click(screen.getByRole("button", { name: "保存重点" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "highlight-1", theme: "A 项目" }), 1));
  await waitFor(() => expect(screen.queryByRole("group", { name: "编辑重点" })).toBeNull());
  expect(remove).not.toHaveBeenCalled();
});

it("does not submit while the Chinese IME is composing", async () => {
  const save = vi.fn(async () => {});
  render(wrapper(<PanelHarness save={save} initialDraft />));
  const summary = screen.getByLabelText("重点摘要（必填）");
  fireEvent.compositionStart(summary);
  fireEvent.click(screen.getByRole("button", { name: "保存重点" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(summary);
  fireEvent.click(screen.getByRole("button", { name: "保存重点" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
});

it("requires confirmation before removing a highlight", async () => {
  const remove = vi.fn(async () => {});
  render(wrapper(<PanelHarness remove={remove} highlights={[highlight()]} />));
  fireEvent.click(screen.getByRole("button", { name: "删除重点：完成 A 项目首轮方案评审" }));
  expect(await screen.findByText("删除这条重点？原始日记和已加入回顾的文字会保留。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除重点" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: "highlight-1" })));
});

it("groups review materials by theme, disables selected items and reports source status", async () => {
  const add = vi.fn(async () => {});
  const materials: JournalReviewMaterial[] = [{ sourceType: "highlight", sourceId: "highlight-1", snapshot: "2026-10-12 · 旧快照", sourceDeleted: false, sourceChanged: true, sourceRevoked: false }];
  render(wrapper(<JournalReviewMaterials kind="month" start="2026-10-01" materials={materials} busy={false} onAdd={add} onOpen={() => {}}
    highlights={[highlight(), highlight({ id: "highlight-2", date: "2026-10-20", summary: "月度收尾", theme: "", result: "" })]} />));
  const project = screen.getByRole("region", { name: "A 项目" });
  const uncategorized = screen.getByRole("region", { name: "未分类" });
  expect(within(project).getByText("完成 A 项目首轮方案评审")).toBeTruthy();
  expect(within(uncategorized).getByText("月度收尾")).toBeTruthy();
  expect(screen.getByRole("button", { name: "已加入回顾：完成 A 项目首轮方案评审" })).toHaveProperty("disabled", true);
  expect(screen.getByText("来源已更新 · 回顾中的摘录已保留")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "加入回顾：月度收尾" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith({ type: "highlight", id: "highlight-2" }));
});

it("offers twelve month entries for a year and disables future months", () => {
  const add = vi.fn(async () => {});
  render(wrapper(<JournalReviewMaterials kind="year" start={new Date().getFullYear() + "-01-01"} materials={[]} busy={false} onAdd={add} onOpen={() => {}} highlights={[]} />));
  const months = within(screen.getByRole("region", { name: "按月份查看回顾" })).getByRole("list");
  expect(within(months).getAllByRole("listitem")).toHaveLength(12);
  within(months).getAllByRole("button", { name: /加入.*月度回顾/ }).forEach((button, index) => expect(button).toHaveProperty("disabled", index > new Date().getMonth()));
});

it("searches persisted records, shows a marked snippet and opens the source", async () => {
  const repository = state.repository as JournalRepository;
  await repository.saveContent("day", "2026-10-12", plainDocument("完成 A 项目首轮方案评审，明确两个待修改问题。"), 0);
  await expect(repository.search({ query: "方案评审" })).resolves.toBeTruthy();
  const open = vi.fn();
  render(wrapper(<JournalSearch onOpen={open} />));
  fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "方案评审" } });
  const result = await screen.findByRole("button", { name: /打开2026-10-12日记/ });
  expect((await screen.findAllByText((_, node) => node?.tagName === "MARK" && node.textContent === "方案评审")).length).toBeGreaterThan(0);
  fireEvent.click(result);
  expect(open).toHaveBeenCalledWith("day", "2026-10-12");
});

it("finds legacy item fields even when rich content exists", async () => {
  const repository = state.repository as JournalRepository;
  await repository.saveContent("day", "2026-10-12", plainDocument("当前正文"), 0);
  const raw = JSON.parse(localStorage.getItem("review-ui-test")!);
  raw[0].items = [{ id: "legacy-1", title: "旧事项：客户审批跟进", notes: "", taskId: null, completedAt: null, theme: "", important: false }];
  localStorage.setItem("review-ui-test", JSON.stringify(raw));
  render(wrapper(<JournalSearch onOpen={() => {}} />));
  fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "客户审批" } });
  expect(await screen.findByText((_, node) => node?.tagName === "MARK" && node.textContent === "客户审批")).toBeTruthy();
});

it("shows an explicit failure state and offers retry", async () => {
  vi.spyOn(state.repository as JournalRepository, "search").mockRejectedValue(new Error("读取失败"));
  render(wrapper(<JournalSearch onOpen={() => {}} />));
  expect(await screen.findByText("搜索失败，请重试。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重试搜索" })).toBeTruthy();
});

it("paginates highlight excerpts in batches of fifty and resets the page when filtering", async () => {
  const list = vi.fn(async () => Array.from({ length: 51 }, (_, index) => highlight({ id: `h-${String(index).padStart(2, "0")}`, summary: `评审事项 ${index}` })));
  state.review = { list };
  render(wrapper(<JournalSearch onOpen={() => {}} />));
  fireEvent.click(screen.getByRole("checkbox", { name: "只看重点" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /打开2026-10-12重点/ })).toHaveLength(50));
  expect(list).toHaveBeenCalledWith("1000-01-01", "9999-12-31", { includeUnavailable: false });
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getAllByRole("button", { name: /打开2026-10-12重点/ })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "评审事项 50" } });
  expect(screen.getByRole("status").textContent).toContain("第 1—1 条结果");
});

it("shows a snippet when the keyword exists only in a saved highlight", async () => {
  const repository = state.repository as JournalRepository;
  await repository.saveContent("day", "2026-10-12", plainDocument("普通工作记录"), 0);
  localStorage.setItem("review-ui-test.review.v1", JSON.stringify([highlight({ summary: "专项成果关键词" })]));
  state.review = { list: vi.fn(async () => [highlight({ summary: "专项成果关键词" })]) };
  render(wrapper(<JournalSearch onOpen={() => {}} />));
  fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "专项成果" } });
  expect(await screen.findByText((_, node) => node?.tagName === "MARK" && node.textContent === "专项成果")).toBeTruthy();
});

it("passes selected search dates to the repository", async () => {
  const search = vi.spyOn(state.repository as JournalRepository, "search");
  render(wrapper(<JournalSearch onOpen={() => {}} />));
  fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-10-31" } });
  await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-10-01", to: "2026-10-31", offset: 0, limit: 50 })));
});

it("adds a month only after an explicit action without reading its full document", async () => {
  const add = vi.fn(async () => {}), get = vi.spyOn(state.repository as JournalRepository, "get");
  render(wrapper(<JournalReviewMaterials kind="year" start="2025-01-01" materials={[]} highlights={[]} busy={false} onAdd={add} onOpen={() => {}} />));
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加入2025-03月度回顾" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith({ type: "month", id: "2025-03-01" }));
  expect(get).not.toHaveBeenCalled();
});

it("refreshes a note highlight's source revision when the user explicitly edits it", async () => {
  const save = vi.fn(async () => {});
  render(wrapper(<PanelHarness save={save} highlights={[highlight({ sourceRevision: 1, sourceChanged: true })]} />));
  fireEvent.click(screen.getByRole("button", { name: "编辑重点：完成 A 项目首轮方案评审" }));
  fireEvent.click(screen.getByRole("button", { name: "保存重点" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ sourceRevision: 2 }), 1));
});

it("restores a trash result through the parent callback", async () => {
  const repository = state.repository as JournalRepository;
  await repository.saveContent("day", "2026-10-12", plainDocument("待恢复日记"), 0);
  const saved = (await repository.list())[0];
  await repository.remove(saved);
  const restore = vi.fn(async () => {});
  render(wrapper(<JournalSearch trash onRestore={restore} onOpen={() => {}} />));
  fireEvent.click(await screen.findByRole("button", { name: "恢复2026-10-12日记" }));
  await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.objectContaining({ start: "2026-10-12", deletedAt: expect.any(String) })));
});
