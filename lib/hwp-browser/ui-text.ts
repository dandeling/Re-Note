/**
 * 브라우저에서 한글 파일을 읽는 화면(서버 변환을 끈 배포)의 문구.
 * 공용 messages/ko.json은 여러 작업이 함께 고치는 파일이라 이 기능의 문구는 여기에 모은다.
 */
export const hwpBrowserText = {
  convert: {
    title: "한글 파일 열기",
    intro: "한글 문서(.hwp, .hwpx)를 이 브라우저에서 바로 읽어 글자·표·그림을 보여 줍니다. 로그인 없이 쓸 수 있어요.",
    fileLabel: "열 한글 파일(.hwp, .hwpx)",
    limit: "파일 크기는 최대 {mb}MB입니다.",
    privacy: "파일은 이 브라우저 안에서만 읽고 서버로 올리지 않아요. ‘내 프로젝트로 가져오기’를 누를 때만 문서와 그림이 저장됩니다.",
    another: "다른 파일 열기",
    saveText: "텍스트로 저장",
    importTitle: "내 프로젝트로 가져오기",
    projectLabel: "프로젝트",
    loginToImport: "로그인하면 내 프로젝트의 새 문서로 가져올 수 있어요.",
    login: "로그인",
    noProjects: "먼저 내 프로젝트에서 프로젝트를 만들어 주세요.",
    goProjects: "내 프로젝트로 가기",
  },
  importer: {
    intro: "한글(.hwp, .hwpx)·Markdown·텍스트 파일을 이 브라우저에서 읽어 편집할 수 있는 새 문서로 가져옵니다.",
    fileLabel: "가져올 파일",
    accept: "지원 형식: HWP, HWPX, Markdown(.md), 텍스트(.txt) · 최대 {mb}MB. PDF·DOCX 가져오기는 이 서버에서 지원하지 않아요.",
    serverOnly: "PDF·DOCX 가져오기는 이 서버에서 지원하지 않아요. 한글(.hwp, .hwpx)·Markdown·텍스트 파일만 가져올 수 있어요.",
    mdImagesDropped: "Markdown 안의 그림 {n}개는 가져오지 않았어요.",
    newDocNotice: "가져오기는 항상 새 문서를 만듭니다. 기존 문서의 내용은 바뀌지 않아요.",
    targetNotice: "이 서버에서는 \"{title}\" 문서 끝에 붙여 넣을 수 없어 새 문서로 만들어요. 필요한 부분을 새 문서에서 복사해 붙여 넣어 주세요.",
  },
  common: {
    layoutNotice: "레이아웃이 원본과 다를 수 있습니다. 쪽 배치·글꼴·여백은 가져오지 않고 글자·표·그림만 읽어요. 결과를 꼭 원본과 비교해 확인해 주세요.",
    reading: "파일을 읽는 중…",
    readingPct: "파일을 읽는 중… {pct}%",
    onlyHwp: "HWP(.hwp) 또는 HWPX(.hwpx) 파일만 열 수 있습니다.",
    tooLarge: "파일이 너무 커서 열 수 없어요(최대 {mb}MB).",
    summary: "문단 {paragraphs}개 · 제목 {headings}개 · 표 {tables}개 · 그림 {images}개",
    previewLabel: "{name} 미리보기",
    empty: "읽어 올 글자가 없어요.",
    unsaved: "아직 저장되지 않았어요. 지금 보이는 것은 미리보기일 뿐이며, ‘{action}’ 버튼을 눌러야 문서로 저장돼요.",
    unsavedPreviewOnly: "미리보기일 뿐 어디에도 저장되지 않아요. 창을 닫으면 사라집니다.",
    titleLabel: "새 문서 제목",
    save: "새 문서로 저장",
    saving: "저장하는 중…",
    uploadingImages: "그림을 올리는 중… ({done}/{total})",
    creating: "새 문서를 만드는 중…",
    saved: "\"{title}\" 문서를 만들었어요.",
    openDocument: "가져온 문서 열기",
    imagesFailed: "그림 {n}개는 올리지 못해 그 자리에 안내 문구를 넣었어요.",
    truncated: "문서가 너무 커서 뒷부분은 가져오지 못했어요.",
    saveFailed: "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
    notesTitle: "읽으면서 바뀐 점",
  },
} as const;

export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
