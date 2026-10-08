// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomRepeatDialog } from "./CustomRepeatDialog";
import { parseRecurrence } from "@/domain/recurrence";
afterEach(cleanup);
it("selects multiple weekdays and previews them before applying a draft", () => {
  const apply=vi.fn();
  render(<CustomRepeatDialog rule="" date="2026-10-05" time="09:00" onApply={apply} onClosed={()=>{}} />);
  fireEvent.click(screen.getByRole("button",{name:"每周三"}));
  expect(screen.getByText("2026-10-07 09:00")).toBeTruthy();
  expect(screen.getByText("2026-10-12 09:00")).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"应用重复"}));
  expect(parseRecurrence(apply.mock.calls[0][0])).toMatchObject({weekdays:[1,3],basis:"due"});
});
it("selects the first workday and a count limit, then restores the saved rule", () => {
  const apply=vi.fn();
  const {unmount}=render(<CustomRepeatDialog rule="" date="2026-10-01" time="" onApply={apply} onClosed={()=>{}} />);
  fireEvent.change(screen.getByLabelText("重复单位"),{target:{value:"month"}});
  fireEvent.click(screen.getByRole("button",{name:"工作日"}));
  fireEvent.change(screen.getByLabelText("重复结束方式"),{target:{value:"count"}});
  fireEvent.change(screen.getByLabelText("重复总次数"),{target:{value:"2"}});
  expect(screen.getByText("2026-11-02")).toBeTruthy();
  expect(screen.queryByText("2026-12-01")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"应用重复"}));
  const saved=apply.mock.calls[0][0];
  expect(parseRecurrence(saved)).toMatchObject({monthMode:"workday",end:"count",count:2});
  unmount();
  render(<CustomRepeatDialog rule={saved} date="2026-10-01" time="" onApply={apply} onClosed={()=>{}} />);
  expect((screen.getByLabelText("工作日位置") as HTMLSelectElement).value).toBe("first");
  expect((screen.getByLabelText("重复总次数") as HTMLInputElement).value).toBe("2");
});
it("validates custom dates and keeps cancellation separate from applying", () => {
  const apply=vi.fn(),close=vi.fn();
  render(<CustomRepeatDialog rule="" date="2026-10-05" time="" onApply={apply} onClosed={close} />);
  fireEvent.change(screen.getByLabelText("重复计算方式"),{target:{value:"dates"}});
  fireEvent.click(screen.getByRole("button",{name:"应用重复"}));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("添加重复日期"),{target:{value:"2026-10-11"}});
  fireEvent.click(screen.getByRole("button",{name:"加入"}));
  expect(screen.getByText("2026-10-11")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"取消"}));
  expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
});
