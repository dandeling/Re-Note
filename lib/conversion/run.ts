import { spawn } from "node:child_process";

export type RunResult = {
  /** "unavailable": 실행 파일이 없음, "crashed": 시그널로 죽음, "timeout": 제한 시간 초과로 강제 종료 */
  outcome: "ok" | "failed" | "crashed" | "timeout" | "unavailable";
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  ms: number;
};

const MAX_CAPTURE = 64 * 1024;

/**
 * 외부 엔진을 별도 프로세스(프로세스 그룹)로 실행한다.
 * 제한 시간이 지나면 그룹 전체를 SIGKILL한다 — soffice처럼 자식 프로세스를 띄우는 엔진도 남지 않게.
 * 예외를 던지지 않고 항상 결과를 돌려준다.
 */
export function runProcess(
  command: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv; maxOutput?: number },
): Promise<RunResult> {
  const started = Date.now();
  const limit = opts.maxOutput ?? MAX_CAPTURE;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: Omit<RunResult, "stdout" | "stderr" | "ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr: stderr.slice(-limit), ms: Date.now() - started });
    };

    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, Math.max(1, opts.timeoutMs));

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < limit) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-limit);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      const missing = err.code === "ENOENT" || err.code === "EACCES";
      stderr += String(err);
      finish({ outcome: missing ? "unavailable" : "failed", code: null, signal: null });
    });
    child.on("close", (code, signal) => {
      // 남은 자식 프로세스 정리 (정상 종료여도 그룹에 남아 있을 수 있다)
      killGroup();
      if (timedOut) return finish({ outcome: "timeout", code, signal });
      // 셸 래퍼를 거치면 시그널이 128+N 종료 코드로 보인다.
      if (signal || (code !== null && code >= 128)) return finish({ outcome: "crashed", code, signal });
      finish({ outcome: code === 0 ? "ok" : "failed", code, signal });
    });
  });
}

/** 로그·오류 사유에 넣을 짧은 요약 */
export function describeRun(result: RunResult) {
  const tail = (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" | ").slice(0, 300);
  if (result.outcome === "timeout") return `timeout after ${result.ms}ms`;
  if (result.outcome === "crashed") return `crashed (signal ${result.signal ?? result.code}) ${tail}`;
  if (result.outcome === "unavailable") return "executable not found";
  return `exit ${result.code} ${tail}`;
}
