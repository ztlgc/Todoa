// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { holdJournalImages, journalDraftImageIds, pruneUnusedJournalImages } from "./journalImageMaintenance";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 1) }));
vi.mock("@/app/browserDebug", () => ({ isBrowserDebug: () => false }));
vi.mock("./repositories/JournalRepository", () => ({ journalRepository: { draftNamespace: "image-maintenance-test" } }));

const namespace = "image-maintenance-test";
const draftKey = `todoa.journal.content-draft.v1:${namespace}:day:2026-10-24`;
function draft(id: number) { return JSON.stringify({ doc: { type: "doc", content: [{ type: "image", attrs: { src: `todoa-asset:${id}` } }] } }); }
let shared = 0;
function locks() {
  return { request: vi.fn(async (_name: string, options: { mode: string; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown>) => {
    if (options.mode === "exclusive") return callback(shared ? null : {});
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    shared++;
    try { return await callback({}); } finally { shared--; }
  }) };
}
beforeEach(() => { localStorage.clear(); shared = 0; vi.clearAllMocks(); vi.stubGlobal("navigator", { locks: locks() }); });
afterEach(() => { vi.unstubAllGlobals(); });
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

it("keeps draft references from all dates and ignores other datasets", () => {
  localStorage.setItem(draftKey, draft(1));
  localStorage.setItem(`todoa.journal.content-draft.v1:${namespace}:month:2026-10-01`, draft(2));
  localStorage.setItem("todoa.journal.content-draft.v1:another:day:2026-10-24", "broken");
  expect(journalDraftImageIds(localStorage, namespace)).toEqual([1, 2]);
});

it("does not call destructive cleanup if even one recoverable draft is unreadable", async () => {
  localStorage.setItem(draftKey, "broken");
  await expect(pruneUnusedJournalImages()).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("protects undo history across two open editors and collects only after both close", async () => {
  const firstReady = vi.fn(), secondReady = vi.fn();
  const first = holdJournalImages(namespace, firstReady, async () => {});
  const second = holdJournalImages(namespace, secondReady, async () => {});
  expect(firstReady).toHaveBeenCalledOnce(); expect(secondReady).toHaveBeenCalledOnce();
  expect(await pruneUnusedJournalImages()).toBe(0);
  first(); await settle(); expect(invoke).not.toHaveBeenCalled();
  localStorage.setItem(draftKey, draft(7));
  second(); await settle();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("prune_journal_images", { protectedAssets: [7] });
});

it("holds ownership until an outstanding content write finishes", async () => {
  let finish!: () => void;
  const writing = new Promise<void>(resolve => { finish = resolve; });
  const release = holdJournalImages(namespace, () => {}, () => writing);
  release(); await settle();
  expect(await pruneUnusedJournalImages()).toBe(0); expect(invoke).not.toHaveBeenCalled();
  localStorage.setItem(draftKey, draft(9)); finish(); await settle();
  expect(invoke).toHaveBeenCalledWith("prune_journal_images", { protectedAssets: [9] });
});

it("allows editing but skips cleanup when cross-tab exclusion is unavailable", async () => {
  vi.stubGlobal("navigator", {});
  const ready = vi.fn(); const release = holdJournalImages(namespace, ready, async () => {});
  expect(ready).toHaveBeenCalledOnce(); release();
  expect(await pruneUnusedJournalImages()).toBe(0); expect(invoke).not.toHaveBeenCalled();
});
