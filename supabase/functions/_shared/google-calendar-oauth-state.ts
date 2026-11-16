/**
 * google-calendar-oauth-state — `state` OAuth assinado do Google Calendar.
 *
 * SEGURANÇA: o fluxo antigo mandava `{userId, orgId, ts}` em base64 puro no
 * `state`, e o `google-calendar-callback` (público, service_role) confiava
 * nesses ids para gravar os tokens. Um `state` forjado com o `userId`/`orgId`
 * da vítima vinculava o Google do atacante à conta dela — e a partir daí o
 * webhook gravava eventos do atacante no cache da org vítima e mexia em
 * `leads.compromisso_date`.
 *
 * Agora o `state` é emitido só pelo `google-calendar-connect` (que resolveu a
 * org pela membership do chamador), assinado com HMAC-SHA256 e verificado aqui
 * na volta. Camadas:
 *   1. Assinatura — payload adulterado ou forjado sem a chave é recusado.
 *   2. Expiração ≤ 10 min — `exp` no payload assinado, e `exp - iat` limitado.
 *   3. Nonce de uso único — gravado em `google_calendar_oauth_nonces` no connect
 *      e consumido (DELETE ... RETURNING) pelo callback via
 *      `google_calendar_consume_oauth_nonce`, que também revalida a membership.
 *      Isto fica no callback; este módulo só garante o formato do nonce.
 *
 * Chave: `GOOGLE_CLIENT_SECRET`, que todo ambiente onde o OAuth funciona já tem
 * (mesmo desenho do Meta, que assina com `META_APP_SECRET`). A mensagem HMAC
 * leva o prefixo de domínio `STATE_DOMAIN`, então uma assinatura emitida com o
 * mesmo segredo para outro propósito nunca vale como `state`. Girar o client
 * secret só invalida `state`s em voo (≤ 10 min).
 *
 * Formato: `base64url(JSON(payload)) + "." + base64url(HMAC_SHA256(domínio + "." + payloadB64))`.
 * Só Web Crypto: roda igual em Deno e Node/Vitest.
 */

export const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_DOMAIN = "torque.google-calendar.oauth-state.v1";
const MAX_STATE_LENGTH = 2048;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GoogleCalendarStatePayload {
  v: 1;
  userId: string;
  orgId: string;
  nonce: string;
  /** Emissão, epoch ms. */
  iat: number;
  /** Expiração, epoch ms. */
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringFromB64url(b64url: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(b64url)) throw new Error("base64url inválido");
  const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

async function sign(secret: string, payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${STATE_DOMAIN}.${payloadB64}`));
  return b64urlFromBytes(new Uint8Array(mac));
}

/** Comparação em tempo constante (o comprimento não é segredo: HMAC-SHA256 tem tamanho fixo). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Emite um `state` assinado. Lança se faltar segredo ou se algum id não for UUID. */
export async function signGoogleCalendarState(
  input: { userId: string; orgId: string; nonce: string },
  secret: string,
  opts?: { now?: number },
): Promise<{ state: string; expiresAt: number }> {
  if (!secret) throw new Error("signGoogleCalendarState: segredo ausente");
  if (!UUID_RE.test(input.userId) || !UUID_RE.test(input.orgId) || !UUID_RE.test(input.nonce)) {
    throw new Error("signGoogleCalendarState: userId, orgId e nonce precisam ser UUID");
  }
  const iat = opts?.now ?? Date.now();
  const payload: GoogleCalendarStatePayload = {
    v: 1,
    userId: input.userId,
    orgId: input.orgId,
    nonce: input.nonce,
    iat,
    exp: iat + STATE_TTL_MS,
  };
  const payloadB64 = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  return { state: `${payloadB64}.${await sign(secret, payloadB64)}`, expiresAt: payload.exp };
}

/**
 * Verifica um `state`. Devolve o payload, ou null se a assinatura não bater, o
 * segredo faltar, o formato estiver errado, o `state` tiver expirado ou vier
 * com validade maior que `STATE_TTL_MS`. Nunca lança.
 *
 * Não consome o nonce: o chamador PRECISA chamar
 * `google_calendar_consume_oauth_nonce` antes de usar o payload.
 */
export async function verifyGoogleCalendarState(
  state: string,
  secret: string,
  opts?: { now?: number },
): Promise<GoogleCalendarStatePayload | null> {
  try {
    if (!secret || typeof state !== "string" || !state || state.length > MAX_STATE_LENGTH) return null;
    const parts = state.split(".");
    if (parts.length !== 2) return null;
    const [payloadB64, mac] = parts;
    if (!payloadB64 || !mac) return null;

    if (!timingSafeEqual(mac, await sign(secret, payloadB64))) return null;

    const p = JSON.parse(stringFromB64url(payloadB64)) as Partial<GoogleCalendarStatePayload>;
    const now = opts?.now ?? Date.now();
    if (p.v !== 1) return null;
    if (typeof p.userId !== "string" || !UUID_RE.test(p.userId)) return null;
    if (typeof p.orgId !== "string" || !UUID_RE.test(p.orgId)) return null;
    if (typeof p.nonce !== "string" || !UUID_RE.test(p.nonce)) return null;
    if (typeof p.iat !== "number" || typeof p.exp !== "number") return null;
    if (p.exp <= now) return null;
    if (p.exp - p.iat > STATE_TTL_MS) return null;
    return p as GoogleCalendarStatePayload;
  } catch {
    return null;
  }
}
