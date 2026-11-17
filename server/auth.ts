import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { buildProviders } from "@/server/auth-providers";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // 테스트 로그인(Credentials)과 함께 쓰기 위해 JWT 세션을 사용한다.
  session: { strategy: "jwt" },
  providers: buildProviders(),
  pages: { signIn: "/login", verifyRequest: "/login/verify" },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
