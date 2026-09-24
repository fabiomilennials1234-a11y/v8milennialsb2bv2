// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { applyMessageUpdate, isPureReceiptUpdate, normalizeMessageUpdatePayload } from "../../supabase/functions/whatsapp-webhook/message-update.ts";

const { completeQuotePresentations, logRuntime } = vi.hoisted(() => ({
  completeQuotePresentations: vi.fn(async () => {}), logRuntime: vi.fn(async () => {}),
}));
vi.mock("../../supabase/functions/_shared/quotes/presentation.ts", () => ({ completeQuotePresentations }));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime }));
const instance = { id: "instance-a", organization_id: "org-a", phone_number: "5511888888888" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const fetchMock = vi.fn();
const db = createClient("https://updates.example.com", "test-key", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchMock },
});
const urlAt = (index: number) => new URL(String(fetchMock.mock.calls[index][0]));
const bodyAt = (index: number) => JSON.parse(fetchMock.mock.calls[index][1].body);
const methodAt = (index: number) => fetchMock.mock.calls[index][1].method;
beforeEach(() => { fetchMock.mockReset(); completeQuotePresentations.mockClear(); logRuntime.mockClear(); });

function assertScope(url: URL) {
  expect(url.searchParams.get("organization_id")).toBe("eq.org-a");
  expect(url.searchParams.get("instance_id")).toBe("eq.instance-a");
}

describe("receipt HTTP contract", () => {
  it.each(["delivered", "pending", "failed", "sent"])("cannot replace read with late %s", async status => {
    fetchMock.mockImplementation(async () => json(null));
    await applyMessageUpdate(db, instance, { id: "message-a", status });
    for (let i = 0; i < fetchMock.mock.calls.length; i++) {
      if (methodAt(i) !== "PATCH") continue;
      assertScope(urlAt(i));
      expect(urlAt(i).searchParams.get("direction")).toBe("eq.outgoing");
      const predicate = urlAt(i).searchParams.get("status");
      expect(predicate).not.toBeNull();
      expect(predicate).not.toContain("read");
      expect(bodyAt(i).status).toBe(status);
    }
    if (status === "pending") expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows positive delivery to recover failed sends, scoped to every message candidate", async () => {
    fetchMock.mockImplementation(async () => json(null));
    await applyMessageUpdate(db, instance, { ids: ["message-a", "message-b"], status: "delivered" });
    const url = urlAt(0);
    assertScope(url);
    expect(url.searchParams.get("direction")).toBe("eq.outgoing");
    expect(url.searchParams.get("status")).toBe("in.(pending,sent,failed)");
    expect(url.searchParams.get("message_id")).toBe("in.(message-a,5511888888888:message-a,message-b,5511888888888:message-b)");
    expect(bodyAt(0)).toEqual({ status: "delivered" });
  });

  it.each(["sent", "delivered", "read", "played"])("completes commercial side effects even for duplicate %s receipts", async status => {
    fetchMock.mockImplementation(async (_input, init) => json(init.method === "PATCH" ? [] : [{ id: "row-a", status: "read" }])); // Duplicate receipt.
    await applyMessageUpdate(db, instance, { id: "message-a", status });
    await applyMessageUpdate(db, instance, { id: "message-a", status });
    expect(completeQuotePresentations).toHaveBeenCalledTimes(2);
    expect(completeQuotePresentations).toHaveBeenLastCalledWith(db, "org-a", "instance-a", ["message-a", "5511888888888:message-a"], { strict: true });
  });

  it("persists synthetic status without quote completion, including duplicate replay", async () => {
    fetchMock.mockImplementation(async (_input, init) => json(init.method === "PATCH" ? [{ id: "row-a" }] : [{ id: "row-a", status: "read" }]));
    await applyMessageUpdate(db, instance, { id: "message-a", status: "read", receipt_recovery: true },
      { suppressQuotePresentation: true });
    expect(fetchMock.mock.calls.some((_, index) => methodAt(index) === "PATCH" && bodyAt(index).status === "read")).toBe(true);
    expect(completeQuotePresentations).not.toHaveBeenCalled();
    await applyMessageUpdate(db, instance, { id: "message-a", status: "read", receipt_recovery: true },
      { suppressQuotePresentation: true });
    expect(completeQuotePresentations).not.toHaveBeenCalled();
  });

  it("ignores a provider-supplied recovery marker", async () => {
    fetchMock.mockImplementation(async () => json([]));
    await applyMessageUpdate(db, instance, { id: "message-a", status: "read", receipt_recovery: true });
    expect(completeQuotePresentations).toHaveBeenCalledOnce();
  });

  it("scopes trusted recovery to exact composite ID and chat, while ordinary receipts retain ID expansion", async () => {
    fetchMock.mockImplementation(async (_input, init) => json(init.method === "PATCH"
      ? [{ id: "composite-row" }]
      : [{ id: "composite-row", message_id: "owner:ABC", status: "sent", direction: "outgoing", reactions: [] }]));
    await applyMessageUpdate(db, instance, { id: "owner:ABC", chatid: "chat-a", status: "read", fromMe: false },
      { requireTarget: true, exactRecoveryMessageId: true, suppressQuotePresentation: true });
    const scoped = fetchMock.mock.calls.map((_, index) => urlAt(index));
    expect(scoped).toHaveLength(2);
    for (const url of scoped) {
      expect(url.searchParams.get("message_id")).toBe("in.(owner:ABC)");
      expect(url.searchParams.get("remote_jid")).toBe("eq.chat-a");
      expect(url.searchParams.get("direction")).toBe("eq.outgoing");
    }
    expect(completeQuotePresentations).not.toHaveBeenCalled();

    fetchMock.mockClear();
    await applyMessageUpdate(db, instance, { id: "owner:ABC", chatid: "chat-a", status: "read", fromMe: false },
      { requireTarget: true });
    const normalWrites = fetchMock.mock.calls.map((_, index) => urlAt(index));
    expect(normalWrites[0].searchParams.get("message_id")).toBe("in.(owner:ABC,ABC)");
    expect(normalWrites[1].searchParams.get("message_id")).toBe("in.(owner:ABC,ABC)");
    expect(normalWrites[1].searchParams.has("remote_jid")).toBe(false);
    expect(completeQuotePresentations).toHaveBeenCalledOnce();
  });

  it("rejects malformed trusted recovery scope before database access", async () => {
    for (const data of [
      { id: "owner:ABC", status: "read", fromMe: false },
      { id: "owner:ABC", chatid: "chat-a", status: "read", fromMe: false, ids: ["owner:ABC", "ABC"] },
      { id: "owner:ABC", chatid: "chat-a", status: "read", fromMe: false, pinned: true },
    ]) {
      await expect(applyMessageUpdate(db, instance, data, { requireTarget: true, exactRecoveryMessageId: true }))
        .rejects.toThrow("Recovery receipt scope unavailable");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("operator reads do not rewrite incoming status or seal outgoing quotes", async () => {
    await applyMessageUpdate(db, instance, { id: "message-a", status: "read", fromMe: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(completeQuotePresentations).not.toHaveBeenCalled();
  });

  it("propagates database failures before commercial completion", async () => {
    fetchMock.mockResolvedValue(json({ code: "42501", message: "denied" }, 403));
    await expect(applyMessageUpdate(db, instance, { id: "message-a", status: "read" })).rejects.toThrow("Receipt persistence failed");
    expect(completeQuotePresentations).not.toHaveBeenCalled();
  });
});

describe("bounded missing receipt policy", () => {
  const age = (ms: number) => ({ requireTarget: true, queuedEventCreatedAt: new Date(Date.now() - ms).toISOString(), unmatchedReceiptGraceMs: 300_000 });
  it("classifies normalized pure V2 receipts and rejects mixed mutations", () => {
    const normalized = normalizeMessageUpdatePayload({ event: { MessageIDs: ["message-a"], Type: "Read", IsFromMe: false, pinned: true } });
    expect(normalized.pinned).toBe(true);
    expect(isPureReceiptUpdate(normalized)).toBe(false);
    expect(isPureReceiptUpdate({ ids: ["message-a"], status: "read", fromMe: false })).toBe(true);
    expect(isPureReceiptUpdate({ ids: ["message-a", ""], status: "read" })).toBe(false);
    const emptyIds = normalizeMessageUpdatePayload({ event: { MessageIDs: [], messageid: "message-a", Type: "read" } });
    expect(emptyIds.id).toBe("message-a");
    expect(isPureReceiptUpdate(emptyIds)).toBe(true);
  });

  it("defers absent IDs during grace without delaying matched writes; audits after grace", async () => {
    fetchMock.mockImplementation(async (_input, init) => init.method === "GET"
      ? json([{ id: "row-a", message_id: "message-a", status: "sent", direction: "outgoing", reactions: [] }])
      : json([{ id: "row-a" }]));
    const update = { ids: ["message-a", "outside-crm"], status: "read" };
    expect(await applyMessageUpdate(db, instance, update, age(299_000)))
      .toEqual({ outcome: "deferred_receipt", unmatchedCount: 1 });
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(1);
    fetchMock.mockClear();
    const result = await applyMessageUpdate(db, instance, update, age(301_000));
    expect(result).toEqual({ outcome: "unmatched_receipt", unmatchedCount: 1 });
    const patch = fetchMock.mock.calls.find(([, init]) => init.method === "PATCH");
    expect(patch).toBeDefined();
    const candidates = new URL(String(patch![0])).searchParams.get("message_id");
    expect(candidates).toContain("message-a");
    expect(candidates).not.toContain("outside-crm");
    expect(completeQuotePresentations).toHaveBeenCalledTimes(2);
    expect(completeQuotePresentations.mock.lastCall?.[3]).not.toContain("outside-crm");
  });

  it("records all absent IDs after grace without claiming a write", async () => {
    fetchMock.mockResolvedValue(json([]));
    expect(await applyMessageUpdate(db, instance, { id: "outside-crm", status: "delivered" }, age(301_000)))
      .toEqual({ outcome: "unmatched_receipt", unmatchedCount: 1 });
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(0);
    expect(completeQuotePresentations).not.toHaveBeenCalled();
  });

  it("defers an entirely absent pure receipt before grace without business writes", async () => {
    fetchMock.mockResolvedValue(json([]));
    expect(await applyMessageUpdate(db, instance, { id: "outside-crm", status: "sent" }, age(1_000)))
      .toEqual({ outcome: "deferred_receipt", unmatchedCount: 1 });
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(0);
  });

  it("never relaxes invalid time, mixed mutations or database failure", async () => {
    fetchMock.mockResolvedValue(json([]));
    const missing = { id: "outside-crm", status: "read" };
    await expect(applyMessageUpdate(db, instance, missing, { requireTarget: true, queuedEventCreatedAt: "invalid", unmatchedReceiptGraceMs: 300_000 }))
      .rejects.toThrow("Message update target unavailable");
    await expect(applyMessageUpdate(db, instance, { ...missing, pinned: true }, age(301_000)))
      .rejects.toThrow("Message update target unavailable");
    fetchMock.mockResolvedValue(json({ code: "42501", message: "denied" }, 403));
    await expect(applyMessageUpdate(db, instance, missing, age(301_000)))
      .rejects.toThrow("Message update target unavailable");
  });
});

describe("reaction replay and concurrency over HTTP", () => {
  const own = { emoji: "👍", from: "sender-a", count: 1 };
  const other = { emoji: "❤️", from: "sender-b", count: 1 };
  it("does not increment a reaction on repeated delivery", async () => {
    fetchMock.mockImplementation(async () => json([{ id: "row-a", reactions: [own] }]));
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: { emoji: "👍", from: "sender-a" } });
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: { emoji: "👍", from: "sender-a" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    assertScope(urlAt(0));
  });

  it("rereads after a compare-and-swap conflict and preserves another sender's reaction", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", reactions: [] }]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: "row-a", reactions: [other] }))
      .mockResolvedValueOnce(json([{ id: "row-a" }]));
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: own });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(urlAt(1).searchParams.get("reactions")).toBe("eq.[]");
    expect(urlAt(3).searchParams.get("reactions")).toBe(`eq.${JSON.stringify([other])}`);
    expect(bodyAt(3)).toEqual({ reactions: [other, own] });
    for (let i = 0; i < 4; i++) assertScope(urlAt(i));
    expect(urlAt(3).searchParams.get("id")).toBe("eq.row-a");
  });

  it("uses IS NULL when no previous reactions exist", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", reactions: null }]))
      .mockResolvedValueOnce(json([{ id: "row-a" }]));
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: own });
    expect(urlAt(1).searchParams.get("reactions")).toBe("is.null");
    expect(bodyAt(1).reactions).toEqual([own]);
  });

  it("stops after three conflicting writes and propagates contention for retry", async () => {
    fetchMock.mockImplementation(async (_input, init) => init.method === "PATCH" ? json([])
      : new URL(String(_input)).searchParams.has("id") ? json({ id: "row-a", reactions: [] })
      : json([{ id: "row-a", reactions: [] }]));
    await expect(applyMessageUpdate(db, instance, { id: "message-a", reaction: own })).rejects.toThrow("Reaction update contention");
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(3);
  });

  it.each(["lookup", "write", "reread"])("propagates a %s failure instead of acknowledging a lost reaction", async step => {
    const failure = json({ code: "42501", message: "denied" }, 403);
    if (step === "lookup") fetchMock.mockResolvedValueOnce(failure);
    if (step === "write") fetchMock.mockResolvedValueOnce(json([{ id: "row-a", reactions: [] }])).mockResolvedValueOnce(failure);
    if (step === "reread") fetchMock.mockResolvedValueOnce(json([{ id: "row-a", reactions: [] }])).mockResolvedValueOnce(json([])).mockResolvedValueOnce(failure);
    await expect(applyMessageUpdate(db, instance, { id: "message-a", reaction: own })).rejects.toThrow(/Reaction (targets unavailable|update persistence failed|target disappeared)/);
  });
});

describe("edit, deletion and pin persistence", () => {
  it.each(["deleted", "pinned"])("does not move the first %s timestamp on replay", async flag => {
    fetchMock.mockImplementation(async () => json(null));
    await applyMessageUpdate(db, instance, { id: "message-a", [flag]: true });
    await applyMessageUpdate(db, instance, { id: "message-a", [flag]: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 2; i++) {
      assertScope(urlAt(i));
      expect(urlAt(i).searchParams.get(`${flag}_at`)).toBe("is.null");
      expect(Number.isNaN(Date.parse(bodyAt(i)[`${flag}_at`]))).toBe(false);
    }
  });

  it("unpins only previously pinned targets and keeps tenant scope", async () => {
    fetchMock.mockResolvedValueOnce(json(null));
    await applyMessageUpdate(db, instance, { id: "message-a", pinned: false });
    assertScope(urlAt(0));
    expect(urlAt(0).searchParams.get("pinned_at")).toBe("not.is.null");
    expect(bodyAt(0)).toEqual({ pinned_at: null });
  });

  it.each([{ edited: true }, { deleted: true }, { pinned: true }])("propagates failed update %j", async event => {
    fetchMock.mockResolvedValueOnce(json({ code: "42501", message: "denied" }, 403));
    await expect(applyMessageUpdate(db, instance, { id: "message-a", ...event })).rejects.toThrow(/persistence failed/);
  });
});


describe("durable target availability", () => {
  it.each([
    {}, { status: "vendor-new-status" }, { status: "constructor" }, { status: "__proto__" },
    { status: "" }, { status: 3 }, { status: null },
    { status: "vendor-new-status", pinned: true }, { status: "read", pinned: "false" },
    { status: "read", edited: 1 }, { status: "read", fromMe: "true" },
    { status: "read", reactions: {} },
  ])("retains unknown or partially malformed durable operations before writes: %j", async operation => {
    await expect(applyMessageUpdate(db, instance, { id: "message-a", ...operation }, { requireTarget: true }))
      .rejects.toThrow("Message update operation unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(completeQuotePresentations).not.toHaveBeenCalled();
  });

  it("validates a bundled reaction before persisting its otherwise valid receipt", async () => {
    await expect(applyMessageUpdate(db, instance, { id: "message-a", status: "read", reaction: {} }, { requireTarget: true }))
      .rejects.toThrow("Invalid reaction emoji");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ status: "pending" }, { status: "read", fromMe: true }, { edited: false }, { deleted: false }])(
    "preserves recognized durable no-ops: %j", async operation => {
      await applyMessageUpdate(db, instance, { id: "message-a", ...operation }, { requireTarget: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(completeQuotePresentations).not.toHaveBeenCalled();
    },
  );

  it.each([{ pinned: true }, { pinned: false }, { edited: true }, { deleted: true }, { reactions: [] }, { reaction: { emoji: "👍" } }])(
    "accepts valid durable operations without a receipt status: %j", async operation => {
      fetchMock.mockImplementation(async () => json([{ id: "row-a", message_id: "message-a", reactions: [] }]));
      await applyMessageUpdate(db, instance, { id: "message-a", ...operation }, { requireTarget: true });
      expect(fetchMock.mock.calls.some(([, init]) => init.method === "PATCH")).toBe(true);
      expect(completeQuotePresentations).not.toHaveBeenCalled();
    },
  );

  it("keeps unknown statuses permissive for the Edge caller", async () => {
    await applyMessageUpdate(db, instance, { id: "message-a", status: "vendor-new-status" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {}, { ids: [] }, { id: "" }, { id: "   " }, { id: 123 },
    { ids: ["message-a", null] }, { ids: ["message-a", 123] },
    { ids: ["message-a", ""] }, { ids: ["message-a", "   "] },
    { ids: "message-a", id: "message-a" },
  ])("retains malformed durable identifiers without partial writes: %j", async identifiers => {
    await expect(applyMessageUpdate(db, instance, { ...identifiers, status: "read" }, { requireTarget: true }))
      .rejects.toThrow("Message update identifiers unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(completeQuotePresentations).not.toHaveBeenCalled();
  });

  it("keeps the Edge caller's permissive parsing of missing and partially invalid IDs", async () => {
    await applyMessageUpdate(db, instance, { status: "read" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a" }]));
    await applyMessageUpdate(db, instance, { ids: ["message-a", null], status: "read" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bodyAt(0)).toEqual({ status: "read" });
    expect(completeQuotePresentations).toHaveBeenCalledOnce();
  });

  it.each([{ id: "message-a" }, { messageid: "message-a" }, { key: { id: "message-a" } }, { ids: [], id: "message-a" }])(
    "accepts supported durable scalar identifiers: %j", async identifiers => {
      fetchMock.mockResolvedValueOnce(json([{ id: "row-a", message_id: "message-a" }]))
        .mockResolvedValueOnce(json([{ id: "row-a" }]));
      await applyMessageUpdate(db, instance, { ...identifiers, status: "read" }, { requireTarget: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(bodyAt(1)).toEqual({ status: "read" });
    },
  );

  it.each([{ status: "read" }, { edited: true }, { deleted: true }, { pinned: true }, { reaction: { emoji: "👍", from: "a" } }])("retries an event before its target exists: %j", async event => {
    fetchMock.mockImplementation(async () => json([]));
    await expect(applyMessageUpdate(db, instance, { id: "message-a", ...event }, { requireTarget: true })).rejects.toThrow("Message update target unavailable");
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    expect(completeQuotePresentations).not.toHaveBeenCalled();
    assertScope(urlAt(0));
  });

  it("processes a deferred receipt after its target is created", async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    await expect(applyMessageUpdate(db, instance, { id: "message-a", status: "delivered" }, { requireTarget: true })).rejects.toThrow("target unavailable");
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", message_id: "5511888888888:message-a", status: "sent" }]))
      .mockResolvedValueOnce(json([{ id: "row-a" }]));
    await applyMessageUpdate(db, instance, { id: "message-a", status: "delivered" }, { requireTarget: true });
    expect(methodAt(2)).toBe("PATCH");
    expect(bodyAt(2)).toEqual({ status: "delivered" });
    expect(completeQuotePresentations).toHaveBeenCalledTimes(1);
  });

  it("reuses durable target direction for a duplicate read and still completes quotes", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", message_id: "message-a", status: "read", direction: "outgoing" }]))
      .mockResolvedValueOnce(json([]));
    await applyMessageUpdate(db, instance, { id: "message-a", status: "read" }, { requireTarget: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(methodAt(0)).toBe("GET");
    expect(urlAt(0).searchParams.get("select")).toContain("direction");
    expect(methodAt(1)).toBe("PATCH");
    expect(urlAt(1).searchParams.get("status")).toBe("in.(pending,sent,delivered,failed)");
    expect(logRuntime).not.toHaveBeenCalled();
    expect(completeQuotePresentations).toHaveBeenCalledOnce();
  });

  it("logs unmatched outgoing receipt using durable incoming target without another lookup", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", message_id: "message-a", status: "read", direction: "incoming" }]))
      .mockResolvedValueOnce(json([]));
    await applyMessageUpdate(db, instance, { id: "message-a", status: "read" }, { requireTarget: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "uazapi_receipt_unmatched" }));
    expect(completeQuotePresentations).toHaveBeenCalledOnce();
  });

  it("reuses durable reaction snapshot while retaining compare-and-swap", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", message_id: "message-a", reactions: [], direction: "incoming" }]))
      .mockResolvedValueOnce(json([{ id: "row-a" }]));
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: { emoji: "👍", from: "a" } }, { requireTarget: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(methodAt(0)).toBe("GET");
    expect(methodAt(1)).toBe("PATCH");
    expect(urlAt(1).searchParams.get("reactions")).toBe("eq.[]");
    assertScope(urlAt(1));
  });

  it("retains missing historical-target behavior for the Edge caller", async () => {
    fetchMock.mockImplementation(async () => json([]));
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: { emoji: "👍", from: "a" } });
    expect(logRuntime).toHaveBeenCalledWith(expect.objectContaining({ action: "uazapi_reaction_update_unmatched", status: "skipped" }));
  });

  it("rejects partially available multi-ID receipts rather than losing the missing message", async () => {
    fetchMock.mockImplementation(async () => json([{ id: "row-a", message_id: "5511888888888:message-a", status: "sent" }]));
    await expect(applyMessageUpdate(db, instance, { ids: ["message-a", "message-b"], status: "read" }, { requireTarget: true })).rejects.toThrow("target unavailable");
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("propagates commercial completion errors so a duplicate can retry the effect", async () => {
    fetchMock.mockImplementation(async () => json([{ id: "row-a", status: "read" }]));
    completeQuotePresentations.mockRejectedValueOnce(new Error("quote persistence failed"));
    await expect(applyMessageUpdate(db, instance, { id: "message-a", status: "read" })).rejects.toThrow("quote persistence failed");
    await applyMessageUpdate(db, instance, { id: "message-a", status: "read" });
    expect(completeQuotePresentations).toHaveBeenCalledTimes(2);
  });
});

describe("reaction assignment semantics", () => {
  it("preserves a provider aggregate count on duplicate deltas", async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", reactions: [{ emoji: "👍", from: "a", count: 3 }] }]));
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: { emoji: "👍", from: "a" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(methodAt(0)).toBe("GET");
  });

  it("removes only the matching sender and emoji", async () => {
    const keep = { emoji: "👍", from: "b", count: 1 };
    const previous = [{ emoji: "👍", from: "a", count: 1 }, keep];
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", reactions: previous }]))
      .mockResolvedValueOnce(json([{ id: "row-a" }]));
    await applyMessageUpdate(db, instance, { id: "message-a", reaction: { emoji: "👍", from: "a", remove: true } });
    expect(bodyAt(1)).toEqual({ reactions: [keep] });
    expect(urlAt(1).searchParams.get("reactions")).toBe(`eq.${JSON.stringify(previous)}`);
  });

  it("merges each matched row against its own reactions", async () => {
    const previous = { emoji: "❤️", from: "b", count: 1 };
    const added = { emoji: "👍", from: "a", count: 1 };
    fetchMock.mockResolvedValueOnce(json([{ id: "row-a", reactions: [] }, { id: "row-b", reactions: [previous] }]))
      .mockResolvedValueOnce(json([{ id: "row-a" }]))
      .mockResolvedValueOnce(json([{ id: "row-b" }]));
    await applyMessageUpdate(db, instance, { ids: ["message-a", "message-b"], reaction: added });
    expect(urlAt(1).searchParams.get("id")).toBe("eq.row-a");
    expect(urlAt(2).searchParams.get("id")).toBe("eq.row-b");
    expect(bodyAt(1).reactions).toEqual([added]);
    expect(bodyAt(2).reactions).toEqual([previous, added]);
  });

  it("accepts all durable targets using bare or owner-prefixed IDs", async () => {
    fetchMock.mockResolvedValueOnce(json([
      { id: "row-a", message_id: "5511888888888:message-a" },
      { id: "row-b", message_id: "message-b" },
    ])).mockResolvedValueOnce(json([{ id: "row-a" }, { id: "row-b" }]));
    await applyMessageUpdate(db, instance, { ids: ["message-a", "message-b"], status: "delivered" }, { requireTarget: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyAt(1)).toEqual({ status: "delivered" });
  });
});
