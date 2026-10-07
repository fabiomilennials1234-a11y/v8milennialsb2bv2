/**
 * Entrada do Worker do front. Decide a rota (routing.ts), busca no servidor de
 * assets ou no proxy da API, e impõe os headers do nginx (headers.ts).
 *
 * Log: uma linha por requisição com método, caminho, rota, status e duração.
 * Nunca headers, corpo ou query — a query da API pode carregar dado de lead —,
 * e o caminho passa por `logPath`: em rota desconhecida (SPA) só o primeiro
 * segmento, nas outras sem os segredos conhecidos (token de redefinição de
 * senha, link de pagamento).
 */
import { proxyApi } from "./api-proxy";
import { CACHE, ROBOTS_HEADER, ROBOTS_VALUE, VERSION_HEADER, applyProfile, type Profile } from "./headers";
import { encodePath, logPath, resolveRoute, type Route } from "./routing";

function plain(status: number, text: string, extra?: Record<string, string>): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...extra },
  });
}

function notFound(profile: Profile = "app"): Response {
  return applyProfile(plain(404, "Not Found"), profile, CACHE.noStore);
}

/**
 * Busca o caminho exato no servidor de assets, com o método e os headers do
 * cliente (If-None-Match → 304). `null` quando o arquivo não existe.
 */
async function fetchAsset(env: Env, request: Request, url: URL, path: string): Promise<Response | null> {
  const response = await env.ASSETS.fetch(new URL(encodePath(path), url.origin).toString(), {
    method: request.method,
    headers: request.headers,
  });
  return response.status === 404 ? null : response;
}

async function assetExists(env: Env, url: URL, path: string): Promise<boolean> {
  const response = await env.ASSETS.fetch(new URL(encodePath(path), url.origin).toString(), { method: "HEAD" });
  return response.status !== 404;
}

/**
 * Dockerfile:144-148 — `try_files $uri $uri/ =404` com `index index.html`.
 * Pasta sem index: 404 em vez do 403 do nginx (Div2).
 */
async function serveLanding(env: Env, request: Request, url: URL, path: string): Promise<Response> {
  const exact = await fetchAsset(env, request, url, path);
  if (exact) return applyProfile(exact, "lp", CACHE.landing);

  if (path.endsWith("/")) {
    const index = await fetchAsset(env, request, url, `${path}index.html`);
    return index ? applyProfile(index, "lp", CACHE.landing) : notFound("lp");
  }

  if (await assetExists(env, url, `${path}/index.html`)) {
    // Relativo: o nginx de hoje manda `http://…:8080/…` (Div4).
    const redirect = new Response(null, {
      status: 301,
      headers: { Location: `${encodePath(path)}/${url.search}` },
    });
    return applyProfile(redirect, "lp", CACHE.landing);
  }

  return notFound("lp");
}

async function handle(route: Route, request: Request, url: URL, env: Env): Promise<Response> {
  switch (route.kind) {
    case "index":
    case "service-worker":
    case "page": {
      const asset = await fetchAsset(env, request, url, route.asset);
      return asset ? applyProfile(asset, "app", CACHE.noStore) : notFound();
    }
    case "redirect":
      return applyProfile(
        new Response(null, { status: 301, headers: { Location: route.location } }),
        "app",
        CACHE.noStore,
      );
    case "api":
      return proxyApi(request, url, { upstream: env.API_UPSTREAM });
    case "method-not-allowed":
      return applyProfile(plain(405, "Method Not Allowed", { Allow: "GET, HEAD" }), "app", CACHE.noStore);
    case "not-found":
      return notFound();
    case "landing":
      return serveLanding(env, request, url, route.path);
    case "spa": {
      const exact = route.path.endsWith("/") ? null : await fetchAsset(env, request, url, route.path);
      const response = exact ?? (await fetchAsset(env, request, url, route.fallback));
      return response ? applyProfile(response, "app", CACHE.noStore) : notFound();
    }
  }
}

function log(entry: Record<string, string | number>): void {
  console.log(JSON.stringify(entry));
}

// `Env` vem de worker-configuration.d.ts (`wrangler types`): renomear um
// binding no wrangler.jsonc sem regerar os tipos quebra o cf:typecheck.
export default {
  async fetch(request, env): Promise<Response> {
    const startedAt = Date.now();
    const url = new URL(request.url);
    let route: Route["kind"] | "error" = "error";
    let response: Response;

    try {
      const resolved = resolveRoute(url, request.method, request.headers.get("cookie"));
      route = resolved.kind;
      response = await handle(resolved, request, url, env);
    } catch (error) {
      // Nome do erro só: a mensagem pode carregar a URL com a query.
      log({ level: "error", method: request.method, path: logPath(route, url.pathname), route, error: error instanceof Error ? error.name : "unknown" });
      route = "error";
      response = applyProfile(plain(500, "Internal Server Error"), "app", CACHE.noStore);
    }

    // Div8: a cópia em *.workers.dev não entra em buscador.
    if (url.hostname.endsWith(".workers.dev")) response.headers.set(ROBOTS_HEADER, ROBOTS_VALUE);
    // Prova de versão para o smoke do deploy (docs/DEPLOY_CLOUDFLARE.md, "Pipeline").
    response.headers.set(VERSION_HEADER, env.CF_VERSION_METADATA.id);

    log({ method: request.method, path: logPath(route, url.pathname), route, status: response.status, ms: Date.now() - startedAt });
    return response;
  },
} satisfies ExportedHandler<Env>;
