import { Plugin, PluginKey } from "@tiptap/pm/state";

/** 캡션·블록 수식에 붙이는 짧은 무작위 id */
export function newNodeId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

export const uniqueIdPluginKey = new PluginKey("uniqueNodeId");

/**
 * `id` 속성이 비었거나 겹치는 노드에 새 id를 준다 (문서 순서에서 먼저 나온 쪽이 id를 유지).
 * 캡션을 Enter로 나누거나 복사해 붙여 넣었을 때 같은 id가 둘이 되는 것을 막는다.
 */
export function uniqueIdPlugin(typeNames: string[], makeId: () => string = newNodeId): Plugin {
  return new Plugin({
    key: uniqueIdPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const seen = new Set<string>();
      const fixes: number[] = [];
      newState.doc.descendants((node, pos) => {
        if (!typeNames.includes(node.type.name)) return true;
        const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
        if (!id || seen.has(id)) fixes.push(pos);
        else seen.add(id);
        return false;
      });
      if (!fixes.length) return null;
      const tr = newState.tr;
      for (const pos of fixes) {
        let id = makeId();
        while (seen.has(id)) id = makeId();
        seen.add(id);
        tr.setNodeAttribute(pos, "id", id);
      }
      return tr;
    },
  });
}
