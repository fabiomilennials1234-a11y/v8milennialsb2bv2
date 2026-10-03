/**
 * Fake auth material for the ui-preview mock. NOTHING here is a secret:
 * tokens are unsigned-in-spirit (random signature), only ever accepted by
 * the local mock, and useless against any real Supabase project.
 */
import { randomBytes } from "node:crypto";

export const MOCK_HOST = "127.0.0.1";
export const MOCK_PORT = Number(process.env.UI_PREVIEW_MOCK_PORT ?? 54399);
export const MOCK_URL = `http://${MOCK_HOST}:${MOCK_PORT}`;
export const APP_PORT = Number(process.env.UI_PREVIEW_APP_PORT ?? 4180);
export const APP_URL = process.env.UI_PREVIEW_APP_URL ?? `http://localhost:${APP_PORT}`;

/**
 * supabase-js v2: `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
 * (node_modules/@supabase/supabase-js/dist/index.mjs). For 127.0.0.1 → "sb-127-auth-token".
 */
export const STORAGE_KEY = `sb-${new URL(MOCK_URL).hostname.split(".")[0]}-auth-token`;

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

export function fakeJwt(payload) {
  const header = { alg: "HS256", typ: "JWT", kid: "ui-preview" };
  return `${b64url(header)}.${b64url(payload)}.${randomBytes(32).toString("base64url")}`;
}

/** Anon key: syntactically a JWT with role=anon. Accepted only by the mock. */
export const ANON_KEY = fakeJwt({
  iss: "ui-preview-mock",
  ref: "uipreview",
  role: "anon",
  iat: 1_700_000_000,
  exp: 4_102_444_800, // 2100-01-01
});

export function buildUser(fx) {
  const u = fx.authUser;
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: "2025-01-10T12:00:00Z",
    phone: "",
    confirmed_at: "2025-01-10T12:00:00Z",
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: u.full_name, name: u.full_name, avatar_url: null },
    identities: [],
    factors: fx.isMaster
      ? [{ id: "f0f0f0f0-0000-4000-8000-000000000001", friendly_name: "Authenticator", factor_type: "totp", status: "verified", created_at: "2025-01-10T12:00:00Z", updated_at: "2025-01-10T12:00:00Z" }]
      : [],
    created_at: "2025-01-10T12:00:00Z",
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  };
}

export function buildSession(fx) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 365 * 5; // 5 years — autoRefresh never fires
  const user = buildUser(fx);
  const access_token = fakeJwt({
    iss: `${MOCK_URL}/auth/v1`,
    sub: user.id,
    aud: "authenticated",
    exp,
    iat: now,
    email: user.email,
    phone: "",
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    role: "authenticated",
    // aal2 so a master preview passes the MFA gate (useMfaRequired).
    aal: "aal2",
    amr: [{ method: "password", timestamp: now }, { method: "totp", timestamp: now }],
    session_id: "5e551011-0000-4000-8000-000000000001",
    is_anonymous: false,
  });
  return {
    access_token,
    token_type: "bearer",
    expires_in: exp - now,
    expires_at: exp,
    refresh_token: "ui-preview-refresh-token",
    user,
  };
}
