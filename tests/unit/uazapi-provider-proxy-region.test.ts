/**
 * Wiring tests for the managed-proxy region on connect (#1477, PRD #1472).
 *
 * The pure derivation is covered in whatsapp-proxy-region.test.ts. What THIS file
 * covers is the wiring: that the derived region actually reaches
 * `POST /instance/connect`, and — just as important — that every failure path
 * still connects WITHOUT the region instead of costing a connection.
 *
 * Nothing here touches the network: `fetch` is mocked and the call sequence is
 * asserted (catalog GET, then connect POST).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Admin mock that can answer the phone lookup used by the QR flow. */
function makeAdminMock(phoneNumber: string | null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { phone_number: phoneNumber }, error: null }),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

function makeProvider(phoneInDb: string | null = null, token = "tok-abc") {
  return new UazapiProvider({
    baseUrl: "https://uazapi.test",
    token,
    adminToken: "admin-xyz",
    instanceId: "inst-uuid-123",
    organizationId: "org-uuid-456",
    supabaseAdmin: makeAdminMock(phoneInDb),
  });
}

const SC_CITIES = {
  country: "br",
  state: "sc",
  cities: [
    { value: "joinville", label: "Joinville", state: "sc" },
    { value: "florianopolis", label: "Florianópolis", state: "sc" },
  ],
};

function connectBodyOf(callIndex: number): Record<string, unknown> {
  const [, init] = vi.mocked(fetch).mock.calls[callIndex];
  return JSON.parse(String(init?.body ?? "{}"));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connectQR — region reaches the provider", () => {
  it("asks the catalog for the UF derived from the phone, then connects with the region", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes(200, SC_CITIES))
      .mockResolvedValueOnce(jsonRes(200, { paircode: "1234-5678" }));

    const provider = makeProvider(null, "tok-region-1");
    await provider.connectQR("5548988887777");

    const [catalogUrl] = vi.mocked(fetch).mock.calls[0];
    expect(String(catalogUrl)).toContain("/proxy-managed/cities");
    expect(String(catalogUrl)).toContain("country=br");
    expect(String(catalogUrl)).toContain("state=sc");

    const [connectUrl] = vi.mocked(fetch).mock.calls[1];
    expect(String(connectUrl)).toBe("https://uazapi.test/instance/connect");
    expect(connectBodyOf(1)).toEqual({
      phone: "5548988887777",
      proxy_managed_country: "br",
      proxy_managed_state: "sc",
      proxy_managed_city: "florianopolis",
    });
  });

  it("falls back to the instance's stored number in the QR flow (no phone argument)", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes(200, SC_CITIES))
      .mockResolvedValueOnce(jsonRes(200, { qrcode: "data:image/png;base64,x" }));

    const provider = makeProvider("5547988887777", "tok-region-2");
    await provider.connectQR();

    const body = connectBodyOf(1);
    expect(body.phone).toBeUndefined();
    expect(body.proxy_managed_state).toBe("sc");
    expect(body.proxy_managed_city).toBe("florianopolis");
  });
});

describe("connectQR — never costs a connection", () => {
  it("connects without the region for a non-Brazilian number, and skips the catalog call entirely", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, { paircode: "1111-2222" }));

    const provider = makeProvider(null, "tok-region-3");
    await provider.connectQR("14155552671");

    // Only one request: no point asking for a Brazilian catalog.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://uazapi.test/instance/connect");
    expect(connectBodyOf(0)).toEqual({ phone: "14155552671" });
  });

  it("connects without the region when the catalog request fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes(400, { error: "catalog unavailable" }))
      .mockResolvedValueOnce(jsonRes(200, { paircode: "3333-4444" }));

    const provider = makeProvider(null, "tok-region-4");
    const res = await provider.connectQR("5548988887777");

    expect(res.paircode).toBe("3333-4444");
    expect(connectBodyOf(1)).toEqual({ phone: "5548988887777" });
  });

  it("connects without the region when the catalog has no city for the UF", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes(200, { country: "br", cities: [] }))
      .mockResolvedValueOnce(jsonRes(200, { paircode: "5555-6666" }));

    const provider = makeProvider(null, "tok-region-5");
    await provider.connectQR("5548988887777");

    expect(connectBodyOf(1)).toEqual({ phone: "5548988887777" });
  });

  it("connects without the region when the instance has no phone at all", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonRes(200, { qrcode: "x" }));

    const provider = makeProvider(null, "tok-region-6");
    await provider.connectQR();

    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(connectBodyOf(0)).toEqual({});
  });
});
