import { mkdir } from "node:fs/promises";
import path from "node:path";
import { EngineError, engineChain, type PdfEngine, type SourceKind } from "./engines";
import { inspectPdf } from "./pdf-inspect";

export type AttemptOutcome = "ok" | "empty" | "invalid" | "failed" | "crashed" | "timeout" | "unavailable";

/** 엔진 시도 한 번의 기록. 작업 결과(result.attempts)와 구조화 로그에 남는다. */
export type Attempt = { engine: string; outcome: AttemptOutcome; ms: number; detail?: string };

export type ConversionFailureCode = "TIMEOUT" | "CORRUPT" | "ENGINE_FAILED" | "NO_ENGINE" | "CRASHED" | "INTERNAL";

export class ConversionError extends Error {
  constructor(
    readonly code: ConversionFailureCode,
    readonly attempts: Attempt[] = [],
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export type PdfResult = { pdfPath: string; engine: string; pages: number | null; attempts: Attempt[] };

/** 기본 전체 제한 시간 120초 (SPEC 7.3 a). CONVERSION_TIMEOUT_MS로 바꿀 수 있다. */
export function conversionTimeoutMs() {
  const ms = Number(process.env.CONVERSION_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 120_000;
}

/**
 * HWP/HWPX → PDF. 엔진을 순서대로 시도하고, 실패·크래시·빈 결과면 다음 엔진으로 넘어간다 (docs/hwp-spike.md).
 *
 * - 엔진이 설치되어 있지 않으면 건너뛴다.
 * - 성공 판정은 종료 코드가 아니라 결과물로 한다: PDF가 있고 쪽수 ≥ 1이며 글자가 추출되어야 한다.
 * - 글자가 없는 PDF는 "빈 결과"로 보고 다음 엔진을 시도한다. 다른 엔진도 문서를 정상적으로 열었는데
 *   마찬가지로 글자가 없으면(그림만 있는 문서) 처음 만든 PDF를 결과로 쓴다. 다른 엔진이 확인해 주지 않은
 *   빈 PDF는 결과로 쓰지 않는다 (잘린 파일을 LibreOffice가 빈 쪽으로 "변환"하는 경우가 있다).
 * - deadline(epoch ms)이 지나면 TIMEOUT.
 */
export async function convertToPdf(opts: {
  input: string;
  kind: SourceKind;
  workDir: string;
  deadline: number;
  engines?: PdfEngine[];
}): Promise<PdfResult> {
  const engines = opts.engines ?? engineChain(opts.kind);
  const attempts: Attempt[] = [];
  let emptyCandidate: { pdfPath: string; engine: string; pages: number | null } | null = null;

  for (const [index, engine] of engines.entries()) {
    const remaining = opts.deadline - Date.now();
    if (remaining <= 0) throw new ConversionError("TIMEOUT", attempts);
    const started = Date.now();
    const record = (outcome: AttemptOutcome, detail?: string) =>
      attempts.push({ engine: engine.name, outcome, ms: Date.now() - started, ...(detail ? { detail: detail.slice(0, 300) } : {}) });

    let pdfPath: string;
    try {
      const workDir = path.join(opts.workDir, `engine-${index}-${engine.name}`);
      await mkdir(workDir, { recursive: true });
      pdfPath = await engine.run({ input: opts.input, workDir, timeoutMs: remaining });
    } catch (err) {
      if (err instanceof EngineError) record(err.outcome, err.message);
      else record("failed", String(err));
      continue;
    }

    const info = await inspectPdf(pdfPath, Math.max(1000, opts.deadline - Date.now()));
    if (!info.valid) {
      record("invalid", "output is not a readable PDF");
      continue;
    }
    if (info.hasText !== false) {
      record("ok");
      return { pdfPath, engine: engine.name, pages: info.pages, attempts };
    }
    record("empty", "PDF has no text");
    if (emptyCandidate) return { ...emptyCandidate, attempts };
    emptyCandidate = { pdfPath, engine: engine.name, pages: info.pages };
  }

  if (Date.now() >= opts.deadline || (attempts.length > 0 && attempts.at(-1)?.outcome === "timeout")) {
    throw new ConversionError("TIMEOUT", attempts);
  }
  if (attempts.every((attempt) => attempt.outcome === "unavailable")) throw new ConversionError("NO_ENGINE", attempts);
  throw new ConversionError("ENGINE_FAILED", attempts);
}
