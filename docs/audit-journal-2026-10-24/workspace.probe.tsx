// @vitest-environment jsdom
import { useEffect, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalQueryClient } from "@/app/queryClient";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { plainDocument, plainText } from "@/domain/contentDocument";
import { dateKey, emptyJournal } from "@/domain/journal";
import type { JSONContent } from "@tiptap/react";
import { JournalWorkspace } from "@/features/journal/JournalWorkspace";
import type { JournalFlush } from "@/features/journal/JournalNoteEditor";

const clock = vi.hoisted(() => ({ value: new Date("2026-10-24T12:00:00+08:00") }));
vi.mock("@/features/tasks/useLocalClock", () => ({ useLocalClock: () => clock.value }));
vi.mock("@/data/repositories/JournalRepository", async importOriginal => {
  const module = await importOriginal<typeof import("@/data/repositories/JournalRepository")>();
  return { ...module, journalRepository: new module.JournalRepository(undefined, () => true, () => localStorage, "audit-isolated") };
});
let editorBusy: ((value: boolean) => void) | undefined;
vi.mock("@/features/tasks/TaskContentEditor", () => ({ ContentEditor: function MockEditor(props: { initial: JSONContent; label: string; editable: boolean; onChange: (doc: JSONContent) => void; onEditor: (value: unknown) => void; onComposition: (value: boolean) => void; onBusy: (value: boolean) => void }) {
  const [text, setText] = useState(plainText(props.initial)), latest = useRef(props); latest.current = props;
  editorBusy = props.onBusy;
  useEffect(() => { latest.current.onEditor({ commands: { setContent: (doc: JSONContent) => setText(plainText(doc)), focus: () => {} }, getJSON: () => plainDocument(text) }); }, [text]);
  return <textarea aria-label={props.label} disabled={!props.editable} value={text} onChange={event => { setText(event.target.value); props.onChange(plainDocument(event.target.value)); }} onCompositionStart={() => props.onComposition(true)} onCompositionEnd={() => props.onComposition(false)} />;
} }));
let client: ReturnType<typeof createLocalQueryClient>;
let leave: JournalFlush | null;
function wrapper() { return <QueryClientProvider client={client}><JournalWorkspace lists={[]} onDirtyChange={() => {}} onBusyChange={() => {}} onBeforeLeave={value => { leave = value; }} /></QueryClientProvider>; }
function setup() { client = createLocalQueryClient(); return render(wrapper()); }
beforeEach(() => { localStorage.clear(); leave = null; clock.value = new Date("2026-10-24T12:00:00+08:00"); });
afterEach(() => { cleanup(); client?.clear(); vi.restoreAllMocks(); });

it.each(["editor", "quick"])("CONFIRMED P1: restoring a legacy %s draft deletes its only durable copy when new draft storage is full", async mode => {
  const legacyKey = mode === "editor" ? "todoa.journal.draft.v2:audit-isolated:editor:day:2026-10-24" : "todoa.journal.draft.v2:audit-isolated:quick";
  const text = "这份历史草稿是唯一已落盘的客户沟通记录";
  // Many lines expand from a compact plain-text draft to one JSON paragraph per line.
  // The new document can exceed the remaining quota even after removing the old key.
  const lines = "逐项核对客户材料\n".repeat(120);
  const legacy = mode === "editor" ? { ...emptyJournal("day", "2026-10-24"), text: text + "\n" + lines } : { date: "2026-10-24", item: { id: "legacy-quick", title: text, notes: lines, taskId: null, completedAt: null, theme: "", important: false } };
  const legacyRaw = JSON.stringify(legacy);
  localStorage.setItem(legacyKey, legacyRaw);
  const quotaCharacters = legacyRaw.length + legacyKey.length + 512;
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    let occupied = 0;
    for (let index = 0; index < this.length; index++) {
      const existingKey = this.key(index)!;
      if (existingKey !== key) occupied += existingKey.length + this.getItem(existingKey)!.length;
    }
    if (occupied + key.length + String(value).length > quotaCharacters) throw new DOMException("Quota exceeded", "QuotaExceededError");
    return original.call(this, key, value);
  });
  const save = vi.spyOn(journalRepository, "saveContent");
  const first = setup();
  fireEvent.click(await screen.findByRole("button", { name: "恢复草稿" }));
  expect((screen.getByRole("textbox", { name: "日记补充内容" }) as HTMLTextAreaElement).value).toContain(text);
  expect(localStorage.getItem(legacyKey)).toBeNull();
  expect(localStorage.getItem("todoa.journal.content-draft.v1:audit-isolated:day:2026-10-24")).toBeNull();
  // Close before the 650 ms debounce, exactly when users expect the draft to be retained.
  first.unmount(); client.clear();
  expect(save).not.toHaveBeenCalled();
  setup(); await screen.findByRole("textbox", { name: "日记补充内容" });
  expect(screen.queryByRole("button", { name: "恢复草稿" })).toBeNull();
  expect((screen.getByRole("textbox", { name: "日记补充内容" }) as HTMLTextAreaElement).value).toBe("");
  expect(await journalRepository.list()).toHaveLength(0);
  console.log(JSON.stringify({ probe: "legacy-draft-quota-loss", mode, quotaCharacters, legacyRemoved: true, replacementPersisted: false, databaseSaved: false, recoveryAfterReopen: false }));
});

it("CONFIRMED: midnight blocked by composition is never retried after composition ends", async () => {
  const view = setup();
  const oldDay = dateKey(clock.value);
  const input = await screen.findByRole("textbox", { name: "日记补充内容" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "跨午夜客户回访记录" } });
  clock.value = new Date("2026-10-25T12:00:00+08:00");
  view.rerender(wrapper());
  await act(async () => {});
  fireEvent.compositionEnd(input);
  await act(async () => { expect(await leave?.()).toBe(true); });
  view.rerender(wrapper());
  expect((screen.getByLabelText("选择日记日期") as HTMLInputElement).value).toBe(oldDay);
  console.log(JSON.stringify({ probe: "midnight-no-retry", expectedToday: dateKey(clock.value), displayed: oldDay, saved: (await journalRepository.list())[0].start }));
});

it("CONFIRMED: autosave blocked by an image import is not rescheduled when import finishes", async () => {
  setup();
  const input = await screen.findByRole("textbox", { name: "日记补充内容" });
  act(() => editorBusy?.(true));
  fireEvent.change(input, { target: { value: "首张图片导入后继续导入，第二张失败" } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
  act(() => editorBusy?.(false));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
  expect(await journalRepository.list()).toHaveLength(0);
  expect(screen.getByText("待保存")).toBeTruthy();
  expect(localStorage.getItem("todoa.journal.content-draft.v1:audit-isolated:day:2026-10-24")).toContain("首张图片");
  console.log(JSON.stringify({ probe: "import-no-reschedule", persistedRecords: 0, draftRetained: true }));
});

it("CONFIRMED: switching history search does not filter a range export", async () => {
  await journalRepository.saveContent("day", "2026-10-23", plainDocument("青禾客户回访"), 0);
  await journalRepository.saveContent("day", "2026-10-22", plainDocument("云杉客户材料"), 0);
  setup(); await screen.findByRole("textbox", { name: "日记补充内容" });
  fireEvent.click(within(screen.getByRole("group", { name: "日记显示范围" })).getByRole("button", { name: "月" }));
  await screen.findByText("青禾客户回访");
  fireEvent.click(screen.getByRole("button", { name: "历史" }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索日记" }), { target: { value: "青禾" } });
  expect(screen.queryByRole("button", { name: /2026-10-22 日记/ })).toBeNull();
  expect(screen.getByText("云杉客户材料")).toBeTruthy();
  console.log(JSON.stringify({ probe: "search-range-scope", historySearch: "青禾", unrelatedRangeContentStillVisible: true, classification: "UX scope mismatch; export follows visible range by design" }));
});
