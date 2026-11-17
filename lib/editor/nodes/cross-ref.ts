import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    crossRef: {
      /** 캡션(또는 블록 수식) id를 가리키는 상호 참조를 커서 자리에 넣는다. */
      insertCrossRef: (targetId: string) => ReturnType;
    };
  }
}

/** 상호 참조. 보이는 글자(`그림 1` 등)는 저장하지 않고 대상의 현재 번호로 그린다. */
export const CrossRef = Node.create({
  name: "crossRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      targetId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-target-id") ?? "",
        renderHTML: (attrs) => ({ "data-target-id": attrs.targetId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="cross-ref"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-type": "cross-ref", class: "doc-cross-ref" }, HTMLAttributes)];
  },

  addCommands() {
    return {
      insertCrossRef:
        (targetId) =>
        ({ commands }) =>
          !!targetId && commands.insertContent({ type: this.name, attrs: { targetId } }),
    };
  },
});
