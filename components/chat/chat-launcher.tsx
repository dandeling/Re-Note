import { getCurrentUser } from "@/server/session";
import { ChatFloating } from "./chat-floating";

/** 전역 플로팅 챗봇. app/layout.tsx에 한 줄로 끼운다. */
export async function ChatLauncher() {
  const user = await getCurrentUser();
  return <ChatFloating loggedIn={Boolean(user)} />;
}
