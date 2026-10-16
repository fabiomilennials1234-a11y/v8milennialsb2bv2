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

/**
 * Interface única (V5) desde 2026-10-14. O cookie `torque_ui` não escolhe mais
 * nada: `/`, `/index.html`, o SPA e `/sw.js` são sempre da V5.
 */
export const INDEX_ASSET = "/index.html";
export const SERVICE_WORKER_ASSET = "/sw.js";

/**
 * A build clássica continua no artefato (rollback = reverter o commit do
 * Worker), mas não é servida: o caminho direto dos arquivos dela é 404, para
 * ninguém cair na clássica por URL. Comparado sem diferenciar maiúscula.
 */
const CLASSIC_ENTRY_FILES: ReadonlySet<string> = new Set(["/index.classic.html", "/sw.classic.js", "/sw.classic.js.map"]);

export type Route =
  /** `/` e `/index.html`: o index da V5. */
  | { kind: "index"; asset: typeof INDEX_ASSET }
  /** `/sw.js`: o service worker da V5. */
  | { kind: "service-worker"; asset: typeof SERVICE_WORKER_ASSET }
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
  /** Resto: o arquivo exato, se existir; senão o index da V5. */
  | { kind: "spa"; path: string };

/** Dockerfile — `location ~* ^/assets/.*\.(…)$`. */
const ASSET_FILE = /^\/assets\/.*\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|map)$/i;

const SECURITY_TXT = "/.well-known/security.txt";

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

export function resolveRoute(url: URL, method: string): Route {
  const path = decodePath(url.pathname);

  // Dockerfile — `location ^~ /api/v1/`: vence as regex e vale para
  // qualquer método. Sem a barra, o nginx responde 301 para a pasta.
  if (path === "/api/v1") return { kind: "redirect", location: `/api/v1/${url.search}` };
  if (path.startsWith("/api/v1/")) return { kind: "api" };

  // O nginx só serve arquivo estático para GET/HEAD; o resto é 405.
  if (method !== "GET" && method !== "HEAD") return { kind: "method-not-allowed" };

  // Dockerfile — os `location =`.
  if (path === "/" || path === INDEX_ASSET) return { kind: "index", asset: INDEX_ASSET };
  if (path === SERVICE_WORKER_ASSET) return { kind: "service-worker", asset: SERVICE_WORKER_ASSET };
  if (CLASSIC_ENTRY_FILES.has(path.toLowerCase())) return { kind: "not-found" };
  if (path === "/sobre") return { kind: "page", asset: "/sobre.html" };
  if (path === "/privacidade") return { kind: "page", asset: "/privacidade.html" };

  if (hasDotSegment(path)) {
    return path === SECURITY_TXT ? { kind: "page", asset: SECURITY_TXT } : { kind: "not-found" };
  }

  if (path.startsWith("/lp/")) return { kind: "landing", path };

  if (ASSET_FILE.test(path)) return { kind: "not-found" };

  return { kind: "spa", path };
}
