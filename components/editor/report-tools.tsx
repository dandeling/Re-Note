"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { AtSign, Captions, Images, Sheet, Sigma, SquareSigma, WandSparkles, type LucideIcon } from "lucide-react";
import { findCaptionTarget } from "@/lib/editor/nodes/caption";
import { messages } from "@/lib/messages";
import { CrossRefPicker } from "./cross-ref-picker";
import { MathAiPanel, setMathAiOpen, useMathAiOpen } from "./math-ai-panel";
import { MathPanel, requestEasyMath } from "./math-panel";
import "katex/dist/katex.min.css";
import "./report-nodes.css";

type Tool = { key: string; label: string; icon: LucideIcon; run: (e: Editor) => void; disabled?: boolean };

/** `@`를 넣어 참조 고르기 목록을 연다. 앞 글자에 붙어 있으면 한 칸 띄운다. */
function startCrossRef(editor: Editor) {
  const { $from } = editor.state.selection;
  const before = $from.parent.isTextblock ? $from.parent.textBetween(0, $from.parentOffset, undefined, "￼") : "";
  editor.chain().focus().insertContent(before && !/\s$/.test(before) ? " @" : "@").run();
}

/** 툴바에 끼워 넣는 캡션·상호 참조·목차·수식 버튼 */
export function ReportTools({ editor }: { editor: Editor }) {
  const c = messages.captions;
  const m = messages.math;
  const mathAiOpen = useMathAiOpen(editor);
  const canCaption = useEditorState({ editor, selector: ({ editor: e }) => findCaptionTarget(e.state) !== null });

  const tools: Tool[] = [
    { key: "caption", label: c.insertCaption, icon: Captions, run: (e) => e.chain().focus().insertCaption().run(), disabled: !canCaption },
    { key: "crossRef", label: c.insertCrossRef, icon: AtSign, run: startCrossRef },
    { key: "figureList", label: c.insertFigureList, icon: Images, run: (e) => e.chain().focus().insertCaptionList("figure").run() },
    { key: "tableList", label: c.insertTableList, icon: Sheet, run: (e) => e.chain().focus().insertCaptionList("table").run() },
    // 수식은 넣자마자 입력란으로 초점이 가야 하므로 에디터에 초점을 돌려주지 않는다.
    // 툴바로 넣는 새 수식은 쉬운 입력(또는 마지막에 고른 방식)으로 연다.
    { key: "mathInline", label: m.insertInline, icon: Sigma, run: (e) => (requestEasyMath(e), e.chain().insertMathInline("", { select: true }).run()) },
    { key: "mathBlock", label: m.insertBlock, icon: SquareSigma, run: (e) => (requestEasyMath(e), e.chain().insertMathBlock("", { select: true }).run()) },
    { key: "mathAi", label: m.ai.open, icon: WandSparkles, run: (e) => setMathAiOpen(e, !mathAiOpen) },
  ];

  return (
    <div role="group" aria-label={c.toolsLabel} className="flex items-center gap-0.5">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.key}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            disabled={tool.disabled}
            aria-expanded={tool.key === "mathAi" ? mathAiOpen : undefined}
            onClick={() => tool.run(editor)}
            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** 툴바 아래에 놓는 패널: 수식 편집(팔레트 포함)과 `@` 참조 고르기 목록 */
export function ReportPanels({ editor }: { editor: Editor }) {
  return (
    <>
      <MathPanel editor={editor} />
      <MathAiPanel editor={editor} />
      <CrossRefPicker editor={editor} />
    </>
  );
}
