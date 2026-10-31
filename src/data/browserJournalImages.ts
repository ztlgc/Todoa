import type { JournalKind } from "@/domain/journal";

type JournalImage = { id?: number; kind: JournalKind; start: string; blob: Blob };
const databases = new Map<string, Promise<IDBDatabase>>();
function database(namespace: string): Promise<IDBDatabase> {
  let pending = databases.get(namespace);
  if (!pending) {
    pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`${namespace}.images.v1`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("images", { keyPath: "id", autoIncrement: true });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("日记图片存储无法打开，请重试。"));
      request.onblocked = () => reject(new Error("日记图片存储正在被其他窗口使用，请重试。"));
    }).catch(error => { databases.delete(namespace); throw error; });
    databases.set(namespace, pending);
  }
  return pending;
}
export async function importBrowserJournalImage(namespace: string, kind: JournalKind, start: string, blob: Blob): Promise<number> {
  const db = await database(namespace);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite"), request = tx.objectStore("images").add({ kind, start, blob } satisfies JournalImage);
    tx.oncomplete = () => resolve(Number(request.result));
    tx.onerror = tx.onabort = () => reject(new Error("日记图片保存失败，可能是存储空间不足。"));
  });
}
export async function readBrowserJournalImage(namespace: string, kind: JournalKind, start: string, id: number): Promise<Blob> {
  const db = await database(namespace);
  return new Promise((resolve, reject) => {
    const request = db.transaction("images", "readonly").objectStore("images").get(id);
    request.onsuccess = () => {
      const image: JournalImage | undefined = request.result;
      if (!image || image.kind !== kind || image.start !== start) reject(new Error("日记图片不存在。"));
      else resolve(image.blob);
    };
    request.onerror = () => reject(new Error("日记图片读取失败，请重试。"));
  });
}

// Caller holds the exclusive image-maintenance lock and has collected saved,
// trashed and draft references. A single IDB transaction makes deletion atomic.
export async function pruneBrowserJournalImages(namespace: string, keep: ReadonlySet<number>): Promise<number> {
  const db = await database(namespace);
  return new Promise((resolve, reject) => {
    let removed = 0;
    const tx = db.transaction("images", "readwrite"), request = tx.objectStore("images").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!keep.has(Number(cursor.primaryKey))) { cursor.delete(); removed++; }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = tx.onabort = () => reject(new Error("日记图片清理失败，稍后重试。"));
  });
}
