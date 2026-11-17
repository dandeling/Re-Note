import { messages } from "@/lib/messages";

/** 가져오기 품질 안내 코드 (messages.importer.notes의 키) */
export type NoteCode = keyof typeof messages.importer.notes;
export type ImportNote = { code: NoteCode; n?: number };

/** 화면에 보일 안내 문장 */
export function noteText(note: ImportNote): string {
  const template: string = messages.importer.notes[note.code] ?? "";
  return template.replace("{n}", String(note.n ?? 0));
}
