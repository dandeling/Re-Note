/**
 * 서식에서 고를 수 있는 글꼴 (SPEC 7.3 (d)).
 * 웹 글꼴로 배포·임베드가 허용된(OFL) 한글 글꼴만 제공한다. 파일은 @fontsource 패키지에서 온다.
 */
export const FONT_IDS = ["noto-sans-kr", "noto-serif-kr", "nanum-gothic", "nanum-myeongjo"] as const;
export type FontId = (typeof FONT_IDS)[number];

type FontInfo = {
  /** 화면에 보이는 이름 */
  label: string;
  /** CSS font-family 이름 (@fontsource의 @font-face와 같아야 한다) */
  family: string;
  generic: "sans-serif" | "serif";
  /** @fontsource 패키지 이름 (@fontsource/<pkg>) */
  pkg: string;
};

export const FONTS: Record<FontId, FontInfo> = {
  "noto-sans-kr": { label: "Noto Sans KR (본고딕)", family: "Noto Sans KR", generic: "sans-serif", pkg: "noto-sans-kr" },
  "noto-serif-kr": { label: "Noto Serif KR (본명조)", family: "Noto Serif KR", generic: "serif", pkg: "noto-serif-kr" },
  "nanum-gothic": { label: "나눔고딕", family: "Nanum Gothic", generic: "sans-serif", pkg: "nanum-gothic" },
  "nanum-myeongjo": { label: "나눔명조", family: "Nanum Myeongjo", generic: "serif", pkg: "nanum-myeongjo" },
};

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && (FONT_IDS as readonly string[]).includes(value);
}

/** CSS font-family 값 (대체 글꼴 포함) */
export function fontStack(font: FontId): string {
  const info = FONTS[font];
  return `"${info.family}", ${info.generic}`;
}

const key = (name: string) => name.toLowerCase().replace(/[\s\-_"']/g, "");

/** 제공 글꼴의 다른 표기 (대체가 아니라 같은 글꼴) */
const SAME: Record<string, FontId> = {
  본고딕: "noto-sans-kr",
  노토산스: "noto-sans-kr",
  노토산스kr: "noto-sans-kr",
  notosanscjkkr: "noto-sans-kr",
  본명조: "noto-serif-kr",
  노토세리프: "noto-serif-kr",
  노토세리프kr: "noto-serif-kr",
  notoserifcjkkr: "noto-serif-kr",
  나눔고딕: "nanum-gothic",
  나눔명조: "nanum-myeongjo",
};
for (const id of FONT_IDS) {
  SAME[key(id)] = id;
  SAME[key(FONTS[id].family)] = id;
}

/** 임베드할 수 없거나 제공하지 않는 글꼴 → 가장 가까운 제공 글꼴 */
const SUBSTITUTES: Record<string, FontId> = {
  // 한컴 글꼴: 한컴오피스 사용자만 쓸 수 있는 라이선스라 웹에 임베드할 수 없다.
  함초롬바탕: "noto-serif-kr",
  hcrbatang: "noto-serif-kr",
  한컴바탕: "noto-serif-kr",
  함초롬돋움: "noto-sans-kr",
  hcrdotum: "noto-sans-kr",
  한컴돋움: "noto-sans-kr",
  // Windows 번들 글꼴
  맑은고딕: "noto-sans-kr",
  malgungothic: "noto-sans-kr",
  바탕: "nanum-myeongjo",
  바탕체: "nanum-myeongjo",
  batang: "nanum-myeongjo",
  batangche: "nanum-myeongjo",
  궁서: "nanum-myeongjo",
  gungsuh: "nanum-myeongjo",
  굴림: "nanum-gothic",
  굴림체: "nanum-gothic",
  gulim: "nanum-gothic",
  돋움: "nanum-gothic",
  돋움체: "nanum-gothic",
  dotum: "nanum-gothic",
  // 그 밖에 자주 지정되는 글꼴
  신명조: "nanum-myeongjo",
  hy신명조: "nanum-myeongjo",
  휴먼명조: "nanum-myeongjo",
  hy견명조: "nanum-myeongjo",
  hy중고딕: "nanum-gothic",
  hy견고딕: "nanum-gothic",
  휴먼고딕: "nanum-gothic",
  나눔바른고딕: "nanum-gothic",
  나눔스퀘어: "nanum-gothic",
  applesdgothicneo: "noto-sans-kr",
  applemyungjo: "nanum-myeongjo",
  timesnewroman: "noto-serif-kr",
  times: "noto-serif-kr",
  georgia: "noto-serif-kr",
  arial: "noto-sans-kr",
  helvetica: "noto-sans-kr",
  calibri: "noto-sans-kr",
};

export type FontResolution = {
  font: FontId;
  /** 요청한 글꼴을 그대로 쓰지 못해 다른 글꼴로 바꿨는지 */
  substituted: boolean;
  /** 사용자가 요청한 이름 (원문) */
  requested: string;
};

/**
 * 글꼴 이름(자유 입력)을 제공 글꼴로 바꾼다. 순수 함수.
 * 임베드할 수 없는 글꼴(함초롬바탕 등)이나 모르는 글꼴은 가장 가까운 글꼴로 대체하고 `substituted: true`를 돌려준다.
 */
export function resolveFont(name: string): FontResolution {
  const requested = name.trim();
  const k = key(requested);
  const same = SAME[k];
  if (same) return { font: same, substituted: false, requested };
  const known = SUBSTITUTES[k];
  if (known) return { font: known, substituted: true, requested };
  // 모르는 글꼴: 이름으로 명조(세리프) 계열인지 추정한다.
  const serif = /명조|바탕|궁서|myeongjo|myungjo|batang|mincho|serif|roman/.test(k) && !/sans|고딕|gothic/.test(k);
  return { font: serif ? "noto-serif-kr" : "noto-sans-kr", substituted: true, requested };
}
