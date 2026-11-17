/** 구조화(JSON) 로그. SPEC 9장 관측. */
export type LogLevel = "info" | "warn" | "error";
type Fields = Record<string, unknown>;
export type LogEntry = { level: LogLevel; msg: string; time: string } & Fields;
export type LogSink = (entry: LogEntry) => void;

/** 기본 출력: 한 줄에 JSON 하나 */
const consoleSink: LogSink = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
};

/**
 * Vitest 실행 중에는 테스트 출력을 어지럽히지 않도록 기본으로 버린다.
 * 보고 싶으면 `LOG_IN_TESTS=1`.
 */
function defaultSink(): LogSink | null {
  if (process.env.VITEST && process.env.LOG_IN_TESTS !== "1") return null;
  return consoleSink;
}

let sink: LogSink | null = defaultSink();

function write(level: LogLevel, msg: string, fields?: Fields) {
  if (!sink) return;
  const time = new Date().toISOString();
  // 필드가 level/msg/time을 덮어쓰지 못하게 한다(키 순서는 level, msg, time이 먼저).
  const entry: LogEntry = { level, msg, time, ...fields };
  Object.assign(entry, { level, msg, time });
  sink(entry);
}

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

/** 테스트용: 로그를 배열에 모은다. 반환한 함수로 원래 출력으로 되돌린다. */
export function captureLogs(): { entries: LogEntry[]; restore: () => void } {
  const previous = sink;
  const entries: LogEntry[] = [];
  sink = (entry) => entries.push(entry);
  return { entries, restore: () => void (sink = previous) };
}
