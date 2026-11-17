import ko from "@/messages/ko.json";

export type Messages = typeof ko;
export const messages: Messages = ko;

/** 앱 이름은 NEXT_PUBLIC_APP_NAME 환경변수로 교체할 수 있다. */
export const appName = process.env.NEXT_PUBLIC_APP_NAME || "Re;Note";
