import type { QueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function watchMainQueryRefresh(client: QueryClient): () => void {
  let disposed = false;
  let unlistenFocus: (() => void) | undefined;
  const refetch = () => {
    if (!disposed) void client.refetchQueries({ type: "active" });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") refetch();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) refetch();
  }).then((unlisten) => {
    if (disposed) unlisten();
    else unlistenFocus = unlisten;
  }).catch((error: unknown) => {
    console.error("无法监听主窗口焦点变化", error);
  });

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unlistenFocus?.();
  };
}
