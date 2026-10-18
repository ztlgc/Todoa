// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createLocalQueryClient } from "@/app/queryClient";
import { journalRepository } from "@/data/repositories/JournalRepository";
import { JournalAutomation } from "./JournalAutomation";

vi.mock("@/app/browserDebug", () => ({ isBrowserDebug: () => false }));
vi.mock("@/data/repositories/JournalRepository", () => ({ journalRepository:{ reconcile:vi.fn() } }));
let client: ReturnType<typeof createLocalQueryClient>;
beforeEach(() => { vi.clearAllMocks(); client=createLocalQueryClient(); });
afterEach(() => { cleanup(); client.clear(); });

it("reconciles at application startup without visiting the journal and refreshes cached records", async () => {
  vi.mocked(journalRepository.reconcile).mockResolvedValue();
  client.setQueryData(["journal"],[{ text:"已有内容" }]);
  render(<QueryClientProvider client={client}><JournalAutomation /><p>任务首页</p></QueryClientProvider>);
  await waitFor(() => expect(client.getQueryState(["journal"])?.isInvalidated).toBe(true));
  expect(journalRepository.reconcile).toHaveBeenCalledTimes(1);
  expect(screen.getByText("任务首页")).toBeTruthy();
});

it("surfaces reconciliation errors and retries without clearing existing journal data", async () => {
  vi.mocked(journalRepository.reconcile).mockRejectedValueOnce(new Error("模拟失败")).mockResolvedValue();
  client.setQueryData(["journal"],[{ text:"不能丢失" }]);
  render(<QueryClientProvider client={client}><JournalAutomation /></QueryClientProvider>);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("补录失败"));
  expect(client.getQueryData(["journal"])).toEqual([{ text:"不能丢失" }]);
  fireEvent.click(screen.getByRole("button",{ name:"重试补录" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(journalRepository.reconcile).toHaveBeenCalledTimes(2);
});
