import { expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { createLocalQueryClient } from "./queryClient";
import { watchMainTaskEvents } from "./mainTaskEvents";

const { listen, invalidate } = vi.hoisted(() => ({
  listen: vi.fn<(name: string, handler: (event: Event<number>) => void) => Promise<() => void>>(),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen }) }));
vi.mock("@/features/tasks/queries", () => ({ invalidateTaskCaches: invalidate }));

it("invalidates task caches for valid Main events and disposes the listener", async () => {
  listen.mockReset(); invalidate.mockClear();
  const unlisten = vi.fn(); listen.mockResolvedValue(unlisten);
  const client = createLocalQueryClient(); const stop = watchMainTaskEvents(client);
  expect(listen.mock.calls[0][0]).toBe("task-created");
  const handler = listen.mock.calls[0][1];
  for (const payload of [0, -1, NaN, 1.5]) handler({ event: "task-created", id: 1, payload });
  expect(invalidate).not.toHaveBeenCalled();
  handler({ event: "task-created", id: 1, payload: 42 });
  expect(invalidate).toHaveBeenCalledExactlyOnceWith(client, 42);
  await Promise.resolve(); stop();
  expect(unlisten).toHaveBeenCalledTimes(1);
  handler({ event: "task-created", id: 1, payload: 43 });
  expect(invalidate).toHaveBeenCalledTimes(1);
  client.clear();
});

it("unlistens when asynchronous registration completes after disposal", async () => {
  let resolve!: (stop: () => void) => void;
  listen.mockReturnValue(new Promise((done) => { resolve = done; }));
  const client = createLocalQueryClient(); const stop = watchMainTaskEvents(client); stop();
  const unlisten = vi.fn(); resolve(unlisten); await Promise.resolve();
  expect(unlisten).toHaveBeenCalledTimes(1); client.clear();
});
