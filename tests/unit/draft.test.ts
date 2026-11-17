import { describe, expect, it } from "vitest";
import type { DocContent } from "@/lib/editor/content";
import { decideDraft, jsonEqual, type LocalDraft } from "@/lib/editor/draft";

const doc = (text: string): DocContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const draft = (text: string, baseVersion = 3, title = "보고서"): LocalDraft => ({
  docId: "d1",
  title,
  contentJson: doc(text),
  baseVersion,
  savedAt: 0,
});

describe("로컬 초안 복구 결정 (SPEC 7.5)", () => {
  it("초안이 없으면 아무것도 하지 않는다", () => {
    expect(decideDraft(null, { title: "보고서", contentJson: doc("가"), version: 3 })).toEqual({ action: "discard" });
  });
  it("초안이 서버 내용과 같으면 버린다 (이미 저장된 경우)", () => {
    expect(decideDraft(draft("가"), { title: "보고서", contentJson: doc("가"), version: 4 })).toEqual({
      action: "discard",
    });
  });
  it("서버에 없는 변경이 있으면 복구를 제안한다", () => {
    expect(decideDraft(draft("오프라인에서 쓴 글"), { title: "보고서", contentJson: doc("가"), version: 3 })).toEqual({
      action: "offer",
      serverChanged: false,
    });
  });
  it("제목만 달라도 복구를 제안한다", () => {
    expect(decideDraft(draft("가", 3, "새 제목"), { title: "보고서", contentJson: doc("가"), version: 3 }).action).toBe(
      "offer",
    );
  });
  it("그 사이 서버도 바뀌었으면 serverChanged로 알린다", () => {
    expect(decideDraft(draft("내 글"), { title: "보고서", contentJson: doc("남의 글"), version: 5 })).toEqual({
      action: "offer",
      serverChanged: true,
    });
  });
});

describe("jsonEqual", () => {
  it("키 순서와 undefined 값은 무시한다", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
  it("값·길이·타입이 다르면 다르다", () => {
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [1])).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });
});
