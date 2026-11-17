# 변환 워커: docs/hwp-spike.md의 엔진 체인(pyhwp → LibreOffice+H2Orestart → rhwp+Chromium)
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-java-common libreoffice-h2orestart default-jre-headless \
      fonts-noto-cjk fonts-nanum poppler-utils python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/hwp && /opt/hwp/bin/pip install --no-cache-dir pyhwp six unhwp
ENV PATH="/opt/hwp/bin:${PATH}"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium
COPY . .
CMD ["pnpm", "worker"]
