"use client";

import { useCallback, useRef, useState } from "react";
import { canvasToPng } from "@/components/convert/canvas-png";
import { hwpErrorMessage, MAX_FILE, parseAny, type ParseResult } from "@/lib/hwp-browser";
import { fill, hwpBrowserText } from "@/lib/hwp-browser/ui-text";

const c = hwpBrowserText.common;

export type OpenedHwp = { id: number; name: string; size: number; result: ParseResult };

/** 한글 파일을 브라우저에서 읽는다. 마지막으로 고른 파일의 결과만 남긴다(앞서 고른 파일의 늦은 결과는 버린다). */
export function useHwpFile(maxMb: number) {
  const [opened, setOpened] = useState<OpenedHwp | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const limit = Math.min(maxMb * 1024 * 1024, MAX_FILE);

  const open = useCallback(
    async (file: File | null | undefined) => {
      const my = ++seq.current;
      setOpened(null);
      setError(null);
      if (!file) return;
      if (!/\.hwpx?$/i.test(file.name)) return setError(c.onlyHwp);
      if (file.size > limit) return setError(fill(c.tooLarge, { mb: Math.floor(limit / 1024 / 1024) }));
      setBusy(true);
      setStatus(c.reading);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await parseAny(bytes, {
          convertToPng: canvasToPng,
          onProgress: (f) => {
            if (seq.current === my) setStatus(fill(c.readingPct, { pct: Math.round(f * 100) }));
          },
        });
        if (seq.current !== my) return;
        setOpened({ id: my, name: file.name, size: file.size, result });
      } catch (err) {
        if (seq.current !== my) return;
        if (!(err instanceof Error && "code" in err)) console.warn(err);
        setError(hwpErrorMessage(err));
      } finally {
        if (seq.current === my) {
          setBusy(false);
          setStatus(null);
        }
      }
    },
    [limit],
  );

  const reset = useCallback(() => {
    seq.current++;
    setOpened(null);
    setError(null);
    setStatus(null);
    setBusy(false);
  }, []);

  return { opened, status, error, busy, open, reset };
}
