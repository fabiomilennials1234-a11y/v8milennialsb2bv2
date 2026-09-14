import { describe, expect, it, vi } from "vitest";
import { persistHistoryBatches } from "../../supabase/functions/history-sync-worker/persistence";
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ message_id: String(i) }));
describe("bounded history persistence", () => {
  it("writes 100 new messages in four sequential batches", async () => {
    const write = vi.fn(async (_batch: { message_id: string }[]) => ({ error: null }));
    expect(await persistHistoryBatches(rows(100), new Set(), write)).toEqual({
      accepted: 100,
      error: null,
      retryable: false,
    });
    expect(write).toHaveBeenCalledTimes(4);
    expect(write.mock.calls.every((call) => call[0].length === 25)).toBe(true);
  });
  it("does not rewrite existing messages or their receipts/reactions", async () => {
    const write = vi.fn(async (_batch: { message_id: string }[]) => ({ error: null }));
    expect(
      await persistHistoryBatches(rows(100), new Set(rows(100).map((r) => r.message_id)), write),
    ).toEqual({ accepted: 100, error: null, retryable: false });
    expect(write).not.toHaveBeenCalled();
  });
  it("isolates one invalid row while preserving the other rows in its batch", async () => {
    const write = vi.fn(async (batch: { message_id: string }[]) => ({
      error: batch.some((r) => r.message_id === "2")
        ? { code: "22007", message: "invalid timestamp" }
        : null,
    }));
    expect(await persistHistoryBatches(rows(5), new Set(), write)).toEqual({
      accepted: 4,
      error: "invalid timestamp",
      retryable: false,
    });
  });
  it("does not fan out retries on database pressure", async () => {
    const write = vi.fn(async () => ({
      error: { code: "53300", message: "too many connections" },
    }));
    expect(await persistHistoryBatches(rows(100), new Set(), write)).toEqual({
      accepted: 0,
      error: "too many connections",
      retryable: true,
    });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("deduplicates pending IDs without reporting failed duplicates as accepted", async () => {
    const write = vi.fn(async () => ({ error: { code: "22007", message: "invalid" } }));
    expect(
      await persistHistoryBatches([{ message_id: "x" }, { message_id: "x" }], new Set(), write),
    ).toEqual({ accepted: 0, error: "invalid", retryable: false });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("replays a partially persisted page without rewriting accepted messages", async () => {
    const stored = new Set<string>();
    let unavailable = true;
    const write = vi.fn(async (batch: { message_id: string }[]) => {
      if (stored.size >= 25 && unavailable) return { error: { code: "57014", message: "timeout" } };
      batch.forEach((row) => stored.add(row.message_id));
      return { error: null };
    });
    expect(await persistHistoryBatches(rows(100), stored, write)).toEqual({
      accepted: 25,
      error: "timeout",
      retryable: true,
    });
    unavailable = false;
    write.mockClear();
    expect(await persistHistoryBatches(rows(100), stored, write)).toEqual({
      accepted: 100,
      error: null,
      retryable: false,
    });
    expect(write).toHaveBeenCalledTimes(3);
    expect(stored.size).toBe(100);
  });
  it("stops after a thrown network error", async () => {
    const write = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await persistHistoryBatches(rows(100), new Set(), write)).toEqual({
      accepted: 0,
      error: "network down",
      retryable: true,
    });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("stops recursive isolation if database pressure interrupts the split", async () => {
    const write = vi.fn()
      .mockResolvedValueOnce({ error: { code: "22007", message: "invalid" } })
      .mockResolvedValueOnce({ error: { code: "53300", message: "pressure" } });
    expect(await persistHistoryBatches(rows(100), new Set(), write)).toEqual({
      accepted: 0,
      error: "pressure",
      retryable: true,
    });
    expect(write).toHaveBeenCalledTimes(2);
  });
});
