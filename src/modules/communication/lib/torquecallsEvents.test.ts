import { describe, expect, it, vi } from "vitest";
import { subscribeSessionEvents, type SessionEvent } from "./torquecallsEvents";

/** Monta um Response cujo corpo entrega os chunks na ordem dada. */
function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("subscribeSessionEvents", () => {
  it("entrega um evento completo", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      fetchImpl: async () => streamOf(['data: {"type":"session-qr","sessionId":"s1","qr":"abc"}\n\n']),
    });
    expect(seen).toEqual([{ type: "session-qr", sessionId: "s1", qr: "abc" }]);
  });

  it("remonta evento partido entre dois chunks", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      // A quebra cai no meio do JSON — é o caso que uma implementação
      // ingênua, que faz JSON.parse por chunk, perde em silêncio.
      fetchImpl: async () => streamOf(['data: {"type":"session-q', 'r","sessionId":"s1","qr":"abc"}\n\n']),
    });
    expect(seen).toEqual([{ type: "session-qr", sessionId: "s1", qr: "abc" }]);
  });

  it("junta data: de várias linhas no mesmo evento", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      fetchImpl: async () => streamOf(['data: {"type":"auth-state",\ndata: "paired":true}\n\n']),
    });
    expect(seen).toEqual([{ type: "auth-state", paired: true }]);
  });

  it("manda o token no header e nunca na URL", async () => {
    const spy = vi.fn(async () => streamOf([]));
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "segredo",
      onEvent: () => {},
      signal: new AbortController().signal,
      fetchImpl: spy as unknown as typeof fetch,
    });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("segredo");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer segredo");
  });

  it("ignora linha que não é JSON em vez de derrubar o stream", async () => {
    const seen: SessionEvent[] = [];
    await subscribeSessionEvents({
      vpsUrl: "https://calls.example",
      token: "tk",
      onEvent: (e) => seen.push(e),
      signal: new AbortController().signal,
      fetchImpl: async () => streamOf([': heartbeat\n\n', 'data: {"type":"auth-state"}\n\n']),
    });
    expect(seen).toEqual([{ type: "auth-state" }]);
  });
});
