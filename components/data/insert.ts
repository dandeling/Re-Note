"use client";

import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { newCaptionId, withCaption, type CaptionKind } from "@/lib/data/doc-nodes";
import type { DocNode } from "@/lib/editor/content";

/** 에디터 스키마에 caption 노드가 있는가 (캡션 기능은 다른 확장이 추가한다) */
export function hasCaptionNode(editor: Editor) {
  return Boolean(editor.schema.nodes.caption);
}

/** 표·그림을 커서 위치에 넣는다. caption 노드가 있으면 캡션도 함께 넣는다. */
export function insertWithCaption(editor: Editor, body: DocNode, caption: { kind: CaptionKind; text: string }) {
  const nodes = withCaption(body, hasCaptionNode(editor) ? { ...caption, id: newCaptionId(caption.kind) } : null);
  // 방금 넣은 그림처럼 노드 전체가 선택돼 있으면 그 노드를 덮어쓰지 않고 뒤에 넣는다.
  const { selection } = editor.state;
  const chain = editor.chain().focus();
  return (selection instanceof NodeSelection ? chain.insertContentAt(selection.to, nodes) : chain.insertContent(nodes)).run();
}

/** 문구의 {name} 자리를 채운다. */
export function fill(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
