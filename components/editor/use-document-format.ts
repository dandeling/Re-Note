"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/api-client";
import { formatCssVars, formatDataAttrs } from "@/lib/format/css";
import { FORMAT_FILL_EVENT } from "@/lib/format/fill";
import { DEFAULT_PRESET_ID, FORMAT_PRESETS } from "@/lib/format/presets";
import { DEFAULT_RULES, normalizeRules, type FontNotice, type FormatRules } from "@/lib/format/rules";
import { messages } from "@/lib/messages";

export type FormatTemplate = { id: string; name: string; isPreset: boolean; rulesJson: FormatRules };
/** 우측 패널 탭 ("chat": AI 도우미) */
export type FormatTab = "chat" | "format" | "check" | "export";

type ListResponse = { presets: FormatTemplate[]; templates: FormatTemplate[]; documentTemplateId?: string | null };

const fallbackPresets: FormatTemplate[] = FORMAT_PRESETS.map((p) => ({ id: p.id, name: p.name, isPreset: true, rulesJson: p.rules }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 문서의 서식 상태: 적용된 템플릿, 폼에서 고치는 중인 규칙, 저장.
 * `scopeProps`를 문서 본문을 감싸는 요소에 주면 규칙이 CSS 변수 + data 속성으로 즉시 반영된다.
 */
export function useDocumentFormat(docId: string) {
  const t = messages.format;
  const [presets, setPresets] = useState<FormatTemplate[]>(fallbackPresets);
  const [templates, setTemplates] = useState<FormatTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_PRESET_ID);
  /** 폼의 값 (입력 중에는 범위를 벗어난 값도 들어 있을 수 있다) */
  const [draft, setDraft] = useState<FormatRules>(DEFAULT_RULES);
  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fontNotices, setFontNotices] = useState<FontNotice[]>([]);
  const [tab, setTab] = useState<FormatTab | null>(null);

  const current = useMemo(
    () => [...presets, ...templates].find((x) => x.id === templateId) ?? presets[0] ?? fallbackPresets[0],
    [presets, templates, templateId],
  );
  // 화면에 적용하는 규칙: 올바르지 않은 값은 저장된 값으로 대신한다.
  const normalized = useMemo(() => normalizeRules(draft, current.rulesJson), [draft, current]);
  const rules = normalized.rules;
  const dirty = !same(rules, current.rulesJson);

  const select = useCallback((template: FormatTemplate) => {
    setTemplateId(template.id);
    setDraft(template.rulesJson);
    setName(template.isPreset ? `${template.name} ${messages.format.customSuffix}` : template.name);
    setFontNotices([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<ListResponse>(`/api/format-templates?docId=${encodeURIComponent(docId)}`).then(
      (res) => {
        if (cancelled) return;
        setPresets(res.presets);
        setTemplates(res.templates);
        const all = [...res.presets, ...res.templates];
        select(all.find((x) => x.id === res.documentTemplateId) ?? res.presets[0] ?? fallbackPresets[0]);
        setLoaded(true);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [docId, select]);

  // 최신 값을 이벤트 핸들러·비동기 함수에서 읽기 위한 ref
  const latest = useRef({ rules, current, name, dirty });
  useEffect(() => {
    latest.current = { rules, current, name, dirty };
  });

  /** rulesJson(일부만 있어도 됨)을 폼에 채운다. 저장은 사용자가 확인한 뒤에 한다. */
  const fill = useCallback((rulesJson: unknown) => {
    const result = normalizeRules(rulesJson, latest.current.rules);
    setDraft(result.rules);
    setFontNotices(result.fontNotices);
    setNotice(messages.format.filled);
    setError(null);
    setTab("format");
  }, []);

  useEffect(() => {
    const onFill = (e: Event) => fill((e as CustomEvent).detail);
    window.addEventListener(FORMAT_FILL_EVENT, onFill);
    return () => window.removeEventListener(FORMAT_FILL_EVENT, onFill);
  }, [fill]);

  const applyToDocument = (id: string) => api(`/api/docs/${docId}`, { method: "PATCH", body: { formatTemplateId: id } });

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errors.INTERNAL_ERROR);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** 다른 템플릿을 이 문서에 적용한다. */
  function chooseTemplate(id: string) {
    const template = [...presets, ...templates].find((x) => x.id === id);
    if (!template || id === templateId) return;
    if (dirty && !window.confirm(t.discardConfirm)) return;
    void run(async () => {
      await applyToDocument(id);
      select(template);
      return t.applied;
    });
  }

  /** 폼의 규칙을 내 템플릿으로 저장하고 이 문서에 적용한다. asNew가 아니면 지금 쓰는 내 템플릿을 고친다. */
  function save(asNew: boolean) {
    return run(async () => {
      const { rules: rulesJson, current: cur, name: rawName } = latest.current;
      const update = !asNew && !cur.isPreset;
      const res = await api<{ template: FormatTemplate }>("/api/format-templates", {
        method: "POST",
        body: { id: update ? cur.id : undefined, name: rawName.trim() || `${cur.name} ${t.customSuffix}`, rulesJson },
      });
      if (!update) await applyToDocument(res.template.id);
      setTemplates((list) => [res.template, ...list.filter((x) => x.id !== res.template.id)]);
      select(res.template);
      return t.saved;
    });
  }

  /** 내보내기 전에 호출: 저장하지 않은 서식 변경이 있으면 저장한다. */
  async function ensureSaved() {
    if (!latest.current.dirty) return true;
    return save(false);
  }

  const scopeProps = useMemo(
    () => ({ style: formatCssVars(rules) as CSSProperties, ...formatDataAttrs(rules) }),
    [rules],
  );

  return {
    loaded,
    busy,
    notice,
    error,
    fontNotices,
    presets,
    templates,
    current,
    draft,
    setDraft,
    rules,
    dirty,
    invalidFields: normalized.defaulted,
    name,
    setName,
    chooseTemplate,
    save,
    ensureSaved,
    fill,
    tab,
    setTab,
    scopeProps,
  };
}

export type DocumentFormat = ReturnType<typeof useDocumentFormat>;
