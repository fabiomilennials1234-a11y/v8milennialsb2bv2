import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SESSION_ID_HEADER,
  REQUEST_ID_HEADER,
  getSessionId,
  newRequestId,
  withTraceHeaders,
  createTracedFetch,
  resetSessionIdForTests,
} from "./request-trace";

describe("getSessionId", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetSessionIdForTests();
  });

  it("returns the same id across calls within one browsing session", () => {
    expect(getSessionId()).toBe(getSessionId());
  });

  it("survives a module-level reset by reading it back from sessionStorage", () => {
    const first = getSessionId();
    resetSessionIdForTests();
    expect(getSessionId()).toBe(first);
  });

  it("mints a new id once the session storage is cleared", () => {
    const first = getSessionId();
    sessionStorage.clear();
    resetSessionIdForTests();
    expect(getSessionId()).not.toBe(first);
  });

  // O id vive na sessão de navegação. Se sessionStorage não estiver disponível
  // (aba privada em alguns browsers), degradamos para um id em memória em vez
  // de derrubar toda chamada ao Supabase.
  it("falls back to an in-memory id when sessionStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    resetSessionIdForTests();
    expect(getSessionId()).toBe(getSessionId());
    spy.mockRestore();
  });
});

describe("newRequestId", () => {
  it("mints a distinct id per call", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});

describe("withTraceHeaders", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetSessionIdForTests();
  });

  it("stamps both headers on a bare request", () => {
    const headers = new Headers(withTraceHeaders(undefined));
    expect(headers.get(SESSION_ID_HEADER)).toBe(getSessionId());
    expect(headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("gives every request its own request id but one shared session id", () => {
    const a = new Headers(withTraceHeaders(undefined));
    const b = new Headers(withTraceHeaders(undefined));

    expect(a.get(SESSION_ID_HEADER)).toBe(b.get(SESSION_ID_HEADER));
    expect(a.get(REQUEST_ID_HEADER)).not.toBe(b.get(REQUEST_ID_HEADER));
  });

  it("preserves headers the caller already set", () => {
    const headers = new Headers(
      withTraceHeaders({ authorization: "Bearer token", "content-type": "application/json" }),
    );
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get(SESSION_ID_HEADER)).toBeTruthy();
  });

  it("accepts a Headers instance as input", () => {
    const input = new Headers({ authorization: "Bearer token" });
    const headers = new Headers(withTraceHeaders(input));
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  // Um request id que o chamador já cunhou vence — permite correlacionar uma
  // ação do usuário que dispara várias chamadas.
  it("does not overwrite a request id the caller supplied", () => {
    const headers = new Headers(withTraceHeaders({ [REQUEST_ID_HEADER]: "caller-owned" }));
    expect(headers.get(REQUEST_ID_HEADER)).toBe("caller-owned");
  });
});

describe("createTracedFetch", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetSessionIdForTests();
  });

  it("stamps trace headers on the outgoing request", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    await createTracedFetch(base)("https://api.test/rpc");

    const init = base.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get(SESSION_ID_HEADER)).toBe(getSessionId());
    expect(headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("preserves the url, the method and the body", async () => {
    const base = vi.fn().mockResolvedValue(new Response("ok"));
    await createTracedFetch(base)("https://api.test/rpc", {
      method: "POST",
      body: '{"a":1}',
      headers: { authorization: "Bearer token" },
    });

    const [url, init] = base.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/rpc");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
  });

  it("returns whatever the underlying fetch returned", async () => {
    const expected = new Response("payload", { status: 201 });
    const res = await createTracedFetch(vi.fn().mockResolvedValue(expected))("https://api.test/x");
    expect(res).toBe(expected);
  });

  // Telemetria nunca pode alterar o comportamento de erro da chamada.
  it("propagates a rejection from the underlying fetch untouched", async () => {
    const boom = new Error("network down");
    const traced = createTracedFetch(vi.fn().mockRejectedValue(boom));
    await expect(traced("https://api.test/x")).rejects.toBe(boom);
  });
});
