import type { QueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invalidateTaskCaches } from "@/features/tasks/queries";

export function watchMainTaskEvents(client: QueryClient): () => void {
  let disposed = false;
  let stop: (() => void) | undefined;
  getCurrentWindow().listen<number>("task-created", ({ payload: id }) => {
    if (!disposed && Number.isSafeInteger(id) && id > 0) {
      void invalidateTaskCaches(client, id).catch(() => console.error("TASK_EVENT_REFRESH_FAILED"));
    }
  }).then((unlisten) => {
    if (disposed) unlisten();
    else stop = unlisten;
  }).catch(() => console.error("TASK_EVENT_LISTEN_FAILED"));
  return () => { disposed = true; stop?.(); };
}
