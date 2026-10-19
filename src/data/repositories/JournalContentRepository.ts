import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { importBrowserJournalImage, readBrowserJournalImage } from "@/data/browserJournalImages";
import { validateImageFile } from "@/data/imageFiles";
import type { ContentImageStore } from "@/domain/contentDocument";
import type { JournalKind } from "@/domain/journal";
import { journalRepository } from "./JournalRepository";

export function journalImageStore(kind: JournalKind, start: string): ContentImageStore {
  return {
    async importImage(file) {
      await validateImageFile(file);
      if (isBrowserDebug()) return importBrowserJournalImage(journalRepository.draftNamespace, kind, start, file);
      return invoke<number>("import_journal_image", { kind, start, mime: file.type, data: Array.from(new Uint8Array(await file.arrayBuffer())) });
    },
    async image(asset) {
      if (isBrowserDebug()) return readBrowserJournalImage(journalRepository.draftNamespace, kind, start, asset);
      const [mime, data] = await invoke<[string, number[]]>("read_journal_image", { kind, start, asset });
      return new Blob([new Uint8Array(data)], { type: mime });
    },
  };
}
