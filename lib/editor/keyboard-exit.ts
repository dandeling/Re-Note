import { Extension } from "@tiptap/core";

/**
 * 키보드 탈출(WCAG 2.1.2 키보드 트랩 없음): 표 안에서는 Tab이 셀 이동에 쓰여 에디터 밖으로 나갈 수 없으므로
 * Esc로 에디터 포커스를 놓는다. 그다음 Tab/Shift+Tab은 브라우저 기본 순서대로 다음·이전 요소로 간다.
 * UI 전용 확장이라 `documentExtensions()`(문서 스키마)에는 넣지 않는다.
 */
export const KeyboardExit = Extension.create({
  name: "keyboardExit",
  // 가장 나중에 실행한다: @ 참조 목록 등 Esc를 먼저 쓰는 기능이 있으면 그 기능이 Esc를 처리하고,
  // 아무도 쓰지 않을 때만 에디터를 빠져나간다. (Tiptap은 우선순위가 같으면 나중에 등록한 확장을 먼저 실행한다.)
  priority: 1,
  addKeyboardShortcuts() {
    return {
      Escape: ({ editor }) => {
        (editor.view.dom as HTMLElement).blur();
        return true;
      },
    };
  },
});
