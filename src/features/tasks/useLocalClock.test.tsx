// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { localDayRange } from "@/domain/taskDates";
import { useLocalClock } from "./useLocalClock";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("changes calendar boundaries across midnight and recomputes after a focus/wake clock jump", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 23, 59, 59));
  const { result } = renderHook(useLocalClock); const first = localDayRange(result.current);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(localDayRange(result.current).from).toBe(first.to);
  act(() => { vi.setSystemTime(new Date(2026, 9, 8)); window.dispatchEvent(new Event("focus")); });
  expect(result.current.getDate()).toBe(8);
});
