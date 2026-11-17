"use client";

import Link from "next/link";
import { useState } from "react";
import { HwpPreview, HwpSummary } from "@/components/convert/hwp-preview";
import { useHwpFile } from "@/components/convert/use-hwp-file";
import { SaveAsDocument, titleFromFilename } from "@/components/importer/save-as-document";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { blocksToText } from "@/lib/hwp-browser";
import { fill, hwpBrowserText } from "@/lib/hwp-browser/ui-text";

const t = hwpBrowserText.convert;
const c = hwpBrowserText.common;

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 서버 변환을 끈 배포의 "한글 파일 열기": 파일을 브라우저에서 읽어 미리 보여 준다(서버로 올리지 않는다).
 * 로그인했으면 내 프로젝트의 새 문서로 가져올 수 있다.
 */
export function BrowserConvertTool({
  maxMb,
  loggedIn,
  projects,
}: {
  maxMb: number;
  loggedIn: boolean;
  projects: { id: string; title: string }[];
}) {
  const { opened, status, error, busy, open, reset } = useHwpFile(maxMb);
  const [savedId, setSavedId] = useState<number | null>(null);
  const saved = opened !== null && savedId === opened.id;

  return (
    <div className="flex flex-col gap-6">
      <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        {c.layoutNotice}
      </p>

      {!opened ? (
        <div className="flex max-w-xl flex-col gap-3">
          <Label htmlFor="convert-file">{t.fileLabel}</Label>
          <Input id="convert-file" type="file" accept=".hwp,.hwpx" disabled={busy} onChange={(e) => void open(e.target.files?.[0])} />
          <p className="text-sm text-muted-foreground">{fill(t.limit, { mb: maxMb })}</p>
          <p className="text-xs text-muted-foreground">{t.privacy}</p>
        </div>
      ) : null}

      <div role="status" aria-live="polite" className="text-sm">
        {status}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {opened ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <HwpSummary name={opened.name} blocks={opened.result.blocks} notes={opened.result.notes} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => downloadText(`${titleFromFilename(opened.name)}.txt`, blocksToText(opened.result.blocks))}>
                {t.saveText}
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                {t.another}
              </Button>
            </div>
          </div>

          {saved ? null : (
            <p id="hwp-unsaved" className="text-sm font-medium">
              {loggedIn && projects.length ? fill(c.unsaved, { action: t.importTitle }) : c.unsavedPreviewOnly}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.importTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {!loggedIn ? (
                <p className="text-sm">
                  {t.loginToImport}{" "}
                  <Link href={`/login?callbackUrl=${encodeURIComponent("/tools/convert")}`} className="underline">
                    {t.login}
                  </Link>
                </p>
              ) : projects.length === 0 ? (
                <p className="text-sm">
                  {t.noProjects}{" "}
                  <Link href="/projects" className="underline">
                    {t.goProjects}
                  </Link>
                </p>
              ) : (
                <SaveAsDocument
                  key={opened.id}
                  blocks={opened.result.blocks}
                  filename={opened.name}
                  projects={projects}
                  actionLabel={t.importTitle}
                  onSaved={() => setSavedId(opened.id)}
                />
              )}
            </CardContent>
          </Card>

          <HwpPreview name={opened.name} blocks={opened.result.blocks} />
        </>
      ) : null}
    </div>
  );
}
