"use client";

import type { ReactNode } from "react";
import type { Block, ImageBlock, TableBlock } from "@/lib/hwp-browser";
import { fill, hwpBrowserText } from "@/lib/hwp-browser/ui-text";

const c = hwpBrowserText.common;

/** 문단 글자 안의 "[수식: …]"은 구분해 보이게 */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\[수식: [^\n]*?\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <code key={m.index} className="rounded bg-black/5 px-1 font-mono text-[0.9em] dark:bg-white/10">
        {m[0]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** 그림: 바이트로 blob: URL을 만들고 이 img가 사라지면 놓아 준다(ref 정리 함수) */
function PreviewImage({ block }: { block: ImageBlock }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 브라우저에서 읽은 바이트(blob:)라 next/image를 쓸 수 없다
    <img
      ref={(el) => {
        if (!el) return;
        const url = URL.createObjectURL(new Blob([block.bytes.slice()], { type: block.mime }));
        el.src = url;
        return () => URL.revokeObjectURL(url);
      }}
      alt={`그림 ${block.n}`}
      width={block.width}
      height={block.height}
      decoding="async"
      className="block h-auto max-w-full"
    />
  );
}

function PreviewTable({ table }: { table: TableBlock }) {
  const covered = new Set<string>();
  const at = new Map(table.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  for (const cell of table.cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++)
      for (let k = cell.col; k < cell.col + cell.colSpan; k++) if (r !== cell.row || k !== cell.col) covered.add(`${r}:${k}`);
  }
  const rows: ReactNode[] = [];
  for (let r = 0; r < table.rows; r++) {
    const tds: ReactNode[] = [];
    for (let k = 0; k < table.cols; k++) {
      if (covered.has(`${r}:${k}`)) continue;
      const cell = at.get(`${r}:${k}`);
      tds.push(
        <td
          key={k}
          rowSpan={cell && cell.rowSpan > 1 ? cell.rowSpan : undefined}
          colSpan={cell && cell.colSpan > 1 ? cell.colSpan : undefined}
          className="min-w-[3em] whitespace-pre-wrap border border-neutral-400 px-2 py-1 align-top"
        >
          {cell ? inline(cell.text) : null}
        </td>,
      );
    }
    rows.push(<tr key={r}>{tds}</tr>);
  }
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="min-w-[60%] border-collapse text-[0.92rem]">
        {table.caption ? <caption className="pb-1 text-left text-sm">{table.caption}</caption> : null}
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

/** 읽은 한글 문서를 종이처럼 보여 준다(최대 1080px). 쪽 배치·글꼴은 원본과 다르다. */
export function HwpPreview({ name, blocks }: { name: string; blocks: Block[] }) {
  return (
    <article
      id="hwp-preview"
      aria-label={fill(c.previewLabel, { name })}
      tabIndex={0}
      className="mx-auto w-full min-w-0 max-w-[1080px] space-y-3 rounded border bg-white px-[clamp(18px,6vw,56px)] py-[clamp(18px,5vw,48px)] leading-7 text-neutral-900 shadow-sm [overflow-wrap:anywhere]"
    >
      {blocks.length === 0 ? <p>{c.empty}</p> : null}
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const Tag = b.level <= 1 ? "h2" : b.level === 2 ? "h3" : "h4";
            const size = b.level <= 1 ? "text-xl" : b.level === 2 ? "text-lg" : "text-base";
            return (
              <Tag key={i} className={`${size} pt-2 font-bold`}>
                {b.text}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={i} className={`whitespace-pre-wrap ${b.note ? "text-sm" : ""}`}>
                {inline(b.text)}
              </p>
            );
          case "table":
            return <PreviewTable key={i} table={b} />;
          case "image":
            return (
              <figure key={i} className="m-0">
                <PreviewImage block={b} />
              </figure>
            );
        }
      })}
    </article>
  );
}

/** 문단·표·그림 수와 읽으면서 바뀐 점(빠진 그림, 각주 위치 등) */
export function HwpSummary({ name, blocks, notes }: { name: string; blocks: Block[]; notes: string[] }) {
  const count = { paragraphs: 0, headings: 0, tables: 0, images: 0 };
  for (const b of blocks) {
    if (b.type === "paragraph") count.paragraphs++;
    else if (b.type === "heading") count.headings++;
    else if (b.type === "table") count.tables++;
    else count.images++;
  }
  return (
    <div className="flex flex-col gap-2">
      <p id="hwp-summary" className="text-sm">
        <span className="font-semibold [overflow-wrap:anywhere]">{name}</span>
        <span className="text-muted-foreground"> · {fill(c.summary, count)}</span>
      </p>
      {notes.length ? (
        <div>
          <p className="text-sm font-medium">{c.notesTitle}</p>
          <ul id="hwp-notes" className="list-disc pl-5 text-sm text-muted-foreground">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
