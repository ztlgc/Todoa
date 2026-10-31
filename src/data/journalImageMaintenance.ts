import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { parseJournalDocument } from "@/domain/journalContent";
import { pruneBrowserJournalImages } from "./browserJournalImages";
import { journalRepository } from "./repositories/JournalRepository";

const lockName = (namespace: string) => `todoa:journal-images:${namespace}`;

// Fail closed: an unreadable draft may be the only owner of an imported image.
export function journalDraftImageIds(storage: Storage, namespace: string): number[] {
  const assets = new Set<number>();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)!;
    const current = key.startsWith(`todoa.journal.content-draft.v1:${namespace}:`);
    if (!current && !key.startsWith(`todoa.journal.draft.v2:${namespace}:`)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const draft = JSON.parse(raw);
    if (current) parseJournalDocument(draft.doc).assets.forEach(id => assets.add(id));
    else for (const match of raw.matchAll(/todoa-asset:(\d+)/g)) {
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("旧日记草稿图片无效，暂不清理图片。");
      assets.add(id);
    }
  }
  return [...assets];
}

export async function pruneUnusedJournalImages(): Promise<number> {
  // Web Locks are shared by all tabs of this origin. Never guess whether a
  // different editor still has an image in its undo history.
  if (!navigator.locks) return 0;
  const namespace = journalRepository.draftNamespace;
  return navigator.locks.request(lockName(namespace), { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) return 0;
    const protectedAssets = journalDraftImageIds(localStorage, namespace);
    if (!isBrowserDebug()) return invoke<number>("prune_journal_images", { protectedAssets });
    const keep = new Set(protectedAssets);
    // Includes the recycle bin. Parsing failures abort before opening a write transaction.
    for (const record of await journalRepository.list()) if (record.contentJson)
      parseJournalDocument(record.contentJson).assets.forEach(id => keep.add(id));
    return pruneBrowserJournalImages(namespace, keep);
  });
}

export function holdJournalImages(namespace: string, ready: () => void, drain: () => Promise<void>): () => void {
  if (!navigator.locks) { ready(); return () => {}; }
  const controller = new AbortController();
  let disposed = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const session = navigator.locks.request(lockName(namespace), { mode: "shared", signal: controller.signal }, async () => {
    if (disposed) return;
    ready(); await held;
  });
  // Attach a rejection handler immediately, including StrictMode's aborted setup.
  void session.catch(() => {});
  return () => {
    disposed = true; controller.abort();
    // Retain ownership until an in-flight write has finished. The component's
    // synchronous unmount cleanup persists the last draft before this continues.
    void drain().catch(() => {}).then(release).then(() => session.catch(cause => { if (cause?.name !== "AbortError") throw cause; })).then(() => pruneUnusedJournalImages())
      .catch(() => console.error("JOURNAL_IMAGE_CLEANUP_DEFERRED"));
  };
}
