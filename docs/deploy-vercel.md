# Vercel + Supabase로 무료 배포하기

Re: Note를 **Vercel**(웹사이트)과 **Supabase**(데이터베이스 + 파일 저장소)에 올리는 방법입니다. 서버를 직접 빌리지 않아도 되고, 두 서비스의 무료 요금제로 시작할 수 있습니다.

> 검증 범위: 코드 쪽(기능 끄기, 빌드 스크립트, 설정)은 이 저장소에서 확인했지만, **실제 Supabase·Vercel에 배포해 보지는 못했습니다.** 화면의 메뉴 이름은 서비스가 바뀌면서 조금씩 달라질 수 있습니다. 비슷한 이름의 메뉴를 찾아 주세요.

## 되는 것과 안 되는 것

| 기능 | 이 구성에서 |
|---|---|
| 로그인, 프로젝트·문서 작성, 자동 저장, 서식, AI 도우미, 검색, 연구 공유, 고충 게시판 | 됩니다 |
| 그림·데이터 파일 올리기 | 됩니다 (Supabase Storage에 저장) |
| Word(DOCX)·Markdown 내보내기 | 됩니다 |
| **HWP 파일 열기** | **브라우저에서 엽니다.** 서버가 HWP를 변환하지 않습니다. |
| 서버에서 HWP → PDF 변환, 서버에서 파일 가져오기 | **안 됩니다.** "이 서버에서는 HWP 변환을 지원하지 않습니다" 안내가 나옵니다. |
| **PDF 내보내기** | **안 됩니다.** 에디터의 내보내기 메뉴에 PDF 항목이 보이지 않습니다. DOCX로 내보낸 뒤 Word 등에서 PDF로 저장하세요. 연구 공유에서 "문서를 PDF로 첨부"하는 기능도 동작하지 않습니다. |

서버 HWP 변환과 PDF 내보내기는 LibreOffice·Chromium 같은 큰 프로그램이 필요해서 Vercel에서는 돌릴 수 없습니다. 이 기능이 꼭 필요하면 `docs/deploy.md`(서버 한 대 + Docker)를 쓰세요.

## 준비물

- GitHub 계정 (저장소 `dandeling/Re-Note`를 볼 수 있어야 합니다)
- Google 계정 (Google 로그인을 쓸 때)
- Anthropic API 키 (AI 기능을 쓸 때)
- 메모장: 아래에서 나오는 주소와 키를 잠시 적어 둘 곳. **다 쓰고 나면 지우세요. 비밀 값은 채팅·메일·저장소에 올리지 마세요.**

## 1. Supabase 가입과 프로젝트 만들기

1. <https://supabase.com>에 들어가 **Start your project**(또는 Sign up)를 누르고 GitHub 계정으로 가입합니다.
2. 처음이면 조직(Organization)을 하나 만듭니다. 이름은 아무거나, 요금제는 **Free**.
3. **New project**를 누릅니다.
   - **Name**: 예) `renote`
   - **Database Password**: 비밀번호를 정합니다. **영문 대소문자와 숫자만** 쓰는 것을 권합니다(특수문자가 있으면 주소에 넣을 때 따로 바꿔 써야 해서 헷갈립니다). 이 비밀번호를 메모장에 적어 둡니다.
   - **Region**: 사용자와 가까운 곳(한국이면 Seoul 또는 Northeast Asia)을 고릅니다.
4. **Create new project**를 누르고 1~2분 기다립니다.

## 2. 데이터베이스 확장 (보통은 할 일 없음)

Re: Note는 검색에 `pg_trgm`과 `vector` 확장을 씁니다. **배포할 때 마이그레이션이 이 둘을 자동으로 켭니다**(`CREATE EXTENSION IF NOT EXISTS`). 그래서 보통은 손댈 것이 없습니다.

나중에 Vercel 빌드 로그에 `extension "vector"` 또는 `pg_trgm` 관련 권한 오류가 보이면 그때만:

1. Supabase 왼쪽 메뉴 **Database → Extensions**로 갑니다.
2. 검색창에 `pg_trgm`을 입력해 켭니다. `vector`도 똑같이 켭니다.
3. Vercel에서 다시 배포(Redeploy)합니다.

## 3. 데이터베이스 주소 두 개 찾기

Supabase 프로젝트 화면 위쪽의 **Connect** 버튼을 누릅니다. 여러 종류의 연결 주소(Connection string)가 보입니다. 그중 두 개가 필요합니다. 형식은 **URI**를 고릅니다.

| 이름 | Supabase에서 고를 것 | 생김새 (예시, 실제 값 아님) |
|---|---|---|
| `DATABASE_URL` | **Transaction pooler** (포트 **6543**) | `postgresql://postgres.abcd1234:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres` |
| `DIRECT_URL` | **Session pooler** (포트 **5432**) | `postgresql://postgres.abcd1234:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres` |

- 두 주소 모두 `[YOUR-PASSWORD]` 부분을 1단계에서 정한 비밀번호로 바꿉니다(대괄호 `[ ]`도 지웁니다).
- `DATABASE_URL`은 앱이 평소에 쓰고, `DIRECT_URL`은 배포할 때 표(테이블)를 만드는 마이그레이션에만 씁니다.
- "Direct connection"(`db.….supabase.co`) 주소는 쓰지 마세요. 무료 프로젝트에서는 Vercel의 빌드 서버가 이 주소로 접속하지 못할 수 있습니다. 그래서 `DIRECT_URL`에도 **Session pooler**를 씁니다.
- 주소 끝에 `?pgbouncer=true` 같은 것이 붙어 있어도 괜찮습니다(무시됩니다). `?sslmode=require`는 붙이지 마세요(인증서 확인 오류가 날 수 있습니다).

## 4. 파일 저장소(Storage) 만들기

### 4-1. 버킷 만들기

1. 왼쪽 메뉴 **Storage**로 갑니다.
2. **New bucket**을 누릅니다.
   - 이름: 예) `renote` (영문 소문자, 숫자, `-`만)
   - **Public bucket은 끈 채로** 둡니다. 파일은 로그인한 본인만 볼 수 있어야 합니다.
3. 만든 버킷 이름을 메모합니다 → `S3_BUCKET`.

### 4-2. S3 접속 정보와 키 발급

1. Storage 화면에서 **Settings**(또는 **S3 Configuration**/**S3 Connection**)로 갑니다.
2. **S3 protocol**(S3 연결)이 켜져 있는지 확인합니다.
3. 여기에 보이는 값을 메모합니다.
   - **Endpoint** → `S3_ENDPOINT` (생김새: `https://abcd1234.supabase.co/storage/v1/s3`)
   - **Region** → `S3_REGION` (생김새: `ap-northeast-2`)
4. 같은 화면의 **S3 Access Keys**에서 **New access key**를 누릅니다. 설명은 `vercel` 정도로 적습니다.
5. 나오는 두 값을 메모합니다. **Secret은 이때 한 번만 보입니다.**
   - **Access key ID** → `S3_ACCESS_KEY`
   - **Secret access key** → `S3_SECRET_KEY`

> 이 키는 모든 버킷을 마음대로 읽고 쓸 수 있는 관리자 키입니다. Vercel 환경변수에만 넣고 다른 곳에 붙여 넣지 마세요.

## 5. 로그인 비밀 값(AUTH_SECRET) 만들기

로그인 쿠키를 잠그는 무작위 문자열입니다. 아래 중 하나로 만들고 결과를 메모합니다 → `AUTH_SECRET`.

- Mac / Linux: 터미널을 열고
  ```bash
  openssl rand -base64 32
  ```
- Windows: PowerShell을 열고
  ```powershell
  [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
  ```

한 번 정하면 바꾸지 마세요. 바꾸면 모든 사용자가 로그아웃됩니다.

## 6. 로그인 방법 정하기 (하나 이상 필요)

**Google 로그인** (추천)

1. <https://console.cloud.google.com>에서 프로젝트를 하나 만듭니다.
2. **API 및 서비스 → OAuth 동의 화면**을 설정합니다(외부, 앱 이름, 지원 이메일).
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**, 유형은 **웹 애플리케이션**.
4. **승인된 리디렉션 URI**는 Vercel 주소가 나온 뒤(9단계)에 넣습니다. 지금은 비워 두고 만들어도 됩니다.
5. 나오는 값을 메모합니다: **클라이언트 ID** → `AUTH_GOOGLE_ID`, **클라이언트 보안 비밀번호** → `AUTH_GOOGLE_SECRET`.

**메일 링크 로그인** (선택)

메일 발송 서비스(SMTP)가 있어야 합니다.
- `EMAIL_SERVER`: 예) `smtp://사용자이름:비밀번호@smtp.example.com:587`
- `EMAIL_FROM`: 보내는 사람 주소, 예) `Re: Note <no-reply@example.com>`

비워 두면 메일 로그인은 꺼집니다.

## 7. Vercel 가입과 저장소 가져오기

1. <https://vercel.com>에서 **Sign Up** → **Continue with GitHub**로 가입합니다. 요금제는 **Hobby**(무료).
2. 대시보드에서 **Add New… → Project**를 누릅니다.
3. **Import Git Repository** 목록에서 `dandeling/Re-Note` 옆의 **Import**를 누릅니다. 목록에 없으면 **Adjust GitHub App Permissions**에서 이 저장소 접근을 허용합니다.
4. 설정 화면에서
   - **Framework Preset**: `Next.js` (자동으로 잡힙니다)
   - **Root Directory**: 그대로(`./`)
   - **Build Command / Install Command**: **건드리지 않습니다.** 저장소의 `vercel-build` 스크립트(`prisma migrate deploy && next build`)가 자동으로 쓰여, 배포할 때마다 DB 표를 최신으로 맞춘 뒤 빌드합니다.
5. 아직 **Deploy**를 누르지 말고 아래 환경변수를 먼저 넣습니다.

## 8. 환경변수 넣기

같은 화면의 **Environment Variables**를 펼쳐 **이름(Key)** 과 **값(Value)** 을 하나씩 넣습니다. 나중에 바꾸려면 프로젝트의 **Settings → Environment Variables**에서 고치고 다시 배포합니다.

| 이름 | 값 | 꼭 필요? |
|---|---|---|
| `DATABASE_URL` | 3단계의 Transaction pooler 주소 (포트 6543) | 필수 |
| `DIRECT_URL` | 3단계의 Session pooler 주소 (포트 5432) | 필수 |
| `AUTH_SECRET` | 5단계에서 만든 값 | 필수 |
| `AUTH_URL` | 사이트 주소, 예) `https://renote-abc.vercel.app`. 처음에는 주소를 모르므로 비워 두고 9단계 뒤에 넣습니다 | 권장 |
| `AUTH_GOOGLE_ID` | 6단계의 클라이언트 ID | Google 로그인 시 |
| `AUTH_GOOGLE_SECRET` | 6단계의 클라이언트 보안 비밀번호 | Google 로그인 시 |
| `EMAIL_SERVER` | SMTP 주소 | 메일 로그인 시 |
| `EMAIL_FROM` | 보내는 사람 주소 | 메일 로그인 시 |
| `S3_ENDPOINT` | 4-2단계의 Endpoint (`https://…supabase.co/storage/v1/s3`) | 필수 |
| `S3_REGION` | 4-2단계의 Region (예: `ap-northeast-2`) | 필수 |
| `S3_BUCKET` | 4-1단계의 버킷 이름 | 필수 |
| `S3_ACCESS_KEY` | 4-2단계의 Access key ID | 필수 |
| `S3_SECRET_KEY` | 4-2단계의 Secret access key | 필수 |
| `ANTHROPIC_API_KEY` | Anthropic 콘솔에서 만든 API 키 | AI 기능 쓸 때 |
| `ANTHROPIC_MODEL` | 사용할 Claude 모델 이름 (Anthropic 문서의 모델 목록 참고) | AI 기능 쓸 때 |
| `NEXT_PUBLIC_APP_NAME` | `Re: Note` | 선택 (바꾸면 다시 배포해야 반영) |

**넣지 말아야 할 것**

- `AUTH_TEST_MODE`, `AI_FAKE`: **절대 넣지 마세요.** 테스트 전용입니다. 특히 `AUTH_TEST_MODE`를 켜면 누구나 이메일 주소만으로 아무 계정에 로그인할 수 있습니다.
- `REDIS_URL`, `CONVERSION_QUEUE`, `STORAGE_LOCAL_DIR`, `S3_PUBLIC_ENDPOINT`: 이 구성에서는 쓰지 않습니다. 비워 둡니다.
- `SERVER_CONVERSION`, `PDF_EXPORT`: 비워 둡니다. Vercel에서는 자동으로 꺼집니다(`1`로 켜도 Vercel에는 필요한 프로그램이 없어 동작하지 않습니다).

## 9. 배포(Deploy)

1. **Deploy**를 누릅니다. 몇 분 걸립니다. 빌드 로그에 `prisma migrate deploy`가 표를 만드는 내용이 보이면 정상입니다.
2. 끝나면 사이트 주소(예: `https://renote-abc.vercel.app`)가 나옵니다. 이 주소를 메모합니다.
3. **Settings → Environment Variables**에서 `AUTH_URL`에 이 주소를 넣고, **Deployments** 탭에서 가장 최근 배포의 **⋯ → Redeploy**를 누릅니다.

빌드가 실패하면 로그 맨 아래를 봅니다.
- `P1001`, `Can't reach database server`: `DIRECT_URL`/`DATABASE_URL` 주소나 비밀번호가 틀렸거나, Supabase 프로젝트가 일시 중지된 상태입니다.
- `password authentication failed`: 비밀번호가 틀렸습니다. `[YOUR-PASSWORD]`를 바꿨는지, 대괄호를 지웠는지 확인합니다.
- `extension` 관련 오류: 2단계를 봅니다.

## 10. Google 로그인 리디렉션 주소 등록

Google 로그인을 쓴다면, 6단계에서 만든 OAuth 클라이언트로 돌아가 **승인된 리디렉션 URI**에 아래를 추가하고 저장합니다.

```
https://<내 사이트 주소>/api/auth/callback/google
```

예: `https://renote-abc.vercel.app/api/auth/callback/google`. 나중에 도메인을 바꾸면 이 주소와 `AUTH_URL`을 함께 바꿉니다.

## 11. 확인

1. 사이트에 들어가 로그인합니다.
2. 프로젝트와 문서를 하나 만들고 글을 써 봅니다(자동 저장).
3. 문서에 그림을 하나 올려 봅니다. 올라가지 않으면 4단계 값(`S3_*`)을 다시 확인합니다.
4. 문서의 **내보내기**에서 DOCX를 내려받아 봅니다. PDF 항목이 없는 것이 정상입니다.

## 무료 요금제에서 주의할 점

- **무료 한도는 각 서비스의 요금제 안내를 확인하세요.** DB 용량, 파일 저장 용량, 전송량, 함수 실행 시간 등에 한도가 있고 수시로 바뀝니다.
- **Supabase 무료 프로젝트는 일정 기간 사용하지 않으면 일시 중지될 수 있습니다.** 그러면 사이트가 DB에 접속하지 못해 오류가 납니다. Supabase 대시보드에서 프로젝트를 다시 시작(Restore/Resume)하면 됩니다. 데이터는 지워지지 않지만, 중요한 자료는 따로 백업해 두세요.
- Vercel의 함수는 주고받는 요청·응답 크기에 제한이 있어, 아주 큰 파일을 사이트를 거쳐 내려받을 때 실패할 수 있습니다.
- 가능하면 Vercel 함수 지역을 Supabase 지역과 가깝게 맞추세요(Vercel 프로젝트 **Settings → Functions**의 지역 설정). 멀리 떨어져 있으면 화면이 느려집니다.
- 휴지통 자동 비우기(`pnpm trash:purge`)는 이 구성에서 자동으로 돌지 않습니다. 필요하면 내 컴퓨터에서 `DATABASE_URL`을 운영 주소로 두고 가끔 실행합니다.
- 기본 설정에서는 다른 브랜치나 풀 리퀘스트의 미리보기 배포(Preview)도 같은 환경변수로 **같은 운영 DB에 마이그레이션을 적용합니다.** 운영 DB를 건드리지 않게 하려면 환경변수를 **Production**에만 두세요(그러면 미리보기 배포는 빌드에 실패합니다).
