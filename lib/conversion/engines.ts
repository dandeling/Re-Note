import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { describeRun, runProcess, type RunResult } from "./run";

export type SourceKind = "hwp" | "hwpx";

export type EngineFailure = "failed" | "crashed" | "timeout" | "unavailable";

/** 엔진 한 번의 실패. outcome이 "unavailable"이면 엔진이 설치되지 않은 것이라 건너뛴다. */
export class EngineError extends Error {
  constructor(
    readonly outcome: EngineFailure,
    detail: string,
  ) {
    super(detail);
  }
}

export type EngineContext = {
  /** 입력 파일 절대 경로 (확장자가 형식과 맞아야 한다) */
  input: string;
  /** 이 엔진만 쓰는 빈 작업 디렉터리 */
  workDir: string;
  /** 이 엔진에 줄 수 있는 남은 시간 */
  timeoutMs: number;
};

export type PdfEngine = {
  name: string;
  /** 성공하면 만들어진 PDF 경로. 실패하면 EngineError. */
  run(ctx: EngineContext): Promise<string>;
};

function check(result: RunResult) {
  if (result.outcome !== "ok") throw new EngineError(result.outcome, describeRun(result));
}

/** LibreOffice headless로 PDF 변환. 호출마다 별도 프로필을 써서 동시에 여러 개를 돌릴 수 있다. */
export async function sofficeToPdf(input: string, workDir: string, timeoutMs: number): Promise<string> {
  const outDir = path.join(workDir, "out");
  await mkdir(outDir, { recursive: true });
  const result = await runProcess(
    process.env.SOFFICE_BIN || "soffice",
    [
      "--headless",
      "--norestore",
      `-env:UserInstallation=file://${path.join(workDir, "lo-profile")}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      input,
    ],
    { timeoutMs, cwd: workDir },
  );
  check(result);
  const pdf = (await readdir(outDir)).find((name) => name.toLowerCase().endsWith(".pdf"));
  // soffice는 문서를 열지 못해도 종료 코드 0으로 끝날 수 있다.
  if (!pdf) throw new EngineError("failed", `no pdf produced: ${describeRun(result)}`);
  return path.join(outDir, pdf);
}

/** 1순위(.hwp): pyhwp `hwp5odt` → ODT → LibreOffice → PDF */
const pyhwp: PdfEngine = {
  name: "pyhwp",
  async run({ input, workDir, timeoutMs }) {
    const started = Date.now();
    const odt = path.join(workDir, "document.odt");
    check(await runProcess(process.env.HWP5ODT_BIN || "hwp5odt", ["--output", odt, input], { timeoutMs, cwd: workDir }));
    return sofficeToPdf(odt, workDir, timeoutMs - (Date.now() - started));
  },
};

/** LibreOffice + H2Orestart 확장 */
const libreoffice: PdfEngine = {
  name: "libreoffice",
  run: ({ input, workDir, timeoutMs }) => sofficeToPdf(input, workDir, timeoutMs),
};

/** rhwp(WASM) + Chromium 인쇄 (worker/engines/rhwp-pdf.mjs) */
const rhwp: PdfEngine = {
  name: "rhwp",
  async run({ input, workDir, timeoutMs }) {
    const output = path.join(workDir, "document.pdf");
    const script = process.env.RHWP_ENGINE_SCRIPT || path.join(process.cwd(), "worker", "engines", "rhwp-pdf.mjs");
    check(await runProcess(process.env.NODE_BIN || process.execPath, [script, input, output], { timeoutMs, cwd: workDir }));
    return output;
  },
};

const ENGINES: Record<string, PdfEngine> = { pyhwp, libreoffice, rhwp };

/** docs/hwp-spike.md 1장의 엔진 순서 */
const DEFAULT_CHAIN: Record<SourceKind, string[]> = {
  hwp: ["pyhwp", "libreoffice", "rhwp"],
  hwpx: ["libreoffice", "rhwp"],
};

/** 엔진 체인. CONVERSION_ENGINES_HWP / CONVERSION_ENGINES_HWPX(쉼표 구분)로 순서를 바꾸거나 엔진을 뺄 수 있다. */
export function engineChain(kind: SourceKind): PdfEngine[] {
  const override = process.env[kind === "hwp" ? "CONVERSION_ENGINES_HWP" : "CONVERSION_ENGINES_HWPX"];
  const names = override ? override.split(",").map((name) => name.trim()).filter(Boolean) : DEFAULT_CHAIN[kind];
  return names.map((name) => ENGINES[name]).filter((engine): engine is PdfEngine => Boolean(engine));
}
