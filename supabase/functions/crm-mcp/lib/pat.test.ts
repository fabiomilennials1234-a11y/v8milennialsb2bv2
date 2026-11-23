import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertWellFormedJwt,
  assertWellFormedResolverJwt,
  type AuthRow,
  classifyAuthRow,
  crc32,
  generatePat,
  hashToken,
  MINT_TTL_SEC,
  mintResolverJwt,
  mintUserJwt,
  parsePat,
  RESOLVER_ROLE,
  RESOLVER_TTL_SEC,
  toSigningJwk,
} from "./pat.ts";
import { importJWK } from "jose";

const UUID = "11111111-1111-4111-8111-111111111111";

// --- signing key ------------------------------------------------------------------------

Deno.test("toSigningJwk: the JWK exactly as Supabase's signing-keys API requires it imports for ES256", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
  // What we upload to POST /config/auth/signing-keys and store as the secret.
  const supabaseShape = JSON.stringify({
    ...priv,
    kid: "9272496f-06ef-4b06-bdbd-4e6b6f569c71",
    alg: "ES256",
    use: "sig",
    key_ops: ["sign", "verify"],
    ext: true,
  });
  // Control: the raw shape is what broke the first deploy ("Invalid key usage").
  await assertRejects(() => importJWK(JSON.parse(supabaseShape), "ES256"));
  const key = await importJWK(toSigningJwk(supabaseShape), "ES256");
  const jwt = await mintResolverJwt(
    { projectRef: "ref", signingKey: key as CryptoKey, kid: "k" },
    1,
  );
  assertEquals(jwt.split(".").length, 3);
});

Deno.test("toSigningJwk: refuses non-JSON, wrong curve and a PUBLIC key with a clear message", () => {
  assertThrows(() => toSigningJwk("nope"), Error, "not JSON");
  assertThrows(() => toSigningJwk('{"kty":"RSA"}'), Error, "P-256");
  assertThrows(() => toSigningJwk('{"kty":"EC","crv":"P-256","x":"a","y":"b"}'), Error, "PRIVATE");
});

// --- token format ---------------------------------------------------------------------

Deno.test("generatePat → parsePat round-trips and the prefix/hash are well-formed", async () => {
  const { token, tokenHash, tokenPrefix } = await generatePat("live");
  const parsed = parsePat(token);
  assertNotEquals(parsed, null);
  assertEquals(parsed!.env, "live");
  assertEquals(parsed!.full, token);
  assertEquals(token.startsWith("tq_mcp_live_"), true);
  assertEquals(tokenPrefix, token.slice(0, "tq_mcp_live_".length + 8));
  assertEquals(tokenHash.length, 64); // sha256 hex
  assertEquals(/^[0-9a-f]{64}$/.test(tokenHash), true);
});

Deno.test("parsePat rejects wrong prefix, wrong length, and a corrupted checksum", async () => {
  const { token } = await generatePat("test");
  assertEquals(parsePat("nope"), null);
  assertEquals(parsePat("tq_mcp_prod_" + token.slice(12)), null); // bad env
  assertEquals(parsePat(token.slice(0, -1)), null); // truncated
  // Flip the last char of the body → CRC32 mismatch → rejected offline.
  const bodyStart = "tq_mcp_test_".length;
  const flipped = token.slice(0, bodyStart) +
    (token[bodyStart] === "a" ? "b" : "a") + token.slice(bodyStart + 1);
  assertEquals(parsePat(flipped), null);
});

Deno.test("crc32 is deterministic and matches a known vector", () => {
  assertEquals(crc32("123456789"), 0xcbf43926); // standard CRC-32 check value
  assertEquals(crc32("abc"), crc32("abc"));
  assertNotEquals(crc32("abc"), crc32("abd"));
});

Deno.test("hashToken: stable, distinct per token, and pepper changes the digest", async () => {
  const { token } = await generatePat("live");
  const a = await hashToken(token);
  const b = await hashToken(token);
  assertEquals(a, b); // deterministic
  const peppered = await hashToken(token, "secret-pepper");
  assertNotEquals(a, peppered); // HMAC path differs from plain sha256
  const other = await generatePat("live");
  assertNotEquals(a, await hashToken(other.token));
});

// --- pure resolution logic ------------------------------------------------------------

const PAT = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const NOW = 1_900_000_000_000;
const FUTURE = new Date(NOW + 86_400_000).toISOString();

function row(over: Partial<AuthRow> = {}): AuthRow {
  return {
    pat_id: PAT,
    user_id: UUID,
    organization_id: ORG,
    scopes: ["read"],
    audience: "crm-mcp",
    expires_at: FUTURE,
    revoked_at: null,
    principal: "ok",
    outcome: "ok",
    retry_after_seconds: null,
    ...over,
  };
}

Deno.test("classifyAuthRow: no row → not_found (no existence oracle)", () => {
  assertEquals(classifyAuthRow(null, NOW), { kind: "unauthorized", reason: "not_found" });
});

Deno.test("classifyAuthRow: ok verdict with consistent facts → principal from the TOKEN", () => {
  assertEquals(classifyAuthRow(row(), NOW), {
    kind: "ok",
    principal: { patId: PAT, userId: UUID, orgId: ORG, scopes: ["read"] },
  });
});

Deno.test("classifyAuthRow: DB verdicts map to the right decision", () => {
  assertEquals(classifyAuthRow(row({ outcome: "revoked" }), NOW).kind, "unauthorized");
  assertEquals(classifyAuthRow(row({ outcome: "expired" }), NOW), {
    kind: "unauthorized",
    reason: "expired",
  });
  for (const r of ["master_principal", "not_member", "org_blocked", "org_disabled"] as const) {
    assertEquals(classifyAuthRow(row({ outcome: r, principal: r }), NOW), {
      kind: "forbidden",
      reason: r,
    });
  }
  assertEquals(classifyAuthRow(row({ outcome: "rate_limited", retry_after_seconds: 17 }), NOW), {
    kind: "rate_limited",
    retryAfterSeconds: 17,
  });
  // a missing/garbage Retry-After still yields a sane one
  assertEquals(classifyAuthRow(row({ outcome: "rate_limited", retry_after_seconds: null }), NOW), {
    kind: "rate_limited",
    retryAfterSeconds: 60,
  });
});

Deno.test("classifyAuthRow: FAILS CLOSED when an `ok` verdict contradicts the facts", () => {
  // A future SQL regression that answers ok must not let these through.
  assertEquals(classifyAuthRow(row({ revoked_at: "2020-01-01T00:00:00Z" }), NOW), {
    kind: "unauthorized",
    reason: "revoked",
  });
  assertEquals(classifyAuthRow(row({ expires_at: "2020-01-01T00:00:00Z" }), NOW), {
    kind: "unauthorized",
    reason: "expired",
  });
  assertEquals(classifyAuthRow(row({ expires_at: "not-a-date" }), NOW).kind, "unauthorized");
  assertEquals(classifyAuthRow(row({ principal: "master_principal" }), NOW), {
    kind: "forbidden",
    reason: "master_principal",
  });
  assertEquals(classifyAuthRow(row({ principal: "weird" }), NOW), {
    kind: "forbidden",
    reason: "inconsistent",
  });
  assertEquals(classifyAuthRow(row({ audience: "other" }), NOW), {
    kind: "forbidden",
    reason: "audience",
  });
  assertEquals(classifyAuthRow(row({ scopes: [] }), NOW), { kind: "forbidden", reason: "scope" });
  assertEquals(classifyAuthRow(row({ scopes: null }), NOW), { kind: "forbidden", reason: "scope" });
  assertEquals(classifyAuthRow(row({ organization_id: "org-A" }), NOW), {
    kind: "forbidden",
    reason: "inconsistent",
  });
});

Deno.test("classifyAuthRow: an unknown verdict is never ok", () => {
  assertEquals(classifyAuthRow(row({ outcome: "maybe" }), NOW), {
    kind: "forbidden",
    reason: "inconsistent",
  });
});

// --- mint + hard-fail-closed guard ----------------------------------------------------

async function es256Key(): Promise<CryptoKey> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  return kp.privateKey;
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.test("mintUserJwt: produces a 60s-capped authenticated JWT with sub=userId, no org claim", async () => {
  const key = await es256Key();
  const now = 1_900_000_000;
  const jwt = await mintUserJwt(
    { userId: UUID, email: "u@example.com", projectRef: "ref", signingKey: key, kid: "k1" },
    now,
  );
  assertWellFormedJwt(jwt); // must pass
  const payload = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      ),
    ),
  );
  assertEquals(payload.sub, UUID);
  assertEquals(payload.role, "authenticated");
  assertEquals(payload.aud, "authenticated");
  assertEquals(payload.exp - payload.iat, MINT_TTL_SEC);
  assertEquals("organization_id" in payload, false); // H3b: no org claim
  assertEquals("app_metadata" in payload, false);
});

Deno.test("mintUserJwt: refuses a non-UUID sub", async () => {
  const key = await es256Key();
  await assertRejects(
    () =>
      mintUserJwt(
        { userId: "not-a-uuid", email: "x", projectRef: "r", signingKey: key, kid: "k" },
        1,
      ),
    Error,
    "non-UUID sub",
  );
});

Deno.test("assertWellFormedJwt: throws on >60s ttl, wrong role, and non-UUID sub", () => {
  const head = b64url({ alg: "ES256", typ: "JWT" });
  const sig = "x";
  // ttl 300s > cap
  assertThrows(
    () =>
      assertWellFormedJwt(
        `${head}.${
          b64url({ sub: UUID, role: "authenticated", aud: "authenticated", iat: 100, exp: 400 })
        }.${sig}`,
      ),
    Error,
    "ttl",
  );
  // wrong role (service_role) — must never pass
  assertThrows(
    () =>
      assertWellFormedJwt(
        `${head}.${
          b64url({ sub: UUID, role: "service_role", aud: "authenticated", iat: 100, exp: 130 })
        }.${sig}`,
      ),
    Error,
    "role",
  );
  // non-UUID sub
  assertThrows(
    () =>
      assertWellFormedJwt(
        `${head}.${
          b64url({ sub: "anon", role: "authenticated", aud: "authenticated", iat: 100, exp: 130 })
        }.${sig}`,
      ),
    Error,
    "sub",
  );
});

Deno.test("mintResolverJwt: role crm_mcp_resolver, no sub, 30s — and the guard enforces it", async () => {
  const key = await es256Key();
  const now = 1_900_000_000;
  const jwt = await mintResolverJwt({ projectRef: "ref", signingKey: key, kid: "k1" }, now);
  assertWellFormedResolverJwt(jwt);
  const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  assertEquals(payload.role, RESOLVER_ROLE);
  assertEquals("sub" in payload, false);
  assertEquals(payload.exp - payload.iat, RESOLVER_TTL_SEC);
  // the user guard must reject it (no sub, wrong role) — the two tokens never interchange
  assertThrows(() => assertWellFormedJwt(jwt), Error);
});

Deno.test("assertWellFormedResolverJwt: rejects service_role, a sub, and a long ttl", () => {
  const head = b64url({ alg: "ES256", typ: "JWT" });
  const mk = (p: Record<string, unknown>) => `${head}.${b64url(p)}.x`;
  assertThrows(
    () => assertWellFormedResolverJwt(mk({ role: "service_role", iat: 1, exp: 20 })),
    Error,
    "role",
  );
  assertThrows(
    () => assertWellFormedResolverJwt(mk({ role: RESOLVER_ROLE, sub: UUID, iat: 1, exp: 20 })),
    Error,
    "sub",
  );
  assertThrows(
    () => assertWellFormedResolverJwt(mk({ role: RESOLVER_ROLE, iat: 1, exp: 100 })),
    Error,
    "ttl",
  );
});
