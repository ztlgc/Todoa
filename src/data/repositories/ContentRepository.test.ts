import { expect, it, vi } from "vitest";
import { browserTaskRepository } from "@/data/browserRepositories";
import { contentRepository, plainDocument } from "./ContentRepository";
import { withSubtasks } from "@/domain/subtask";

vi.mock("@/app/browserDebug", () => ({ isBrowserDebug: () => true }));
it("stores subtasks with content and keeps readable snapshots without accepting stale writes", async () => {
  const task = await browserTaskRepository.create({ title: "带子任务的交付" });
  const doc = withSubtasks(plainDocument("交付说明"), [
    { id: "one", title: "核对", completed: false, dueAt: "2026-10-20T01:30:00.000Z" },
    { id: "two", title: "归档", completed: true },
  ]);
  await contentRepository.save(task.id, task.title, doc, 0);
  expect(await browserTaskRepository.getById(task.id)).toMatchObject({ notes: "[ ] 核对\n[x] 归档\n交付说明", contentJson: JSON.stringify(doc) });
  await expect(contentRepository.save(task.id, task.title, plainDocument("旧正文"), 0)).rejects.toThrow("CONTENT_CONFLICT");
  expect((await browserTaskRepository.getById(task.id))?.contentJson).toBe(JSON.stringify(doc));
});

it("saves an emoji title accepted by task creation at the 500-character boundary", async () => {
  const title = "😀".repeat(500);
  const task = await browserTaskRepository.create({ title });
  expect(await contentRepository.save(task.id, title, plainDocument("编辑后保存"), 0)).toBe(1);
  expect(await browserTaskRepository.getById(task.id)).toMatchObject({ title, notes: "编辑后保存", contentRevision: 1 });
  await expect(contentRepository.save(task.id, `${title}😀`, plainDocument("不得覆盖"), 1)).rejects.toThrow();
  expect(await browserTaskRepository.getById(task.id)).toMatchObject({ title, notes: "编辑后保存", contentRevision: 1 });
});

it("uses the same character limit for emoji notes as the task domain", async () => {
  const task = await browserTaskRepository.create({ title: "表情正文边界" });
  const notes = "😀".repeat(100000);
  expect(await contentRepository.save(task.id, task.title, plainDocument(notes), 0)).toBe(1);
  expect((await browserTaskRepository.getById(task.id))?.notes).toBe(notes);
  await expect(contentRepository.save(task.id, task.title, plainDocument(`${notes}😀`), 1)).rejects.toThrow();
  expect((await browserTaskRepository.getById(task.id))?.contentRevision).toBe(1);
});
