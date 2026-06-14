import { assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  handleApiRequest,
  matchRoute,
  type ApiDeps,
  type ApiRoute,
} from "./router.ts";

const noop = () =>
  Promise.resolve(new Response(null, { status: 200 }));

const cors = { "access-control-allow-origin": "*" };

function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    cors,
    supabase: {},
    routes: [
      {
        method: "GET",
        pattern: "/api/v1/ping",
        scope: null,
        handler: (ctx) =>
          Promise.resolve(
            new Response(JSON.stringify({ pong: true, org: ctx.organizationId }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
      },
      {
        method: "GET",
        pattern: "/api/v1/leads/{id}",
        scope: "lead:read",
        handler: (ctx) =>
          Promise.resolve(
            new Response(JSON.stringify({ id: ctx.params.id }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
      },
    ],
    authenticate: () =>
      Promise.resolve({
        valid: true,
        organizationId: "org-1",
        keyId: "key-1",
        scopes: ["lead:read"],
      }),
    ...over,
  };
}

function req(method: string, path: string): Request {
  return new Request(`https://x.fn${path}`, { method });
}

const routes: ApiRoute[] = [
  { method: "GET", pattern: "/api/v1/ping", scope: null, handler: noop },
  { method: "GET", pattern: "/api/v1/leads/{id}", scope: "lead:read", handler: noop },
  { method: "POST", pattern: "/api/v1/leads/{id}/stage", scope: "lead:write", handler: noop },
];

Deno.test("matchRoute — matches exact static path", () => {
  const m = matchRoute("GET", "/api/v1/ping", routes);
  assertEquals(m?.route.pattern, "/api/v1/ping");
  assertEquals(m?.params, {});
});

Deno.test("matchRoute — extracts path params", () => {
  const m = matchRoute("GET", "/api/v1/leads/abc-123", routes);
  assertEquals(m?.route.pattern, "/api/v1/leads/{id}");
  assertEquals(m?.params, { id: "abc-123" });
});

Deno.test("matchRoute — url-decodes param values", () => {
  const m = matchRoute("GET", "/api/v1/leads/a%2Fb", routes);
  assertEquals(m?.params, { id: "a/b" });
});

Deno.test("matchRoute — returns null for unknown path", () => {
  assertEquals(matchRoute("GET", "/api/v1/nope", routes), null);
});

Deno.test("matchRoute — method mismatch does not match", () => {
  assertEquals(matchRoute("POST", "/api/v1/ping", routes), null);
});

Deno.test("matchRoute — distinguishes nested sub-resource from leaf", () => {
  const leaf = matchRoute("GET", "/api/v1/leads/x", routes);
  assertEquals(leaf?.route.pattern, "/api/v1/leads/{id}");
  const stage = matchRoute("POST", "/api/v1/leads/x/stage", routes);
  assertEquals(stage?.route.pattern, "/api/v1/leads/{id}/stage");
});

Deno.test("handleApiRequest — 404 for unknown route", async () => {
  const res = await handleApiRequest(req("GET", "/api/v1/nope"), deps());
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "not_found");
});

Deno.test("handleApiRequest — 401 when key invalid", async () => {
  const res = await handleApiRequest(
    req("GET", "/api/v1/ping"),
    deps({ authenticate: () => Promise.resolve({ valid: false, error: "bad key" }) }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "unauthorized");
});

Deno.test("handleApiRequest — public route runs after auth, receives org", async () => {
  const res = await handleApiRequest(req("GET", "/api/v1/ping"), deps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { pong: true, org: "org-1" });
});

Deno.test("handleApiRequest — 403 insufficient_scope when key lacks scope", async () => {
  const res = await handleApiRequest(
    req("GET", "/api/v1/leads/abc"),
    deps({
      authenticate: () =>
        Promise.resolve({ valid: true, organizationId: "org-1", scopes: ["pipeline:read"] }),
    }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "insufficient_scope");
});

Deno.test("handleApiRequest — dispatches with params when scope satisfied", async () => {
  const res = await handleApiRequest(req("GET", "/api/v1/leads/abc-123"), deps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { id: "abc-123" });
});

Deno.test("handleApiRequest — 403 when key has no org bound", async () => {
  const res = await handleApiRequest(
    req("GET", "/api/v1/ping"),
    deps({ authenticate: () => Promise.resolve({ valid: true, scopes: [] }) }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "no_organization");
});

Deno.test("handleApiRequest — 429 when rate limit exceeded, sets Retry-After", async () => {
  const res = await handleApiRequest(
    req("GET", "/api/v1/ping"),
    deps({ checkLimit: () => ({ allowed: false, resetIn: 5000 }) }),
  );
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("retry-after"), "5");
  const body = await res.json();
  assertEquals(body.error.code, "rate_limited");
});

Deno.test("handleApiRequest — rate limit checked per key after auth", async () => {
  let seenKey = "";
  const res = await handleApiRequest(
    req("GET", "/api/v1/ping"),
    deps({ checkLimit: (k) => { seenKey = k; return { allowed: true, resetIn: 0 }; } }),
  );
  assertEquals(res.status, 200);
  assertEquals(seenKey, "key-1");
});
