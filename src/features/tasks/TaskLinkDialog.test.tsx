// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskLinkDialog } from "./TaskLinkDialog";

afterEach(cleanup);
function setup(initialHref = "") {
  const apply = vi.fn(), close = vi.fn();
  render(<TaskLinkDialog initialHref={initialHref} returnTo={null} onApply={apply} onClosed={close} />);
  return { apply, close };
}
it.each(["https://example.com/docs?q=中文", "http://localhost:1422/", "mailto:test@example.com"])("saves a supported address without a native prompt: %s", href => {
  const { apply, close } = setup();
  fireEvent.change(screen.getByLabelText("链接地址"), { target: { value: ` ${href} ` } });
  fireEvent.click(screen.getByRole("button", { name: "保存链接" }));
  expect(apply).toHaveBeenCalledWith(href);
  expect(close).toHaveBeenCalledOnce();
});
it.each(["javascript:alert(1)", "file:///C:/private.txt", "https://", "mailto:"])("rejects an invalid or unsupported address and retains the input: %s", href => {
  const { apply, close } = setup();
  fireEvent.change(screen.getByLabelText("链接地址"), { target: { value: href } });
  fireEvent.click(screen.getByRole("button", { name: "保存链接" }));
  expect(screen.getByRole("alert").textContent).toContain("有效");
  expect((screen.getByLabelText("链接地址") as HTMLInputElement).value).toBe(href);
  expect(apply).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
it("cancels an edited address without applying it", () => {
  const { apply, close } = setup("https://example.com/original");
  fireEvent.change(screen.getByLabelText("链接地址"), { target: { value: "https://example.com/changed" } });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(apply).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it("removes an existing link explicitly", () => {
  const { apply, close } = setup("https://example.com/original");
  fireEvent.click(screen.getByRole("button", { name: "移除链接" }));
  expect(apply).toHaveBeenCalledWith("");
  expect(close).toHaveBeenCalledOnce();
});
it("does not save while the address is being composed", () => {
  const { apply } = setup();
  const field = screen.getByLabelText("链接地址");
  fireEvent.compositionStart(field);
  fireEvent.click(screen.getByRole("button", { name: "保存链接" }));
  expect(apply).not.toHaveBeenCalled();
});
