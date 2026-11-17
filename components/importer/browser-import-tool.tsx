"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { HwpPreview, HwpSummary } from "@/components/convert/hwp-preview";
import { useHwpFile } from "@/components/convert/use-hwp-file";
import { SaveAsDocument } from "@/components/importer/save-as-document";
import { isTextFile, readTextFile, type TextImport } from "@/components/importer/text-import";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fill, hwpBrowserText } from "@/lib/hwp-browser/ui-text";
import { messages } from "@/lib/messages";

const t = hwpBrowserText.importer;
const c = hwpBrowserText.common;

/**
 * 서버 변환을 끈 배포의 가져오기 화면. 파일을 브라우저에서 읽어 미리 보고, "새 문서로 저장"을 눌러야 저장한다.
 * - HWP/HWPX: lib/hwp-browser로 읽는다(그림은 자산 업로드).
 * - Markdown/텍스트: 서버 가져오기와 같은 변환(marked → htmlToDoc)을 브라우저에서 한다.
 * - DOCX/PDF: 서버 변환 워커가 필요해 "이 서버에서는 지원하지 않음"으로 안내한다.
 * 문서는 워커를 거치지 않는 문서 생성 API(POST /api/projects/:id/docs)로 만든다. 기존 문서에 붙여 넣기(?doc=)는
 * 서버 스냅샷이 필요해 하지 않고 늘 새 문서를 만든다.
 */
export function BrowserImportTool({
  projectId,
  target,
  maxMb,
}: {
  projectId: string;
  target: { id: string; title: string } | null;
  maxMb: number;
}) {
  const hwp = useHwpFile(maxMb);
  const [textFile, setTextFile] = useState<(TextImport & { id: number }) | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const seq = useRef(0);

  const opened = hwp.opened;
  const current = opened ?? textFile;
  const saved = current !== null && savedId === current.id;
  const error = localError ?? hwp.error;

  async function choose(file: File | undefined) {
    const my = ++seq.current;
    setLocalError(null);
    setTextFile(null);
    hwp.reset();
    if (!file) return;
    if (/\.(docx|pdf)$/i.test(file.name)) return setLocalError(t.serverOnly);
    if (!isTextFile(file.name)) return void hwp.open(file);
    if (file.size > maxMb * 1024 * 1024) return setLocalError(fill(c.tooLarge, { mb: maxMb }));
    try {
      const read = await readTextFile(file);
      if (seq.current === my) setTextFile({ ...read, id: -my });
    } catch (err) {
      if (seq.current === my) setLocalError(err instanceof Error ? err.message : c.saveFailed);
    }
  }

  function reset() {
    seq.current++;
    setTextFile(null);
    setLocalError(null);
    hwp.reset();
  }

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
        {target ? fill(t.targetNotice, { title: target.title }) : t.newDocNotice}
      </p>
      <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        {c.layoutNotice}
      </p>

      {!current ? (
        <div className="flex max-w-xl flex-col gap-3">
          <Label htmlFor="import-file">{t.fileLabel}</Label>
          <Input
            id="import-file"
            type="file"
            accept=".hwp,.hwpx,.md,.markdown,.txt,.docx,.pdf"
            disabled={hwp.busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <p className="text-sm text-muted-foreground">{fill(t.accept, { mb: maxMb })}</p>
          <div>
            <Link href={`/projects/${projectId}`} className={buttonVariants({ variant: "ghost" })}>
              {messages.importer.backToProject}
            </Link>
          </div>
        </div>
      ) : null}

      <div role="status" aria-live="polite" className="text-sm">
        {hwp.status}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {current ? (
        <>
          {opened ? (
            <HwpSummary name={opened.name} blocks={opened.result.blocks} notes={opened.result.notes} />
          ) : textFile ? (
            <div className="flex flex-col gap-1 text-sm">
              <p id="hwp-summary">
                <span className="font-semibold [overflow-wrap:anywhere]">{textFile.name}</span>
                <span className="text-muted-foreground"> · {fill(c.summary, textFile.stats)}</span>
              </p>
              {textFile.hadHtml ? <p className="text-muted-foreground">{messages.importer.notes.MD_HTML}</p> : null}
              {textFile.droppedImages ? <p className="text-muted-foreground">{fill(t.mdImagesDropped, { n: textFile.droppedImages })}</p> : null}
            </div>
          ) : null}
          {saved ? null : (
            <p id="hwp-unsaved" className="text-sm font-medium">
              {fill(c.unsaved, { action: c.save })}
            </p>
          )}
          <SaveAsDocument
            key={current.id}
            blocks={opened?.result.blocks}
            doc={opened ? undefined : textFile?.doc}
            filename={current.name}
            projectId={projectId}
            onSaved={() => setSavedId(current.id)}
          />
          {opened ? (
            <HwpPreview name={opened.name} blocks={opened.result.blocks} />
          ) : textFile ? (
            <pre
              id="hwp-preview"
              aria-label={fill(c.previewLabel, { name: textFile.name })}
              tabIndex={0}
              className="mx-auto max-h-[70vh] w-full max-w-[1080px] overflow-auto whitespace-pre-wrap rounded border bg-white p-6 text-sm text-neutral-900 [overflow-wrap:anywhere]"
            >
              {textFile.text}
            </pre>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={reset}>
              {hwpBrowserText.convert.another}
            </Button>
            <Link href={`/projects/${projectId}`} className={buttonVariants({ variant: "ghost" })}>
              {messages.importer.backToProject}
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
