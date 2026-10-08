/**
 * `/api/v1/*` → edge function `api` do Supabase (Dockerfile:128-134).
 *
 * Proxy transparente: método, query, corpo e credenciais do cliente passam como
 * vieram, e a resposta volta como veio. Este arquivo não loga nada e não
 * acrescenta credencial nenhuma — quem autentica é a function, pela X-API-Key
 * que o próprio cliente mandou.
 */
import { CACHE, addIfAbsent, applyProfile } from "./headers";

/** `client_max_body_size` padrão do nginx (1m). */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Dockerfile:133 — `proxy_read_timeout 30s`. No nginx o relógio vale entre duas
 * leituras do upstream, inclusive durante o corpo. Aqui vale só até os headers
 * chegarem; o corpo segue sem relógio (a function `api` responde JSON pequeno,
 * de uma vez).
 */
export const HEADERS_TIMEOUT_MS = 30_000;

/** O único lugar para onde o proxy fala. */
export const UPSTREAM_PREFIX = "/functions/v1/api/v1/";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface ProxyOptions {
  /** Origem do Supabase (`vars.API_UPSTREAM`). Só https, sem caminho. */
  upstream: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Envelope de erro da API pública (`_shared/api/responses.ts`). */
export function apiErrorResponse(status: number, code: string, message: string): Response {
  const response = new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  return applyProfile(response, "app", CACHE.noStore);
}

function upstreamOrigin(upstream: string): string {
  const url = new URL(upstream);
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if (url.protocol !== "https:" || !bare) {
    throw new Error("API_UPSTREAM precisa ser uma origem https, sem caminho");
  }
  return url.origin;
}

/**
 * O caminho cru precisa começar com `/api/v1/` e nenhum segmento pode, depois
 * de decodificado, virar `.`/`..` ou carregar `/`/`\`. Sem isso, `..%2f` passaria
 * pelo prefixo aqui e seria resolvido do outro lado, fora da function `api`.
 */
export function isSafeApiPath(rawPathname: string): boolean {
  if (!rawPathname.startsWith("/api/v1/")) return false;
  const segments = rawPathname.split("/").slice(1);
  return segments.every((segment, index) => {
    if (segment === "") return index === segments.length - 1;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    return decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\\");
  });
}

/**
 * Headers que seguem para o Supabase: os do cliente, menos transporte e procedência.
 *
 * `Accept-Encoding` é o que o CLIENTE mandou (`request.cf.clientAcceptEncoding`),
 * como o nginx repassa. O header que chega ao Worker não serve: a Cloudflare o
 * troca por `br, gzip` antes, e repassá-lo faria o Supabase comprimir para quem
 * não pediu — `curl` sem `--compressed` receberia gzip cru. Cliente sem
 * Accept-Encoding → `identity`.
 */
export function forwardHeaders(incoming: Headers, clientAcceptEncoding?: string): Headers {
  const headers = new Headers(incoming);
  const listedInConnection = (incoming.get("connection") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  for (const name of [...headers.keys()]) {
    if (
      HOP_BY_HOP.has(name) ||
      listedInConnection.includes(name) ||
      name === "host" ||
      name === "content-length" ||
      name === "x-real-ip" ||
      name.startsWith("cf-") ||
      name.startsWith("x-forwarded-")
    ) {
      headers.delete(name);
    }
  }

  // $proxy_add_x_forwarded_for: a cadeia recebida mais o IP do cliente.
  const chain = (incoming.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const client = incoming.get("cf-connecting-ip")?.trim();
  if (client && chain[chain.length - 1] !== client) chain.push(client);
  if (chain.length > 0) headers.set("X-Forwarded-For", chain.join(", "));
  headers.set("X-Forwarded-Proto", "https");
  headers.set("Accept-Encoding", clientAcceptEncoding?.trim() ? clientAcceptEncoding : "identity");

  return headers;
}

/** Lê o corpo até `limit` bytes; `null` se passar do limite. */
async function readCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** O Accept-Encoding original do cliente, que a Cloudflare guarda em `request.cf`. */
function clientAcceptEncodingOf(request: Request): string | undefined {
  const cf = (request as { cf?: { clientAcceptEncoding?: unknown } }).cf;
  return typeof cf?.clientAcceptEncoding === "string" ? cf.clientAcceptEncoding : undefined;
}

type Body = ReadableStream<Uint8Array> | Uint8Array | null;

async function requestBody(request: Request): Promise<Body | Response> {
  if (request.method === "GET" || request.method === "HEAD" || request.body === null) return null;

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared.trim())) {
      return apiErrorResponse(400, "bad_request", "Invalid Content-Length header");
    }
    if (Number(declared) > BODY_LIMIT_BYTES) {
      return apiErrorResponse(413, "payload_too_large", "Request body exceeds 1 MiB");
    }
    return request.body;
  }

  // Sem Content-Length (chunked): conta enquanto lê, como o nginx.
  const buffered = await readCapped(request.body, BODY_LIMIT_BYTES);
  return buffered ?? apiErrorResponse(413, "payload_too_large", "Request body exceeds 1 MiB");
}

export async function proxyApi(request: Request, url: URL, options: ProxyOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? HEADERS_TIMEOUT_MS;

  if (!isSafeApiPath(url.pathname)) {
    return apiErrorResponse(400, "bad_request", "Invalid API path");
  }

  const origin = upstreamOrigin(options.upstream);
  const target = new URL(`/functions/v1${url.pathname}${url.search}`, origin);
  if (target.origin !== origin || !target.pathname.startsWith(UPSTREAM_PREFIX)) {
    return apiErrorResponse(400, "bad_request", "Invalid API path");
  }

  const body = await requestBody(request);
  if (body instanceof Response) return body;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetchImpl(target.toString(), {
      method: request.method,
      headers: forwardHeaders(request.headers, clientAcceptEncodingOf(request)),
      body,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch {
    return timedOut
      ? apiErrorResponse(504, "gateway_timeout", "Upstream did not respond in time")
      : apiErrorResponse(502, "bad_gateway", "Upstream unavailable");
  } finally {
    // Os headers chegaram (ou falharam): o corpo segue sem relógio.
    clearTimeout(timer);
  }

  const response = new Response(upstream.body, upstream);
  addIfAbsent(response.headers, "app");
  return response;
}
