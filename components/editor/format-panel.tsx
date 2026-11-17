"use client";

import { useId, type ReactNode } from "react";
import type { DocumentFormat } from "@/components/editor/use-document-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FONT_IDS, FONTS } from "@/lib/format/fonts";
import { HEADING_LEVELS, type FormatRules } from "@/lib/format/rules";
import { messages } from "@/lib/messages";

const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function getAt(rules: FormatRules, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => (cur as Record<string, unknown>)[key], rules);
}

function setAt(rules: FormatRules, path: string, value: unknown): FormatRules {
  const next = structuredClone(rules);
  const keys = path.split(".");
  let cur = next as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) cur = cur[key] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = value;
  return next;
}

/** 서식 폼 (SPEC 7.3 (d)): 값을 바꾸면 문서에 바로 반영되고, 저장하면 템플릿으로 남는다. */
export function FormatPanel({ format }: { format: DocumentFormat }) {
  const t = messages.format;
  const f = t.fields;
  const o = t.options;
  const { draft, setDraft, current } = format;
  const set = (path: string, value: unknown) => setDraft((prev) => setAt(prev, path, value));

  const num = (path: string, label: string, step = 1) => (
    <Field label={label}>
      {(id) => {
        const value = getAt(draft, path) as number;
        return (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            step={step}
            className="h-8"
            value={Number.isFinite(value) ? value : ""}
            onChange={(e) => set(path, e.target.value === "" ? Number.NaN : Number(e.target.value))}
          />
        );
      }}
    </Field>
  );
  const choice = (path: string, label: string, options: Record<string, string>) => (
    <Field label={label}>
      {(id) => (
        <select id={id} className={selectClass} value={getAt(draft, path) as string} onChange={(e) => set(path, e.target.value)}>
          {Object.entries(options).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  const check = (path: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={getAt(draft, path) as boolean} onChange={(e) => set(path, e.target.checked)} />
      {label}
    </label>
  );
  const fontOptions = Object.fromEntries(FONT_IDS.map((id) => [id, FONTS[id].label]));
  const pick = <K extends string>(all: Record<string, string>, keys: K[]) => Object.fromEntries(keys.map((k) => [k, all[k]]));
  const section = (title: string, body: ReactNode) => (
    <fieldset className="flex flex-col gap-2 border-t pt-3">
      <legend className="float-left mb-1 w-full text-sm font-semibold">{title}</legend>
      <div className="grid grid-cols-2 gap-2">{body}</div>
    </fieldset>
  );

  return (
    <form
      aria-label={t.panelTitle}
      data-testid="format-panel"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void format.save(current.isPreset);
      }}
    >
      <Field label={t.template}>
        {(id) => (
          <select
            id={id}
            className={selectClass}
            value={current.id}
            disabled={format.busy || !format.loaded}
            onChange={(e) => format.chooseTemplate(e.target.value)}
          >
            <optgroup label={t.presetGroup}>
              {format.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {format.templates.length > 0 ? (
              <optgroup label={t.mineGroup}>
                {format.templates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        )}
      </Field>

      {format.fontNotices.length > 0 ? (
        <ul role="alert" data-testid="format-font-notice" className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {format.fontNotices.map((n) => (
            <li key={n.path}>{t.fontSubstituted.replace("{requested}", n.requested).replace("{font}", FONTS[n.font].label)}</li>
          ))}
        </ul>
      ) : null}

      {section(
        t.sections.page,
        <>
          {choice("page.size", f.size, { A4: "A4", B5: "B5", Letter: "Letter" })}
          {choice("page.orientation", f.orientation, o.orientation)}
          {num("page.margin.top", f.marginTop)}
          {num("page.margin.bottom", f.marginBottom)}
          {num("page.margin.left", f.marginLeft)}
          {num("page.margin.right", f.marginRight)}
        </>,
      )}
      {section(
        t.sections.body,
        <>
          {choice("body.font", `${t.prefix.body} ${f.font}`, fontOptions)}
          {num("body.sizePt", `${t.prefix.body} ${f.sizePt}`, 0.5)}
          {num("body.lineHeight", f.lineHeight, 5)}
          {choice("body.align", `${t.prefix.body} ${f.align}`, pick(o.align, ["left", "justify"]))}
        </>,
      )}
      {section(
        t.sections.paragraph,
        <>
          {num("paragraph.indentPt", f.indentPt)}
          {num("paragraph.spacingPt", f.spacingPt)}
        </>,
      )}
      {HEADING_LEVELS.map((h) => (
        <div key={h}>
          {section(
            t.prefix[h],
            <>
              {choice(`headings.${h}.font`, `${t.prefix[h]} ${f.font}`, fontOptions)}
              {num(`headings.${h}.sizePt`, `${t.prefix[h]} ${f.sizePt}`, 0.5)}
              {choice(`headings.${h}.align`, `${t.prefix[h]} ${f.align}`, pick(o.align, ["left", "center", "right"]))}
              {check(`headings.${h}.bold`, `${t.prefix[h]} ${f.bold}`)}
            </>,
          )}
        </div>
      ))}
      {section(
        t.sections.caption,
        <>
          {num("caption.sizePt", `${t.prefix.caption} ${f.sizePt}`, 0.5)}
          {choice("caption.align", `${t.prefix.caption} ${f.align}`, pick(o.align, ["left", "center", "right"]))}
          {choice("caption.figurePosition", f.figurePosition, o.captionPosition)}
          {choice("caption.tablePosition", f.tablePosition, o.captionPosition)}
          {check("caption.bold", `${t.prefix.caption} ${f.bold}`)}
        </>,
      )}
      {section(
        t.sections.pageNumber,
        <>
          {check("pageNumber.enabled", f.enabled)}
          <span />
          {choice("pageNumber.position", `${t.prefix.pageNumber} ${f.position}`, o.pageNumberPosition)}
          {choice("pageNumber.style", `${t.prefix.pageNumber} ${f.style}`, o.pageNumberStyle)}
        </>,
      )}

      <div className="flex flex-col gap-2 border-t pt-3">
        {format.invalidFields.length > 0 ? (
          <p role="alert" className="text-xs text-destructive">
            {t.invalid.replace("{fields}", format.invalidFields.join(", "))}
          </p>
        ) : null}
        {format.dirty ? (
          <p data-testid="format-dirty" className="text-xs text-muted-foreground">
            {t.dirty}
          </p>
        ) : null}
        <Field label={t.templateName}>
          {(id) => <Input id={id} className="h-8" maxLength={60} value={format.name} onChange={(e) => format.setName(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          {!current.isPreset ? (
            <Button type="button" size="sm" disabled={format.busy || !format.dirty} onClick={() => void format.save(false)}>
              {t.saveChanges}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={current.isPreset ? "default" : "outline"}
            disabled={format.busy}
            onClick={() => void format.save(true)}
          >
            {t.saveAsNew}
          </Button>
        </div>
      </div>
    </form>
  );
}
