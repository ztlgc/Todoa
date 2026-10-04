// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ShortcutNotice } from "./ShortcutNotice";

const { listen } = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("reports an OS registration failure explicitly and unsubscribes", async () => {
  const stop = vi.fn(); listen.mockResolvedValue(stop);
  vi.mocked(invoke).mockResolvedValue("registration-failed");
  const view = render(<ShortcutNotice />);
  await screen.findByText(/可能已被其他应用占用/);
  expect(invoke).toHaveBeenCalledWith("global_shortcut_status");
  expect(screen.getByRole("alert").textContent).toContain("仍可点击快速添加");
  view.unmount(); expect(stop).toHaveBeenCalledTimes(1);
});

it("cleans up a late listener without querying status after disposal", async () => {
  let resolve!: (stop: () => void) => void;
  listen.mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = render(<ShortcutNotice />); view.unmount();
  const stop = vi.fn(); resolve(stop);
  await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  expect(invoke).not.toHaveBeenCalled();
});
