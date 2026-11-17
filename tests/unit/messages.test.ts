import { describe, expect, it } from "vitest";
import { appName, messages } from "@/lib/messages";

describe("messages", () => {
  it("한국어 문구를 messages/ko.json에서 불러온다", () => {
    expect(messages.home.searchButton).toBe("검색");
  });
  it("앱 이름 기본값은 Re: Note", () => {
    expect(appName).toBe(process.env.NEXT_PUBLIC_APP_NAME || "Re: Note");
  });
});
