// @vitest-environment node
/**
 * UazapiClient /sender/* — REAL CONTRACT (verified live 2026-06-15).
 *
 * Probe (create+delete non-deliver) against prod established the ground truth
 * the client must encode. These tests drive the HTTP layer with a mocked
 * `fetch` (no network) and assert the *shape* and *endpoints* the real Uazapi
 * server returns — NOT the legacy {sender_id,status,total,sent,failed} fiction.
 *
 *  1. CREATE  POST /sender/advanced  → { count, folder_id, status }
 *               (count = messages ACCEPTED; folder_id = the campaign id)
 *  2. LIST    GET  /sender/listfolders → Array<{ id, status, log_total,
 *               log_sucess (sic), log_failed, ... }>
 *  3. GET /sender/{id}  AND  GET /sender/list  → 404 (do NOT exist)
 *
 * senderGet(id) must resolve via /sender/listfolders (find-by-id) and map
 * log_sucess→sent, log_failed→failed, log_total→total, plus the Uazapi status
 * vocabulary → the app's canonical enum (done→completed, scheduled→queued, ...).
 *
 * RED phase: current uazapi-client.ts hits GET /sender/{id} and returns the raw
 * sender_id shape, so these will fail until B2/B3 land.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";

function makeResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE_CONFIG = {
  baseUrl: "https://uazapi.example.com",
  token: "tok-instance-xyz",
  adminToken: "admin-secret-token",
  timeoutMs: 200,
};

// Real CREATE response shape (POST /sender/advanced) — count = accepted.
const CREATE_RESPONSE = {
  count: 42,
  folder_id: "fld-abc-123",
  status: "scheduled",
};

// Real LIST entry shape (GET /sender/listfolders). Note log_sucess sic (1 'c').
const folder = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "fld-abc-123",
  info: "quick-blast",
  status: "running",
  scheduled_for: 0,
  delayMin: 5000,
  delayMax: 30000,
  log_total: 42,
  log_sucess: 30,
  log_delivered: 28,
  log_failed: 2,
  log_read: 10,
  log_played: 0,
  owner: "5511999999999",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  UazapiClient._resetCircuitState();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  UazapiClient._resetCircuitState();
});

// ---------------------------------------------------------------------------
// B2 — CREATE returns { count, folder_id, status } (NOT sender_id)
// ---------------------------------------------------------------------------

describe("senderAdvanced — CREATE contract (folder_id + count)", () => {
  it("POSTs /sender/advanced and returns the real { folder_id, count, status } shape", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, CREATE_RESPONSE));

    const client = new UazapiClient(BASE_CONFIG);
    const res = await client.senderAdvanced({
      messages: [{ number: "5511999999999", type: "text", text: "oi {nome}" }],
      delayMin: 5000,
      delayMax: 30000,
      track_source: "quick-blast",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/sender/advanced");
    expect(init?.method).toBe("POST");

    // The campaign id is folder_id (used as uazapi_sender_id downstream).
    expect((res as any).folder_id).toBe("fld-abc-123");
    // count = messages accepted by Uazapi.
    expect((res as any).count).toBe(42);
    // There is no sender_id field in the real response.
    expect((res as any).sender_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// B3 — senderGet(id) resolves via GET /sender/listfolders (find-by-id) and maps
//       log_sucess→sent, log_failed→failed, log_total→total, status→canonical
// ---------------------------------------------------------------------------

describe("senderGet — resolves via /sender/listfolders + maps metrics & status", () => {
  it("queries GET /sender/listfolders (never GET /sender/{id}, which is 404)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, [folder()]));

    const client = new UazapiClient(BASE_CONFIG);
    await client.senderGet("fld-abc-123");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/sender/listfolders");
    expect(init?.method).toBe("GET");
  });

  it("finds the folder by id and maps log_sucess→sent, log_failed→failed, log_total→total", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(200, [
        folder({ id: "other-folder", log_sucess: 1, log_failed: 1, log_total: 2 }),
        folder({ id: "fld-abc-123", status: "running", log_sucess: 30, log_failed: 2, log_total: 42 }),
      ]),
    );

    const client = new UazapiClient(BASE_CONFIG);
    const res = await client.senderGet("fld-abc-123");

    expect(res.sent).toBe(30);
    expect(res.failed).toBe(2);
    expect(res.total).toBe(42);
  });

  it.each([
    ["done", "completed"],
    ["scheduled", "queued"],
    ["queued", "queued"],
    ["running", "running"],
    ["failed", "failed"],
  ] as const)(
    "maps Uazapi status %s → canonical app enum %s",
    async (uazapiStatus, canonical) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse(200, [folder({ id: "fld-abc-123", status: uazapiStatus })]),
      );

      const client = new UazapiClient(BASE_CONFIG);
      const res = await client.senderGet("fld-abc-123");

      expect(res.status).toBe(canonical);
    },
  );

  it("maps the Uazapi 'deleting' status to a terminal non-running app status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(200, [folder({ id: "fld-abc-123", status: "deleting" })]),
    );

    const client = new UazapiClient(BASE_CONFIG);
    const res = await client.senderGet("fld-abc-123");

    // Per contract: deleting → failed (or stopped) — never left as "running".
    expect(["failed", "stopped", "cancelled"]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// B3 — senderList must hit /sender/listfolders (GET /sender/list is 404)
// ---------------------------------------------------------------------------

describe("senderList — uses /sender/listfolders", () => {
  it("GETs /sender/listfolders and returns the folder array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, [folder()]));

    const client = new UazapiClient(BASE_CONFIG);
    const res = await client.senderList();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://uazapi.example.com/sender/listfolders");
    expect(init?.method).toBe("GET");
    expect(Array.isArray(res)).toBe(true);
    expect((res[0] as any).id).toBe("fld-abc-123");
  });
});
