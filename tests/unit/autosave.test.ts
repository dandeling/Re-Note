import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutosaveController,
  SaveConflictError,
  SaveOfflineError,
  type AutosaveStatus,
  type SaveResult,
} from "@/lib/editor/autosave";

function setup(save: (payload: string, baseVersion: number) => Promise<SaveResult>) {
  const statuses: AutosaveStatus["kind"][] = [];
  let content = "";
  const saveSpy = vi.fn(save);
  const c = new AutosaveController<string>({
    version: 1,
    savedAt: new Date("2026-01-01T00:00:00Z"),
    getPayload: () => content,
    save: saveSpy,
    onStatus: (s) => statuses.push(s.kind),
  });
  const type = (text: string) => {
    content = text;
    c.markDirty();
  };
  return { c, statuses, saveSpy, type };
}

const ok = (version: number): SaveResult => ({ version, updatedAt: "2026-01-01T00:01:00Z" });

describe("자동 저장 컨트롤러 (SPEC 7.5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("입력이 멈춘 뒤 2초가 지나야 저장한다", async () => {
    const { c, saveSpy, type, statuses } = setup(async (_p, v) => ok(v + 1));
    type("가");
    await vi.advanceTimersByTimeAsync(1999);
    expect(saveSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saveSpy).toHaveBeenCalledWith("가", 1);
    expect(c.getVersion()).toBe(2);
    expect(statuses).toEqual(["dirty", "saving", "saved"]);
  });

  it("계속 입력하면 저장을 미루고 마지막 내용만 한 번 저장한다", async () => {
    const { saveSpy, type } = setup(async (_p, v) => ok(v + 1));
    for (const text of ["가", "가나", "가나다"]) {
      type(text);
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(saveSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith("가나다", 1);
  });

  it("저장 중에 바뀐 내용은 저장이 끝난 뒤 새 버전 기준으로 다시 저장한다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const { c, saveSpy, type } = setup(async (_p, v) => {
      if (calls++ === 0) await gate;
      return ok(v + 1);
    });
    type("첫 내용");
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.getStatus().kind).toBe("saving");
    type("둘째 내용");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.getStatus().kind).toBe("dirty");
    await vi.advanceTimersByTimeAsync(2000);
    expect(saveSpy).toHaveBeenNthCalledWith(2, "둘째 내용", 2);
    expect(c.getVersion()).toBe(3);
    expect(c.hasUnsavedChanges()).toBe(false);
  });

  it("flush()는 디바운스를 기다리지 않고 바로 저장한다", async () => {
    const { c, saveSpy, type } = setup(async (_p, v) => ok(v + 1));
    type("가");
    await c.flush();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("네트워크가 끊기면 offline이 되고, 온라인 복귀 시 자동으로 다시 저장한다", async () => {
    let online = false;
    const { c, saveSpy, type } = setup(async (_p, v) => {
      if (!online) throw new SaveOfflineError();
      return ok(v + 1);
    });
    type("오프라인에서 쓴 글");
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.getStatus().kind).toBe("offline");
    expect(c.hasUnsavedChanges()).toBe(true);

    online = true;
    await c.retry();
    expect(c.getStatus().kind).toBe("saved");
    expect(saveSpy).toHaveBeenLastCalledWith("오프라인에서 쓴 글", 1);
    expect(c.hasUnsavedChanges()).toBe(false);
  });

  it("오프라인 상태에서는 주기적으로 재시도한다", async () => {
    let online = false;
    const { c, type } = setup(async (_p, v) => {
      if (!online) throw new SaveOfflineError();
      return ok(v + 1);
    });
    type("가");
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.getStatus().kind).toBe("offline");
    online = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.getStatus().kind).toBe("saved");
  });

  it("버전 충돌이면 conflict에서 멈추고 자동 저장을 계속하지 않는다", async () => {
    const { c, saveSpy, type } = setup(async () => {
      throw new SaveConflictError(5);
    });
    type("내 버전");
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.getStatus()).toEqual({ kind: "conflict", serverVersion: 5 });
    type("내 버전 계속");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("충돌 해결 '내 버전 유지': 서버 버전을 기준으로 내 내용을 저장한다", async () => {
    let conflict = true;
    const { c, saveSpy, type } = setup(async (_p, v) => {
      if (conflict) throw new SaveConflictError(5);
      return ok(v + 1);
    });
    type("내 버전");
    await vi.advanceTimersByTimeAsync(2000);
    conflict = false;
    await c.resolveKeepMine();
    expect(saveSpy).toHaveBeenLastCalledWith("내 버전", 5);
    expect(c.getVersion()).toBe(6);
    expect(c.getStatus().kind).toBe("saved");
  });

  it("충돌 해결 '서버 버전 불러오기': 서버 버전으로 맞추고 저장할 것이 없는 상태가 된다", async () => {
    const { c, saveSpy, type } = setup(async () => {
      throw new SaveConflictError(5);
    });
    type("내 버전");
    await vi.advanceTimersByTimeAsync(2000);
    c.resolveUseServer(5, new Date());
    expect(c.getStatus().kind).toBe("saved");
    expect(c.getVersion()).toBe(5);
    expect(c.hasUnsavedChanges()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("그 밖의 오류는 error 상태가 되고 변경은 남아 있다", async () => {
    const { c, type } = setup(async () => {
      throw new Error("서버 오류");
    });
    type("가");
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.getStatus()).toEqual({ kind: "error", message: "서버 오류" });
    expect(c.hasUnsavedChanges()).toBe(true);
  });
});
