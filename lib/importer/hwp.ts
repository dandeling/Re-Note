import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { EngineError, type SourceKind } from "@/lib/conversion/engines";
import { describeRun, runProcess, type RunResult } from "@/lib/conversion/run";
import { ConversionError, type Attempt, type AttemptOutcome } from "@/lib/conversion/to-pdf";
import { markdownToHtml } from "@/lib/importer/markdown";

/**
 * HWP/HWPX → 중간 형식 HTML (docs/hwp-spike.md 1장: 가져오기는 PDF가 아니라 구조가 필요하다).
 * 엔진 체인: unhwp(Markdown + 그림) → pyhwp hwp5html(.hwp만, XHTML + bindata). 엔진은 별도 프로세스.
 * 엔진이 없으면 건너뛰고, 실패·빈 결과면 다음 엔진으로 넘어간다.
 */
export type HwpExtraction = { html: string; images: Map<string, { filename: string; bytes: Uint8Array }>; engine: string; attempts: Attempt[] };

type HtmlEngine = {
  name: string;
  kinds: SourceKind[];
  run(input: string, workDir: string, timeoutMs: number): Promise<{ html: string; imageDir: string }>;
};

function check(result: RunResult) {
  if (result.outcome !== "ok") throw new EngineError(result.outcome, describeRun(result));
}

const unhwp: HtmlEngine = {
  name: "unhwp",
  kinds: ["hwp", "hwpx"],
  async run(input, workDir, timeoutMs) {
    const script = process.env.UNHWP_ENGINE_SCRIPT || path.join(process.cwd(), "worker", "engines", "unhwp-extract.py");
    const result = await runProcess(process.env.UNHWP_PYTHON || "python3", [script, input, workDir], { timeoutMs, cwd: workDir });
    // python은 있는데 unhwp 모듈이 없으면 ModuleNotFoundError로 끝난다 → 설치되지 않은 엔진으로 본다
    if (result.outcome === "failed" && /ModuleNotFoundError/.test(result.stderr)) throw new EngineError("unavailable", "unhwp module not installed");
    check(result);
    const markdown = await readFile(path.join(workDir, "document.md"), "utf8");
    return { html: markdownToHtml(markdown).html, imageDir: workDir };
  },
};

const hwp5html: HtmlEngine = {
  name: "hwp5html",
  kinds: ["hwp"],
  async run(input, workDir, timeoutMs) {
    const out = path.join(workDir, "html");
    check(await runProcess(process.env.HWP5HTML_BIN || "hwp5html", ["--output", out, input], { timeoutMs, cwd: workDir }));
    const xhtml = await readFile(path.join(out, "index.xhtml"), "utf8");
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml)?.[1] ?? "";
    // 문단 끝의 &#13;(CR)은 공백으로 정리된다
    return { html: body, imageDir: out };
  },
};

const ENGINES: Record<string, HtmlEngine> = { unhwp, hwp5html };

/** CONVERSION_IMPORT_ENGINES_HWP(쉼표 구분)로 순서를 바꾸거나 엔진을 뺄 수 있다. */
export function importEngineChain(kind: SourceKind): HtmlEngine[] {
  const override = process.env.CONVERSION_IMPORT_ENGINES_HWP;
  const names = override ? override.split(",").map((n) => n.trim()) : ["unhwp", "hwp5html"];
  return names.map((n) => ENGINES[n]).filter((e): e is HtmlEngine => Boolean(e) && e.kinds.includes(kind));
}

/** img src(상대 경로)가 가리키는 그림 파일을 읽는다. 엔진 출력 디렉터리 밖은 읽지 않는다. */
async function collectImages(html: string, baseDir: string) {
  const images = new Map<string, { filename: string; bytes: Uint8Array }>();
  const available = new Set<string>();
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else available.add(full);
    }
  };
  await walk(baseDir);
  for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
    const src = match[1].replace(/&amp;/g, "&");
    if (/^[a-z]+:/i.test(src) || images.has(src)) continue;
    const full = path.resolve(baseDir, decodeURIComponent(src));
    if (!full.startsWith(baseDir + path.sep) || !available.has(full)) continue;
    images.set(src, { filename: path.basename(full), bytes: new Uint8Array(await readFile(full)) });
  }
  return images;
}

export async function extractHwpStructure(opts: { input: string; kind: SourceKind; workDir: string; deadline: number }): Promise<HwpExtraction> {
  const attempts: Attempt[] = [];
  const engines = importEngineChain(opts.kind);
  // 글자가 없는 결과(도형만 있는 문서 등)는 다른 엔진을 더 시도해 보고, 그래도 없으면 빈 문서로 받아들인다.
  let empty: HwpExtraction | null = null;
  for (const [index, engine] of engines.entries()) {
    const remaining = opts.deadline - Date.now();
    if (remaining <= 0) throw new ConversionError("TIMEOUT", attempts);
    const started = Date.now();
    const record = (outcome: AttemptOutcome, detail?: string) =>
      attempts.push({ engine: engine.name, outcome, ms: Date.now() - started, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
    const dir = path.join(opts.workDir, `import-${index}-${engine.name}`);
    await mkdir(dir, { recursive: true });
    try {
      const { html, imageDir } = await engine.run(opts.input, dir, remaining);
      const text = html.replace(/<[^>]+>/g, "").replace(/&[#\w]+;/g, "").replace(/\s+/g, "");
      if (!text && !/<img\b/i.test(html)) {
        record("empty", "no text extracted");
        empty ??= { html, images: new Map(), engine: engine.name, attempts };
        continue;
      }
      record("ok");
      return { html, images: await collectImages(html, path.resolve(imageDir)), engine: engine.name, attempts };
    } catch (err) {
      if (err instanceof EngineError) record(err.outcome, err.message);
      else record("failed", String(err));
    }
  }
  if (empty) return { ...empty, attempts };
  if (attempts.at(-1)?.outcome === "timeout" || Date.now() >= opts.deadline) throw new ConversionError("TIMEOUT", attempts);
  if (attempts.every((a) => a.outcome === "unavailable")) throw new ConversionError("NO_ENGINE", attempts);
  throw new ConversionError("ENGINE_FAILED", attempts);
}
