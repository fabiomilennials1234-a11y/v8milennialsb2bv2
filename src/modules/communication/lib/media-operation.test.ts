import { afterEach, expect, it, vi } from "vitest";
import { MEDIA_READ_TIMEOUT_MS, readMediaAsDataUrl, withMediaDeadline } from "./media-operation";
const record = vi.hoisted(() => vi.fn());
vi.mock("@/core/observability/client-error-buffer", () => ({ recordClientError: record }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); record.mockClear(); });

it("reads file contents and releases its deadline", async () => {
  expect(await readMediaAsDataUrl(new Blob(["hello"], { type: "text/plain" }))).toBe("data:text/plain;base64,aGVsbG8=");
  expect(record).not.toHaveBeenCalled();
});
it("settles an aborted FileReader instead of leaving preparation pending", async () => {
  class AbortedReader {
    onabort: (() => void) | null = null;
    readAsDataURL() { queueMicrotask(() => this.onabort?.()); }
    abort() {}
  }
  vi.stubGlobal("FileReader", AbortedReader);
  await expect(readMediaAsDataUrl(new Blob(["private-file"]))).rejects.toMatchObject({ phase: "read", reason: "aborted" });
});
it("aborts a hung read and records only safe phase diagnostics", async () => {
  vi.useFakeTimers();
  const abort = vi.fn();
  class HungReader { readAsDataURL() {} abort = abort; }
  vi.stubGlobal("FileReader", HungReader);
  const outcome = readMediaAsDataUrl(new Blob(["private-file"])).catch(error => error);
  await vi.advanceTimersByTimeAsync(MEDIA_READ_TIMEOUT_MS);
  expect(await outcome).toMatchObject({ phase: "read", reason: "timeout" });
  expect(abort).toHaveBeenCalledOnce();
  expect(record.mock.calls[0][0].name).toBe("MediaOperation:read:timeout");
  expect(JSON.stringify(record.mock.calls)).not.toContain("private-file");
});
it("bounds and cancels a hung transport even if it ignores abort", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const outcome = withMediaDeadline("upload", captured => {
    signal = captured;
    return new Promise<string>(() => {});
  }, 50).catch(error => error);
  await vi.advanceTimersByTimeAsync(50);
  expect(await outcome).toMatchObject({ phase: "upload", reason: "timeout" });
  expect(signal?.aborted).toBe(true);
});
it("does not leak raw transport URL or token in diagnostics", async () => {
  await expect(withMediaDeadline("upload", async () => { throw new Error("https://private.invalid?token=secret"); })).rejects.toMatchObject({ phase: "upload", reason: "failed" });
  expect(record.mock.calls[0][0].message).not.toContain("secret");
  expect(record.mock.calls[0][0]).not.toHaveProperty("cause");
});
