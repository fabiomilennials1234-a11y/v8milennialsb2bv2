import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertEligiblePrincipal,
  assertWellFormedJwt,
  classifyTokenRow,
  crc32,
  generatePat,
  hashToken,
  MINT_TTL_SEC,
  mintUserJwt,
  parsePat,
  type PatRow,
} from "./pat.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

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

function row(over: Partial<PatRow> = {}): PatRow {
  return {
    id: "pat-1",
    user_id: UUID,
    organization_id: "org-A",
    scopes: ["read"],
    expires_at: null,
    revoked_at: null,
    audience: "crm-mcp",
    ...over,
  };
}
const NOW = 1_900_000_000_000;

Deno.test("classifyTokenRow: empty row → not_found (no existence oracle)", () => {
  assertEquals(classifyTokenRow(null, NOW), { kind: "unauthorized", reason: "not_found" });
});

Deno.test("classifyTokenRow: revoked / expired → unauthorized; bad audience → forbidden", () => {
  assertEquals(classifyTokenRow(row({ revoked_at: "2020-01-01T00:00:00Z" }), NOW), {
    kind: "unauthorized",
    reason: "revoked",
  });
  assertEquals(classifyTokenRow(row({ expires_at: "2020-01-01T00:00:00Z" }), NOW), {
    kind: "unauthorized",
    reason: "expired",
  });
  assertEquals(classifyTokenRow(row({ audience: "some-other-product" }), NOW), {
    kind: "forbidden",
    reason: "audience",
  });
});

Deno.test("classifyTokenRow: valid, unexpired, right audience → ok", () => {
  const out = classifyTokenRow(row({ expires_at: "2099-01-01T00:00:00Z" }), NOW);
  assertEquals(out.kind, "ok");
});

Deno.test("assertEligiblePrincipal: master owner → forbidden (H1)", () => {
  assertEquals(
    assertEligiblePrincipal({ isMaster: true, currentOrgIds: ["org-A"], patOrgId: "org-A" }),
    { kind: "forbidden", reason: "master_principal" },
  );
});

Deno.test("assertEligiblePrincipal: PAT org not in current membership → org_drift (M5)", () => {
  assertEquals(
    assertEligiblePrincipal({ isMaster: false, currentOrgIds: ["org-B"], patOrgId: "org-A" }),
    { kind: "forbidden", reason: "org_drift" },
  );
});

Deno.test("assertEligiblePrincipal: non-master, org is current membership → eligible (null)", () => {
  assertEquals(
    assertEligiblePrincipal({
      isMaster: false,
      currentOrgIds: ["org-A", "org-B"],
      patOrgId: "org-A",
    }),
    null,
  );
});

Deno.test("assertEligiblePrincipal: FAILS CLOSED on a non-boolean is_master (drifted resolver)", () => {
  // Only a strict `false` passes the master gate. A NULL/undefined/non-boolean is_master —
  // e.g. if is_master_user ever drifted — must be treated as master (rejected), never as
  // "not master". This keeps H1 robust regardless of the is_master_user search_path pin.
  for (const bad of [null, undefined, "false", 0, "true"]) {
    assertEquals(
      assertEligiblePrincipal({ isMaster: bad, currentOrgIds: ["org-A"], patOrgId: "org-A" }),
      { kind: "forbidden", reason: "master_principal" },
      `is_master=${JSON.stringify(bad)} must fail closed`,
    );
  }
});

Deno.test("assertEligiblePrincipal: non-array current_org_ids → org_drift (fail closed)", () => {
  assertEquals(
    assertEligiblePrincipal({ isMaster: false, currentOrgIds: null, patOrgId: "org-A" }),
    { kind: "forbidden", reason: "org_drift" },
  );
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
