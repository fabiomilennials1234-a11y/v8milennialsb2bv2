/**
 * Path-based router for the public REST API (`/api/v1/*`).
 *
 * Pure routing core: `matchRoute` resolves a (method, path) pair against a
 * route table, extracting `{param}` path segments. No I/O — testable in
 * isolation.
 */

import { apiError } from "./responses.ts";
import { hasScope } from "./scopes.ts";

export type ApiRouteHandler = (ctx: ApiRouteContext) => Promise<Response>;

export interface ApiRoute {
  method: string;
  /** Path pattern with `{name}` placeholders, e.g. `/api/v1/leads/{id}`. */
  pattern: string;
  /** Scope required to call this route, or `null` for authenticated-no-scope. */
  scope: string | null;
  handler: ApiRouteHandler;
}

export interface ApiRouteContext {
  req: Request;
  params: Record<string, string>;
  /** Tenant resolved from the API key — inject into EVERY query (fail-closed). */
  organizationId: string;
  scopes: string[];
  keyId?: string;
  rateLimitPerMinute?: number;
  supabase: unknown;
  cors: Record<string, string>;
}

/** Shape returned by the injected key validator (matches `validateApiKey`). */
export interface ApiAuthResult {
  valid: boolean;
  organizationId?: string;
  keyId?: string;
  scopes?: string[];
  rateLimitPerMinute?: number;
  error?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the window resets (for the Retry-After header). */
  resetIn: number;
}

export interface ApiDeps {
  routes: ApiRoute[];
  authenticate: (req: Request) => Promise<ApiAuthResult>;
  cors: Record<string, string>;
  supabase: unknown;
  /** Optional per-key rate limiter; when omitted, no limiting is applied. */
  checkLimit?: (key: string, limitPerMinute: number) => RateLimitResult;
}

/**
 * Front controller for `/api/v1/*`. Resolves the route, authenticates the API
 * key, enforces the route scope, and dispatches with a tenant-scoped context.
 * All failures return the REST error envelope.
 */
export async function handleApiRequest(
  req: Request,
  deps: ApiDeps,
): Promise<Response> {
  const { cors } = deps;
  const path = new URL(req.url).pathname;

  const matched = matchRoute(req.method, path, deps.routes);
  if (!matched) {
    return apiError(404, "not_found", "Recurso não encontrado", cors);
  }

  const auth = await deps.authenticate(req);
  if (!auth.valid) {
    return apiError(401, "unauthorized", auth.error ?? "API key inválida", cors);
  }
  if (!auth.organizationId) {
    return apiError(403, "no_organization", "API key sem organização vinculada", cors);
  }

  if (deps.checkLimit) {
    const limit = auth.rateLimitPerMinute ?? 60;
    const key = auth.keyId ?? auth.organizationId;
    const rl = deps.checkLimit(key, limit);
    if (!rl.allowed) {
      return apiError(429, "rate_limited", "Limite de requisições excedido", cors, {
        retry_after_seconds: Math.ceil(rl.resetIn / 1000),
      }, { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) });
    }
  }

  const scopes = auth.scopes ?? [];
  const { route, params } = matched;
  if (route.scope !== null && !hasScope(scopes, route.scope)) {
    return apiError(403, "insufficient_scope", `API key requer escopo ${route.scope}`, cors);
  }

  return route.handler({
    req,
    params,
    organizationId: auth.organizationId,
    scopes,
    keyId: auth.keyId,
    rateLimitPerMinute: auth.rateLimitPerMinute,
    supabase: deps.supabase,
    cors,
  });
}

export interface RouteMatch {
  route: ApiRoute;
  params: Record<string, string>;
}

/**
 * Resolves the first route in `routes` whose method and pattern match the
 * given request method + path. Returns `null` when nothing matches.
 */
export function matchRoute(
  method: string,
  path: string,
  routes: ApiRoute[],
): RouteMatch | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, path);
    if (params) return { route, params };
  }
  return null;
}

function matchPattern(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const v = pathParts[i];
    if (p.startsWith("{") && p.endsWith("}")) {
      params[p.slice(1, -1)] = decodeURIComponent(v);
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}
