import type { Metadata } from "next";
import "./globals.css";
import { ChatLauncher } from "@/components/chat/chat-launcher";
import { SiteHeader } from "@/components/layout/site-header";
import { appName, messages } from "@/lib/messages";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: messages.common.appTagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2"
        >
          {messages.common.skipToContent}
        </a>
        <SiteHeader />
        <div id="main" className="flex flex-1 flex-col">
          {children}
        </div>
        <ChatLauncher />
      </body>
    </html>
  );
}
