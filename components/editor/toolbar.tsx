"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/utils";

type Item = {
  key: keyof typeof messages.docs.toolbar;
  icon: LucideIcon;
  run: (e: Editor) => void;
  active?: (e: Editor) => boolean;
  disabled?: (e: Editor) => boolean;
};

const GROUPS: Item[][] = [
  [
    { key: "undo", icon: Undo2, run: (e) => e.chain().focus().undo().run(), disabled: (e) => !e.can().undo() },
    { key: "redo", icon: Redo2, run: (e) => e.chain().focus().redo().run(), disabled: (e) => !e.can().redo() },
  ],
  [
    { key: "paragraph", icon: Pilcrow, run: (e) => e.chain().focus().setParagraph().run(), active: (e) => e.isActive("paragraph") },
    { key: "h1", icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
    { key: "h2", icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
    { key: "h3", icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  ],
  [
    { key: "bold", icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
    { key: "italic", icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
    { key: "strike", icon: Strikethrough, run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
    { key: "code", icon: Code, run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  ],
  [
    { key: "alignLeft", icon: AlignLeft, run: (e) => e.chain().focus().setTextAlign("left").run(), active: (e) => e.isActive({ textAlign: "left" }) },
    { key: "alignCenter", icon: AlignCenter, run: (e) => e.chain().focus().setTextAlign("center").run(), active: (e) => e.isActive({ textAlign: "center" }) },
    { key: "alignRight", icon: AlignRight, run: (e) => e.chain().focus().setTextAlign("right").run(), active: (e) => e.isActive({ textAlign: "right" }) },
  ],
  [
    { key: "bulletList", icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
    { key: "orderedList", icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
    { key: "blockquote", icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
    { key: "codeBlock", icon: SquareCode, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
  ],
  [
    { key: "table", icon: Table, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { key: "hr", icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
];

const ALL = GROUPS.flat();

export function EditorToolbar({ editor, children }: { editor: Editor; children?: React.ReactNode }) {
  const t = messages.docs.toolbar;
  // 선택 영역이 바뀔 때만 다시 그리도록 필요한 상태만 구독한다.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      ALL.map((item) => `${item.active?.(e) ? 1 : 0}${item.disabled?.(e) ? 1 : 0}`).join(""),
  });

  return (
    <div role="toolbar" aria-label={t.label} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5 border-r pr-2 last:border-r-0">
          {group.map((item) => {
            const idx = ALL.indexOf(item);
            const active = state[idx * 2] === "1";
            const disabled = state[idx * 2 + 1] === "1";
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                title={t[item.key]}
                aria-label={t[item.key]}
                aria-pressed={item.active ? active : undefined}
                disabled={disabled}
                onClick={() => item.run(editor)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                  active && "bg-accent text-primary",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            );
          })}
        </div>
      ))}
      {children}
    </div>
  );
}
