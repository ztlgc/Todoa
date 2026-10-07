import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  EditorContent,
  useEditor,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
  type JSONContent,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { contentRepository } from "@/data/repositories/ContentRepository";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function LocalImage({
  node,
  selected,
  updateAttributes,
  deleteNode,
  extension,
}: NodeViewProps) {
  const [url, setUrl] = useState<string>(),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [preview, setPreview] = useState(false);
  useEffect(() => {
    let active = true,
      object: string | undefined;
    const asset = Number(String(node.attrs.src).replace("todoa-asset:", ""));
    setFailed(false);
    void contentRepository
      .image(extension.options.taskId, asset)
      .then((blob) => {
        object = URL.createObjectURL(blob);
        if (active) setUrl(object);
        else URL.revokeObjectURL(object);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [node.attrs.src, extension.options.taskId, retry]);
  return (
    <NodeViewWrapper
      className={`my-3 rounded-lg ${selected ? "ring-2 ring-primary" : ""}`}
    >
      {url ? (
        <img
          src={url}
          alt={node.attrs.alt ?? "任务图片"}
          className="max-h-[480px] max-w-full cursor-zoom-in rounded-lg object-contain"
          onDoubleClick={() => setPreview(true)}
        />
      ) : (
        <div className="rounded-lg bg-muted p-5 text-sm">
          {failed ? (
            <Button variant="ghost" onClick={() => setRetry(retry + 1)}>
              图片加载失败，重试
            </Button>
          ) : (
            "正在加载图片…"
          )}
        </div>
      )}
      {selected && (
        <div contentEditable={false} className="flex gap-1 py-2">
          <Input
            aria-label="图片说明"
            placeholder="图片说明"
            value={node.attrs.alt ?? ""}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
          />
          <Button variant="ghost" size="sm" onClick={() => setPreview(true)}>
            预览
          </Button>
          <Button variant="ghost" size="sm" onClick={deleteNode}>
            删除图片
          </Button>
        </div>
      )}
      {preview && (
        <Dialog open onOpenChange={(open) => setPreview(open)}>
          <DialogContent className="sm:max-w-3xl">
            <DialogTitle>图片预览</DialogTitle>
            {url && (
              <img
                src={url}
                alt={node.attrs.alt ?? "任务图片"}
                className="max-h-[75dvh] max-w-full object-contain"
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </NodeViewWrapper>
  );
}
const TaskImage = Image.extend<{
  taskId: number;
  allowBase64: boolean;
  inline: boolean;
  HTMLAttributes: Record<string, unknown>;
}>({
  addOptions() {
    return {
      ...this.parent?.(),
      taskId: 0,
      allowBase64: false,
      inline: false,
      HTMLAttributes: {},
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(LocalImage);
  },
  parseHTML() {
    return [{ tag: 'img[src^="todoa-asset:"]' }];
  },
});

export function TaskContentEditor({
  id,
  initial,
  onChange,
  onComposition,
  onBusy,
  onEditor,
  showTools,
  onToolsClosed,
}: {
  id: number;
  initial: JSONContent;
  onChange: (doc: JSONContent) => void;
  onComposition: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  onEditor: (editor: Editor) => void;
  showTools: boolean;
  onToolsClosed?: () => void;
}) {
  const callbacks = useRef({
    onChange,
    onComposition,
    onBusy,
    onEditor,
    onToolsClosed,
  });
  callbacks.current = {
    onChange,
    onComposition,
    onBusy,
    onEditor,
    onToolsClosed,
  };
  const file = useRef<HTMLInputElement>(null),
    [error, setError] = useState<string>(),
    [importing, setImporting] = useState(false),
    [selected, setSelected] = useState(false),
    [renderRevision, setRender] = useState(0);
  const toolbarOpen = useRef(false);
  toolbarOpen.current = showTools || selected;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
      }),
      Highlight,
      TaskImage.configure({ taskId: id }),
    ],
    content: initial,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape" && toolbarOpen.current) {
          setSelected(false);
          callbacks.current.onToolsClosed?.();
          event.stopPropagation();
          return true;
        }
        return false;
      },
      attributes: {
        class: "task-content min-h-64 outline-none text-[15px] leading-7",
        role: "textbox",
        "aria-label": "任务内容",
        "aria-multiline": "true",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length) {
          void insert(files);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!moved && files.length) {
          event.preventDefault();
          void insert(files);
          return true;
        }
        return false;
      },
    },
    onTransaction: () => setRender((v) => v + 1),
    onUpdate: ({ editor }) => callbacks.current.onChange(editor.getJSON()),
    onFocus: ({ editor }) => setSelected(!editor.state.selection.empty),
    onSelectionUpdate: ({ editor }) =>
      setSelected(!editor.state.selection.empty),
  });
  useEffect(() => {
    if (editor) callbacks.current.onEditor(editor);
  }, [editor]);
  const selectionAnchor = useMemo(
    () =>
      editor
        ? {
            contextElement: editor.view.dom,
            getBoundingClientRect: () => {
              const selection = window.getSelection();
              if (
                selection?.rangeCount &&
                editor.view.dom.contains(selection.anchorNode) &&
                !selection.isCollapsed
              )
                return selection.getRangeAt(0).getBoundingClientRect();
              const position = editor.view.coordsAtPos(
                editor.state.selection.from,
              );
              return new DOMRect(
                position.left,
                position.top,
                1,
                position.bottom - position.top,
              );
            },
          }
        : null,
    [editor, renderRevision],
  );
  async function insert(files: File[]) {
    if (!editor || importing) return;
    setImporting(true);
    callbacks.current.onBusy(true);
    setError(undefined);
    try {
      for (const f of files) {
        const asset = await contentRepository.importImage(id, f);
        if (!editor.isDestroyed)
          editor
            .chain()
            .focus()
            .setImage({ src: `todoa-asset:${asset}`, alt: f.name })
            .run();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "图片插入失败，请重试。",
      );
    } finally {
      setImporting(false);
      callbacks.current.onBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  if (!editor) return <p>正在加载编辑器…</p>;
  const controls = [
    {
      label: "加粗",
      text: "B",
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      text: "I",
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "下划线",
      text: "U",
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "删除线",
      text: "S",
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "重点高亮",
      text: "重点",
      active: editor.isActive("highlight"),
      run: () => editor.chain().focus().toggleHighlight().run(),
    },
    {
      label: "无序列表",
      text: "• 列表",
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      text: "1. 列表",
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ];
  return (
    <div
      onCompositionStart={() => callbacks.current.onComposition(true)}
      onCompositionEnd={() => callbacks.current.onComposition(false)}
    >
      <Popover.Root
        open={showTools || selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(false);
            onToolsClosed?.();
          }
        }}
      >
        <Popover.Portal>
          <Popover.Positioner
            anchor={selectionAnchor}
            side="top"
            align="center"
            sideOffset={8}
            collisionPadding={12}
            className="z-50"
          >
            <Popover.Popup
              initialFocus={false}
              finalFocus={false}
              data-task-popover
              onMouseDown={(e) => e.preventDefault()}
              role="toolbar"
              aria-label="内容格式"
              className="flex w-[min(360px,calc(100vw-24px))] flex-wrap gap-1 rounded-lg border bg-popover p-1 shadow-md"
            >
              {controls.map((c) => (
                <Button
                  key={c.label}
                  aria-label={c.label}
                  aria-pressed={c.active}
                  variant={c.active ? "secondary" : "ghost"}
                  size="sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={c.run}
                >
                  {c.text}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                aria-label="插入图片"
                disabled={importing}
                onClick={() => file.current?.click()}
              >
                图片
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().undo().run()}
              >
                撤销
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().redo().run()}
              >
                重做
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const href = window.prompt(
                    "链接地址（https://…）",
                    editor.getAttributes("link").href ?? "",
                  );
                  if (href === null) return;
                  if (!href) editor.chain().focus().unsetLink().run();
                  else if (/^(https?:\/\/|mailto:)/.test(href))
                    editor.chain().focus().setLink({ href }).run();
                  else setError("请输入 http、https 或 mailto 链接。");
                }}
              >
                链接
              </Button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <div className="relative">
        <EditorContent editor={editor} />
        {editor.isEmpty && (
          <p className="pointer-events-none absolute top-0 text-sm text-muted-foreground">
            添加内容…
          </p>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        aria-label="选择任务图片"
        onChange={(e) => void insert(Array.from(e.target.files ?? []))}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
