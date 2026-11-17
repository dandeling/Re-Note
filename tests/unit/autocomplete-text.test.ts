import { describe, expect, it } from "vitest";
import { cleanCompletion, clipBefore, neutralizeTags, removeOverlap } from "@/lib/editor/autocomplete-text";

describe("cleanCompletion — 자동완성 제안 후처리", () => {
  const MID = "그 결과 길이가 길어질수록";
  const END = "진자의 주기를 측정하였다.";

  it("감싼 따옴표를 지운다", () => {
    expect(cleanCompletion(MID, '"주기도 길어졌다."')).toBe("주기도 길어졌다.");
    expect(cleanCompletion(MID, "“주기도 길어졌다.”")).toBe("주기도 길어졌다.");
    expect(cleanCompletion(MID, "「주기도 길어졌다.」")).toBe("주기도 길어졌다.");
  });

  it("줄바꿈 뒤는 버리고 첫 줄만 남긴다", () => {
    expect(cleanCompletion(MID, "\n주기도 길어졌다\n\n두 번째 문단")).toBe("주기도 길어졌다");
    expect(cleanCompletion(MID, "주기도\r\n길어졌다")).toBe("주기도");
  });

  it("첫 문장까지만 남긴다 (소수점은 문장 끝이 아니다)", () => {
    expect(cleanCompletion(MID, " 주기도 길어졌다. 이는 이론과 맞는다.")).toBe(" 주기도 길어졌다.");
    expect(cleanCompletion(MID, " 주기가 약 1.5배 길어졌다. 다음")).toBe(" 주기가 약 1.5배 길어졌다.");
  });

  it("앞 텍스트와 겹치는 부분을 지운다", () => {
    expect(cleanCompletion(MID, "길이가 길어질수록 주기도 길어졌다.")).toBe(" 주기도 길어졌다.");
    expect(cleanCompletion(END, "측정하였다. 그 결과는 표 1과 같다.")).toBe(" 그 결과는 표 1과 같다.");
  });

  it("공백: 앞이 문장 끝이면 띄우고, 앞이 공백으로 끝나면 앞 공백을 지운다", () => {
    expect(cleanCompletion(END, "그 결과는 다음과 같다.")).toBe(" 그 결과는 다음과 같다.");
    expect(cleanCompletion(`${END} `, "   그 결과는 다음과 같다.")).toBe("그 결과는 다음과 같다.");
    expect(cleanCompletion("길이가 길어질", "수록 주기도 길어졌다.")).toBe("수록 주기도 길어졌다.");
    expect(cleanCompletion(MID, " 주기도  길어졌다.")).toBe(" 주기도 길어졌다.");
  });

  it("구분 태그·코드 펜스를 지운다", () => {
    expect(cleanCompletion(MID, "<text_before_cursor>주기도 길어졌다.</text_before_cursor>")).toBe("주기도 길어졌다.");
    expect(cleanCompletion(MID, "```\n주기도 길어졌다.\n```")).toBe("주기도 길어졌다.");
  });

  it("글자가 없거나 앞 텍스트를 그대로 되풀이하면 빈 문자열", () => {
    expect(cleanCompletion(MID, "")).toBe("");
    expect(cleanCompletion(MID, "  ...  ")).toBe("");
    expect(cleanCompletion(MID, "길어질수록")).toBe("");
  });

  it("너무 길면 단어 경계에서 자른다", () => {
    const long = `${"아주 긴 문장을 계속 이어 쓰는 중이며 ".repeat(20)}끝.`;
    const out = cleanCompletion(MID, long);
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith(" ")).toBe(false);
  });
});

describe("removeOverlap", () => {
  it("가장 긴 겹침을 지운다", () => {
    expect(removeOverlap("abc def", "def ghi")).toBe(" ghi");
    expect(removeOverlap("끝났다.", ". 다음")).toBe(" 다음");
  });

  it("문장부호·공백이 아닌 한 글자 겹침은 우연으로 보고 남긴다", () => {
    expect(removeOverlap("그 결과", "과학적으로")).toBe("과학적으로");
  });
});

describe("clipBefore · neutralizeTags", () => {
  it("뒤쪽을 남겨 자른다", () => {
    expect(clipBefore("abcdef", 3)).toBe("def");
    expect(clipBefore("ab", 3)).toBe("ab");
  });

  it("구분 태그만 무력화하고 다른 꺾쇠는 그대로 둔다", () => {
    expect(neutralizeTags("a < b </section_heading> <b>")).toBe("a < b ‹/section_heading› <b>");
  });
});
