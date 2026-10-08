// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { createLocalQueryClient } from "@/app/queryClient";
import { FeatureSettings } from "./FeatureSettings";
import { NotificationSettings } from "./NotificationSettings";
import { parsePreferences, preferenceDefaults, preferencesRepository } from "./preferences";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/app/browserDebug", () => ({ isBrowserDebug: vi.fn() }));
const clients: ReturnType<typeof createLocalQueryClient>[] = [];
function setup(component: React.ReactNode) {
  const client = createLocalQueryClient(); clients.push(client);
  render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); vi.mocked(isBrowserDebug).mockReturnValue(true); });
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.restoreAllMocks(); });

it("persists browser module and notification choices across fresh reads", async () => {
  setup(<FeatureSettings />);
  const calendar = await screen.findByRole("switch", { name: "显示日历" });
  await waitFor(() => expect(calendar.hasAttribute("disabled")).toBe(false));
  fireEvent.click(calendar);
  await waitFor(() => expect(calendar.getAttribute("aria-checked")).toBe("false"));
  expect((await preferencesRepository.read()).calendarEnabled).toBe(false);
  await preferencesRepository.save({ ...preferenceDefaults, notificationsEnabled: false });
  expect((await preferencesRepository.read()).notificationsEnabled).toBe(false);
});
it("keeps saved controls unchanged when local persistence fails", async () => {
  setup(<FeatureSettings />);
  const journal = await screen.findByRole("switch", { name: "显示日记" });
  await waitFor(() => expect(journal.hasAttribute("disabled")).toBe(false));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.click(journal);
  await screen.findByRole("alert");
  expect(journal.getAttribute("aria-checked")).toBe("true");
});
it("ignores removed quiet settings and still validates active preferences", () => {
  expect(parsePreferences({ quietEnabled: true, quietStart: "invalid", quietEnd: "invalid" })).toEqual(preferenceDefaults);
  expect(() => parsePreferences({ journalEnabled: "false" })).toThrow();
});

it("routes desktop preferences and manual notification tests through native commands", async () => {
  vi.mocked(isBrowserDebug).mockReturnValue(false);
  vi.mocked(invoke).mockImplementation(async command => command === "test_system_notification" ? undefined : { ...preferenceDefaults, notificationsEnabled: false });
  setup(<NotificationSettings />);
  fireEvent.click(screen.getByRole("button", { name: "发送系统测试通知" }));
  await screen.findByText(/已向系统提交测试通知/);
  expect(invoke).toHaveBeenCalledWith("test_system_notification");
  await preferencesRepository.save(preferenceDefaults);
  expect(invoke).toHaveBeenCalledWith("set_app_preferences", { input: preferenceDefaults });
});
it("explains the desktop boundary and prevents browser notification tests", async () => {
  setup(<NotificationSettings />);
  expect(screen.getByRole("button", { name: "发送系统测试通知" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/浏览器预览不发送通知/)).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
});
