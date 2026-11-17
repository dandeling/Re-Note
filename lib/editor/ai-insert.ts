import type { Editor, JSONContent } from "@tiptap/core";
import { insertLatex } from "@/lib/editor/nodes/math";

/**
 * 챗봇 제안을 에디터에 넣는 함수들 (SPEC 7.4: 사용자가 "삽입" 버튼을 눌렀을 때만 호출된다).
 * 문서를 바꾸는 일은 이 파일의 함수만 하며, 일반 트랜잭션으로 넣으므로 자동 저장이 그대로 돈다.
 */

/** 질문을 보낼 때의 선택 영역 */
export type CapturedSelection = { from: number; to: number; text: string };

const BLOCK_SEPARATOR = "\n\n";

/** 지금 선택 영역(비어 있지 않을 때)과 그 글을 기록한다. 챗봇에 컨텍스트로 보내는 글도 이것이다. */
export function captureSelection(editor: Editor): CapturedSelection | undefined {
  const { from, to, empty } = editor.state.selection;
  if (empty) return undefined;
  const text = editor.state.doc.textBetween(from, to, BLOCK_SEPARATOR, " ").trim();
  return text ? { from, to, text } : undefined;
}

/** 기록한 선택 영역이 지금도 그대로 선택돼 있고 내용도 같은가 */
function stillSelected(editor: Editor, captured: CapturedSelection | undefined): captured is CapturedSelection {
  if (!captured) return false;
  const { from, to } = editor.state.selection;
  if (from !== captured.from || to !== captured.to) return false;
  return editor.state.doc.textBetween(from, to, BLOCK_SEPARATOR, " ").trim() === captured.text;
}

/** 일반 텍스트 제안을 노드로 바꾼다. 한 문단이면 글자만, 여러 줄이면 줄마다 문단 노드. (HTML로 해석하지 않는다) */
export function textToContent(content: string): JSONContent | JSONContent[] | null {
  const paragraphs = content
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  if (paragraphs.length === 1) return { type: "text", text: paragraphs[0] };
  return paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }));
}

function isMounted(editor: Editor) {
  try {
    return editor.view.dom.isConnected;
  } catch {
    return false;
  }
}

/**
 * 글 제안을 넣는다.
 * - `replace_selection`이고 질문 당시의 선택 영역이 그대로면 그 영역을 바꾼다.
 * - 선택이 바뀌었거나 없으면(또는 `insert`면) 지금 커서 위치(선택 영역의 끝)에 넣는다. 다른 글을 지우지 않는다.
 */
export function insertSuggestedText(
  editor: Editor,
  content: string,
  mode: "replace_selection" | "insert",
  captured: CapturedSelection | undefined,
): boolean {
  const nodes = textToContent(content);
  if (!nodes) return false;
  const at = editor.state.selection.to;
  const range = mode === "replace_selection" && stillSelected(editor, captured) ? { from: captured.from, to: captured.to } : { from: at, to: at };
  const ok = editor.commands.insertContentAt(range, nodes, { updateSelection: true });
  if (ok && isMounted(editor)) editor.commands.focus();
  return ok;
}

/** 수식 제안을 커서 위치에 넣는다. 선택 영역이 있어도 지우지 않도록 선택 끝으로 접은 뒤 넣는다. */
export function insertSuggestedLatex(editor: Editor, latex: string, display: "inline" | "block"): boolean {
  const { to, empty } = editor.state.selection;
  if (!empty) editor.commands.setTextSelection(to);
  return insertLatex(editor, latex, { display: display === "block" });
}
