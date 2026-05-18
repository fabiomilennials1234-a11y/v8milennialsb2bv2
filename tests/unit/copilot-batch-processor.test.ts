/**
 * TDD tests for copilot-batch-processor batch maturity logic.
 * Strict red-green-refactor — one test at a time.
 */

import { describe, it, expect } from "vitest";
import {
  checkBatchMaturity,
  BATCH_IDLE_WINDOW_MS,
  BATCH_ABSOLUTE_CAP_MS,
  type BatchInfo,
} from "../../supabase/functions/_shared/copilot-batch-maturity.ts";

describe("checkBatchMaturity", () => {
  const now = new Date("2026-05-18T12:00:00Z");

  it("returns mature (idle_window) when last msg > 5s ago", () => {
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: new Date(now.getTime() - 10_000), // 10s ago
      newestQueuedAt: new Date(now.getTime() - 6_000),  // 6s ago (> 5s idle)
      messageCount: 3,
    };

    const result = checkBatchMaturity(batch, now);

    expect(result.isMature).toBe(true);
    expect(result.reason).toBe("idle_window");
  });

  it("returns not_ready when last msg < 5s ago and first msg < 15s ago", () => {
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: new Date(now.getTime() - 8_000),  // 8s ago (< 15s cap)
      newestQueuedAt: new Date(now.getTime() - 2_000),  // 2s ago (< 5s idle)
      messageCount: 2,
    };

    const result = checkBatchMaturity(batch, now);

    expect(result.isMature).toBe(false);
    expect(result.reason).toBe("not_ready");
  });

  it("returns mature (absolute_cap) when first msg > 15s ago even if last msg is recent", () => {
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: new Date(now.getTime() - 16_000), // 16s ago (> 15s cap)
      newestQueuedAt: new Date(now.getTime() - 1_000),  // 1s ago (< 5s idle)
      messageCount: 5,
    };

    const result = checkBatchMaturity(batch, now);

    expect(result.isMature).toBe(true);
    expect(result.reason).toBe("absolute_cap");
  });

  it("returns not_ready for empty batch (messageCount=0)", () => {
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: now,
      newestQueuedAt: now,
      messageCount: 0,
    };

    const result = checkBatchMaturity(batch, now);

    expect(result.isMature).toBe(false);
    expect(result.reason).toBe("not_ready");
  });

  it("returns mature (idle_window) for single message > 5s ago", () => {
    const queuedAt = new Date(now.getTime() - 7_000); // 7s ago
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: queuedAt,
      newestQueuedAt: queuedAt, // same — single msg
      messageCount: 1,
    };

    const result = checkBatchMaturity(batch, now);

    expect(result.isMature).toBe(true);
    expect(result.reason).toBe("idle_window");
  });

  it("treats exactly 5s idle as mature (boundary)", () => {
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: new Date(now.getTime() - 10_000),
      newestQueuedAt: new Date(now.getTime() - BATCH_IDLE_WINDOW_MS), // exactly 5s
      messageCount: 2,
    };

    const result = checkBatchMaturity(batch, now);
    expect(result.isMature).toBe(true);
    expect(result.reason).toBe("idle_window");
  });

  it("treats exactly 15s oldest as mature (boundary)", () => {
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: new Date(now.getTime() - BATCH_ABSOLUTE_CAP_MS), // exactly 15s
      newestQueuedAt: new Date(now.getTime() - 1_000), // 1s ago
      messageCount: 4,
    };

    const result = checkBatchMaturity(batch, now);
    expect(result.isMature).toBe(true);
    expect(result.reason).toBe("absolute_cap");
  });

  it("idle_window takes precedence over absolute_cap when both match", () => {
    const batch: BatchInfo = {
      batchKey: "5511999999999:org-1",
      oldestQueuedAt: new Date(now.getTime() - 20_000), // 20s ago (> 15s cap)
      newestQueuedAt: new Date(now.getTime() - 8_000),  // 8s ago (> 5s idle)
      messageCount: 3,
    };

    const result = checkBatchMaturity(batch, now);
    expect(result.isMature).toBe(true);
    expect(result.reason).toBe("idle_window"); // idle checked first
  });
});
