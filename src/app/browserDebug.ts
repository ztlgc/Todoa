import { isTauri } from "@tauri-apps/api/core";

// Unit tests exercise the native code path with mocked Tauri APIs.
export function isBrowserDebug(): boolean {
  return import.meta.env.MODE !== "test" && !isTauri();
}
