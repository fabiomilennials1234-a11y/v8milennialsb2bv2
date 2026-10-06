/**
 * Roteamento do front na Cloudflare: a precedência do nginx de produção
 * (Dockerfile:117-180) como função PURA. Decide a rota; quem faz I/O é o
 * worker.ts.
 *
 * O Worker nunca vê `/assets/*`: o `run_worker_first: ["/*", "!/assets/*"]`
 * manda esses caminhos direto para o servidor de assets. A regra de assets
 * daqui só pega variações de caixa (`/ASSETS/x.js`), que o padrão negativo
 * não cobre.
 */

export type IndexAsset = "/index.html" | "/index.classic.html";
export type ServiceWorkerAsset = "/sw.js" | "/sw.classic.js";

export type Route =
  /** `/` e `/index.html`: o index da interface escolhida pelo cookie. */
  | { kind: "index"; asset: IndexAsset }
  /** `/sw.js`: o service worker da mesma build do index. */
  | { kind: "service-worker"; asset: ServiceWorkerAsset }
  /** Páginas estáticas com caminho limpo, e a exceção de dotfile (Div1). */
  | { kind: "page"; asset: "/sobre.html" | "/privacidade.html" | "/.well-known/security.txt" }
  /** `/api/v1` sem barra: 301 relativo, como o nginx faria sem o bug do :8080 (Div4). */
  | { kind: "redirect"; location: string }
  /** `/api/v1/*`: proxy para a edge function `api`. */
  | { kind: "api" }
  | { kind: "method-not-allowed" }
  | { kind: "not-found" }
  /** `/lp/*`: landing pages estáticas, com headers próprios. */
  | { kind: "landing"; path: string }
  /** Resto: o arquivo exato, se existir; senão o index do SPA. */
  | { kind: "spa"; path: string; fallback: IndexAsset };

export type UiVariant = "v5" | "classic";

export const UI_COOKIE = "torque_ui";

/** Dockerfile:136 — `location ~* ^/assets/.*\.(…)$`. */
const ASSET_FILE = /^\/assets\/.*\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|map)$/i;

const SECURITY_TXT = "/.well-known/security.txt";

/** `;` separa pares no header Cookie; `,` também — ver `readCookie`. */
const isCookieSeparator = (ch: string | undefined): boolean => ch === ";" || ch === ",";

/**
 * Valor do cookie como o nginx lê (`$cookie_<nome>`, algoritmo de
 * `ngx_http_parse_cookie_lines` em src/http/ngx_http_parse.c): primeira
 * ocorrência, nome sem diferenciar maiúscula, espaços opcionais em volta do
 * `=`, espaço no fim do valor conta.
 *
 * Diferença de propósito (Div12): aqui `,` também separa pares. O nginx recebe
 * cada header `Cookie` numa linha própria e percorre uma por uma; o workerd
 * junta os headers repetidos num só, com `, ` — e o HTTP/2 manda o cookie em
 * pedaços, um por header. Só com `;` a V5 de quem manda `a=1` e `torque_ui=v5`
 * em headers separados cairia na clássica. O app nunca grava vírgula no
 * cookie, e o RFC 6265 proíbe o servidor de gravar: a vírgula como separador
 * não troca a interface de ninguém que use o app.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const wanted = name.toLowerCase();
  const end = header.length;
  let i = 0;

  while (i < end) {
    if (header.slice(i, i + wanted.length).toLowerCase() === wanted) {
      let j = i + wanted.length;
      while (j < end && header[j] === " ") j++;
      if (j < end && header[j] === "=") {
        j++;
        while (j < end && header[j] === " ") j++;
        let k = j;
        while (k < end && !isCookieSeparator(header[k])) k++;
        return header.slice(j, k);
      }
    }
    while (i < end) {
      if (isCookieSeparator(header[i++])) break;
    }
    while (i < end && header[i] === " ") i++;
  }

  return null;
}

/**
 * `map $cookie_torque_ui` do nginx: só `v5` (sem diferenciar maiúscula) liga a
 * V5. Ausente, com aspas ou qualquer outro valor = clássica.
 */
export function uiFromCookie(header: string | null): UiVariant {
  return readCookie(header, UI_COOKIE)?.toLowerCase() === "v5" ? "v5" : "classic";
}

/**
 * Caminho decodificado do jeito do servidor de assets: cada segmento passa por
 * `decodeURIComponent` (o que falha fica como veio) e barras repetidas viram
 * uma — como o `merge_slashes` do nginx.
 */
export function decodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/")
    .replace(/\/+/g, "/");
}

/** Inverso de `decodePath`, na forma canônica que o servidor de assets espera. */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return encodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/** Dockerfile:123 — `location ~ /\. { return 404; }`, sobre o caminho decodificado. */
export function hasDotSegment(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Segredo conhecido que mora no CAMINHO. Contém a lista `SECRET_PATH_SEGMENTS`
 * de src/shared/errors/sentry-event.ts (o que não sai para o Sentry também não
 * sai para o Workers Logs), aqui sem diferenciar maiúscula, e acrescenta o que
 * o Sentry ainda não tem; o teste `routing.test.ts` quebra se perder alguma.
 * - `/reset-password/:token`: o link do e-mail de redefinição
 *   (supabase/functions/forgot-password/index.ts) carrega o token, válido por 1 h.
 * - caminho de objeto do Storage: org, lead e nome de arquivo do cliente.
 * - `/checkout/:token`: o link de pagamento gerado pelo master
 *   (GeneratedLinkDialog.tsx; "O TOKEN É CREDENCIAL" em
 *   supabase/functions/billing-payment-link/index.ts).
 *
 * Vale só para as rotas de caminho conhecido (`FULL_PATH_ROUTES`); nas outras,
 * `logPath` corta o caminho antes.
 */
export const SECRET_PATH_SEGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\/reset-password\/[^/?#]+/gi, "/reset-password/:token"],
  [/(\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?[^/?#]+)\/[^?#]+/gi, "$1/:path"],
  [/\/checkout\/[^/?#]+/gi, "/checkout/:token"],
];

/**
 * Caminho que pode ir para o log: sem query (não recebe) e sem segredo no path.
 * Decodifica antes (`/reset-password%2Ftoken` também abre a tela) e ignora
 * maiúscula (o React Router casa `/RESET-PASSWORD/…` com a mesma rota).
 */
export function redactPath(pathname: string): string {
  let out = decodePath(pathname);
  for (const [pattern, replacement] of SECRET_PATH_SEGMENTS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Rotas de estrutura conhecida, cujo caminho inteiro pode ir para o log depois
 * do `redactPath`. Todas as outras — `spa`, `method-not-allowed`, `not-found`,
 * erro antes de saber a rota e qualquer rota nova — ficam com o caminho
 * cortado. Negar por padrão: rota nova nasce sem vazar.
 */
const FULL_PATH_ROUTES: ReadonlySet<string> = new Set<Route["kind"]>([
  "api",
  "landing",
  "page",
  "index",
  "service-worker",
  "redirect",
]);

/** Segmento que tem cara de rota do app: curto, minúsculo, kebab-case. */
const ROUTE_LIKE_SEGMENT = /^[a-z0-9-]{1,32}$/;

/**
 * O caminho que vai para o log, conforme a rota.
 *
 * Fora de `FULL_PATH_ROUTES`, o caminho é qualquer coisa que o cliente mandou:
 * deep link do app, link de e-mail com token, sondagem. Ali pode morar um token
 * que ninguém listou — foi assim com `/checkout/<token>`. Então só vai o
 * primeiro segmento (decodificado, minúsculo), mais `/*` se houver outros, e
 * ele mesmo vira `:seg` se não tiver cara de rota (mais de 32 caracteres ou
 * fora de `[a-z0-9-]`, como `/<token>` ou `/checkout;<token>`):
 * `/checkout/<token>` → `/checkout/*`, `/leads` → `/leads`, `/<token>` → `/:seg`.
 *
 * Nas rotas de `FULL_PATH_ROUTES`, `redactPath` tira os segredos conhecidos.
 */
export function logPath(route: Route["kind"] | "error", pathname: string): string {
  if (FULL_PATH_ROUTES.has(route)) return redactPath(pathname);
  const segments = decodePath(pathname).split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const first = segments[0]!.toLowerCase();
  const shown = ROUTE_LIKE_SEGMENT.test(first) ? first : ":seg";
  return `/${shown}${segments.length > 1 ? "/*" : ""}`;
}

export function resolveRoute(url: URL, method: string, cookieHeader: string | null): Route {
  const path = decodePath(url.pathname);
  const ui = uiFromCookie(cookieHeader);
  const index: IndexAsset = ui === "v5" ? "/index.html" : "/index.classic.html";

  // Dockerfile:128 — `location ^~ /api/v1/`: vence as regex e vale para
  // qualquer método. Sem a barra, o nginx responde 301 para a pasta.
  if (path === "/api/v1") return { kind: "redirect", location: `/api/v1/${url.search}` };
  if (path.startsWith("/api/v1/")) return { kind: "api" };

  // O nginx só serve arquivo estático para GET/HEAD; o resto é 405.
  if (method !== "GET" && method !== "HEAD") return { kind: "method-not-allowed" };

  // Dockerfile:149-175 — os `location =`.
  if (path === "/" || path === "/index.html") return { kind: "index", asset: index };
  if (path === "/sw.js") {
    return { kind: "service-worker", asset: ui === "v5" ? "/sw.js" : "/sw.classic.js" };
  }
  if (path === "/sobre") return { kind: "page", asset: "/sobre.html" };
  if (path === "/privacidade") return { kind: "page", asset: "/privacidade.html" };

  if (hasDotSegment(path)) {
    return path === SECURITY_TXT ? { kind: "page", asset: SECURITY_TXT } : { kind: "not-found" };
  }

  if (path.startsWith("/lp/")) return { kind: "landing", path };

  if (ASSET_FILE.test(path)) return { kind: "not-found" };

  return { kind: "spa", path, fallback: index };
}
