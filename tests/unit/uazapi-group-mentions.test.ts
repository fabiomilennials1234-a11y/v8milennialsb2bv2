// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_MENTIONS,
  normalizeGroupParticipants,
  sanitizeMentions,
} from "../../supabase/functions/_shared/group-mentions.ts";
import { extractChatTarget } from "../../supabase/functions/_shared/chat-owner-guard.ts";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts";

const GROUP = "120363404701403742@g.us";
const A = "5548999990001";
const B = "5548999990002";

describe("sanitizeMentions", () => {
  it("passes valid numbers through for a group destination", () => {
    expect(sanitizeMentions(GROUP, [A, B])).toEqual([A, B]);
  });
  it("accepts the legacy group JID format", () => {
    expect(sanitizeMentions("554899999999-1600000000@g.us", [A])).toEqual([A]);
  });
  it.each([
    ["phone destination", "5548999990001"],
    ["phone JID", "5548999990001@s.whatsapp.net"],
    ["lid", "59738817577139@lid"],
    ["suffix injection", `${GROUP}.evil`],
    ["missing", undefined],
  ])("drops the list outside a valid group (%s)", (_label, number) => {
    expect(sanitizeMentions(number, [A])).toBeUndefined();
  });
  it("drops invalid items silently and keeps the rest", () => {
    expect(sanitizeMentions(GROUP, [A, "abc", "123", "5548-9999", 42, null, `${B},999`, " " + B + " "])).toEqual([A, B]);
  });
  it("returns undefined when nothing valid remains or payload is malformed", () => {
    expect(sanitizeMentions(GROUP, ["x", "1"])).toBeUndefined();
    expect(sanitizeMentions(GROUP, [])).toBeUndefined();
    expect(sanitizeMentions(GROUP, A)).toBeUndefined();
    expect(sanitizeMentions(GROUP, { 0: A })).toBeUndefined();
  });
  it("dedups", () => {
    expect(sanitizeMentions(GROUP, [A, A, B, A])).toEqual([A, B]);
  });
  it("collapses to all when all is present (exact match only)", () => {
    expect(sanitizeMentions(GROUP, [A, "all", B])).toEqual(["all"]);
    expect(sanitizeMentions(GROUP, ["ALL", "all,1"])).toBeUndefined();
  });
  it("caps at MAX_MENTIONS", () => {
    const many = Array.from({ length: 80 }, (_, i) => `55489999${String(i).padStart(5, "0")}`);
    const out = sanitizeMentions(GROUP, many)!;
    expect(out).toHaveLength(MAX_MENTIONS);
    expect(out[0]).toBe(many[0]);
  });
});

describe("normalizeGroupParticipants", () => {
  it("keeps only phone, lid, name and admin flag", () => {
    const out = normalizeGroupParticipants({
      JID: GROUP, Name: "Grupo", OwnerJID: "x", InviteLink: "https://chat.whatsapp.com/x",
      Participants: [
        { JID: `${A}@s.whatsapp.net`, LID: "111111111@lid", PhoneNumber: `${A}@s.whatsapp.net`, IsAdmin: true, IsSuperAdmin: false, DisplayName: " Ana " , Extra: "x" },
        { JID: "222222222@lid", LID: "222222222@lid", PhoneNumber: "", IsAdmin: false, IsSuperAdmin: true, DisplayName: "" },
        { JID: `${B}:12@s.whatsapp.net`, IsAdmin: false },
      ],
    });
    expect(out).toEqual([
      { phone: A, lid: "111111111@lid", name: "Ana", isAdmin: true },
      { phone: null, lid: "222222222@lid", name: null, isAdmin: true },
      { phone: B, lid: null, name: null, isAdmin: false },
    ]);
    expect(JSON.stringify(out)).not.toContain("InviteLink");
  });
  it("tolerates null participants, wrappers and garbage", () => {
    expect(normalizeGroupParticipants({ Participants: null })).toEqual([]);
    expect(normalizeGroupParticipants(null)).toEqual([]);
    expect(normalizeGroupParticipants("x")).toEqual([]);
    expect(normalizeGroupParticipants({ group: { Participants: [{ PhoneNumber: A }] } })).toEqual([
      { phone: A, lid: null, name: null, isAdmin: false },
    ]);
  });
  it("drops rows without identity and duplicates", () => {
    const out = normalizeGroupParticipants({ Participants: [
      { DisplayName: "Sem id" }, null, "x",
      { PhoneNumber: A, DisplayName: "Ana" },
      { JID: `${A}@s.whatsapp.net`, DisplayName: "Ana dup" },
      { PhoneNumber: "abc@s.whatsapp.net" },
    ] });
    expect(out).toEqual([{ phone: A, lid: null, name: "Ana", isAdmin: false }]);
  });
  it("truncates long names", () => {
    const [p] = normalizeGroupParticipants({ Participants: [{ PhoneNumber: A, DisplayName: "x".repeat(500) }] });
    expect(p.name).toHaveLength(80);
  });
});

describe("groupParticipants goes through the chat owner gate", () => {
  it("targets the group JID", () => {
    expect(extractChatTarget("groupParticipants", { groupjid: GROUP })).toEqual({ leadId: null, rawPhone: GROUP, messageId: null });
  });
  it("ignores number/lead_id/message_id so an allowed phone cannot unlock another group", () => {
    expect(extractChatTarget("groupParticipants", { groupjid: GROUP, number: "5548999990001", lead_id: "l1", message_id: "m1" }))
      .toEqual({ leadId: null, rawPhone: GROUP, messageId: null });
    expect(extractChatTarget("groupParticipants", { number: "5548999990001" })).toEqual({ leadId: null, rawPhone: null, messageId: null });
  });
});

// ── Contract against the vendor spec ─────────────────────────────────────────
type Operation = { required: string[]; fields: Record<string, { type?: string }> };
const { operations } = JSON.parse(readFileSync(new URL("../fixtures/uazapi/operations-2.1.1.json", import.meta.url), "utf8")) as { operations: Record<string, Operation> };
const config = { baseUrl: "https://contract.uazapi.test", token: "instance-a", adminToken: "admin-a" };
const message = { id: "message-1", status: "sent", timestamp: 1700000000 };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function assertContract() {
  for (const [url, init] of vi.mocked(fetch).mock.calls) {
    const path = new URL(String(url)).pathname;
    const op = operations[`${init?.method} ${path}`];
    expect(op, `${init?.method} ${path}`).toBeDefined();
    const body = JSON.parse(String(init?.body));
    for (const name of op.required) expect(body).toHaveProperty(name);
    for (const [name, value] of Object.entries(body)) {
      expect(op.fields[name], `${path}: undocumented ${name}`).toBeDefined();
      const t = op.fields[name].type;
      if (t === "integer") expect(Number.isInteger(value)).toBe(true);
      else if (t && t !== "array") expect(typeof value).toBe(t);
    }
  }
}
const bodyOf = (i: number) => JSON.parse(String(vi.mocked(fetch).mock.calls[i][1]?.body));
const provider = () => new UazapiProvider({ ...config, instanceId: "instance-id", organizationId: "org-id", supabaseAdmin: {} as never });

describe("UazapiProvider mentions + group info (contract)", () => {
  beforeEach(() => { vi.stubGlobal("Deno", { env: { get: () => undefined } }); UazapiClient._resetCircuitState(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("sends mentions as a comma-joined string on /send/text", async () => {
    vi.mocked(fetch).mockImplementation(async () => response(message));
    await provider().sendText({ number: GROUP, text: `oi @${A} @${B}`, mentions: [A, B] });
    assertContract();
    expect(bodyOf(0).mentions).toBe(`${A},${B}`);
  });
  it("sends mentions as a string on /send/media", async () => {
    vi.mocked(fetch).mockImplementation(async () => response(message));
    await provider().sendMedia({ number: GROUP, type: "image", file: "https://x.test/a.png", caption: `@${A}`, mentions: [A] });
    assertContract();
    expect(bodyOf(0).mentions).toBe(A);
  });
  it("payload without mentions is unchanged (no mentions key)", async () => {
    vi.mocked(fetch).mockImplementation(async () => response(message));
    await provider().sendText({ number: GROUP, text: "oi" });
    await provider().sendText({ number: GROUP, text: "oi", mentions: [] });
    await provider().sendMedia({ number: GROUP, type: "image", file: "https://x.test/a.png", caption: "c" });
    expect(bodyOf(0)).not.toHaveProperty("mentions");
    expect(bodyOf(1)).not.toHaveProperty("mentions");
    expect(bodyOf(2)).not.toHaveProperty("mentions");
    expect(bodyOf(0)).toEqual(bodyOf(1));
  });
  it("reads /group/info with only the documented groupjid and returns lean participants", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ JID: GROUP, Participants: [{ JID: `${A}@s.whatsapp.net`, PhoneNumber: `${A}@s.whatsapp.net`, DisplayName: "Ana", IsAdmin: false }] }));
    const out = await provider().getGroupParticipants(GROUP);
    assertContract();
    expect(bodyOf(0)).toEqual({ groupjid: GROUP });
    expect(out).toEqual([{ phone: A, lid: null, name: "Ana", isAdmin: false }]);
  });
  it("a failing group read does not open the send circuit breaker", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes("/group/info") ? new Response("{}", { status: 503 }) : response(message));
    const p = provider();
    for (let n = 0; n < 4; n++) await expect(p.getGroupParticipants(GROUP)).rejects.toBeDefined();
    await expect(p.sendText({ number: GROUP, text: "oi" })).resolves.toBeDefined();
  });
});
