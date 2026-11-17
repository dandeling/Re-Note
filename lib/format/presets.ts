import { DEFAULT_RULES, type FormatRules } from "@/lib/format/rules";

export type FormatPreset = { id: string; name: string; rules: FormatRules };

/**
 * 서식 프리셋 3종 (SPEC 7.3 (d)). id는 고정이라 시드를 여러 번 돌려도 같은 행을 갱신한다.
 */
export const FORMAT_PRESETS: FormatPreset[] = [
  { id: "preset-general", name: "일반 보고서", rules: DEFAULT_RULES },
  {
    id: "preset-academic",
    name: "학술 논문형",
    rules: {
      page: { size: "A4", orientation: "portrait", margin: { top: 30, right: 25, bottom: 25, left: 25 } },
      body: { font: "noto-serif-kr", sizePt: 10, lineHeight: 160, align: "justify" },
      paragraph: { indentPt: 10, spacingPt: 0 },
      headings: {
        h1: { font: "noto-serif-kr", sizePt: 16, bold: true, align: "center" },
        h2: { font: "noto-serif-kr", sizePt: 13, bold: true, align: "left" },
        h3: { font: "noto-serif-kr", sizePt: 11, bold: true, align: "left" },
        h4: { font: "noto-serif-kr", sizePt: 10, bold: true, align: "left" },
      },
      caption: { sizePt: 9, bold: false, align: "center", figurePosition: "below", tablePosition: "above" },
      pageNumber: { enabled: true, position: "bottom-center", style: "dash" },
    },
  },
  {
    id: "preset-inquiry",
    name: "탐구 보고서형",
    rules: {
      page: { size: "A4", orientation: "portrait", margin: { top: 20, right: 20, bottom: 20, left: 20 } },
      body: { font: "nanum-gothic", sizePt: 12, lineHeight: 180, align: "left" },
      paragraph: { indentPt: 0, spacingPt: 8 },
      headings: {
        h1: { font: "nanum-gothic", sizePt: 20, bold: true, align: "center" },
        h2: { font: "nanum-gothic", sizePt: 16, bold: true, align: "left" },
        h3: { font: "nanum-gothic", sizePt: 14, bold: true, align: "left" },
        h4: { font: "nanum-gothic", sizePt: 12, bold: true, align: "left" },
      },
      caption: { sizePt: 10, bold: true, align: "center", figurePosition: "below", tablePosition: "above" },
      pageNumber: { enabled: true, position: "bottom-right", style: "total" },
    },
  },
];

export const DEFAULT_PRESET_ID = "preset-general";
