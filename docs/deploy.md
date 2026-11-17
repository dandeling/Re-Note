# 운영 배포 (서버 한 대 + Docker)

서버 한 대에 웹, DB, Redis, 파일 저장소, HWP 변환 워커, HTTPS 프록시를 모두 띄웁니다.

> 검증 범위: `docker-compose.prod.yml`의 문법 검사와, 환경변수 없이 `pnpm build`가 되는 것까지 확인했습니다. 이미지를 실제로 빌드해 서버에서 띄워 보지는 못했습니다.

## 1. 준비물

- 리눅스 서버 1대: 2코어 / 메모리 4GB 이상 / 디스크 30GB 이상 (워커 이미지가 큽니다). Ubuntu 22.04 또는 24.04 권장.
- 방화벽에서 80, 443 포트 열기 (22는 SSH용).
- 주소 두 개가 서버 IP를 가리켜야 합니다: `도메인`과 `s3.도메인`.
  - 도메인이 있으면: DNS에 A 레코드 두 개(`renote.example.com`, `s3.renote.example.com`)를 서버 IP로 등록.
  - 도메인이 없으면: 서버 IP가 `203.0.113.7`일 때 `203-0-113-7.sslip.io`를 도메인으로 쓰면 됩니다. 등록 없이 두 주소 모두 서버로 연결됩니다.

## 2. 서버에 설치

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
git clone https://github.com/dandeling/Re-Note.git && cd Re-Note
```

```bash
sh scripts/deploy.sh renote.example.com
```

처음 실행하면 `.env`를 만들고 DB 비밀번호, 세션 비밀 값, 저장소 키를 무작위로 채운 뒤 멈춥니다.

## 3. 로그인과 AI 값 채우기

`.env`를 열어 아래를 채웁니다. 비밀 값은 채팅이나 저장소에 올리지 말고 서버에서만 입력합니다.

| 변수 | 내용 |
|---|---|
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트(웹). 승인된 리디렉션 URI: `https://도메인/api/auth/callback/google` |
| `EMAIL_SERVER`, `EMAIL_FROM` | 메일 링크 로그인을 쓸 때. 예: `smtp://사용자:비밀번호@smtp.example.com:587`. 비우면 메일 로그인이 꺼집니다. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | AI 기능용. 비우면 AI 기능이 동작하지 않습니다. |

로그인 수단은 Google과 메일 중 하나 이상 있어야 합니다. `AUTH_TEST_MODE`와 `AI_FAKE`는 운영 구성에서 강제로 꺼져 있습니다.

## 4. 띄우기

```bash
sh scripts/deploy.sh
```

빌드(처음에는 10~20분), 기동, DB 마이그레이션까지 합니다. 끝나면 `https://도메인`으로 접속합니다. 인증서는 Caddy가 자동으로 받습니다.

예시 데이터를 넣으려면 한 번만 실행합니다.

```bash
docker compose -f docker-compose.prod.yml exec web pnpm db:seed
```

## 5. 운영

- 새 버전 반영: `git pull` 후 `sh scripts/deploy.sh`.
- 로그: `docker compose -f docker-compose.prod.yml logs -f web worker`.
- 백업 대상: 볼륨 `db-data`(PostgreSQL), `minio-data`(올린 파일), 그리고 `.env`.

```bash
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U researchmate researchmate | gzip > backup-$(date +%F).sql.gz
```

- 휴지통 정리 cron 등 그 밖의 운영 주의는 `README.md`의 "운영 주의"를 봅니다.

## 알려 둘 점

- 아티팩트 판(`artifact/`)에서 나중에 바꾼 것들(단순해진 화면, 쉬운 수식 입력, HWP 그림 추출, 고충 댓글 제거, 예시 600건)은 이 서버 앱에 아직 반영되지 않았습니다.
- HWP 변환의 한계는 `docs/hwp-spike.md`에 있습니다. pyhwp는 AGPL-3.0입니다.
