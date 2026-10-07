import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useQueryClient } from "@tanstack/react-query";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  CalendarDays,
  Flag,
  MoreHorizontal,
  Tag as TagIcon,
  Type,
  X,
  Inbox,
  Repeat2,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Task, UpdateTaskInput } from "@/domain/task";
import type { TaskList } from "@/domain/list";
import type { Tag, TaskTag } from "@/domain/tag";
import {
  contentRepository,
  plainDocument,
} from "@/data/repositories/ContentRepository";
import { isBrowserDebug } from "@/app/browserDebug";
import { TaskTags } from "@/features/tags/TaskTags";
import {
  useTask,
  useTrashTask,
  useUpdateTask,
  useUpdateTaskStatus,
  invalidateTaskCaches,
} from "./queries";
import { priorityMeta, taskPriorities } from "./taskPriority";
import { TaskContentEditor } from "./TaskContentEditor";
import { TaskSchedulePicker } from "./TaskSchedulePicker";

type Props = {
  id: number;
  lists: TaskList[];
  listsUnavailable: boolean;
  tags?: Tag[];
  taskTags: TaskTag[];
  tagsUnavailable: boolean;
  returnTo: HTMLElement | null;
  onClosed: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};
const temporaryDrafts = new Map<string, string>();
const browserDraftStorage = {
  getItem: (key: string) => temporaryDrafts.get(key) ?? null,
  setItem: (key: string, value: string) => {
    temporaryDrafts.set(key, value);
  },
  removeItem: (key: string) => {
    temporaryDrafts.delete(key);
  },
};
export function TaskDetails(props: Props) {
  const query = useTask(props.id),
    [wide, setWide] = useState(false),
    requestClose = useRef<() => void>(() => {});
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia("(min-width:1100px)");
    const update = () => setWide(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  const close = () => {
    props.onDirtyChange?.(false);
    props.onClosed();
    requestAnimationFrame(() => {
      (props.returnTo?.isConnected
        ? props.returnTo
        : document.getElementById("inbox-heading")
      )?.focus();
    });
  };
  const content = query.data ? (
    <Inspector
      key={props.id}
      {...props}
      task={query.data}
      onClosed={close}
      registerClose={(callback) => {
        requestClose.current = callback;
      }}
    />
  ) : (
    <div className="p-6">
      {query.isPending ? (
        <p role="status">正在读取任务详情…</p>
      ) : (
        <>
          <p role="alert">
            {query.isError ? "详情读取失败。" : "任务已被删除。"}
          </p>
          <Button onClick={() => void query.refetch()}>重试详情</Button>
          <Button onClick={close}>关闭</Button>
        </>
      )}
    </div>
  );
  return wide ? (
    <aside
      aria-label="任务详情"
      className="fixed inset-y-0 right-0 z-20 flex w-[min(460px,38vw)] min-w-80 flex-col border-l bg-background text-sm"
    >
      {content}
    </aside>
  ) : (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          if (document.querySelector("[data-task-popover]")) return;
          if (query.data) requestClose.current();
          else close();
        }
      }}
    >
      <DialogContent
        layout="inspector"
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden p-0"
        initialFocus={false}
        finalFocus={() =>
          props.returnTo?.isConnected
            ? props.returnTo
            : document.getElementById("inbox-heading")
        }
      >
        <DialogTitle className="sr-only">
          {query.data?.title ?? "任务详情"}
        </DialogTitle>
        {content}
      </DialogContent>
    </Dialog>
  );
}

function Inspector({
  task,
  lists,
  listsUnavailable,
  tags,
  taskTags,
  tagsUnavailable,
  onClosed,
  onDirtyChange,
  registerClose,
}: Props & { task: Task; registerClose: (callback: () => void) => void }) {
  const client = useQueryClient(),
    update = useUpdateTask(),
    status = useUpdateTaskStatus(),
    trash = useTrashTask();
  const initialDoc = useRef<JSONContent>(
    task.contentJson ? JSON.parse(task.contentJson) : plainDocument(task.notes),
  );
  const [title, setTitle] = useState(task.title),
    [saveState, setSaveState] = useState("已保存"),
    [error, setError] = useState<string>();
  const [tools, setTools] = useState(false),
    [panel, setPanel] = useState<
      "schedule" | "priority" | "tags" | "list" | "more" | null
    >(null);
  const [recovery, setRecovery] = useState<{
    title: string;
    doc: JSONContent;
  } | null>(null);
  const editor = useRef<Editor | null>(null),
    composing = useRef(false),
    imageBusy = useRef(false),
    alive = useRef(true),
    root = useRef<HTMLDivElement>(null);
  const current = useRef({
      title: task.title,
      doc: initialDoc.current,
      sequence: 0,
    }),
    saved = useRef(0),
    revision = useRef(task.contentRevision ?? 0);
  const saving = useRef<Promise<boolean> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    closing = useRef(false),
    actionBusy = useRef(false);
  const storage = isBrowserDebug() ? browserDraftStorage : localStorage,
    draftKey = `todoa-content-draft-${task.id}`;
  function persist() {
    try {
      storage.setItem(
        draftKey,
        JSON.stringify({
          title: current.current.title,
          doc: current.current.doc,
          revision: revision.current,
        }),
      );
    } catch {
      setError("本地草稿空间不足，请保持页面打开并重试保存。");
    }
  }
  function changed() {
    current.current.sequence++;
    persist();
    onDirtyChange?.(true);
    setSaveState("待保存");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!composing.current) void flush();
    }, 800);
  }
  async function flush(): Promise<boolean> {
    if (composing.current || imageBusy.current) return false;
    if (saving.current) return saving.current;
    if (current.current.sequence === saved.current) return true;
    const work = async () => {
      setSaveState("保存中…");
      setError(undefined);
      try {
        while (current.current.sequence !== saved.current) {
          const snapshot = { ...current.current };
          revision.current = await contentRepository.save(
            task.id,
            snapshot.title,
            snapshot.doc,
            revision.current,
          );
          saved.current = snapshot.sequence;
        }
        storage.removeItem(draftKey);
        onDirtyChange?.(false);
        if (alive.current) setSaveState("已保存");
        await invalidateTaskCaches(client, task.id).catch(() =>
          console.error("CONTENT_REFRESH_FAILED"),
        );
        return true;
      } catch (cause) {
        persist();
        if (alive.current) {
          setSaveState("保存失败");
          setError(
            String(cause).includes("CONTENT_CONFLICT")
              ? "任务内容已在其他位置更新。草稿已保留，请重新载入后选择要保留的内容。"
              : "保存失败，草稿已保留。请重试。",
          );
        }
        return false;
      }
    };
    saving.current = work();
    const result = await saving.current;
    saving.current = null;
    return result;
  }
  async function close() {
    if (closing.current) return;
    closing.current = true;
    if (await flush()) onClosed();
    closing.current = false;
  }
  useEffect(() => {
    alive.current = true;
    registerClose(() => {
      void close();
    });
    try {
      const draft = storage.getItem(draftKey);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.doc?.type === "doc" && typeof parsed.title === "string")
          setRecovery(parsed);
      }
    } catch {
      setError("恢复草稿无法读取，已保存的内容仍可编辑。");
    }
    const blur = () => {
      void flush();
    };
    window.addEventListener("blur", blur);
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !composing.current &&
        !event.isComposing &&
        !document.querySelector(
          '[data-slot="dialog-content"] [aria-label="截止日期"]',
        ) &&
        !panel &&
        !document.querySelector("[data-task-popover]")
      ) {
        event.preventDefault();
        void close();
      }
    };
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        root.current?.contains(target) ||
        (target instanceof Element && target.closest("[data-task-popover]")) ||
        document.querySelector('[data-slot="dialog-content"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const element = target instanceof Element ? target : target.parentElement;
      const replay = element?.closest<HTMLElement>(
        'button,a,input,select,[role="button"]',
      );
      void flush().then((ok) => {
        if (ok) {
          onClosed();
          requestAnimationFrame(() => {
            if (replay?.isConnected) replay.click();
          });
        }
      });
    };
    document.addEventListener("click", outside, true);
    const element = root.current;
    element?.addEventListener("keydown", escape);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("blur", blur);
      document.removeEventListener("click", outside, true);
      element?.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (
      current.current.sequence === saved.current &&
      !saving.current &&
      (task.contentRevision ?? 0) !== revision.current
    ) {
      revision.current = task.contentRevision ?? 0;
      current.current.title = task.title;
      current.current.doc = task.contentJson
        ? JSON.parse(task.contentJson)
        : plainDocument(task.notes);
      setTitle(task.title);
      editor.current?.commands.setContent(current.current.doc, {
        emitUpdate: false,
      });
    }
  }, [task.contentRevision, task.title, task.contentJson, task.notes]);
  async function attribute(input: UpdateTaskInput) {
    if (!(await flush())) throw new Error("请先完成正文保存。");
    await update.mutateAsync({ id: task.id, input });
  }
  async function action(kind: "status" | "delete") {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setError(undefined);
    try {
      if (!(await flush())) return;
      if (kind === "status")
        await status.mutateAsync({
          id: task.id,
          status: task.status === "completed" ? "todo" : "completed",
        });
      else {
        await trash.mutateAsync(task.id);
        onClosed();
      }
    } catch {
      setError("操作失败，任务和内容仍保留，请重试。");
    } finally {
      actionBusy.current = false;
    }
  }
  const pending = update.isPending || status.isPending || trash.isPending;
  const dateLabel =
    task.dueDate ??
    (task.dueAt
      ? new Date(task.dueAt).toLocaleString("zh-CN", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "日期与提醒");
  return (
    <div
      ref={root}
      className="flex h-full min-h-0 flex-col"
      aria-label="任务编辑器"
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
        <Checkbox
          checked={task.status === "completed"}
          disabled={pending}
          aria-label={task.status === "completed" ? "取消完成任务" : "完成任务"}
          className={priorityMeta(task.priority).checkbox}
          onCheckedChange={() => void action("status")}
        />
        <span className="mx-1 h-5 border-l" />
        <Button
          variant="ghost"
          size="sm"
          className={`min-w-0 flex-1 justify-start px-1 ${task.dueAt || task.dueDate ? "text-primary" : "text-muted-foreground"}`}
          aria-label="日期与提醒"
          onClick={() => setPanel("schedule")}
        >
          <CalendarDays className="size-4" />
          <span className="truncate">{dateLabel}</span>
          {task.repeatRule && <Repeat2 className="size-3" />}
          {!!task.reminderOffsets?.length && <Bell className="size-3" />}
        </Button>
        <Popover.Root
          open={panel === "priority"}
          onOpenChange={(open) => setPanel(open ? "priority" : null)}
        >
          <Popover.Trigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="设置优先级"
                className={priorityMeta(task.priority).color}
              />
            }
          >
            <Flag className="size-4" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={8}
              className="z-50"
            >
              <Popover.Popup
                aria-label="优先级"
                data-task-popover
                className="w-40 rounded-lg border bg-popover p-1 shadow-md"
              >
                {taskPriorities.map((p) => (
                  <Button
                    key={p.value}
                    variant={task.priority === p.value ? "secondary" : "ghost"}
                    size="sm"
                    disabled={pending}
                    className={`h-7 w-full justify-start text-xs ${p.color}`}
                    onClick={() =>
                      void attribute({ priority: p.value })
                        .then(() => setPanel(null))
                        .catch(() => setError("优先级保存失败，请重试。"))
                    }
                  >
                    <Flag className="size-3.5" />
                    {p.label}
                  </Button>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭任务详情"
          onClick={() => void close()}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {recovery && (
          <div role="status" className="mb-4 rounded-lg bg-muted p-3 text-xs">
            <p>找到尚未保存的内容草稿。恢复前可核对当前内容。</p>
            <p className="mt-2 max-h-20 overflow-auto">
              草稿标题：{recovery.title}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setTitle(recovery.title);
                  current.current.title = recovery.title;
                  current.current.doc = recovery.doc;
                  editor.current?.commands.setContent(recovery.doc, {
                    emitUpdate: false,
                  });
                  changed();
                  setRecovery(null);
                }}
              >
                恢复草稿
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  storage.removeItem(draftKey);
                  setRecovery(null);
                }}
              >
                使用已保存内容
              </Button>
            </div>
          </div>
        )}
        <h2 className="sr-only">{title || "任务详情"}</h2>
        <textarea
          autoFocus
          autoComplete="off"
          aria-label="任务标题"
          value={title}
          rows={Math.max(1, Math.ceil(title.length / 18))}
          className="mb-3 max-h-40 w-full resize-none border-0 bg-transparent text-[22px] leading-8 font-semibold outline-none placeholder:text-muted-foreground"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            void flush();
          }}
          onChange={(e) => {
            setTitle(e.target.value);
            current.current.title = e.target.value;
            changed();
          }}
          placeholder="任务标题"
        />
        <TaskContentEditor
          id={task.id}
          initial={initialDoc.current}
          showTools={tools}
          onToolsClosed={() => setTools(false)}
          onEditor={(e) => {
            editor.current = e;
          }}
          onChange={(doc) => {
            current.current.doc = doc;
            changed();
          }}
          onComposition={(value) => {
            composing.current = value;
            if (!value) void flush();
          }}
          onBusy={(value) => {
            imageBusy.current = value;
          }}
        />
        <div className="mt-5 flex flex-wrap gap-2">
          {tags
            ?.filter((tag) =>
              taskTags.some(
                (link) => link.taskId === task.id && link.tagId === tag.id,
              ),
            )
            .map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                onClick={() => setPanel("tags")}
              >
                # {tag.name}
              </button>
            ))}
        </div>
        {error && (
          <div role="alert" className="mt-4 space-y-2 text-xs text-destructive">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => void flush()}>
              重试保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRecovery({
                  title: current.current.title,
                  doc: current.current.doc,
                });
                revision.current = task.contentRevision ?? 0;
                current.current = {
                  title: task.title,
                  doc: task.contentJson
                    ? JSON.parse(task.contentJson)
                    : plainDocument(task.notes),
                  sequence: 0,
                };
                saved.current = 0;
                setTitle(task.title);
                editor.current?.commands.setContent(current.current.doc, {
                  emitUpdate: false,
                });
                setError(undefined);
              }}
            >
              重新载入内容
            </Button>
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center gap-1 border-t px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          aria-label="所属清单"
          className="min-w-0 max-w-40 justify-start"
          onClick={() => setPanel("list")}
        >
          <Inbox className="size-4" />
          <span className="truncate">
            {lists.find((l) => l.id === task.listId)?.name ?? "收件箱"}
          </span>
        </Button>
        <span
          role="status"
          className="ml-auto text-[11px] text-muted-foreground"
        >
          {saveState}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="内容格式"
          aria-pressed={tools}
          onClick={() => setTools(!tools)}
        >
          <Type className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="管理任务标签"
          onClick={() => setPanel("tags")}
        >
          <TagIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="更多任务操作"
          onClick={() => setPanel("more")}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </footer>
      {panel === "schedule" && (
        <TaskSchedulePicker
          task={task}
          onSave={attribute}
          onClosed={() => setPanel(null)}
        />
      )}
      {panel && panel !== "schedule" && panel !== "priority" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {panel === "list"
                ? "所属清单"
                : panel === "tags"
                  ? "标签"
                  : "更多操作"}
            </DialogTitle>
            {panel === "list" &&
              [{ id: null, name: "收件箱" }, ...lists].map((l) => (
                <Button
                  key={l.id ?? "inbox"}
                  variant={task.listId === l.id ? "secondary" : "ghost"}
                  disabled={pending || listsUnavailable}
                  className="justify-start"
                  onClick={() =>
                    void attribute({ listId: l.id })
                      .then(() => setPanel(null))
                      .catch(() => setError("清单保存失败，请重试。"))
                  }
                >
                  {l.name}
                </Button>
              ))}
            {panel === "tags" &&
              (tags && !tagsUnavailable ? (
                <TaskTags
                  task={task}
                  tags={tags}
                  assignedIds={taskTags
                    .filter((l) => l.taskId === task.id)
                    .map((l) => l.tagId)}
                  disabled={pending}
                />
              ) : (
                <p>标签暂不可用，请重试读取。</p>
              ))}
            {panel === "more" && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void action("delete")}
              >
                移入回收站
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
