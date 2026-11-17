FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app ./
# PDF 내보내기(server/export.ts)가 웹 프로세스에서 Playwright Chromium을 띄운다.
RUN pnpm exec playwright install --with-deps chromium
EXPOSE 3000
CMD ["pnpm", "start"]
