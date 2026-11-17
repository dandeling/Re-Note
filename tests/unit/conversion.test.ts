import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EngineError, engineChain, type PdfEngine } from "@/lib/conversion/engines";
import { inspectPdf } from "@/lib/conversion/pdf-inspect";
import { looksLikeDocx, looksLikeHwp, looksLikeHwpx, looksLikePdf } from "@/lib/conversion/precheck";
import { runProcess } from "@/lib/conversion/run";
import { ConversionError, convertToPdf } from "@/lib/conversion/to-pdf";
import { fakeEngine, HAS_POPPLER, HAS_SOFFICE, scopedEnv, THIRD_PARTY_DIR, THIRD_PARTY_SAMPLES } from "../setup/engines";
import { fixture, FIXTURES } from "../setup/storage";

const root = mkdtempSync(path.join(tmpdir(), "rm-conv-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const setEnv = scopedEnv();
const workDir = () => mkdtempSync(path.join(root, "w-"));
const sample = (name: string) => path.join(FIXTURES, "hwp", name);
const soon = (ms = 120_000) => Date.now() + ms;

async function failure(promise: Promise<unknown>): Promise<ConversionError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConversionError) return err;
    throw err;
  }
  throw new Error("expected ConversionError");
}

describe("runProcess (엔진을 별도 프로세스로 실행)", () => {
  it("정상 종료·오류 종료·실행 파일 없음을 구분한다", async () => {
    expect(await runProcess("sh", ["-c", "echo hi"], { timeoutMs: 5000 })).toMatchObject({ outcome: "ok", code: 0, stdout: "hi\n" });
    expect(await runProcess(fakeEngine("fail"), [], { timeoutMs: 5000 })).toMatchObject({ outcome: "failed", code: 3 });
    expect((await runProcess("/nonexistent/engine", [], { timeoutMs: 5000 })).outcome).toBe("unavailable");
  });

  it("시그널로 죽은 프로세스는 크래시로 본다 (셸 래퍼의 128+N 종료 코드 포함)", async () => {
    expect((await runProcess(fakeEngine("crash"), [], { timeoutMs: 5000 })).outcome).toBe("crashed");
    expect((await runProcess("sh", ["-c", "exit 134"], { timeoutMs: 5000 })).outcome).toBe("crashed");
  });

  it("제한 시간이 지나면 자식 프로세스까지 죽이고 timeout으로 끝난다", async () => {
    const marker = `rm-hang-${Date.now()}`;
    const started = Date.now();
    const result = await runProcess("sh", ["-c", `sleep 61 & echo ${marker}; wait`], { timeoutMs: 300 });
    expect(result.outcome).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const survivors = execFileSync("sh", ["-c", "ps -eo args | grep 'sleep 61' | grep -v grep || true"]).toString();
    expect(survivors.trim()).toBe("");
  });
});

describe("구조 검사 (엔진에 넘기기 전)", () => {
  it("정상 파일은 통과하고 매직바이트만 맞는 손상 파일은 걸러낸다", () => {
    expect(looksLikeHwp(fixture("hwp/sample.hwp"))).toBe(true);
    expect(looksLikeHwp(fixture("hwp/corrupt.hwp"))).toBe(false);
    expect(looksLikeHwp(fixture("hwp/sample.hwpx"))).toBe(false);
    expect(looksLikeHwpx(fixture("hwp/sample.hwpx"))).toBe(true);
    expect(looksLikeHwpx(fixture("hwp/corrupt.hwpx"))).toBe(false);
    expect(looksLikeHwpx(fixture("hwp/truncated.hwpx"))).toBe(false);
    expect(looksLikeHwpx(fixture("import/sample.docx"))).toBe(false);
    expect(looksLikeDocx(fixture("import/sample.docx"))).toBe(true);
    expect(looksLikeDocx(fixture("import/corrupt.docx"))).toBe(false);
    expect(looksLikePdf(fixture("import/sample.pdf"))).toBe(true);
    expect(looksLikePdf(fixture("import/fake.pdf"))).toBe(false);
  });
});

describe.skipIf(!HAS_POPPLER)("PDF 검사 (종료 코드가 아니라 결과물로 판정)", () => {
  it("글자가 있는 PDF, 빈 PDF, PDF가 아닌 파일을 구분한다", async () => {
    expect(await inspectPdf(path.join(FIXTURES, "import/sample.pdf"))).toMatchObject({ valid: true, pages: 1, hasText: true });
    expect(await inspectPdf(path.join(FIXTURES, "engines/blank.pdf"))).toMatchObject({ valid: true, pages: 1, hasText: false });
    expect((await inspectPdf(path.join(FIXTURES, "import/fake.pdf"))).valid).toBe(false);
    expect((await inspectPdf(path.join(root, "missing.pdf"))).valid).toBe(false);
  });
});

describe.skipIf(!HAS_POPPLER)("엔진 체인 — 가짜 엔진으로 실패 경로 검증", () => {
  const input = sample("sample.hwpx");
  const good: PdfEngine = { name: "good", run: async () => path.join(FIXTURES, "import/sample.pdf") };
  const blank = (name: string): PdfEngine => ({ name, run: async () => path.join(FIXTURES, "engines/blank.pdf") });
  const throwing = (name: string, outcome: "failed" | "crashed" | "timeout" | "unavailable"): PdfEngine => ({
    name,
    run: async () => {
      throw new EngineError(outcome, `${name} ${outcome}`);
    },
  });
  const convert = (engines: PdfEngine[], deadline = soon()) => convertToPdf({ input, kind: "hwpx", workDir: workDir(), deadline, engines });

  it("앞 엔진이 실패·크래시하면 다음 엔진으로 넘어간다", async () => {
    const result = await convert([throwing("a", "failed"), throwing("b", "crashed"), good]);
    expect(result.engine).toBe("good");
    expect(result.attempts.map((a) => a.outcome)).toEqual(["failed", "crashed", "ok"]);
  });

  it("설치되지 않은 엔진은 건너뛴다", async () => {
    const result = await convert([throwing("missing", "unavailable"), good]);
    expect(result.attempts.map((a) => [a.engine, a.outcome])).toEqual([["missing", "unavailable"], ["good", "ok"]]);
  });

  it("종료 코드 0인 빈 PDF는 실패로 보고 다음 엔진의 결과를 쓴다", async () => {
    const result = await convert([blank("empty-one"), good]);
    expect(result.engine).toBe("good");
    expect(result.attempts.map((a) => a.outcome)).toEqual(["empty", "ok"]);
  });

  it("두 엔진이 모두 글자 없는 PDF를 만들면(그림만 있는 문서) 첫 결과를 쓴다", async () => {
    const result = await convert([blank("first"), throwing("mid", "failed"), blank("second")]);
    expect(result.engine).toBe("first");
    expect(result.pages).toBe(1);
  });

  it("다른 엔진이 확인해 주지 않은 빈 PDF는 결과로 쓰지 않는다", async () => {
    const err = await failure(convert([blank("only"), throwing("b", "failed")]));
    expect(err.code).toBe("ENGINE_FAILED");
    expect(err.attempts.map((a) => a.outcome)).toEqual(["empty", "failed"]);
  });

  it("PDF가 아닌 결과물은 invalid로 기록하고 넘어간다", async () => {
    const bogus: PdfEngine = { name: "bogus", run: async () => path.join(FIXTURES, "import/fake.pdf") };
    const result = await convert([bogus, good]);
    expect(result.attempts.map((a) => a.outcome)).toEqual(["invalid", "ok"]);
  });

  it("모든 엔진이 실패하면 ENGINE_FAILED, 엔진이 하나도 없으면 NO_ENGINE", async () => {
    expect((await failure(convert([throwing("a", "failed"), throwing("b", "crashed")]))).code).toBe("ENGINE_FAILED");
    expect((await failure(convert([throwing("a", "unavailable"), throwing("b", "unavailable")]))).code).toBe("NO_ENGINE");
  });

  it("마감 시간이 지나면 남은 엔진을 시도하지 않고 TIMEOUT", async () => {
    let called = false;
    const slow: PdfEngine = {
      name: "slow",
      run: async ({ timeoutMs }) => {
        await new Promise((resolve) => setTimeout(resolve, timeoutMs + 20));
        throw new EngineError("timeout", "slow timeout");
      },
    };
    const never: PdfEngine = { name: "never", run: async () => ((called = true), path.join(FIXTURES, "import/sample.pdf")) };
    const err = await failure(convert([slow, never], Date.now() + 200));
    expect(err.code).toBe("TIMEOUT");
    expect(called).toBe(false);
  });

  it("실제 프로세스: 멈춘 엔진은 제한 시간에 강제 종료되고 TIMEOUT으로 끝난다", async () => {
    setEnv({ SOFFICE_BIN: fakeEngine("hang"), CONVERSION_ENGINES_HWPX: "libreoffice" });
    const started = Date.now();
    const err = await failure(convertToPdf({ input, kind: "hwpx", workDir: workDir(), deadline: Date.now() + 700 }));
    expect(err.code).toBe("TIMEOUT");
    expect(err.attempts).toMatchObject([{ engine: "libreoffice", outcome: "timeout" }]);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("실제 프로세스: 크래시·오류·빈 PDF·PDF 아닌 결과를 각각 기록한다", async () => {
    setEnv({ CONVERSION_ENGINES_HWPX: "libreoffice" });
    const outcomes: string[] = [];
    for (const fake of ["crash", "fail", "empty-pdf", "garbage-pdf"] as const) {
      setEnv({ SOFFICE_BIN: fakeEngine(fake) });
      const err = await failure(convertToPdf({ input, kind: "hwpx", workDir: workDir(), deadline: soon() }));
      expect(err.code).toBe("ENGINE_FAILED");
      outcomes.push(err.attempts[0].outcome);
    }
    expect(outcomes).toEqual(["crashed", "failed", "empty", "invalid"]);
  });

  it("실행 파일 경로가 잘못된 엔진은 unavailable로 건너뛴다", async () => {
    setEnv({ SOFFICE_BIN: "/nonexistent/soffice", HWP5ODT_BIN: "/nonexistent/hwp5odt", CONVERSION_ENGINES_HWP: "pyhwp,libreoffice" });
    const err = await failure(convertToPdf({ input: sample("sample.hwp"), kind: "hwp", workDir: workDir(), deadline: soon() }));
    expect(err.code).toBe("NO_ENGINE");
    expect(err.attempts.map((a) => a.outcome)).toEqual(["unavailable", "unavailable"]);
  });

  it("엔진 순서는 스파이크 결론을 따르고 환경변수로 바꿀 수 있다", () => {
    expect(engineChain("hwp").map((e) => e.name)).toEqual(["pyhwp", "libreoffice", "rhwp"]);
    expect(engineChain("hwpx").map((e) => e.name)).toEqual(["libreoffice", "rhwp"]);
    setEnv({ CONVERSION_ENGINES_HWP: "rhwp, nope ,libreoffice" });
    expect(engineChain("hwp").map((e) => e.name)).toEqual(["rhwp", "libreoffice"]);
  });
});

describe.skipIf(!HAS_POPPLER)("엔진 체인 — 실제 엔진", () => {
  it.skipIf(!HAS_SOFFICE)("자체 제작 HWPX가 PDF로 변환된다", async () => {
    const result = await convertToPdf({ input: sample("sample.hwpx"), kind: "hwpx", workDir: workDir(), deadline: soon() });
    expect(result.pages).toBeGreaterThanOrEqual(1);
    const text = execFileSync("pdftotext", [result.pdfPath, "-"]).toString();
    expect(text).toContain("음향 블랙홀");
    expect(text).toContain("감쇠율");
  }, 120_000);

  it("자체 제작 HWP는 앞 엔진이 실패하거나 빈 PDF를 내도 폴백으로 변환된다", async () => {
    const result = await convertToPdf({ input: sample("sample.hwp"), kind: "hwp", workDir: workDir(), deadline: soon() });
    expect(result.attempts.at(-1)).toMatchObject({ engine: result.engine, outcome: "ok" });
    // pyhwp는 이 파일(요약 정보 스트림 없음)을 읽지 못한다 → 최소 한 번은 폴백이 일어난다.
    expect(result.attempts.length).toBeGreaterThan(1);
    expect(execFileSync("pdftotext", [result.pdfPath, "-"]).toString()).toContain("음향 블랙홀");
  }, 120_000);

  it("잘린 HWPX는 어떤 엔진으로도 변환되지 않는다 (빈 PDF를 결과로 내지 않는다)", async () => {
    const dir = workDir();
    const input = path.join(dir, "input.hwpx");
    copyFileSync(sample("truncated.hwpx"), input);
    const err = await failure(convertToPdf({ input, kind: "hwpx", workDir: dir, deadline: soon() }));
    expect(err.code).toBe("ENGINE_FAILED");
  }, 120_000);

  it.skipIf(THIRD_PARTY_SAMPLES.length === 0)("제3자 HWP 샘플(표·그림·각주·다단)이 모두 PDF로 변환된다", async () => {
    for (const name of THIRD_PARTY_SAMPLES) {
      const result = await convertToPdf({
        input: path.join(THIRD_PARTY_DIR, `${name}.hwp`),
        kind: "hwp",
        workDir: workDir(),
        deadline: soon(),
      });
      expect(result.pages, name).toBeGreaterThanOrEqual(1);
    }
  }, 300_000);
});
