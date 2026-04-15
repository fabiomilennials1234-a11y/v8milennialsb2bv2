/**
 * Tests for _shared/ai-queue.ts — copilot action queue with idempotency.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import {
  enqueueAiAction,
  enqueueAiActions,
} from "../../supabase/functions/_shared/ai-queue";

type InsertResponse = { data: { id: string } | null; error: unknown };

function makeSupabase(responses: InsertResponse[]) {
  const inserted: unknown[] = [];
  const queue = [...responses];
  const sb = {
    from: () => ({
      insert: (row: unknown) => {
        inserted.push(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                queue.shift() ?? { data: null, error: { message: "no mock" } },
              ),
          }),
        };
      },
    }),
  } as any;
  return { sb, inserted };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── enqueueAiAction ──────────────────────────────────────────────────────

describe("enqueueAiAction", () => {
  it("returns queued=true with id on success", async () => {
    const { sb, inserted } = makeSupabase([
      { data: { id: "q-1" }, error: null },
    ]);
    const result = await enqueueAiAction(sb, {
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: "conv-1",
      actionType: "schedule_meeting",
      payload: { preferred_date: "2026-06-01" },
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ queued: true, id: "q-1" });
    expect((inserted[0] as Record<string, unknown>).action_type).toBe(
      "schedule_meeting",
    );
    expect((inserted[0] as Record<string, unknown>).idempotency_key).toBe(
      "idem-1",
    );
  });

  it("nulls optional fields when not provided", async () => {
    const { sb, inserted } = makeSupabase([
      { data: { id: "q-2" }, error: null },
    ]);
    await enqueueAiAction(sb, {
      organizationId: "org-1",
      actionType: "transfer_to_human",
      payload: {},
    });
    const row = inserted[0] as Record<string, unknown>;
    expect(row.lead_id).toBeNull();
    expect(row.conversation_id).toBeNull();
    expect(row.idempotency_key).toBeNull();
  });

  it("treats 23505 duplicate as non-error", async () => {
    const { sb } = makeSupabase([
      { data: null, error: { code: "23505", message: "duplicate key" } },
    ]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await enqueueAiAction(sb, {
      organizationId: "org-1",
      actionType: "x",
      payload: {},
      idempotencyKey: "dup-1",
    });
    expect(result).toEqual({
      queued: false,
      reason: "duplicate_idempotency_key",
    });
    spy.mockRestore();
  });

  it("returns error reason on generic DB error", async () => {
    const { sb } = makeSupabase([
      { data: null, error: { code: "23502", message: "not null violation" } },
    ]);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await enqueueAiAction(sb, {
      organizationId: "org-1",
      actionType: "x",
      payload: {},
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toContain("not null violation");
    spy.mockRestore();
  });

  it("catches thrown errors and returns stringified reason", async () => {
    const sb = {
      from: () => {
        throw new Error("connection dropped");
      },
    } as any;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await enqueueAiAction(sb, {
      organizationId: "org-1",
      actionType: "x",
      payload: {},
    });
    expect(result.queued).toBe(false);
    expect(result.reason).toContain("connection dropped");
    spy.mockRestore();
  });
});

// ─── enqueueAiActions (batch) ─────────────────────────────────────────────

describe("enqueueAiActions", () => {
  it("enqueues each action sequentially and returns array of results", async () => {
    const { sb } = makeSupabase([
      { data: { id: "a1" }, error: null },
      { data: null, error: { code: "23505", message: "dup" } },
      { data: { id: "a3" }, error: null },
    ]);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const results = await enqueueAiActions(sb, [
      { organizationId: "org-1", actionType: "t1", payload: {} },
      {
        organizationId: "org-1",
        actionType: "t2",
        payload: {},
        idempotencyKey: "k",
      },
      { organizationId: "org-1", actionType: "t3", payload: {} },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].queued).toBe(true);
    expect(results[1].queued).toBe(false);
    expect(results[1].reason).toBe("duplicate_idempotency_key");
    expect(results[2].queued).toBe(true);
    spy.mockRestore();
  });

  it("returns empty array for empty input", async () => {
    const { sb } = makeSupabase([]);
    expect(await enqueueAiActions(sb, [])).toEqual([]);
  });
});
