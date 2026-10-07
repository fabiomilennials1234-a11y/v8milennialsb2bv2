// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BODY_LIMIT_BYTES,
  HEADERS_TIMEOUT_MS,
  UPSTREAM_PREFIX,
  forwardHeaders,
  isSafeApiPath,
  proxyApi,
} from "../../../cloudflare/src/api-proxy";
import { PROFILES } from "../../../cloudflare/src/headers";

const UPSTREAM = "https://jsjsmuncfkbsbzqzqhfq.supabase.co";
const ORIGIN = "https://torque-front.example.workers.dev";

type Call = { url: string; init: RequestInit };

function stubFetch(respond: (call: Call) => Response | Promise<Response> = () => new Response("{}", { status: 200 })) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function req(path: string, init: RequestInit & { duplex?: "half" } = {}): [Request, URL] {
  const url = new URL(path, ORIGIN);
  return [new Request(url, init), url];
}

const forwarded = (call: Call) => new Headers(call.init.headers);

describe("URL de destino e invariante de prefixo", () => {
  it("monta ${API_UPSTREAM}/functions/v1${pathname}${search}", async () => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads?limit=10&q=a%20b");
    await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(calls[0]?.url).toBe(`${UPSTREAM}/functions/v1/api/v1/leads?limit=10&q=a%20b`);
  });

  it.each([
    "/api/v1/leads",
    "/api/v1/",
    "/api/v1/leads/123/notes",
    "/api/v1/.env",
    "/api/v1/a%20b",
    "/api/v1/leads/../deals",
    "/api/v1/%2e%2e/%2e%2e/admin",
    "/api/v1/..%2f..%2fadmin",
    "/api/v1/%2e%2e%2fadmin",
    "/api/v1/a%5c..%5cb",
    "/api/v1//leads",
  ])("todo destino começa com %s → /functions/v1/api/v1/ ou é recusado", async (path) => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req(path);
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    if (calls.length === 0) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "bad_request", message: "Invalid API path" } });
      return;
    }
    const target = new URL(calls[0]!.url);
    expect(target.origin).toBe(UPSTREAM);
    expect(target.pathname.startsWith(UPSTREAM_PREFIX)).toBe(true);
  });

  it("recusa segmento que vira barra, contrabarra ou dot-segment depois de decodificado", () => {
    expect(isSafeApiPath("/api/v1/leads")).toBe(true);
    expect(isSafeApiPath("/api/v1/")).toBe(true);
    expect(isSafeApiPath("/api/v1/.env")).toBe(true);
    expect(isSafeApiPath("/api/v1/..%2fadmin")).toBe(false);
    expect(isSafeApiPath("/api/v1/%2e%2e")).toBe(false);
    expect(isSafeApiPath("/api/v1/a%5cb")).toBe(false);
    expect(isSafeApiPath("/api/v1//x")).toBe(false);
    expect(isSafeApiPath("/api/v1/%E0%A4")).toBe(false);
    expect(isSafeApiPath("/api/v2/leads")).toBe(false);
  });

  it("API_UPSTREAM fora do formato (http, com caminho) é erro de configuração", async () => {
    const { fetchImpl } = stubFetch();
    for (const upstream of ["http://x.supabase.co", "https://x.supabase.co/functions/v1", "https://u:p@x.supabase.co"]) {
      const [request, url] = req("/api/v1/leads");
      await expect(proxyApi(request, url, { upstream, fetchImpl })).rejects.toThrow("API_UPSTREAM");
    }
  });
});

describe("requisição que segue para o Supabase", () => {
  it("mantém método, query, corpo em streaming e redirect manual", async () => {
    const { fetchImpl, calls } = stubFetch();
    const body = JSON.stringify({ name: "Lead" });
    const [request, url] = req("/api/v1/leads?x=1", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": String(body.length) },
    });
    await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    const { init } = calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe(request.body);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("tira hop-by-hop, host, cf-*, x-real-ip e x-forwarded-*; repassa credenciais do cliente intactas", () => {
    const incoming = new Headers({
      host: "torque-front.example.workers.dev",
      connection: "keep-alive, x-custom-hop",
      "keep-alive": "timeout=5",
      "x-custom-hop": "1",
      te: "trailers",
      trailer: "x",
      "transfer-encoding": "chunked",
      upgrade: "websocket",
      "proxy-authorization": "Basic Zm9vOmJhcg==",
      "content-length": "10",
      "cf-connecting-ip": "203.0.113.9",
      "cf-ray": "abc",
      "cf-ipcountry": "BR",
      "x-real-ip": "198.51.100.1",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
      "x-api-key": "tq_live_cliente",
      authorization: "Bearer cliente",
      cookie: "torque_ui=v5",
      "content-type": "application/json",
      accept: "application/json",
    });
    const out = forwardHeaders(incoming);
    for (const gone of [
      "host",
      "connection",
      "keep-alive",
      "x-custom-hop",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
      "proxy-authorization",
      "content-length",
      "cf-connecting-ip",
      "cf-ray",
      "cf-ipcountry",
      "x-real-ip",
      "x-forwarded-host",
    ]) {
      expect(out.has(gone), gone).toBe(false);
    }
    expect(out.get("x-api-key")).toBe("tq_live_cliente");
    expect(out.get("authorization")).toBe("Bearer cliente");
    expect(out.get("cookie")).toBe("torque_ui=v5");
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("x-forwarded-proto")).toBe("https");
    expect(out.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  it("X-Forwarded-For = cadeia recebida + CF-Connecting-IP, sem repetir o último salto", () => {
    expect(forwardHeaders(new Headers({ "x-forwarded-for": "10.0.0.1, 10.0.0.2", "cf-connecting-ip": "203.0.113.9" })).get("x-forwarded-for"))
      .toBe("10.0.0.1, 10.0.0.2, 203.0.113.9");
    expect(forwardHeaders(new Headers({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "203.0.113.9" })).get("x-forwarded-for"))
      .toBe("203.0.113.9");
    expect(forwardHeaders(new Headers()).has("x-forwarded-for")).toBe(false);
  });

  it("não acrescenta credencial nenhuma", async () => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads", { headers: { accept: "application/json" } });
    await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    const sent = forwarded(calls[0]!);
    for (const name of ["authorization", "apikey", "x-api-key", "cookie", "x-cron-secret", "x-webhook-key"]) {
      expect(sent.has(name), name).toBe(false);
    }
    expect([...sent.keys()].sort()).toEqual(["accept", "accept-encoding", "x-forwarded-proto"]);
  });
});

describe("Accept-Encoding — o do cliente, não o que a Cloudflare põe", () => {
  // Na Cloudflare (e no wrangler dev) o header que chega ao Worker é sempre
  // `br, gzip`; o que o cliente mandou fica em `request.cf.clientAcceptEncoding`.
  const withCf = (request: Request, clientAcceptEncoding?: string) =>
    Object.defineProperty(request, "cf", { value: clientAcceptEncoding === undefined ? {} : { clientAcceptEncoding } });

  it.each([
    [undefined, "identity"],
    ["", "identity"],
    ["  ", "identity"],
    ["gzip", "gzip"],
    ["gzip, deflate, br, zstd", "gzip, deflate, br, zstd"],
  ])("cliente pediu %j → Supabase recebe %j", async (client, expected) => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads", { headers: { "accept-encoding": "br, gzip" } });
    await proxyApi(withCf(request, client), url, { upstream: UPSTREAM, fetchImpl });
    expect(forwarded(calls[0]!).get("accept-encoding")).toBe(expected);
  });

  it("sem `cf` (fora da Cloudflare) também não repassa o header de entrada", () => {
    expect(forwardHeaders(new Headers({ "accept-encoding": "br, gzip" })).get("accept-encoding")).toBe("identity");
    expect(forwardHeaders(new Headers({ "accept-encoding": "br, gzip" }), "gzip").get("accept-encoding")).toBe("gzip");
  });
});

describe("limites e erros", () => {
  it("Content-Length acima de 1 MiB → 413 no envelope, sem chamar o Supabase", async () => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(BODY_LIMIT_BYTES + 1) },
    });
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: "payload_too_large", message: "Request body exceeds 1 MiB" } });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(response.headers.get("content-security-policy")).toBe(PROFILES.app["Content-Security-Policy"]);
    expect(calls).toHaveLength(0);
  });

  it("exatamente 1 MiB passa", async () => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads", {
      method: "POST",
      body: new Uint8Array(BODY_LIMIT_BYTES),
      headers: { "content-length": String(BODY_LIMIT_BYTES) },
    });
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  const chunked = (bytes: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        let left = bytes;
        while (left > 0) {
          const size = Math.min(left, 64 * 1024);
          controller.enqueue(new Uint8Array(size));
          left -= size;
        }
        controller.close();
      },
    });

  it("sem Content-Length: conta enquanto lê e devolve 413 ao passar de 1 MiB", async () => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads", { method: "POST", body: chunked(BODY_LIMIT_BYTES + 1), duplex: "half" });
    expect(request.headers.has("content-length")).toBe(false);
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("sem Content-Length e dentro do limite: segue com o corpo lido", async () => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads", { method: "POST", body: chunked(1000), duplex: "half" });
    await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(calls[0]!.init.body).toBeInstanceOf(Uint8Array);
    expect((calls[0]!.init.body as Uint8Array).byteLength).toBe(1000);
  });

  it("Content-Length inválido → 400", async () => {
    const { fetchImpl, calls } = stubFetch();
    const [request, url] = req("/api/v1/leads", { method: "POST", body: "x", headers: { "content-length": "1e9" } });
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  describe("tempo até os headers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const hangUntilAbort = (call: Call) =>
      new Promise<Response>((_, reject) => {
        call.init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });

    it("30 s sem headers → 504 no envelope", async () => {
      const { fetchImpl } = stubFetch(hangUntilAbort);
      const [request, url] = req("/api/v1/leads");
      const pending = proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: { code: "gateway_timeout", message: "Upstream did not respond in time" } });
    });

    it("headers a tempo: o relógio para e o corpo não é abortado depois", async () => {
      const { fetchImpl, calls } = stubFetch(() => new Response("ok"));
      const [request, url] = req("/api/v1/leads");
      const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS * 2);
      expect(calls[0]!.init.signal?.aborted).toBe(false);
      expect(await response.text()).toBe("ok");
    });
  });

  it("falha de rede → 502 no envelope", async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const [request, url] = req("/api/v1/leads");
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "bad_gateway", message: "Upstream unavailable" } });
  });
});

describe("resposta do Supabase", () => {
  it("status, headers e corpo passam como vieram; APP só onde falta (Div9)", async () => {
    const upstreamHeaders = new Headers({
      "content-type": "application/json",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
      "access-control-allow-origin": "https://torquecrm.com.br",
      "x-request-id": "abc",
    });
    upstreamHeaders.append("set-cookie", "__cf_bm=1; Path=/");
    upstreamHeaders.append("set-cookie", "other=2; Path=/");
    const { fetchImpl } = stubFetch(
      () => new Response('{"error":{"code":"unauthorized","message":"x"}}', { status: 401, headers: upstreamHeaders }),
    );
    const [request, url] = req("/api/v1/leads");
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":{"code":"unauthorized","message":"x"}}');
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://torquecrm.com.br");
    expect(response.headers.get("x-request-id")).toBe("abc");
    expect(response.headers.getSetCookie()).toEqual(["__cf_bm=1; Path=/", "other=2; Path=/"]);
    // Os que faltavam entram uma vez só.
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-xss-protection")).toBe("1; mode=block");
    // Cache-Control é do upstream: o proxy não inventa um.
    expect(response.headers.has("cache-control")).toBe(false);
  });

  it("Cache-Control do upstream é preservado", async () => {
    const { fetchImpl } = stubFetch(() => new Response("{}", { headers: { "cache-control": "private, max-age=5" } }));
    const [request, url] = req("/api/v1/leads");
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(response.headers.get("cache-control")).toBe("private, max-age=5");
  });

  it("redirect do upstream volta ao cliente, não é seguido", async () => {
    const { fetchImpl } = stubFetch(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }));
    const [request, url] = req("/api/v1/leads");
    const response = await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://elsewhere.example/");
  });
});

describe("silêncio", () => {
  it("o proxy não loga nada — nem headers, nem corpo, nem query", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    try {
      const { fetchImpl } = stubFetch();
      const [request, url] = req("/api/v1/leads?email=lead@example.com", {
        method: "POST",
        body: '{"phone":"5511999998888"}',
        headers: { "x-api-key": "tq_live_segredo", "content-length": "26" },
      });
      await proxyApi(request, url, { upstream: UPSTREAM, fetchImpl });
      const failing = stubFetch(() => {
        throw new Error(`boom ${url.search}`);
      });
      const [request2, url2] = req("/api/v1/leads?email=lead@example.com");
      await proxyApi(request2, url2, { upstream: UPSTREAM, fetchImpl: failing.fetchImpl });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
