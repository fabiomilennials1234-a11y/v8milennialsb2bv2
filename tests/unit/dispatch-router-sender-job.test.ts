// @vitest-environment node
/**
 * runUazapiSenderJob — persistence + fail-loud contract (B2).
 *
 * Verified Uazapi /sender/advanced CREATE response (2026-06-15):
 *   { count: number, folder_id: string, status: string }
 *
 * The router MUST:
 *  - read res.folder_id (NOT res.sender_id) and persist it as uazapi_sender_id
 *    — otherwise mass-send-status.refreshJob early-returns on the null id and the
 *    job is stuck in "queued" forever.
 *  - use res.count (messages ACCEPTED) for total_messages, falling back to the
 *    recipient count only when count is absent.
 *  - THROW when folder_id is missing OR count === 0 (Uazapi accepted nothing —
 *    e.g. items dispatched without `type`) instead of writing an unpollable
 *    queued row with total_messages = 0.
 *
 * The provider is mocked at the whatsapp-client boundary so no network/provider
 * is exercised; only the router's read-of-the-response + persistence logic is
 * under test.
 *
 * RED phase: current dispatch-router.ts reads res.sender_id and never throws on
 * count===0, so these fail until B2 lands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetProvider } = vi.hoisted(() => ({ mockGetProvider: vi.fn() }));

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: mockGetProvider,
}));

const { runUazapiSenderJob } = await import(
  "../../supabase/functions/_shared/dispatch-router.ts"
);

const INSTANCE = { id: "inst-1", organization_id: "org-1", provider: "uazapi" } as any;

/** Minimal Supabase admin stub capturing the inserted uazapi_sender_jobs row. */
function supabaseStub() {
  const captured: { insertedRow?: any } = {};
  return {
    captured,
    from(_table: string) {
      return {
        insert(row: any) {
          captured.insertedRow = row;
          return {
            select: () => ({
              single: async () => ({ data: { id: "job-row-1" }, error: null }),
            }),
          };
        },
      };
    },
  } as any;
}

/** Fake provider whose senderAdvanced returns the REAL CREATE shape. */
function providerReturning(res: Record<string, unknown>) {
  return { senderAdvanced: vi.fn(async () => res) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runUazapiSenderJob — reads folder_id + count (B2)", () => {
  it("persists uazapi_sender_id from res.folder_id (not res.sender_id)", async () => {
    mockGetProvider.mockResolvedValue(
      providerReturning({ folder_id: "fld-xyz", count: 3, status: "scheduled" }),
    );
    const supabase = supabaseStub();

    const out = await runUazapiSenderJob(supabase, INSTANCE, {
      recipients: [
        { number: "5511999990001", type: "text", text: "a" },
        { number: "5511999990002", type: "text", text: "b" },
        { number: "5511999990003", type: "text", text: "c" },
      ],
    });

    expect(supabase.captured.insertedRow.uazapi_sender_id).toBe("fld-xyz");
    expect(out.uazapi_sender_id).toBe("fld-xyz");
    expect(out.sender_job_id).toBe("job-row-1");
  });

  it("uses res.count for total_messages (messages accepted by Uazapi)", async () => {
    // count (2) intentionally differs from recipients.length (3) to prove the
    // accepted-count is authoritative, not the local recipient tally.
    mockGetProvider.mockResolvedValue(
      providerReturning({ folder_id: "fld-xyz", count: 2, status: "scheduled" }),
    );
    const supabase = supabaseStub();

    await runUazapiSenderJob(supabase, INSTANCE, {
      recipients: [
        { number: "5511999990001", type: "text", text: "a" },
        { number: "5511999990002", type: "text", text: "b" },
        { number: "5511999990003", type: "text", text: "c" },
      ],
    });

    expect(supabase.captured.insertedRow.total_messages).toBe(2);
  });
});

describe("runUazapiSenderJob — dispatch provenance in payload (ADR-0016 §3, #945)", () => {
  it("persists {plan_id, lot_index} into the payload jsonb when the input carries them (blast-plan origin)", async () => {
    mockGetProvider.mockResolvedValue(
      providerReturning({ folder_id: "fld-plan", count: 1, status: "scheduled" }),
    );
    const supabase = supabaseStub();

    await runUazapiSenderJob(supabase, INSTANCE, {
      recipients: [{ number: "5511999990001", type: "text", text: "a" }],
      trackSource: "blast-plan",
      planId: "plan-42",
      lotIndex: 3,
    });

    // The plan→folder link (ADR-0016): the poll reads these to trace failures
    // back to blast_plan_recipients. lot_index 0 must survive too (falsy guard).
    expect(supabase.captured.insertedRow.payload.plan_id).toBe("plan-42");
    expect(supabase.captured.insertedRow.payload.lot_index).toBe(3);
  });

  it("persists lot_index 0 (creation lot) — falsy-zero must not be dropped", async () => {
    mockGetProvider.mockResolvedValue(
      providerReturning({ folder_id: "fld-lot0", count: 1, status: "scheduled" }),
    );
    const supabase = supabaseStub();

    await runUazapiSenderJob(supabase, INSTANCE, {
      recipients: [{ number: "5511999990001", type: "text", text: "a" }],
      trackSource: "blast-plan",
      planId: "plan-42",
      lotIndex: 0,
    });

    expect(supabase.captured.insertedRow.payload.plan_id).toBe("plan-42");
    expect(supabase.captured.insertedRow.payload.lot_index).toBe(0);
  });

  it("does NOT add plan_id/lot_index for non-plan jobs (Quick Blast avulso / campaign) — payload unchanged", async () => {
    mockGetProvider.mockResolvedValue(
      providerReturning({ folder_id: "fld-qb", count: 1, status: "scheduled" }),
    );
    const supabase = supabaseStub();

    await runUazapiSenderJob(supabase, INSTANCE, {
      recipients: [{ number: "5511999990001", type: "text", text: "a" }],
      trackSource: "quick-blast",
    });

    expect(supabase.captured.insertedRow.payload).not.toHaveProperty("plan_id");
    expect(supabase.captured.insertedRow.payload).not.toHaveProperty("lot_index");
  });
});

describe("runUazapiSenderJob — fails loud, never persists an unpollable row (B2)", () => {
  it("throws when Uazapi accepts zero messages (count === 0)", async () => {
    mockGetProvider.mockResolvedValue(
      providerReturning({ folder_id: "fld-empty", count: 0, status: "scheduled" }),
    );
    const supabase = supabaseStub();

    await expect(
      runUazapiSenderJob(supabase, INSTANCE, {
        recipients: [{ number: "5511999990001", type: "text", text: "a" }],
      }),
    ).rejects.toThrow(/uazapi_no_messages_accepted|no messages accepted|count/i);

    // Must NOT have written a queued row with total_messages = 0.
    expect(supabase.captured.insertedRow).toBeUndefined();
  });

  it("throws when the CREATE response has no folder_id", async () => {
    mockGetProvider.mockResolvedValue(
      providerReturning({ count: 3, status: "scheduled" }), // folder_id missing
    );
    const supabase = supabaseStub();

    await expect(
      runUazapiSenderJob(supabase, INSTANCE, {
        recipients: [{ number: "5511999990001", type: "text", text: "a" }],
      }),
    ).rejects.toThrow();

    expect(supabase.captured.insertedRow).toBeUndefined();
  });

  it("throws when the response still carries the legacy sender_id but no folder_id", async () => {
    // Guards against a regression where the API contract is misread and a row is
    // persisted with uazapi_sender_id = undefined (the original stuck-in-queued bug).
    mockGetProvider.mockResolvedValue(
      providerReturning({ sender_id: "snd-legacy", status: "queued", total: 3 }),
    );
    const supabase = supabaseStub();

    await expect(
      runUazapiSenderJob(supabase, INSTANCE, {
        recipients: [{ number: "5511999990001", type: "text", text: "a" }],
      }),
    ).rejects.toThrow();

    expect(supabase.captured.insertedRow).toBeUndefined();
  });
});
