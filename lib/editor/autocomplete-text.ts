/**
 * 글쓰기 자동완성에서 서버와 클라이언트가 함께 쓰는 순수 함수·상수.
 * 서버 전용 코드를 import하지 않는다 (클라이언트 번들에 들어간다).
 */

/** 커서 앞 텍스트를 서버로 보낼 때의 최대 길이 (뒤쪽을 남긴다) */
export const AUTOCOMPLETE_MAX_BEFORE = 1500;
/** 제목·절 제목 최대 길이 */
export const AUTOCOMPLETE_MAX_HEADING = 200;
/** 문단에 글자가 이만큼 있어야 제안을 요청한다 */
export const AUTOCOMPLETE_MIN_PARAGRAPH_CHARS = 10;
/** 제안 최대 길이 (한 문장 이내) */
export const AUTOCOMPLETE_MAX_COMPLETION = 160;

/** 프롬프트 구분 태그. 사용자 글 안에 같은 태그가 있으면 무력화한다. */
export const AUTOCOMPLETE_TAGS = ["document_title", "section_heading", "text_before_cursor"] as const;

const TAG_PATTERN = new RegExp(`<\\s*/?\\s*(${AUTOCOMPLETE_TAGS.join("|")})\\b[^>]*>`, "gi");
const QUOTES = /^["'“”‘’「」『』`]+|["'“”‘’「」『』`]+$/g;
const SENTENCE_END = /[.!?。？！]/;

/** 프롬프트에 넣을 사용자 글에서 구분 태그를 무력화한다 (프롬프트 주입 방지). */
export function neutralizeTags(text: string) {
  return text.replace(TAG_PATTERN, (m) => m.replace(/</g, "‹").replace(/>/g, "›"));
}

/** 앞 텍스트를 서버 한도에 맞게 자른다 (커서에 가까운 뒤쪽을 남긴다). */
export function clipBefore(text: string, max = AUTOCOMPLETE_MAX_BEFORE) {
  return text.length <= max ? text : text.slice(text.length - max);
}

/** completion 앞부분이 before 끝부분과 겹치면 겹친 만큼 지운다. */
export function removeOverlap(before: string, completion: string) {
  const max = Math.min(before.length, completion.length);
  for (let k = max; k >= 1; k--) {
    const head = completion.slice(0, k);
    if (!before.endsWith(head)) continue;
    // 한 글자 겹침은 공백·문장부호일 때만 지운다 (예: "그 결과" + "과학적…"은 우연이다).
    if (k === 1 && !/[\s.,!?;:。、]/.test(head)) continue;
    return completion.slice(k);
  }
  return completion;
}

/**
 * 모델이 낸 이어 쓰기 후보를 에디터에 넣을 수 있는 한 문장으로 다듬는다.
 * - 구분 태그·코드 펜스·감싼 따옴표를 지우고 첫 줄만 남긴다 (줄바꿈 없음)
 * - 앞 텍스트와 겹치는 부분을 지운다
 * - 공백: 앞이 공백으로 끝나면 앞 공백을 지우고, 앞이 문장 끝이면 공백 하나를 붙인다
 * - 첫 문장까지만 남긴다
 * 쓸 만한 내용이 없으면 빈 문자열.
 */
export function cleanCompletion(before: string, raw: string) {
  let s = raw.replace(TAG_PATTERN, "").replace(/```[a-z]*\n?/gi, "").replace(/\r/g, "");
  // 첫 번째 비어 있지 않은 줄만 쓴다.
  const leadingSpace = /^[ \t]/.test(s);
  const firstLine = s.split("\n").find((line) => line.trim().length > 0) ?? "";
  s = firstLine.trim().replace(QUOTES, "").trim();
  // 모델이 앞 문장을 다시 쓰면 겹친 부분을 지운다.
  const tail = before.replace(/\s+$/, "");
  s = removeOverlap(tail, s).replace(/\s+/g, " ");
  const trimmed = s.trimStart();
  if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed)) return "";

  // 첫 문장까지만 (소수점 3.5처럼 뒤에 공백이 없는 마침표는 문장 끝이 아니다)
  let out = trimmed;
  for (let i = 0; i < out.length; i++) {
    if (SENTENCE_END.test(out[i]) && (i === out.length - 1 || /\s/.test(out[i + 1]))) {
      out = out.slice(0, i + 1);
      break;
    }
  }
  if (out.length > AUTOCOMPLETE_MAX_COMPLETION) {
    const cut = out.slice(0, AUTOCOMPLETE_MAX_COMPLETION);
    const lastSpace = cut.lastIndexOf(" ");
    out = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  }

  if (before.length === 0 || /\s$/.test(before)) return out;
  const prev = before.at(-1)!;
  // 앞이 문장 끝·쉼표면 띄어 쓴다. 단어 중간이면 모델이 띄웠을 때만 띄운다.
  const needsSpace = SENTENCE_END.test(prev) || /[,;:)]/.test(prev) || (leadingSpace || s.startsWith(" "));
  return needsSpace && !/^[.,!?;:)\]」』]/.test(out) ? ` ${out}` : out;
}
