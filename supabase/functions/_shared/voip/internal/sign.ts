/**
 * Assinador de credencial do TorqueCalls — ÚNICO lugar do repositório que lê
 * `TORQUECALLS_SIGNING_SK` e produz assinatura.
 *
 * REGRA ESTRUTURAL (ADR-0024 §4)
 * -----------------------------
 * A VPS recusa requisição sem token. Token de escopo `call` só existe se alguém
 * o assinou. Se a ÚNICA função capaz de assinar escopo `call` for a que roda o
 * governor, então "passar pelo governor" e "obter autoridade para discar" são a
 * mesma operação — não existe caller a instrumentar.
 *
 * Por isso `signCallToken` é separado de `signAdminToken` e `signStreamToken`:
 * a restrição estreita é sobre DISCAR, não sobre falar com a VPS. Listar sessão
 * e abrir stream de eventos não consomem minuto nem geram risco de ban, e
 * amarrá-los ao governor só tornaria a regra grande demais para ser respeitada.
 * `scripts/test-voip-choke.sh` prova que só `call-plane.ts` chama `signCallToken`.
 *
 * ASSIMETRIA
 * ----------
 * Ed25519. A chave PRIVADA vive só nos secrets do Supabase; a VPS guarda apenas
 * a pública. VPS comprometida não consegue CUNHAR autoridade para org nenhuma —
 * só verificar o que já foi cunhado aqui.
 */

/** Formato do segredo: base64 dos 64 bytes que `ed25519.GenerateKey` do Go devolve (seed‖pub). */
const GO_PRIVATE_KEY_BYTES = 64;
const SEED_BYTES = 32;

export type VoipScope = "call" | "admin" | "stream";

export interface SignedToken {
  token: string;
  jti: string;
  expiresAt: number;
}

let cachedKey: CryptoKey | null = null;
let cachedKid: string | null = null;

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}

function bytesFromB64(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    // Fail-closed e ruidoso. Um assinador que "funciona" sem chave é pior que um
    // que não sobe: emitiria tokens que a VPS recusa, e o sintoma apareceria
    // como chamada que não completa, não como erro de configuração.
    throw new Error(`voip/sign: ${name} ausente — o choke não pode assinar`);
  }
  return v;
}

async function getKey(): Promise<{ key: CryptoKey; kid: string }> {
  if (cachedKey && cachedKid) return { key: cachedKey, kid: cachedKid };

  const raw = bytesFromB64(requireEnv("TORQUECALLS_SIGNING_SK"));
  if (raw.length !== GO_PRIVATE_KEY_BYTES) {
    throw new Error(
      `voip/sign: TORQUECALLS_SIGNING_SK tem ${raw.length} bytes; ` +
        `esperado ${GO_PRIVATE_KEY_BYTES} (saída de ed25519.GenerateKey, seed‖pub)`,
    );
  }

  cachedKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "OKP",
      crv: "Ed25519",
      d: b64urlFromBytes(raw.slice(0, SEED_BYTES)),
      x: b64urlFromBytes(raw.slice(SEED_BYTES)),
      key_ops: ["sign"],
      ext: false,
    },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  cachedKid = Deno.env.get("TORQUECALLS_SIGNING_KID") ?? "tc1";

  return { key: cachedKey, kid: cachedKid };
}

/**
 * A chave pública que a VPS precisa ter em `TORQUECALLS_TOKEN_PUBKEY`.
 * Existe para o runbook de rotação não depender de alguém reconstruir isso à mão.
 */
export function publicKeyBase64(): string {
  const raw = bytesFromB64(requireEnv("TORQUECALLS_SIGNING_SK"));
  if (raw.length !== GO_PRIVATE_KEY_BYTES) {
    throw new Error("voip/sign: chave em formato inesperado");
  }
  return b64urlFromBytes(raw.slice(SEED_BYTES));
}

/**
 * Núcleo da assinatura. `aud` é o host EXATO da VPS e `env` carimba o ambiente:
 * token de dev não disca em prod nem por acidente nem por cópia de secret.
 */
async function signJWS(
  sc: VoipScope,
  act: readonly string[],
  ttlSeconds: number,
  claims: Record<string, unknown>,
): Promise<SignedToken> {
  const { key, kid } = await getKey();

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const jti = crypto.randomUUID();

  const header = { alg: "EdDSA", typ: "JWT", kid };
  const payload: Record<string, unknown> = {
    iss: "torque-crm",
    aud: requireEnv("TORQUECALLS_AUDIENCE"),
    env: requireEnv("TORQUECALLS_ENV"),
    iat: now,
    exp,
    jti,
    sc,
    act: [...act],
    ...claims,
  };

  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${
    b64urlFromString(JSON.stringify(payload))
  }`;

  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );

  return { token: `${signingInput}.${b64urlFromBytes(sig)}`, jti, expiresAt: exp };
}

// ─── (A) tc-call ────────────────────────────────────────────────────────────
// Escopo restrito. Só `_shared/voip/call-plane.ts` chama — é o que fecha o choke.

export interface CallTokenArgs {
  act: readonly string[];
  ttlSeconds: number;
  /** Organização dona da chamada. Nunca vem do corpo da requisição. */
  org: string;
  /** Operador (auth.users.id). */
  sub: string;
  /** Sessão do TorqueCalls. */
  sid: string;
  /** Id da chamada no ledger do CRM (voip_calls.id). */
  cid: string;
  /** Destino, só dígitos. Derivado do lead no servidor. */
  peer: string;
  lead?: string | null;
}

export function signCallToken(args: CallTokenArgs): Promise<SignedToken> {
  const claims: Record<string, unknown> = {
    org: args.org,
    sub: args.sub,
    sid: args.sid,
    cid: args.cid,
    peer: args.peer,
  };
  if (args.lead) claims.lead = args.lead;
  return signJWS("call", args.act, args.ttlSeconds, claims);
}

// ─── (B) tc-admin ───────────────────────────────────────────────────────────
// Server-to-server, 30 s, NUNCA chega ao browser. Nasce em torquecalls-control e
// morre na mesma requisição.

export const ADMIN_TTL_SECONDS = 30;

export type AdminAction =
  | "session.list"
  | "session.create"
  | "session.delete"
  | "session.pair"
  | "session.logout"
  | "session.adopt"
  | "session.policy";

export interface AdminTokenArgs {
  act: AdminAction;
  /** Organização alvo. Obrigatória salvo quando `all` — não existe org="*" mágica. */
  org?: string;
  /** Alcance global, para inventário e adoção de sessão órfã. Booleano, não string. */
  all?: boolean;
  /** Sessão alvo. Obrigatória em delete/pair/logout/adopt/policy. */
  sid?: string;
  /** Quem pediu, só para trilha. */
  sub: string;
}

// `async` de propósito: a validação abaixo é síncrona, e uma função que devolve
// Promise mas às vezes estoura ANTES de devolvê-la não pode ser tratada com
// `.catch()`. Contrato uniforme vale mais que um microssegundo.
export async function signAdminToken(args: AdminTokenArgs): Promise<SignedToken> {
  if (!args.all && !args.org) {
    throw new Error("voip/sign: tc-admin exige org ou all=true");
  }
  const claims: Record<string, unknown> = { sub: args.sub };
  if (args.all) claims.all = true;
  else claims.org = args.org;
  if (args.sid) claims.sid = args.sid;
  return signJWS("admin", [args.act], ADMIN_TTL_SECONDS, claims);
}

// ─── (C) tc-stream ──────────────────────────────────────────────────────────
// Vai ao browser. TTL curto É a revogação — por isso não existe denylist em
// lugar nenhum deste desenho. O cliente renova antes de expirar.

export const STREAM_TTL_SECONDS = 60;

export interface StreamTokenArgs {
  org: string;
  sub: string;
  /** Filtro por sessão. Validado contra voip_sessions ANTES de assinar. */
  sid?: string;
  /**
   * `org` = enxerga chamada de qualquer lead da organização; `own` = só as
   * próprias. Decidido pelo CRM a partir de leads.view_all, porque a VPS não
   * tem como avaliar can_see_lead_by_permissions.
   */
  vis: "org" | "own";
  /** Sessão em pareamento, para receber o QR. Só com voip.session.manage. */
  pairSid?: string;
}

export function signStreamToken(args: StreamTokenArgs): Promise<SignedToken> {
  const claims: Record<string, unknown> = {
    org: args.org,
    sub: args.sub,
    vis: args.vis,
  };
  if (args.sid) claims.sid = args.sid;
  if (args.pairSid) claims.pair_sid = args.pairSid;
  return signJWS("stream", ["events.read"], STREAM_TTL_SECONDS, claims);
}

/** Só para teste: descarta a chave em cache entre casos. */
export function __resetKeyCacheForTests(): void {
  cachedKey = null;
  cachedKid = null;
}
