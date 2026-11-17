"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useState } from "react";
import type { DocumentFormat } from "@/components/editor/use-document-format";
import { Button } from "@/components/ui/button";
import type { DocContent } from "@/lib/editor/content";
import { checkFormat, fixFormat, type FormatIssue } from "@/lib/format/check";
import { messages } from "@/lib/messages";

const RECHECK_MS = 300;

function fill(template: string, params: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? "");
}

/** 검사 결과 한 줄의 문구 */
export function issueText(issue: FormatIssue): string {
  const t = messages.format;
  const params = { ...issue.params };
  if (params.kind) params.kind = t.check.kinds[params.kind as keyof typeof t.check.kinds] ?? params.kind;
  if (issue.code === "heading-align") params.expected = t.options.align[params.expected as keyof typeof t.options.align];
  if (issue.code === "caption-position") {
    params.expected = t.options.captionPosition[params.expected as keyof typeof t.options.captionPosition];
  }
  return fill(t.check.issues[issue.code], params);
}

/** 서식 검사 (SPEC 7.3 (d)): 규칙에서 벗어난 부분 목록 + "모두 고치기" */
export function FormatCheckPanel({ format, editor }: { format: DocumentFormat; editor: Editor | null }) {
  const t = messages.format.check;
  const [revision, setRevision] = useState(0);
  const [fixedNotice, setFixedNotice] = useState<string | null>(null);

  // 본문을 고치면 잠시 뒤 다시 검사한다.
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRevision((r) => r + 1), RECHECK_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", onUpdate);
    };
  }, [editor]);

  const canInsertCaption = !!editor?.schema.nodes.caption;
  const issues = useMemo(
    () => (editor && revision >= 0 ? checkFormat(editor.getJSON() as DocContent, format.rules, { canInsertCaption }) : []),
    [editor, format.rules, canInsertCaption, revision],
  );
  const fixable = issues.filter((i) => i.fixable).length;

  function fixAll() {
    if (!editor) return;
    const result = fixFormat(editor.getJSON() as DocContent, format.rules, { canInsertCaption });
    editor.commands.setContent(result.doc, { emitUpdate: true });
    setRevision((r) => r + 1);
    setFixedNotice(t.fixed.replace("{count}", String(result.fixed)));
  }

  function goTo(block: number) {
    if (!editor) return;
    let pos: number | null = null;
    editor.state.doc.forEach((_node, offset, index) => {
      if (index === block) pos = offset;
    });
    if (pos === null) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  }

  return (
    <section aria-label={t.title} data-testid="format-check" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{t.title}</h2>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setRevision((r) => r + 1)}>
          {t.run}
        </Button>
        <Button type="button" size="sm" disabled={fixable === 0} onClick={fixAll}>
          {t.fixAll}
        </Button>
      </div>
      {fixedNotice ? (
        <p role="status" data-testid="format-check-fixed" className="text-xs text-muted-foreground">
          {fixedNotice}
        </p>
      ) : null}
      <p data-testid="format-check-summary" className="text-sm">
        {issues.length === 0 ? t.ok : t.count.replace("{count}", String(issues.length))}
      </p>
      {issues.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="format-check-list">
          {issues.map((issue, i) => (
            <li key={`${issue.code}-${issue.block}-${i}`} data-code={issue.code}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => goTo(issue.block)}
              >
                <span>{issueText(issue)}</span>
                <span className="text-muted-foreground">
                  {t.where.replace("{index}", String(issue.block + 1))}
                  {issue.fixable ? "" : ` · ${t.manual}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
