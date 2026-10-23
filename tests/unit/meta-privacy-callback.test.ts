// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMetaPrivacyHandler, type PrivacyKind } from "../../supabase/functions/_shared/meta-privacy-handler";
import { verifyMetaSignedRequest } from "../../supabase/functions/_shared/meta-signed-request";

const secret = "unit-test-secret";
function signed(payload: object = { algorithm: "HMAC-SHA256", user_id: "12345", issued_at: 1 }, key = secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${createHmac("sha256", key).update(body).digest("base64url")}.${body}`;
}
function fixture(kind: PrivacyKind = "deletion", fail = false) {
  const rows = new Map<string, { status: string; app_id: string }>();
  const handler = createMetaPrivacyHandler({ kind, appId: "2095970848458119", secret, callbackUrl: "https://project.supabase.co/functions/v1/meta-data-deletion", store: {
    async enqueue(input) { if (fail) throw new Error("private database details"); if (!rows.has(input.confirmation_code)) rows.set(input.confirmation_code, { status: "pending", app_id: input.app_id }); },
    async status(code, appId) { const row = rows.get(code); return row?.app_id === appId ? row.status : null; },
  } });
  return { handler, rows };
}
const post = (value = signed()) => new Request("https://project.supabase.co/functions/v1/meta-data-deletion", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ signed_request: value }) });

describe("Meta privacy authentication", () => {
  it("accepts a genuine signature, rejects forgery, tampering and malformed payloads", async () => {
    expect(await verifyMetaSignedRequest(signed(), secret)).toBe("12345");
    for (const value of [signed({}, "wrong"), signed() + "x", "broken", ".", signed({ algorithm: "none", user_id: "123" }), signed({ algorithm: "HMAC-SHA256", user_id: 123 }), signed({ algorithm: "HMAC-SHA256", user_id: "x' OR 1=1" })]) {
      expect(await verifyMetaSignedRequest(value, secret)).toBeNull();
    }
  });
  it("does not persist unauthenticated requests", async () => {
    const { handler, rows } = fixture();
    expect((await handler(post(signed({}, "wrong")))).status).toBe(401);
    expect(rows.size).toBe(0);
  });
});
describe("Meta deletion intake", () => {
  it("returns an opaque receipt, real pending status and no personal data", async () => {
    const { handler } = fixture();
    const response = await handler(post());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.confirmation_code).toMatch(/^[a-f0-9]{64}$/);
    expect(body.url).not.toContain("12345");
    const status = await handler(new Request(body.url));
    expect(await status.json()).toEqual({ status: "pending" });
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(status.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("retries never reset completion; a new signed event creates a new request", async () => {
    const { handler, rows } = fixture();
    const first = await (await handler(post())).json();
    rows.get(first.confirmation_code)!.status = "completed";
    await handler(post());
    expect(rows.get(first.confirmation_code)!.status).toBe("completed");
    const next = await (await handler(post(signed({ algorithm: "HMAC-SHA256", user_id: "12345", issued_at: 2 })))).json();
    expect(next.confirmation_code).not.toBe(first.confirmation_code);
    expect(rows.get(next.confirmation_code)!.status).toBe("pending");
  });
  it("unknown receipt and foreign-app receipt expose no data", async () => {
    const { handler, rows } = fixture();
    const body = await (await handler(post())).json();
    rows.get(body.confirmation_code)!.app_id = "another-app";
    expect((await handler(new Request(body.url))).status).toBe(404);
    expect((await handler(new Request("https://x.test?code=" + "a".repeat(64)))).status).toBe(404);
    expect((await handler(new Request("https://x.test?code=123"))).status).toBe(400);
  });
  it("does not acknowledge an event that was not durably saved", async () => {
    const { handler } = fixture("deletion", true);
    const response = await handler(post());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database");
  });
  it("bounds payloads and rejects duplicate signatures and unsupported methods", async () => {
    const { handler } = fixture();
    expect((await handler(new Request("https://x.test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "x".repeat(20_001) }))).status).toBe(413);
    expect((await handler(new Request("https://x.test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `signed_request=${signed()}&signed_request=${signed()}` }))).status).toBe(400);
    expect((await handler(new Request("https://x.test", { method: "POST", body: "{}" }))).status).toBe(415);
    expect((await handler(new Request("https://x.test", { method: "DELETE" }))).status).toBe(405);
  });
  it("records deauthorization separately without claiming data deletion", async () => {
    const { handler, rows } = fixture("deauthorization");
    expect(await (await handler(post())).json()).toEqual({ received: true });
    expect(rows.size).toBe(1);
    expect((await handler(new Request("https://x.test"))).status).toBe(405);
  });
});
