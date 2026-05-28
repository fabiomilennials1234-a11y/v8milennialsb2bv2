import { describe, it, expect, vi, beforeEach } from "vitest";
import "../helpers/deno-mock";

const handlerCalls: Array<unknown> = [];
let handlerImpl: (sb: unknown, ev: unknown) => Promise<void> = async () => {};

vi.mock("../../supabase/functions/_shared/events/registry.ts", () => ({
  getHandler: (eventType: string) =>
    eventType === "lead.stage_changed"
      ? async (sb: unknown, ev: unknown) => {
          handlerCalls.push(ev);
          await handlerImpl(sb, ev);
        }
      : null,
  handlers: {},
}));

vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  captureMessage: vi.fn(async () => {}),
  captureError: vi.fn(async () => {}),
  withSentry: (_n: string, h: unknown) => h,
}));

import { dispatchPending } from "../../supabase/functions/_shared/events/dispatch";

// In-memory fake of `from('domain_events')` chain limited a query + update.
function makeFakeSupabase(pending: Array<Record<string, unknown>>) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const supabase = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_field: string, _value: string) => ({
          order: (_o: string, _opts: unknown) => ({
            limit: (_n: number) => Promise.resolve({ data: pending, error: null }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_field: string, value: string) => {
          updates.push({ id: value, patch });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  } as unknown as Parameters<typeof dispatchPending>[0] extends infer T ? T : never;

  return { supabase, updates };
}

describe("dispatchPending", () => {
  beforeEach(() => {
    handlerCalls.length = 0;
    handlerImpl = async () => {};
  });

  it("chama handler do tipo e marca evento como dispatched", async () => {
    const { supabase, updates } = makeFakeSupabase([
      {
        id: "evt-1",
        organization_id: "org-1",
        event_type: "lead.stage_changed",
        aggregate_type: "pipeline_entry",
        aggregate_id: "pe-1",
        payload: { lead_id: "lead-1", new_stage_key: "abordado" },
        metadata: {},
        status: "pending",
        published_at: "2026-05-28T00:00:00Z",
        attempts: 0,
      },
    ]);

    const result = await dispatchPending({ supabase: supabase as never });

    expect(result.scanned).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(0);
    expect(handlerCalls).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({ status: "dispatched", attempts: 1, last_error: null });
  });

  it("marca evento como failed quando handler lança", async () => {
    handlerImpl = async () => {
      throw new Error("downstream boom");
    };

    const { supabase, updates } = makeFakeSupabase([
      {
        id: "evt-2",
        organization_id: "org-1",
        event_type: "lead.stage_changed",
        aggregate_type: "pipeline_entry",
        aggregate_id: "pe-2",
        payload: {},
        metadata: {},
        status: "pending",
        published_at: "2026-05-28T00:00:01Z",
        attempts: 0,
      },
    ]);

    const result = await dispatchPending({ supabase: supabase as never });

    expect(result.dispatched).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({ id: "evt-2", error: "downstream boom" });
    expect(updates[0].patch).toMatchObject({ status: "failed", attempts: 1 });
    expect((updates[0].patch.last_error as string)).toContain("downstream boom");
  });

  it("marca failed quando não há handler registrado", async () => {
    const { supabase, updates } = makeFakeSupabase([
      {
        id: "evt-unknown",
        organization_id: "org-1",
        event_type: "unknown.event",
        aggregate_type: "x",
        aggregate_id: null,
        payload: {},
        metadata: {},
        status: "pending",
        published_at: "2026-05-28T00:00:02Z",
        attempts: 0,
      },
    ]);

    const result = await dispatchPending({ supabase: supabase as never });

    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toBe("no-handler");
    expect(updates[0].patch.last_error).toContain("No handler registered");
  });
});
