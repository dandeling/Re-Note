/**
 * 자동 저장 컨트롤러 (SPEC 7.5). UI·네트워크와 분리된 순수 로직이라 단위 테스트가 가능하다.
 *
 * - 변경 후 `debounceMs`(기본 2초) 동안 입력이 없으면 저장한다.
 * - 저장 중에 또 바뀌면 끝난 뒤 한 번 더 저장한다.
 * - 네트워크 오류면 `offline` 상태가 되고, 온라인 복귀(`retry()`) 또는 재시도 타이머로 다시 보낸다.
 * - 버전 충돌(409)이면 `conflict` 상태로 멈추고 사용자의 선택을 기다린다.
 */
export type AutosaveStatus =
  | { kind: "saved"; at: Date }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "offline" }
  | { kind: "conflict"; serverVersion: number }
  | { kind: "error"; message: string };

export type SaveResult = { version: number; updatedAt: string };

export class SaveConflictError extends Error {
  constructor(readonly serverVersion: number) {
    super("conflict");
  }
}
export class SaveOfflineError extends Error {}

type Options<P> = {
  version: number;
  savedAt: Date;
  /** 저장할 내용을 그 시점에 읽어 온다 */
  getPayload: () => P;
  /** 서버에 저장한다. 충돌은 SaveConflictError, 네트워크 실패는 SaveOfflineError를 던진다 */
  save: (payload: P, baseVersion: number) => Promise<SaveResult>;
  onStatus: (status: AutosaveStatus) => void;
  debounceMs?: number;
  retryMs?: number;
};

export class AutosaveController<P> {
  private version: number;
  private status: AutosaveStatus;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private disposed = false;
  private readonly debounceMs: number;
  private readonly retryMs: number;

  constructor(private readonly opts: Options<P>) {
    this.version = opts.version;
    this.status = { kind: "saved", at: opts.savedAt };
    this.debounceMs = opts.debounceMs ?? 2000;
    this.retryMs = opts.retryMs ?? 10_000;
  }

  getStatus() {
    return this.status;
  }
  getVersion() {
    return this.version;
  }
  /** 서버에 아직 반영되지 않은 변경이 있는가 */
  hasUnsavedChanges() {
    return this.dirty || this.inFlight !== null;
  }

  /** 내용이 바뀔 때마다 호출한다. */
  markDirty() {
    this.dirty = true;
    if (this.status.kind === "conflict") return; // 충돌 해결 전에는 저장하지 않는다
    if (this.status.kind !== "saving" && this.status.kind !== "offline") this.setStatus({ kind: "dirty" });
    this.schedule(this.debounceMs);
  }

  /** 디바운스를 기다리지 않고 지금 저장한다 (Ctrl+S, 탭 닫기 전). */
  flush(): Promise<void> {
    this.clearTimer();
    if (this.status.kind === "conflict") return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (!this.dirty) return Promise.resolve();
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
      if (this.disposed) return;
      // 저장하는 동안 또 바뀌었거나 오프라인이면 다시 예약한다.
      if (this.status.kind === "offline") this.schedule(this.retryMs);
      else if (this.dirty && this.status.kind !== "conflict") this.schedule(this.debounceMs);
    });
    return this.inFlight;
  }

  /** 온라인으로 돌아왔을 때 호출한다. */
  retry() {
    if (this.status.kind === "offline" || this.status.kind === "error") return this.flush();
    return Promise.resolve();
  }

  /** 브라우저가 오프라인이 되었을 때 호출한다 (저장할 것이 없어도 상태를 보여주기 위함). */
  setOffline() {
    if (this.status.kind !== "conflict") this.setStatus({ kind: "offline" });
  }

  /** 충돌 해결: 내 버전 유지 — 서버 버전을 기준으로 삼아 내 내용으로 덮어쓴다. */
  resolveKeepMine() {
    if (this.status.kind !== "conflict") return Promise.resolve();
    this.version = this.status.serverVersion;
    this.dirty = true;
    this.setStatus({ kind: "dirty" });
    return this.flush();
  }

  /** 충돌 해결: 서버 버전 불러오기 — 호출자가 에디터 내용을 서버 것으로 바꾼 뒤 호출한다. */
  resolveUseServer(version: number, savedAt: Date) {
    this.clearTimer();
    this.version = version;
    this.dirty = false;
    this.setStatus({ kind: "saved", at: savedAt });
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
  }

  private async run() {
    this.dirty = false;
    this.setStatus({ kind: "saving" });
    try {
      const result = await this.opts.save(this.opts.getPayload(), this.version);
      this.version = result.version;
      this.setStatus(this.dirty ? { kind: "dirty" } : { kind: "saved", at: new Date(result.updatedAt) });
    } catch (err) {
      this.dirty = true;
      if (err instanceof SaveConflictError) this.setStatus({ kind: "conflict", serverVersion: err.serverVersion });
      else if (err instanceof SaveOfflineError) this.setStatus({ kind: "offline" });
      else this.setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private schedule(ms: number) {
    this.clearTimer();
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(status: AutosaveStatus) {
    this.status = status;
    if (!this.disposed) this.opts.onStatus(status);
  }
}
