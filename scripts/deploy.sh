#!/bin/sh
# 운영 서버에서 실행: sh scripts/deploy.sh <도메인>
# 처음 실행하면 .env를 만들고 비밀 값을 무작위로 채운 뒤, 전체를 빌드·기동하고 DB 마이그레이션을 적용한다.
# 다시 실행하면 기존 .env를 그대로 두고 새 코드로 다시 빌드·기동한다.
set -eu
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"
rand() { openssl rand -hex "$1"; }

if [ ! -f .env ]; then
  DOMAIN="${1:?처음 실행할 때는 도메인이 필요합니다. 예: sh scripts/deploy.sh renote.example.com}"
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(rand 24)
AUTH_SECRET=$(rand 32)
S3_BUCKET=renote
S3_ACCESS_KEY=renote$(rand 6)
S3_SECRET_KEY=$(rand 24)
NEXT_PUBLIC_APP_NAME=Re;Note
AI_DAILY_LIMIT_PER_USER=100
MAX_UPLOAD_MB=50

# 아래는 직접 채운다 (docs/deploy.md 3단계). 로그인 수단이 하나는 있어야 한다.
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
EMAIL_SERVER=
EMAIL_FROM=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
EOF
  echo ".env를 만들었습니다. 로그인·AI 값을 채운 뒤 이 스크립트를 다시 실행하세요: vi .env"
  exit 0
fi

# .env는 셸 문법이 아닐 수 있으므로(예: Re;Note) 실행하지 않고 값만 읽는다.
val() { sed -n "s/^$1=//p" .env | tail -1; }
DOMAIN=$(val DOMAIN)
if [ -z "$(val AUTH_GOOGLE_ID)" ] && [ -z "$(val EMAIL_SERVER)" ]; then
  echo "경고: 로그인 수단(AUTH_GOOGLE_ID 또는 EMAIL_SERVER)이 비어 있어 아무도 로그인할 수 없습니다." >&2
fi
[ -n "$(val ANTHROPIC_API_KEY)" ] || echo "알림: ANTHROPIC_API_KEY가 비어 있어 AI 기능이 동작하지 않습니다." >&2

$COMPOSE up -d --build
$COMPOSE exec -T web pnpm db:deploy
$COMPOSE ps
echo "끝났습니다: https://${DOMAIN}"
