import { ChartImageAttributes } from "@/lib/data/chart-image";
import type { Extensions } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import type { CaptionPositions } from "@/lib/captions/types";
import { Caption, CaptionList } from "./nodes/caption";
import { CrossRef } from "./nodes/cross-ref";
import { MathBlock, MathInline } from "./nodes/math";

export type DocumentExtensionOptions = {
  /** 캡션 위치 규칙 (기본: 그림·수식은 아래, 표는 위). 서식 템플릿이 넘긴다. */
  captionPositions?: Partial<CaptionPositions>;
};

/**
 * 문서 스키마를 정의하는 확장 목록. 에디터(클라이언트)와 내보내기(서버)가 같은 목록을 쓴다.
 * UI 전용 확장(placeholder 등)은 에디터 컴포넌트에서 따로 더한다.
 * 여기의 노드는 React·DOM에 기대지 않고 `renderHTML`만으로 의미 있는 HTML을 낸다.
 * 에디터 화면용 NodeView(KaTeX 렌더링, 번호 표시)는 `components/editor/editor-extensions.ts`가 덧붙인다.
 */
export function documentExtensions(options: DocumentExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
    Image.configure({ allowBase64: true }),
    // 그래프 그림의 원본 데이터셋·설정 속성 (datasetId, chart)
    ChartImageAttributes,
    TableKit.configure({ table: { resizable: false } }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    options.captionPositions ? Caption.configure({ positions: options.captionPositions }) : Caption,
    CaptionList,
    CrossRef,
    MathInline,
    MathBlock,
  ];
}
