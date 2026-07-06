/**
 * Password reset primitives — shared by the forgot-password / reset-password
 * edge functions (identity BC). Self-hosted flow that replaces Supabase Auth's
 * mailer/PKCE recovery (see migration 20270107000000_password_reset_tokens.sql).
 *
 * Everything here is PURE Web Crypto + string logic (no Deno-only APIs), so it
 * runs unchanged in the Deno edge runtime AND under Vitest/Node for unit tests.
 *
 * Security invariants:
 *  - the raw token is high-entropy (32 random bytes) and display-once; only its
 *    SHA-256 hex is ever persisted — hashRawToken is the single hashing path;
 *  - the password policy is the app-wide strong policy (12+ with complexity),
 *    identical to admin-reset-user-password and src/lib/password-validation.ts.
 */

/**
 * App-wide strong password policy: 12+ chars with lowercase, uppercase, digit
 * and a special character. Kept byte-identical to the PWD_RE in
 * admin-reset-user-password/index.ts and the frontend validatePassword().
 */
export const PWD_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:',.<>?]).{12,}$/;

/** Human-readable policy message (PT-BR), shared with the frontend copy. */
export const PWD_POLICY_MESSAGE =
  'A senha deve ter no mínimo 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';

/** Token lifetime: 1 hour. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** True when the password satisfies the app-wide strong policy. */
export function isStrongPassword(password: string): boolean {
  return typeof password === 'string' && PWD_RE.test(password);
}

/**
 * Conservative email format check. Intentionally simple — we only need to
 * reject obviously malformed input before the (rate-limited) user lookup; the
 * authoritative existence check happens against auth.users.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Generate a raw reset token: 32 cryptographically-random bytes as lowercase
 * hex (64 chars). NEVER log or persist this value — only its hash (below).
 */
export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 hex of an arbitrary UTF-8 string. Deterministic. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash the raw reset token for storage/lookup. Single canonical hashing path. */
export function hashRawToken(rawToken: string): Promise<string> {
  return sha256Hex(rawToken);
}

/** ISO timestamp for a token minted now (expiry = now + TTL). */
export function resetTokenExpiryFromNow(nowMs: number = Date.now()): string {
  return new Date(nowMs + RESET_TOKEN_TTL_MS).toISOString();
}

/**
 * Pure decision mirror of claim_password_reset_token's WHERE clause: a token is
 * usable iff it has not been used and has not expired. The DB RPC is the
 * authoritative, atomic gate under concurrency — this exists so the
 * expiry/single-use logic is unit-testable without a database.
 */
export function isResetTokenUsable(
  token: { used_at: string | null; expires_at: string },
  nowMs: number = Date.now(),
): boolean {
  if (token.used_at != null) return false;
  const expiresMs = Date.parse(token.expires_at);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs > nowMs;
}
