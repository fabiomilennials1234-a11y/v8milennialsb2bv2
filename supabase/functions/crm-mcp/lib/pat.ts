/**
 * Personal Access Token (PAT) primitives for the customer-facing crm-mcp.
 *
 * See `.specs/features/crm-mcp/DESIGN.md` §4. Everything here is auth-agnostic of the
 * transport (the spine in `_shared/mcp/` handles JSON-RPC); this module owns the token
 * format, its hash, the per-user JWT mint, and the PURE decision logic that the request
 * pipeline (index.ts) wires to real DB calls.
 *
 * Security invariants encoded here (do not relax without revisiting the threat model):
 *  - the minted JWT is `aud:authenticated`/`role:authenticated` ONLY — never service_role,
 *    never master; `role`/`aud` are literals, never derived from input (DESIGN §4.4);
 *  - the minted JWT carries NO organization_id claim (DESIGN §4.4, H3b) — org travels in
 *    ToolContext, never in the signed token;
 *  - the JWT TTL is hard-capped at 60s (DESIGN §4.4/§4.6, H6) — the ceiling of revocation
 *    propagation, never config-driven;
 *  - a malformed/empty mint must HARD-FAIL before any client is built (DESIGN §4.4, H3a),
 *    so a request can never silently fall back to the anon role.
 */

import { SignJWT } from "jose";
import { sha256hex } from "../../_shared/mcp/crypto.ts";

// --- token format (DESIGN §4.1) -------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BODY_LEN = 30; // 30 base62 chars ≈ 178.6 bits of entropy (≥178 target)
const CRC_LEN = 6; // CRC32 (32 bits) → 6 base62 chars, zero-padded
const TOKEN_RE = new RegExp(
  `^tq_mcp_(live|test)_([0-9A-Za-z]{${BODY_LEN}})([0-9A-Za-z]{${CRC_LEN}})$`,
);

export type PatEnv = "live" | "test";

export interface ParsedPat {
  env: PatEnv;
  /** The random body (the CRC32 is computed over exactly this). */
  body: string;
  /** The full token as presented (what gets hashed for lookup). */
  full: string;
}

/** base62-encode an unsigned 32-bit int, left-padded to `width` chars. */
function base62Encode(n: number, width: number): string {
  let v = n >>> 0; // force uint32
  let out = "";
  if (v === 0) out = "0";
  while (v > 0) {
    out = BASE62[v % 62] + out;
    v = Math.floor(v / 62);
  }
  return out.padStart(width, "0");
}

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** Standard CRC32 (poly 0xEDB88320) over the UTF-8 bytes of `s`. Integrity/UX only — NOT security. */
export function crc32(s: string): number {
  const bytes = new TextEncoder().encode(s);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Generate a fresh PAT. Returns the plaintext (display-once), its lookup hash, and prefix. */
export async function generatePat(
  env: PatEnv,
  opts?: { pepper?: string },
): Promise<{ token: string; tokenHash: string; tokenPrefix: string }> {
  const bytes = new Uint8Array(BODY_LEN);
  let body = "";
  // Rejection sampling for a uniform base62 body (avoid modulo bias).
  while (body.length < BODY_LEN) {
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && body.length < BODY_LEN; i++) {
      const b = bytes[i];
      if (b < 248) body += BASE62[b % 62]; // 248 = 62*4, the largest multiple of 62 ≤ 256
    }
  }
  const checksum = base62Encode(crc32(body), CRC_LEN);
  const token = `tq_mcp_${env}_${body}${checksum}`;
  return {
    token,
    tokenHash: await hashToken(token, opts?.pepper),
    tokenPrefix: token.slice(0, "tq_mcp_live_".length + 8), // non-secret display fragment
  };
}

/** Parse + validate a presented token OFFLINE (format + CRC32). Returns null on any mismatch. */
export function parsePat(token: string): ParsedPat | null {
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const [, env, body, checksum] = m;
  if (base62Encode(crc32(body), CRC_LEN) !== checksum) return null; // typo/corruption guard
  return { env: env as PatEnv, body, full: token };
}

/**
 * Lookup hash of the FULL token. SHA-256 (no salt) is correct for a high-entropy
 * (≥178-bit) credential — slow hashes buy nothing here and would tax every request
 * (DESIGN §4.2). Optional pepper = HMAC-SHA256 for defense against a DB-only leak.
 */
export async function hashToken(token: string, pepper?: string): Promise<string> {
  if (!pepper) return await sha256hex(token);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- resolution decision logic (PURE; index.ts injects the DB results) ----------------

/** The identity row crm_mcp_resolve_token returns (DESIGN §7.6). */
export interface PatRow {
  id: string;
  user_id: string;
  organization_id: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  audience: string;
}

export type ResolveOutcome =
  | { kind: "ok"; row: PatRow }
  | { kind: "unauthorized"; reason: "malformed" | "not_found" | "revoked" | "expired" }
  | { kind: "forbidden"; reason: "audience" | "scope" | "master_principal" | "org_drift" };

const AUDIENCE = "crm-mcp";

/**
 * Pure status checks over the resolved row. Never differentiates "not found" from a wrong
 * hash (both → not_found) so the endpoint is not a token-existence oracle (DESIGN §4.3/§7.6).
 */
export function classifyTokenRow(row: PatRow | null, nowMs: number): ResolveOutcome {
  if (!row) return { kind: "unauthorized", reason: "not_found" };
  if (row.revoked_at) return { kind: "unauthorized", reason: "revoked" };
  if (row.expires_at && Date.parse(row.expires_at) < nowMs) {
    return { kind: "unauthorized", reason: "expired" };
  }
  if (row.audience !== AUDIENCE) return { kind: "forbidden", reason: "audience" };
  return { kind: "ok", row };
}

/**
 * Pure eligibility gate run AFTER the row is valid (DESIGN §4.3.1 H1 + §4.3.2 M5):
 *  - a PAT whose owner is a master is REJECTED — crm-mcp must never operate with
 *    master-ghost cross-org semantics (the one way a customer endpoint becomes a
 *    cross-tenant reader);
 *  - the PAT's frozen org must still be a current membership of the owner (a re-org'd or
 *    offboarded user must not keep reading via a stale org binding).
 */
export function assertEligiblePrincipal(input: {
  isMaster: unknown;
  currentOrgIds: unknown;
  patOrgId: string;
}): ResolveOutcome | null {
  // FAIL CLOSED on the master gate: only a STRICT `false` is allowed through. A master
  // (true) is rejected; a malformed/missing/non-boolean flag (NULL, undefined, anything the
  // resolver might return if is_master_user ever drifted) is ALSO rejected — it is never
  // read as "not master". This makes H1 robust independent of the is_master_user pin state.
  if (input.isMaster !== false) return { kind: "forbidden", reason: "master_principal" };
  const orgs = Array.isArray(input.currentOrgIds) ? input.currentOrgIds : [];
  if (!orgs.includes(input.patOrgId)) return { kind: "forbidden", reason: "org_drift" };
  return null; // eligible
}

// --- per-user JWT mint (DESIGN §4.4) --------------------------------------------------

/** Hard cap on the minted JWT lifetime, in seconds. This is the revocation-propagation ceiling. */
export const MINT_TTL_SEC = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MintInput {
  userId: string;
  email: string;
  projectRef: string;
  signingKey: CryptoKey;
  kid: string;
}

/**
 * Mint a short-lived Supabase-compatible JWT for the PAT's user (ES256, dedicated key).
 * `role`/`aud` are hard-coded literals — there is no code path that mints service_role.
 * No organization_id claim (H3b). `nowSec` is injected for determinism in tests.
 */
export async function mintUserJwt(input: MintInput, nowSec: number): Promise<string> {
  if (!UUID_RE.test(input.userId)) {
    throw new Error("mintUserJwt: refusing to mint for a non-UUID sub");
  }
  return await new SignJWT({
    role: "authenticated",
    email: input.email,
    is_anonymous: false,
    aal: "aal1",
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: input.kid })
    .setIssuer(`https://${input.projectRef}.supabase.co/auth/v1`)
    .setAudience("authenticated")
    .setSubject(input.userId)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + MINT_TTL_SEC)
    .sign(input.signingKey);
}

/** Decode (no signature check) the payload of a compact JWS. */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("assertWellFormedJwt: not a compact JWS");
  const json = new TextDecoder().decode(
    Uint8Array.from(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    ),
  );
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Hard-fail-closed guard (DESIGN §4.4, H3a): assert the just-minted token is a well-formed
 * authenticated-user JWT BEFORE a client is built. If the mint produced anything else, the
 * caller must abort — never construct a client that could fall back to the anon role
 * (the anon-leak of 2026-06-01 proved anon can read when a policy/view hole exists).
 */
export function assertWellFormedJwt(jwt: string): void {
  const p = decodeJwtPayload(jwt);
  if (typeof p.sub !== "string" || !UUID_RE.test(p.sub)) {
    throw new Error("assertWellFormedJwt: sub is not a UUID");
  }
  if (p.role !== "authenticated") throw new Error("assertWellFormedJwt: role is not authenticated");
  if (p.aud !== "authenticated") throw new Error("assertWellFormedJwt: aud is not authenticated");
  if (!Number.isInteger(p.iat) || !Number.isInteger(p.exp)) {
    throw new Error("assertWellFormedJwt: iat/exp missing or non-integer");
  }
  const ttl = (p.exp as number) - (p.iat as number);
  if (ttl <= 0 || ttl > MINT_TTL_SEC) {
    throw new Error(`assertWellFormedJwt: ttl ${ttl}s outside (0, ${MINT_TTL_SEC}]`);
  }
}
