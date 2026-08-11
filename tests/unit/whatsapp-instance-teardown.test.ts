/**
 * Unit tests for batched FK teardown before deleting a WhatsApp instance.
 *
 * Why this exists: the loop clears an `ON DELETE SET NULL` FK in short
 * statements, each its own transaction, instead of letting the delete hand the
 * whole table to one cascade statement.
 *
 * It was written for `whatsapp_messages` (~2.3M rows, seven indexes over
 * `instance_id`, 34 of 95 deletions dying on the statement timeout). That table
 * is no longer a target: its FK was dropped, so `instance_id` survives the
 * instance and the history stays visible in the chat. The remaining target is
 * `scheduled_user_messages.whatsapp_instance_id` — a pending-send queue, where
 * the batching is a bound rather than a cure.
 *
 * IO is injected — these tests touch no database.
 */

import { describe, it, expect } from "vitest";
import {
  nullifyInBatches,
  DEFAULT_BATCH_SIZE,
  type BatchNullifyIO,
} from "../../supabase/functions/_shared/whatsapp-instance-teardown.ts";

// ---------------------------------------------------------------------------
// Fake IO — an in-memory table of rows carrying the FK column
// ---------------------------------------------------------------------------

interface FakeCall {
  op: "select" | "nullify";
  limit?: number;
  ids?: string[];
}

function makeFakeIO(rowIds: string[]) {
  const remaining = new Set(rowIds);
  const calls: FakeCall[] = [];

  const io: BatchNullifyIO = {
    async selectIds(_table, _column, _value, limit) {
      calls.push({ op: "select", limit });
      return [...remaining].slice(0, limit);
    },
    async nullifyByIds(_table, _column, ids) {
      calls.push({ op: "nullify", ids: [...ids] });
      for (const id of ids) remaining.delete(id);
    },
  };

  return { io, calls, remaining };
}

function idsUpTo(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `row-${i}`);
}

const TARGET = {
  table: "scheduled_user_messages",
  column: "whatsapp_instance_id",
  value: "inst-abc",
};

// ---------------------------------------------------------------------------

describe("nullifyInBatches — drains every row", () => {
  it("clears the FK on all rows when the count is not a multiple of the batch size", async () => {
    const { io, remaining } = makeFakeIO(idsUpTo(2500));

    const result = await nullifyInBatches(io, { ...TARGET, batchSize: 1000 });

    expect(remaining.size).toBe(0);
    expect(result.rows).toBe(2500);
    expect(result.hitBatchCeiling).toBe(false);
  });

  it("never asks for more than the batch size in one statement", async () => {
    const { io, calls } = makeFakeIO(idsUpTo(2500));

    await nullifyInBatches(io, { ...TARGET, batchSize: 1000 });

    const nullifyCalls = calls.filter((c) => c.op === "nullify");
    expect(nullifyCalls.every((c) => (c.ids?.length ?? 0) <= 1000)).toBe(true);
    expect(nullifyCalls.map((c) => c.ids?.length)).toEqual([1000, 1000, 500]);
  });

  it("reports the batch count so the caller can log the real cost", async () => {
    const { io } = makeFakeIO(idsUpTo(2500));

    const result = await nullifyInBatches(io, { ...TARGET, batchSize: 1000 });

    expect(result.batches).toBe(3);
  });
});

describe("nullifyInBatches — nothing to do", () => {
  it("probes once and writes nothing when no row carries the FK", async () => {
    const { io, calls } = makeFakeIO([]);

    const result = await nullifyInBatches(io, { ...TARGET, batchSize: 1000 });

    expect(result.rows).toBe(0);
    expect(result.batches).toBe(0);
    expect(result.hitBatchCeiling).toBe(false);
    expect(calls.filter((c) => c.op === "nullify")).toHaveLength(0);
    expect(calls.filter((c) => c.op === "select")).toHaveLength(1);
  });
});

describe("nullifyInBatches — bounded work", () => {
  it("stops at maxBatches and flags hitBatchCeiling so the caller does not hog the pool", async () => {
    const { io, remaining } = makeFakeIO(idsUpTo(5000));

    const result = await nullifyInBatches(io, {
      ...TARGET,
      batchSize: 1000,
      maxBatches: 2,
    });

    expect(result.batches).toBe(2);
    expect(result.rows).toBe(2000);
    expect(result.hitBatchCeiling).toBe(true);
    // Remaining rows are left for the caller to decide about — the helper does
    // not silently pretend it finished.
    expect(remaining.size).toBe(3000);
  });

  it("does not flag hitBatchCeiling when the last batch happens to fill exactly", async () => {
    const { io, remaining } = makeFakeIO(idsUpTo(2000));

    const result = await nullifyInBatches(io, {
      ...TARGET,
      batchSize: 1000,
      maxBatches: 5,
    });

    expect(remaining.size).toBe(0);
    expect(result.hitBatchCeiling).toBe(false);
  });
});

describe("DEFAULT_BATCH_SIZE — bounded by URL length, not by database cost", () => {
  // The write filters on an explicit id list, and PostgREST carries that filter
  // in the request URL. A batch of 1000 UUIDs is ~38 KB of URL and comes back as
  // `414 URI Too Long` — trading one failure for another. This guard exists
  // because the injected fake cannot model a transport limit, so nothing else in
  // this file would catch the regression.
  const UUID_LENGTH = 36;
  const PER_ID_URL_COST = UUID_LENGTH + 3; // quoting + comma separator
  const CONSERVATIVE_URL_LIMIT_BYTES = 8_192;

  it("keeps the id-list filter comfortably under the smallest common URL ceiling", () => {
    const estimatedBytes = DEFAULT_BATCH_SIZE * PER_ID_URL_COST;

    expect(estimatedBytes).toBeLessThan(CONSERVATIVE_URL_LIMIT_BYTES);
  });

  it("is still large enough that a real pending-send queue drains within the batch ceiling", () => {
    // The whole `scheduled_user_messages` table holds tens of rows in
    // production; 10k pending sends on ONE instance is already an order of
    // magnitude past pathological, and it still drains in one call.
    const PATHOLOGICAL_QUEUE_ROWS = 10_000;

    expect(Math.ceil(PATHOLOGICAL_QUEUE_ROWS / DEFAULT_BATCH_SIZE)).toBeLessThan(
      500
    );
  });
});

describe("nullifyInBatches — surfaces IO failure", () => {
  it("propagates a write error instead of reporting success", async () => {
    const io: BatchNullifyIO = {
      async selectIds() {
        return ["row-0"];
      },
      async nullifyByIds() {
        throw new Error("statement timeout");
      },
    };

    await expect(
      nullifyInBatches(io, { ...TARGET, batchSize: 1000 })
    ).rejects.toThrow(/statement timeout/);
  });
});
