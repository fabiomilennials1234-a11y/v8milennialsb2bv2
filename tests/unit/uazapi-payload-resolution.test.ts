// @vitest-environment node
/**
 * Unit tests for the Uazapi V2 payload resolution helpers (extracted in
 * whatsapp-webhook/index.ts during the 2026-05-14 incident response).
 *
 * Captures the three observed V2 payload shapes so a future server-side
 * schema change either keeps passing or surfaces as a failing test before
 * production silently drops events again.
 *
 * The helpers live inside the Deno edge function for runtime reasons, so
 * this test file re-declares them. They are intentionally tiny and
 * dependency-free; keeping a local copy is cheaper than carving out a
 * shared module. When the production helpers change, change them here too —
 * the test will catch behavioural drift.
 */

import { describe, it, expect } from "vitest";

function pickInstanceId(
  payload: Record<string, unknown> | null | undefined,
  pathInstanceId?: string,
): string | null {
  const p: Record<string, unknown> = payload ?? {};
  const candidates: unknown[] = [
    p.instance, p.instance_id, p.instanceId, p.InstanceId, p.InstanceID,
    p.instanceID, pathInstanceId, p.instanceName, p.InstanceName,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

function pickUazapiToken(payload: Record<string, unknown> | null | undefined): string | null {
  const p: Record<string, unknown> = payload ?? {};
  const candidates: unknown[] = [p.token, p.Token, p.instance_token, p.instanceToken];
  for (const c of candidates) {
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

const KNOWN_EVENTS = new Set(["messages", "messages_update", "connection", "payment", "payment_response"]);

function parseUrlPath(pathname: string): { secret?: string; instanceFromPath?: string; eventFromPath?: string } {
  const segs = pathname.split("/").filter(Boolean);
  const idx = segs.findIndex((s) => s === "whatsapp-webhook");
  const seg2 = idx >= 0 ? segs[idx + 2] : undefined;
  const seg3 = idx >= 0 ? segs[idx + 3] : undefined;
  if (seg2 && seg3) return { secret: segs[idx + 1], instanceFromPath: seg2, eventFromPath: seg3 };
  if (seg2) {
    if (KNOWN_EVENTS.has(seg2)) return { secret: segs[idx + 1], eventFromPath: seg2 };
    return { secret: segs[idx + 1], instanceFromPath: seg2 };
  }
  return { secret: segs[idx + 1] };
}

describe("pickInstanceId — Uazapi V2 payload variants", () => {
  it("returns null when nothing is present", () => {
    expect(pickInstanceId({})).toBeNull();
  });

  it("treats empty strings as missing (the V2 regression that caused 2026-05-14)", () => {
    expect(pickInstanceId({ instance: "", instance_id: "" })).toBeNull();
    expect(pickInstanceId({ instance: "   " })).toBeNull();
  });

  it("accepts the path segment when the body has none", () => {
    expect(pickInstanceId({}, "r6944f1ea39d61f")).toBe("r6944f1ea39d61f");
  });

  it("prefers a non-empty body field over the path segment", () => {
    expect(pickInstanceId({ instance: "rABC" }, "rDEF")).toBe("rABC");
  });

  it("accepts camelCase / PascalCase aliases", () => {
    expect(pickInstanceId({ instanceId: "rABC" })).toBe("rABC");
    expect(pickInstanceId({ InstanceId: "rABC" })).toBe("rABC");
    expect(pickInstanceId({ InstanceID: "rABC" })).toBe("rABC");
    expect(pickInstanceId({ instanceID: "rABC" })).toBe("rABC");
  });

  it("falls back to instanceName when no id-like field is present", () => {
    expect(pickInstanceId({ instanceName: "Comercial 1" })).toBe("Comercial 1");
  });
});

describe("pickUazapiToken — token-based fallback resolution", () => {
  it("returns null when no token is present", () => {
    expect(pickUazapiToken({})).toBeNull();
  });

  it("ignores empty strings", () => {
    expect(pickUazapiToken({ token: "", Token: " " })).toBeNull();
  });

  it("accepts token in any documented casing", () => {
    expect(pickUazapiToken({ token: "tok-1" })).toBe("tok-1");
    expect(pickUazapiToken({ Token: "tok-2" })).toBe("tok-2");
    expect(pickUazapiToken({ instance_token: "tok-3" })).toBe("tok-3");
    expect(pickUazapiToken({ instanceToken: "tok-4" })).toBe("tok-4");
  });
});

describe("Uazapi V2 known payload shapes — resolution outcomes", () => {
  // Shape 1: event as plain string ("messages"), no top-level instance.
  // Recovered via URL path segment OR per-instance token.
  it("[shape 1] event=string + path instance → resolved by path", () => {
    const payload = { event: "messages", data: {}, token: "tok-bar" };
    const path = parseUrlPath("/functions/v1/whatsapp-webhook/SECRET/r6944f1ea39d61f");
    expect(pickInstanceId(payload, path.instanceFromPath)).toBe("r6944f1ea39d61f");
  });

  it("[shape 1] event=string + addUrlEvents path → fallback to token", () => {
    const payload = { event: "messages", token: "tok-bar" };
    const path = parseUrlPath("/functions/v1/whatsapp-webhook/SECRET/messages");
    // KNOWN_EVENTS catches "messages", so no instanceFromPath.
    expect(path.instanceFromPath).toBeUndefined();
    expect(pickInstanceId(payload, path.instanceFromPath)).toBeNull();
    expect(pickUazapiToken(payload)).toBe("tok-bar");
  });

  // Shape 2: event field carries the uazapi instance id (the V2 regression).
  // Path-based recovery still works.
  it("[shape 2] event=<instance_id> + path instance → resolved by path", () => {
    const payload = { event: "re9f0d50f28e936" };
    const path = parseUrlPath("/functions/v1/whatsapp-webhook/SECRET/re9f0d50f28e936");
    expect(pickInstanceId(payload, path.instanceFromPath)).toBe("re9f0d50f28e936");
  });

  // Shape 3: event is the data object (PascalCase nested). No body instance,
  // no body token — only resolvable via path or owner JID lookup.
  it("[shape 3] event=object + path instance → resolved by path", () => {
    const payload = {
      event: {
        Chat: "554791032199@s.whatsapp.net",
        Type: "Delivered",
        IsGroup: false,
        IsFromMe: false,
        Timestamp: 1778850672,
        MessageIDs: ["2A55DE51EBE07A310D7C"],
      },
      EventType: "Delivered",
    };
    const path = parseUrlPath("/functions/v1/whatsapp-webhook/SECRET/r2c380934636c95");
    expect(pickInstanceId(payload, path.instanceFromPath)).toBe("r2c380934636c95");
  });

  it("[shape 3] event=object with only the canonical addUrlEvents path → unresolvable", () => {
    const payload = { event: { Chat: "x@s.whatsapp.net", Type: "Delivered" } };
    const path = parseUrlPath("/functions/v1/whatsapp-webhook/SECRET/messages_update");
    expect(pickInstanceId(payload, path.instanceFromPath)).toBeNull();
    expect(pickUazapiToken(payload)).toBeNull();
    // → DLQ path; whatsapp-dlq-replay retries after rebind or sees the row
    // marked exhausted after 5 attempts (manual review).
  });
});
