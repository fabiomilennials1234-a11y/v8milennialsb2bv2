// @vitest-environment node
/**
 * Blast Plan failure sync core — computeFailedTransitions (ADR-0016, #947).
 *
 * The deep logic: the mass-send-status poll fetches a sender folder's
 * per-message statuses from the provider; this pure core receives those
 * messages plus the plan/lot's `sent` recipients and computes the
 * `sent → failed` transitions, mapping the provider's free-text error onto a
 * canonical failure reason. Matching is by phone within the folder (a folder
 * belongs to exactly one plan+lot dispatch — ADR-0016 §2), with Brazilian
 * phone normalization (with/without 55, with/without the 9th digit).
 *
 * Zero provider/store awareness: data in, transitions out — same pure-core
 * style as the rest of the blast-plan suite.
 */

import { describe, it, expect } from "vitest";

const { computeFailedTransitions, classifyFailureReason } = await import(
  "../../supabase/functions/_shared/quick-blast/failure-sync.ts"
);

/** A folder message as /sender/listmessages returns it (spike #943 shape). */
const msg = (chatid: string, status: string, error = "") => ({ chatid, status, error });

/** A blast_plan_recipients row projection the poll hands the core. */
const recipient = (lead_id: string, phone: string | null, status = "sent") => ({
  lead_id,
  phone,
  status,
});

const PROVENANCE = { plan_id: "plan-1", lot_index: 0 };

const folder = (messages: unknown, ...provenanceOverride: [unknown] | []) => ({
  provenance: provenanceOverride.length > 0 ? provenanceOverride[0] : PROVENANCE,
  messages,
});

describe("classifyFailureReason — canonical reason mapping", () => {
  it.each([
    // invalid/unregistered numbers → invalid_number
    ["number is not on WhatsApp", "invalid_number"],
    ["no account found for this number", "invalid_number"],
    ["recipient unregistered", "invalid_number"],
    ["invalid jid", "invalid_number"],
    ["contact not found", "invalid_number"],
    // instance connectivity → instance_disconnected
    ["instance disconnected", "instance_disconnected"],
    ["client is not connected", "instance_disconnected"],
    ["session logged out", "instance_disconnected"],
    ["unauthorized", "instance_disconnected"],
    // ban/spam/limits → provider_rejected
    ["number banned", "provider_rejected"],
    ["blocked by recipient", "provider_rejected"],
    ["flagged as spam", "provider_rejected"],
    ["rate exceeded", "provider_rejected"],
    ["daily limit reached", "provider_rejected"],
    ["403 forbidden", "provider_rejected"],
    // anything else (including empty) → provider_error
    ["something exploded", "provider_error"],
    ["", "provider_error"],
  ])("classifies %j as %s", (error, expected) => {
    expect(classifyFailureReason(error)).toBe(expected);
  });
});

describe("computeFailedTransitions — tracer bullet", () => {
  it("maps one Failed message onto the matching sent recipient as a failed transition with reason", () => {
    const transitions = computeFailedTransitions(
      folder([msg("5511987654321@s.whatsapp.net", "Failed", "number not on whatsapp")]),
      [recipient("lead-1", "11987654321")],
    );

    expect(transitions).toEqual([
      {
        plan_id: "plan-1",
        lot_index: 0,
        lead_id: "lead-1",
        reason: "invalid_number",
        error: "number not on whatsapp",
      },
    ]);
  });
});

describe("computeFailedTransitions — matching", () => {
  it("ignores a Failed message whose phone matches no recipient", () => {
    const transitions = computeFailedTransitions(
      folder([msg("5511987654321@s.whatsapp.net", "Failed", "boom")]),
      [recipient("lead-1", "11911112222")],
    );
    expect(transitions).toEqual([]);
  });

  it("only reclassifies sent recipients — already-failed rows stay untouched (idempotent re-poll)", () => {
    const transitions = computeFailedTransitions(
      folder([msg("5511987654321@s.whatsapp.net", "Failed", "boom")]),
      [recipient("lead-1", "11987654321", "failed")],
    );
    expect(transitions).toEqual([]);
  });

  it("never reclassifies pending or skipped recipients", () => {
    const messages = [msg("5511987654321@s.whatsapp.net", "Failed", "boom")];
    for (const status of ["pending", "skipped"]) {
      expect(
        computeFailedTransitions(folder(messages), [recipient("lead-1", "11987654321", status)]),
      ).toEqual([]);
    }
  });

  it("skips recipients without a phone", () => {
    const transitions = computeFailedTransitions(
      folder([msg("5511987654321@s.whatsapp.net", "Failed", "boom")]),
      [recipient("lead-1", null)],
    );
    expect(transitions).toEqual([]);
  });
});

describe("computeFailedTransitions — defensive parsing (spike #943 caveat: doc↔server drift)", () => {
  const SENT = [recipient("lead-1", "11987654321")];

  it.each([
    ["non-array messages", "nope"],
    ["null messages", null],
    ["undefined messages", undefined],
  ])("returns empty for %s", (_, messages) => {
    expect(computeFailedTransitions(folder(messages), SENT)).toEqual([]);
  });

  it.each([
    ["a non-object item", ["boom"]],
    ["a null item", [null]],
    ["a message without chatid", [{ status: "Failed", error: "x" }]],
    ["a non-string chatid", [{ chatid: 123, status: "Failed", error: "x" }]],
    ["a non-string status", [{ chatid: "5511987654321@s.whatsapp.net", status: 7, error: "x" }]],
  ])("skips %s without throwing", (_, messages) => {
    expect(computeFailedTransitions(folder(messages), SENT)).toEqual([]);
  });

  it("treats a missing/non-string error as empty text (provider_error)", () => {
    const transitions = computeFailedTransitions(
      folder([{ chatid: "5511987654321@s.whatsapp.net", status: "Failed" }]),
      SENT,
    );
    expect(transitions).toEqual([
      { plan_id: "plan-1", lot_index: 0, lead_id: "lead-1", reason: "provider_error", error: "" },
    ]);
  });

  it("emits a single transition per recipient even if the folder repeats the phone", () => {
    const transitions = computeFailedTransitions(
      folder([
        msg("5511987654321@s.whatsapp.net", "Failed", "first"),
        msg("5511987654321@s.whatsapp.net", "Failed", "second"),
      ]),
      SENT,
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0].error).toBe("first");
  });

  it("handles multiple failures in one folder independently", () => {
    const transitions = computeFailedTransitions(
      folder([
        msg("5511987654321@s.whatsapp.net", "Failed", "invalid jid"),
        msg("5521999998888@s.whatsapp.net", "Sent"),
        msg("5531988887777@s.whatsapp.net", "Failed", "number banned"),
      ]),
      [
        recipient("lead-1", "11987654321"),
        recipient("lead-2", "21999998888"),
        recipient("lead-3", "31988887777"),
      ],
    );
    expect(transitions).toEqual([
      { plan_id: "plan-1", lot_index: 0, lead_id: "lead-1", reason: "invalid_number", error: "invalid jid" },
      { plan_id: "plan-1", lot_index: 0, lead_id: "lead-3", reason: "provider_rejected", error: "number banned" },
    ]);
  });
});

describe("computeFailedTransitions — folder provenance gating (ADR-0016 §3)", () => {
  const FAILED = [msg("5511987654321@s.whatsapp.net", "Failed", "boom")];
  const SENT = [recipient("lead-1", "11987654321")];

  it("ignores a folder with no provenance key at all", () => {
    expect(computeFailedTransitions({ messages: FAILED }, SENT)).toEqual([]);
  });

  it.each([
    ["undefined provenance", undefined as unknown],
    ["null provenance", null],
    ["provenance without plan_id", { lot_index: 0 }],
    ["provenance without lot_index", { plan_id: "plan-1" }],
    ["non-string plan_id", { plan_id: 42, lot_index: 0 }],
    ["non-numeric lot_index", { plan_id: "plan-1", lot_index: "0" }],
    ["non-object provenance", "plan-1"],
  ])("ignores a folder with %s (pre-link legacy folders — no heuristic retrofit)", (_, provenance) => {
    expect(computeFailedTransitions(folder(FAILED, provenance), SENT)).toEqual([]);
  });
});

describe("computeFailedTransitions — Brazilian phone normalization", () => {
  it.each([
    // [chatid phone, recipient phone] — every pairing must match lead-1
    ["5511987654321", "11987654321"], // 55 vs bare
    ["11987654321", "5511987654321"], // bare vs 55
    ["551187654321", "11987654321"], // 55 without 9th digit vs 11-digit
    ["5511987654321", "1187654321"], // 55+9th digit vs 10-digit legacy
    ["5511987654321", "+55 (11) 98765-4321"], // formatted recipient
  ])("matches chatid %s against recipient phone %s", (jidPhone, recipientPhone) => {
    const transitions = computeFailedTransitions(
      folder([msg(`${jidPhone}@s.whatsapp.net`, "Failed", "boom")]),
      [recipient("lead-1", recipientPhone)],
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0].lead_id).toBe("lead-1");
  });
});

describe("computeFailedTransitions — provider status lifecycle", () => {
  it.each(["Queued", "Canceled", "Sent", "Delivered", "Read"])(
    "never reclassifies a %s message (only explicit Failed does)",
    (status) => {
      const transitions = computeFailedTransitions(
        folder([msg("5511987654321@s.whatsapp.net", status)]),
        [recipient("lead-1", "11987654321")],
      );
      expect(transitions).toEqual([]);
    },
  );

  it("ignores unknown status values (open enum — unknown is never a failure)", () => {
    const transitions = computeFailedTransitions(
      folder([msg("5511987654321@s.whatsapp.net", "SomethingNew")]),
      [recipient("lead-1", "11987654321")],
    );
    expect(transitions).toEqual([]);
  });
});
