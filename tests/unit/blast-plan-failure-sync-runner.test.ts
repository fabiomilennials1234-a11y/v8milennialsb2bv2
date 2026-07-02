// @vitest-environment node
/**
 * Blast Plan failure-sync runner — syncFolderFailures (ADR-0016, #948).
 *
 * The deep logic: the mass-send-status poll refreshes a sender job's
 * aggregates, then hands the job row to this orchestration seam. The runner
 * gates on the dispatch provenance ({plan_id, lot_index} in the job payload,
 * #945), fetches the folder's Failed messages through the provider seam,
 * fetches the plan/lot's `sent` recipients through the store seam, computes
 * the transitions with the pure core (#947) and applies them — and it NEVER
 * throws: any provider/store error is captured in the result so the job
 * refresh contract (HTTP 200) is preserved by construction.
 *
 * Same fake-deps style as the rest of the blast-plan suite: deps in, result
 * out, zero I/O.
 */

import { describe, it, expect, vi } from "vitest";

const { syncFolderFailures } = await import(
  "../../supabase/functions/_shared/quick-blast/failure-sync-runner.ts"
);

/** A folder message as /sender/listmessages returns it (spike #943 shape). */
const msg = (chatid: string, status: string, error = "") => ({ chatid, status, error });

const PROVENANCE = { plan_id: "plan-1", lot_index: 0 };

/** uazapi_sender_jobs row projection the poll hands the runner. */
const job = (payload: unknown = { ...PROVENANCE }, uazapi_sender_id: string | null = "fld-1") => ({
  uazapi_sender_id,
  payload,
});

/** Happy-path deps: 1 Failed message, 1 matching `sent` recipient. */
function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    listFolderFailedMessages: vi
      .fn()
      .mockResolvedValue([msg("5511987654321@s.whatsapp.net", "Failed", "invalid jid")]),
    getSentRecipients: vi
      .fn()
      .mockResolvedValue([{ lead_id: "lead-1", phone: "11987654321", status: "sent" }]),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("syncFolderFailures — tracer bullet", () => {
  it("flips the matching sent recipient to failed with the canonical reason", async () => {
    const deps = makeDeps();

    const result = await syncFolderFailures(deps, job());

    expect(deps.listFolderFailedMessages).toHaveBeenCalledWith("fld-1");
    expect(deps.getSentRecipients).toHaveBeenCalledWith("plan-1", 0);
    expect(deps.markFailed).toHaveBeenCalledTimes(1);
    expect(deps.markFailed).toHaveBeenCalledWith({
      plan_id: "plan-1",
      lot_index: 0,
      lead_id: "lead-1",
      reason: "invalid_number",
      error: "invalid jid",
    });
    expect(result).toEqual({ synced: 1 });
  });
});

describe("syncFolderFailures — provenance gating (ADR-0016 §3)", () => {
  it.each([
    ["payload without provenance keys", { trackSource: "quick-blast" }],
    ["null payload", null],
    ["non-object payload", "plan-1"],
    ["provenance without lot_index", { plan_id: "plan-1" }],
  ])("skips a job with %s without touching provider or store", async (_, payload) => {
    const deps = makeDeps();

    const result = await syncFolderFailures(deps, job(payload));

    expect(deps.listFolderFailedMessages).not.toHaveBeenCalled();
    expect(deps.getSentRecipients).not.toHaveBeenCalled();
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, skipped: "no_provenance" });
  });
});

describe("syncFolderFailures — provider capability gating", () => {
  it("skips silently when the provider does not expose per-message listing (non-Uazapi)", async () => {
    const deps = makeDeps({ listFolderFailedMessages: undefined });

    const result = await syncFolderFailures(deps, job());

    expect(deps.getSentRecipients).not.toHaveBeenCalled();
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, skipped: "provider_unsupported" });
  });

  it("skips a job without a provider folder id", async () => {
    const deps = makeDeps();

    const result = await syncFolderFailures(deps, job({ ...PROVENANCE }, null));

    expect(deps.listFolderFailedMessages).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, skipped: "no_folder_id" });
  });
});

describe("syncFolderFailures — never breaks the job refresh", () => {
  it("captures a provider error without throwing and without touching rows", async () => {
    const deps = makeDeps({
      listFolderFailedMessages: vi.fn().mockRejectedValue(new Error("uazapi 500")),
    });

    const result = await syncFolderFailures(deps, job());

    expect(deps.getSentRecipients).not.toHaveBeenCalled();
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, error: "uazapi 500" });
  });

  it("captures a store read error without throwing", async () => {
    const deps = makeDeps({
      getSentRecipients: vi.fn().mockRejectedValue(new Error("db down")),
    });

    const result = await syncFolderFailures(deps, job());

    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, error: "db down" });
  });

  it("captures a store write error mid-batch, keeping the transitions already applied", async () => {
    const deps = makeDeps({
      listFolderFailedMessages: vi.fn().mockResolvedValue([
        msg("5511987654321@s.whatsapp.net", "Failed", "invalid jid"),
        msg("5521999998888@s.whatsapp.net", "Failed", "number banned"),
      ]),
      getSentRecipients: vi.fn().mockResolvedValue([
        { lead_id: "lead-1", phone: "11987654321", status: "sent" },
        { lead_id: "lead-2", phone: "21999998888", status: "sent" },
      ]),
      markFailed: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("write conflict")),
    });

    const result = await syncFolderFailures(deps, job());

    expect(deps.markFailed).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ synced: 1, error: "write conflict" });
  });
});

describe("syncFolderFailures — fast paths", () => {
  it("does not fetch recipients when the folder reports zero failures", async () => {
    const deps = makeDeps({ listFolderFailedMessages: vi.fn().mockResolvedValue([]) });

    const result = await syncFolderFailures(deps, job());

    expect(deps.getSentRecipients).not.toHaveBeenCalled();
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0 });
  });

  it("applies nothing when failures match no sent recipient (already failed / other lot)", async () => {
    const deps = makeDeps({
      getSentRecipients: vi
        .fn()
        .mockResolvedValue([{ lead_id: "lead-9", phone: "31900000000", status: "sent" }]),
    });

    const result = await syncFolderFailures(deps, job());

    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0 });
  });
});
