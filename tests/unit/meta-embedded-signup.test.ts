/**
 * Unit tests for the pure parts of the Meta WhatsApp Cloud CONNECTION flow via
 * Embedded Signup (Slice 3, ADR-0009): request validation (never trusts a body
 * org), instance-row construction, set_meta_cloud_credentials param mapping, the
 * idempotency key, code→token exchange + WABA/phone resolution (anti-forgery
 * against granted WABAs), number registration idempotency, and Graph error
 * mapping (token never echoed).
 *
 * No real network — fetchImpl is injected. Vitest (Node env).
 */
import { describe, it, expect, vi } from "vitest";
import {
  validateExchangeRequest,
  buildInstanceRow,
  buildSetCredentialsParams,
  idempotencyKey,
  createMetaEmbeddedSignupGraph,
  resolveWabaAndPhone,
  graphError,
  EmbeddedSignupError,
  type MetaEmbeddedSignupGraph,
} from "../../supabase/functions/_shared/meta-embedded-signup";

// ── helpers ──────────────────────────────────────────────────────
function jsonResponse(payload: unknown): Response {
  return { json: () => Promise.resolve(payload) } as unknown as Response;
}

const creds = { appId: "APP_ID", appSecret: "APP_SECRET" };

// ── validateExchangeRequest ──────────────────────────────────────
describe("validateExchangeRequest", () => {
  it("accepts a code with optional waba_id / phone_number_id", () => {
    const res = validateExchangeRequest({
      code: "  short-lived-code  ",
      waba_id: "WABA_1",
      phone_number_id: "PHONE_1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.code).toBe("short-lived-code");
      expect(res.value.wabaId).toBe("WABA_1");
      expect(res.value.phoneNumberId).toBe("PHONE_1");
    }
  });

  it("accepts a code without ids (derived later from the token)", () => {
    const res = validateExchangeRequest({ code: "c" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.wabaId).toBeNull();
      expect(res.value.phoneNumberId).toBeNull();
    }
  });

  it("rejects a missing/blank code with a stable code", () => {
    for (const bad of [undefined, "", "   ", 123]) {
      const res = validateExchangeRequest({ code: bad });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("missing_code");
    }
  });

  it("does NOT read organization_id from the body (org comes from auth)", () => {
    // Even if a caller smuggles organization_id, the validator ignores it — the
    // edge fn uses the authed org. The validated value has no org field at all.
    const res = validateExchangeRequest({
      code: "c",
      // @ts-expect-error — organization_id is intentionally not part of the input shape
      organization_id: "ATTACKER_ORG",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Object.keys(res.value)).toEqual(["code", "wabaId", "phoneNumberId"]);
      expect((res.value as Record<string, unknown>).organization_id).toBeUndefined();
    }
  });
});

// ── buildInstanceRow ─────────────────────────────────────────────
describe("buildInstanceRow", () => {
  it("uses the verified name as the instance name and digits-only phone", () => {
    const row = buildInstanceRow({
      organizationId: "ORG_1",
      phoneNumberId: "PHONE_1",
      displayPhoneNumber: "+55 11 98888-7777",
      verifiedName: "Torque CRM",
    });
    expect(row).toEqual({
      organization_id: "ORG_1",
      provider: "meta_cloud",
      instance_name: "Torque CRM",
      phone_number: "5511988887777",
      status: "connected",
    });
  });

  it("falls back to the display number when no verified name", () => {
    const row = buildInstanceRow({
      organizationId: "ORG_1",
      phoneNumberId: "PHONE_1",
      displayPhoneNumber: "+55 11 90000-0000",
    });
    expect(row.instance_name).toBe("+55 11 90000-0000");
    expect(row.phone_number).toBe("5511900000000");
  });

  it("falls back to a phone_number_id label when both are absent", () => {
    const row = buildInstanceRow({ organizationId: "ORG_1", phoneNumberId: "PHONE_X" });
    expect(row.instance_name).toBe("Meta WhatsApp PHONE_X");
    expect(row.phone_number).toBeNull();
    expect(row.provider).toBe("meta_cloud");
    expect(row.status).toBe("connected");
  });

  it("always binds the org passed in (never a body-derived one)", () => {
    const row = buildInstanceRow({ organizationId: "ORG_AUTH", phoneNumberId: "P" });
    expect(row.organization_id).toBe("ORG_AUTH");
  });
});

// ── buildSetCredentialsParams ────────────────────────────────────
describe("buildSetCredentialsParams", () => {
  it("maps to the RPC positional params (token passed via RPC, not a column)", () => {
    const params = buildSetCredentialsParams({
      instanceId: "INST_1",
      organizationId: "ORG_1",
      wabaId: "WABA_1",
      phoneNumberId: "PHONE_1",
      accessToken: "tok-secret",
    });
    expect(params).toEqual({
      p_instance_id: "INST_1",
      p_organization_id: "ORG_1",
      p_meta_waba_id: "WABA_1",
      p_meta_phone_number_id: "PHONE_1",
      p_meta_access_token: "tok-secret",
    });
  });
});

// ── idempotencyKey ───────────────────────────────────────────────
describe("idempotencyKey", () => {
  it("is (organization_id, phone_number_id) — same number+org → same key", () => {
    expect(idempotencyKey("ORG_1", "PHONE_1")).toBe("ORG_1:PHONE_1");
    expect(idempotencyKey("ORG_1", "PHONE_1")).toBe(idempotencyKey("ORG_1", "PHONE_1"));
  });

  it("differs across orgs and across numbers", () => {
    expect(idempotencyKey("ORG_1", "PHONE_1")).not.toBe(idempotencyKey("ORG_2", "PHONE_1"));
    expect(idempotencyKey("ORG_1", "PHONE_1")).not.toBe(idempotencyKey("ORG_1", "PHONE_2"));
  });
});

// ── graphError ───────────────────────────────────────────────────
describe("graphError", () => {
  it("carries the Graph message + code and never the token", () => {
    const err = graphError({ message: "Invalid OAuth token", code: 190 });
    expect(err).toBeInstanceOf(EmbeddedSignupError);
    expect(err.code).toBe("graph_error");
    expect(err.message).toContain("Invalid OAuth token");
    expect(err.message).toContain("code 190");
    // graphError carries only the Graph-supplied message/code — never the actual
    // access-token VALUE. (The Graph message may itself contain the word "token".)
    expect(err.message).not.toContain("USER_TOKEN");
    expect(err.message).not.toContain("APP_SECRET");
  });
});

// ── createMetaEmbeddedSignupGraph.exchangeCode ───────────────────
describe("exchangeCode", () => {
  it("GETs /oauth/access_token with client_id/secret/code and returns the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "USER_TOKEN", expires_in: 5184000 }));
    const graph = createMetaEmbeddedSignupGraph({ credentials: creds, fetchImpl });
    const res = await graph.exchangeCode("the-code");
    expect(res.accessToken).toBe("USER_TOKEN");
    expect(res.expiresIn).toBe(5184000);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("/oauth/access_token");
    expect(url).toContain("client_id=APP_ID");
    expect(url).toContain("client_secret=APP_SECRET");
    expect(url).toContain("code=the-code");
  });

  it("throws a mapped error (no token leak) on a Graph error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "bad code", code: 100 } }));
    const graph = createMetaEmbeddedSignupGraph({ credentials: creds, fetchImpl });
    await expect(graph.exchangeCode("x")).rejects.toThrow(/Meta Graph error: bad code/);
  });

  it("throws token_exchange_failed when Meta returns no access_token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token_type: "bearer" }));
    const graph = createMetaEmbeddedSignupGraph({ credentials: creds, fetchImpl });
    await expect(graph.exchangeCode("x")).rejects.toMatchObject({ code: "token_exchange_failed" });
  });
});

// ── listGrantedWabaIds (debug_token) ─────────────────────────────
describe("listGrantedWabaIds", () => {
  it("extracts WABA target_ids from whatsapp_business_* granular scopes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          granular_scopes: [
            { scope: "whatsapp_business_management", target_ids: ["WABA_1", "WABA_2"] },
            { scope: "whatsapp_business_messaging", target_ids: ["WABA_2"] },
            { scope: "ads_management", target_ids: ["ACT_9"] },
          ],
        },
      }),
    );
    const graph = createMetaEmbeddedSignupGraph({ credentials: creds, fetchImpl });
    const ids = await graph.listGrantedWabaIds("USER_TOKEN");
    expect(ids.sort()).toEqual(["WABA_1", "WABA_2"]);
    // app access token form {app_id}|{app_secret}
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("access_token=APP_ID%7CAPP_SECRET");
  });
});

// ── registerNumber idempotency ───────────────────────────────────
describe("registerNumber", () => {
  it("POSTs /register and returns true on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    const graph = createMetaEmbeddedSignupGraph({ credentials: creds, fetchImpl });
    expect(await graph.registerNumber("PHONE_1", "TOKEN", "000000")).toBe(true);
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).method).toBe("POST");
    expect(String((init as RequestInit).body)).toContain("\"messaging_product\":\"whatsapp\"");
  });

  it("treats 'already registered' (133005) as success — idempotent re-run", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "already registered", code: 133005 } }));
    const graph = createMetaEmbeddedSignupGraph({ credentials: creds, fetchImpl });
    expect(await graph.registerNumber("PHONE_1", "TOKEN", "000000")).toBe(true);
  });

  it("throws on a genuine register error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "boom", code: 100 } }));
    const graph = createMetaEmbeddedSignupGraph({ credentials: creds, fetchImpl });
    await expect(graph.registerNumber("PHONE_1", "TOKEN", "000000")).rejects.toThrow(/boom/);
  });
});

// ── resolveWabaAndPhone (anti-forgery) ───────────────────────────
describe("resolveWabaAndPhone", () => {
  function fakeGraph(over: Partial<MetaEmbeddedSignupGraph>): MetaEmbeddedSignupGraph {
    return {
      exchangeCode: vi.fn(),
      listGrantedWabaIds: vi.fn().mockResolvedValue(["WABA_1"]),
      getPhoneNumber: vi.fn().mockResolvedValue({ id: "PHONE_1", display_phone_number: "+55 11 90000-0000" }),
      listPhoneNumbers: vi.fn().mockResolvedValue([{ id: "PHONE_1", display_phone_number: "+55 11 90000-0000" }]),
      registerNumber: vi.fn().mockResolvedValue(true),
      subscribeApp: vi.fn().mockResolvedValue(true),
      ...over,
    };
  }

  it("validates a requested waba_id against the token's grants", async () => {
    const graph = fakeGraph({ listGrantedWabaIds: vi.fn().mockResolvedValue(["WABA_1", "WABA_2"]) });
    const res = await resolveWabaAndPhone(graph, "TOKEN", { wabaId: "WABA_2", phoneNumberId: "PHONE_1" });
    expect(res.wabaId).toBe("WABA_2");
    expect(res.phoneNumberId).toBe("PHONE_1");
    expect(graph.getPhoneNumber).toHaveBeenCalledWith("PHONE_1", "TOKEN");
  });

  it("REJECTS a requested waba_id not among the granted ones (forgery guard)", async () => {
    const graph = fakeGraph({ listGrantedWabaIds: vi.fn().mockResolvedValue(["WABA_1"]) });
    await expect(
      resolveWabaAndPhone(graph, "TOKEN", { wabaId: "WABA_OTHER", phoneNumberId: "PHONE_1" }),
    ).rejects.toMatchObject({ code: "waba_not_granted" });
  });

  it("derives the WABA when omitted and exactly one was granted", async () => {
    const graph = fakeGraph({ listGrantedWabaIds: vi.fn().mockResolvedValue(["WABA_SOLE"]) });
    const res = await resolveWabaAndPhone(graph, "TOKEN", { wabaId: null, phoneNumberId: null });
    expect(res.wabaId).toBe("WABA_SOLE");
    expect(res.phoneNumberId).toBe("PHONE_1");
  });

  it("errors ambiguous_waba when omitted and multiple were granted", async () => {
    const graph = fakeGraph({ listGrantedWabaIds: vi.fn().mockResolvedValue(["A", "B"]) });
    await expect(
      resolveWabaAndPhone(graph, "TOKEN", { wabaId: null, phoneNumberId: null }),
    ).rejects.toMatchObject({ code: "ambiguous_waba" });
  });

  it("errors no_waba_granted when the token granted none", async () => {
    const graph = fakeGraph({ listGrantedWabaIds: vi.fn().mockResolvedValue([]) });
    await expect(
      resolveWabaAndPhone(graph, "TOKEN", { wabaId: null, phoneNumberId: null }),
    ).rejects.toMatchObject({ code: "no_waba_granted" });
  });

  it("derives the phone_number_id from the WABA when omitted", async () => {
    const graph = fakeGraph({
      listGrantedWabaIds: vi.fn().mockResolvedValue(["WABA_1"]),
      listPhoneNumbers: vi.fn().mockResolvedValue([{ id: "PHONE_DERIVED", display_phone_number: "+55 11 91111-1111" }]),
    });
    const res = await resolveWabaAndPhone(graph, "TOKEN", { wabaId: "WABA_1", phoneNumberId: null });
    expect(res.phoneNumberId).toBe("PHONE_DERIVED");
    expect(res.phone.display_phone_number).toBe("+55 11 91111-1111");
  });

  it("errors no_phone_number when the WABA has no numbers", async () => {
    const graph = fakeGraph({
      listGrantedWabaIds: vi.fn().mockResolvedValue(["WABA_1"]),
      listPhoneNumbers: vi.fn().mockResolvedValue([]),
    });
    await expect(
      resolveWabaAndPhone(graph, "TOKEN", { wabaId: "WABA_1", phoneNumberId: null }),
    ).rejects.toMatchObject({ code: "no_phone_number" });
  });
});
