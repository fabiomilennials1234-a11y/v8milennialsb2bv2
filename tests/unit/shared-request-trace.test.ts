/**
 * Tests for _shared/request-trace.ts — extração dos ids de correlação
 * enviados pelo frontend (x-torque-session-id / x-torque-request-id).
 */

import { describe, it, expect } from "vitest";
import { getTraceContext } from "../../supabase/functions/_shared/request-trace";

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const REQUEST = "9c858901-8a57-4791-81fe-4c455b099bc9";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://fn.test/x", { headers });
}

describe("getTraceContext", () => {
  it("extracts both ids when the frontend sent them", () => {
    const ctx = getTraceContext(
      reqWith({ "x-torque-session-id": SESSION, "x-torque-request-id": REQUEST }),
    );
    expect(ctx).toEqual({ sessionId: SESSION, requestId: REQUEST });
  });

  it("is case-insensitive about header names", () => {
    const ctx = getTraceContext(reqWith({ "X-Torque-Session-Id": SESSION }));
    expect(ctx.sessionId).toBe(SESSION);
  });

  it("returns nulls when no trace headers are present", () => {
    expect(getTraceContext(reqWith({}))).toEqual({ sessionId: null, requestId: null });
  });

  it("returns each id independently of the other", () => {
    expect(getTraceContext(reqWith({ "x-torque-request-id": REQUEST }))).toEqual({
      sessionId: null,
      requestId: REQUEST,
    });
  });

  // As colunas são UUID. Um header malformado (ou forjado) faria o INSERT
  // explodir — e logRuntime engole o erro, perdendo a linha inteira em
  // silêncio. Descartar o id inválido preserva o resto do log.
  it("discards a non-uuid value instead of poisoning the insert", () => {
    const ctx = getTraceContext(
      reqWith({ "x-torque-session-id": "not-a-uuid", "x-torque-request-id": REQUEST }),
    );
    expect(ctx).toEqual({ sessionId: null, requestId: REQUEST });
  });

  it("discards a uuid-shaped value with a trailing injection attempt", () => {
    const ctx = getTraceContext(reqWith({ "x-torque-session-id": `${SESSION}' OR 1=1--` }));
    expect(ctx.sessionId).toBeNull();
  });

  it("accepts an uppercase uuid", () => {
    const ctx = getTraceContext(reqWith({ "x-torque-session-id": SESSION.toUpperCase() }));
    expect(ctx.sessionId).toBe(SESSION.toUpperCase());
  });

  it("treats an empty header as absent", () => {
    expect(getTraceContext(reqWith({ "x-torque-session-id": "" })).sessionId).toBeNull();
  });
});
