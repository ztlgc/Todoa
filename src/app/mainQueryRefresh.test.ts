// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import { createLocalQueryClient } from "./queryClient";
import { watchMainQueryRefresh } from "./mainQueryRefresh";

const { onFocusChanged } = vi.hoisted(() => ({ onFocusChanged: vi.fn<(handler: (event: TauriEvent<boolean>) => void) => Promise<() => void>>() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onFocusChanged }) }));
afterEach(() => { vi.restoreAllMocks(); onFocusChanged.mockReset(); });

it("refetches active queries on native focus or becoming visible and removes listeners", async () => {
  const client = createLocalQueryClient();
  const read = vi.fn(async () => 1);
  const observer = new QueryObserver(client, { queryKey: ["tasks"], queryFn: read });
  const stopQuery = observer.subscribe(() => {});
  const unlisten = vi.fn();
  onFocusChanged.mockResolvedValue(unlisten);
  const stopRefresh = watchMainQueryRefresh(client);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  const focused = onFocusChanged.mock.calls[0][0];
  focused({ event: "tauri://blur", id: 1, payload: false });
  expect(read).toHaveBeenCalledTimes(1);
  focused({ event: "tauri://focus", id: 2, payload: true });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(read).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  stopRefresh();
  expect(unlisten).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event("visibilitychange"));
  focused({ event: "tauri://focus", id: 3, payload: true });
  expect(read).toHaveBeenCalledTimes(3);
  stopQuery();
  client.clear();
});

it("cleans up a native listener that finishes registration after unmount", async () => {
  let registered!: (unlisten: () => void) => void;
  onFocusChanged.mockReturnValue(new Promise((resolve) => { registered = resolve; }));
  const client = createLocalQueryClient();
  const stopRefresh = watchMainQueryRefresh(client);
  stopRefresh();
  const unlisten = vi.fn();
  registered(unlisten);
  await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  client.clear();
});
