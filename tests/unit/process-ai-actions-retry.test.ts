// @vitest-environment node
/**
 * Unit tests for process-ai-actions retry with exponential backoff.
 *
 * Validates the retry logic extracted from process-ai-actions/index.ts:
 * - Backoff escalation: 1min → 5min → 15min
 * - Dead letter after MAX_RETRIES (3)
 * - Status transitions: pending → processing → (pending w/ backoff | dead_letter)
 * - Claim RPC respects next_retry_at
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [1, 5, 15];

interface ActionRecord {
  id: string;
  organization_id: string;
  lead_id: string | null;
  action_type: string;
  payload: Record<string, unknown>;
  retry_count: number;
  next_retry_at: string | null;
  status: string;
}

interface Stats {
  completed: number;
  failed: number;
  rescheduled: number;
  dead_letter: number;
}

function computeRetryOutcome(
  action: ActionRecord,
  errorMessage: string,
): { status: string; retry_count: number; next_retry_at: string | null; error_message: string } {
  const currentRetry = action.retry_count || 0;
  const nextRetry = currentRetry + 1;

  if (nextRetry >= MAX_RETRIES) {
    return {
      status: "dead_letter",
      retry_count: nextRetry,
      next_retry_at: null,
      error_message: errorMessage,
    };
  }

  const backoffMinutes = RETRY_BACKOFF_MINUTES[currentRetry] || 15;
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();

  return {
    status: "pending",
    retry_count: nextRetry,
    next_retry_at: nextRetryAt,
    error_message: errorMessage,
  };
}

function computeBackoffMinutes(retryCount: number): number {
  return RETRY_BACKOFF_MINUTES[retryCount] || 15;
}

function shouldClaimAction(action: { status: string; next_retry_at: string | null }): boolean {
  if (action.status !== "pending") return false;
  if (action.next_retry_at === null) return true;
  return new Date(action.next_retry_at) <= new Date();
}

describe("AI Actions retry — backoff escalation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
  });

  const baseAction: ActionRecord = {
    id: "action-1",
    organization_id: "org-1",
    lead_id: "lead-1",
    action_type: "schedule_meeting",
    payload: {},
    retry_count: 0,
    next_retry_at: null,
    status: "processing",
  };

  it("first failure → status=pending, retry_count=1, backoff=1min", () => {
    const result = computeRetryOutcome({ ...baseAction, retry_count: 0 }, "timeout");

    expect(result.status).toBe("pending");
    expect(result.retry_count).toBe(1);
    expect(result.next_retry_at).not.toBeNull();

    const retryAt = new Date(result.next_retry_at!);
    const expectedAt = new Date("2026-05-17T12:01:00Z");
    expect(retryAt.getTime()).toBe(expectedAt.getTime());
  });

  it("second failure → status=pending, retry_count=2, backoff=5min", () => {
    const result = computeRetryOutcome({ ...baseAction, retry_count: 1 }, "api_error");

    expect(result.status).toBe("pending");
    expect(result.retry_count).toBe(2);

    const retryAt = new Date(result.next_retry_at!);
    const expectedAt = new Date("2026-05-17T12:05:00Z");
    expect(retryAt.getTime()).toBe(expectedAt.getTime());
  });

  it("third failure → dead_letter, retry_count=3", () => {
    const result = computeRetryOutcome({ ...baseAction, retry_count: 2 }, "permanent_error");

    expect(result.status).toBe("dead_letter");
    expect(result.retry_count).toBe(3);
    expect(result.next_retry_at).toBeNull();
    expect(result.error_message).toBe("permanent_error");
  });

  it("backoff minutes escalate correctly: [1, 5, 15]", () => {
    expect(computeBackoffMinutes(0)).toBe(1);
    expect(computeBackoffMinutes(1)).toBe(5);
    expect(computeBackoffMinutes(2)).toBe(15);
  });

  it("out-of-bounds retry_count defaults to 15min backoff", () => {
    expect(computeBackoffMinutes(99)).toBe(15);
  });
});

describe("AI Actions retry — claim eligibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
  });

  it("pending with null next_retry_at → eligible", () => {
    expect(shouldClaimAction({ status: "pending", next_retry_at: null })).toBe(true);
  });

  it("pending with past next_retry_at → eligible", () => {
    expect(shouldClaimAction({ status: "pending", next_retry_at: "2026-05-17T11:59:00Z" })).toBe(true);
  });

  it("pending with future next_retry_at → NOT eligible", () => {
    expect(shouldClaimAction({ status: "pending", next_retry_at: "2026-05-17T12:05:00Z" })).toBe(false);
  });

  it("dead_letter → never eligible", () => {
    expect(shouldClaimAction({ status: "dead_letter", next_retry_at: null })).toBe(false);
  });

  it("completed → never eligible", () => {
    expect(shouldClaimAction({ status: "completed", next_retry_at: null })).toBe(false);
  });

  it("processing → never eligible", () => {
    expect(shouldClaimAction({ status: "processing", next_retry_at: null })).toBe(false);
  });
});

describe("AI Actions retry — stats accounting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
  });

  const baseAction: ActionRecord = {
    id: "action-1",
    organization_id: "org-1",
    lead_id: "lead-1",
    action_type: "schedule_meeting",
    payload: {},
    retry_count: 0,
    next_retry_at: null,
    status: "processing",
  };

  function applyRetryToStats(action: ActionRecord, stats: Stats): void {
    const result = computeRetryOutcome(action, "error");
    if (result.status === "dead_letter") {
      stats.dead_letter++;
    } else {
      stats.failed++;
    }
  }

  it("retryable failure increments stats.failed", () => {
    const stats: Stats = { completed: 0, failed: 0, rescheduled: 0, dead_letter: 0 };
    applyRetryToStats({ ...baseAction, retry_count: 0 }, stats);
    expect(stats.failed).toBe(1);
    expect(stats.dead_letter).toBe(0);
  });

  it("exhausted retries increments stats.dead_letter", () => {
    const stats: Stats = { completed: 0, failed: 0, rescheduled: 0, dead_letter: 0 };
    applyRetryToStats({ ...baseAction, retry_count: 2 }, stats);
    expect(stats.dead_letter).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("full lifecycle: 3 failures → 2 failed + 1 dead_letter", () => {
    const stats: Stats = { completed: 0, failed: 0, rescheduled: 0, dead_letter: 0 };
    applyRetryToStats({ ...baseAction, retry_count: 0 }, stats);
    applyRetryToStats({ ...baseAction, retry_count: 1 }, stats);
    applyRetryToStats({ ...baseAction, retry_count: 2 }, stats);
    expect(stats.failed).toBe(2);
    expect(stats.dead_letter).toBe(1);
  });
});
