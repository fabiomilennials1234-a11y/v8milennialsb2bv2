/**
 * Assinador de credencial do TorqueCalls — ÚNICO lugar do repositório que lê
 * `TORQUECALLS_SIGNING_SK` e produz assinatura.
 *
 * REGRA ESTRUTURAL (ADR-0024 §4)
 * -----------------------------
 * A VPS recusa requisição sem token de escopo `call`. Token de escopo `call` só
 * existe se alguém o assinou. Se a ÚNICA função capaz de assinar for a que roda
 * o governor, então "passar pelo governor" e "obter autoridade" são a mesma
 * operação — não existe caller a instrumentar, porque não existe caller que
 * consiga falar com a VPS sem passar por lá.
 *
 * Por isso este arquivo mora em `internal/` e só pode ser importado de dentro de
 * `_shared/voip/`. `scripts/test-voip-choke.sh` reprova o build se alguém
 * importar daqui de fora, ou se qualquer outro arquivo ler a variável de
 * ambiente. A lição é do Send Governor: proteção nas closures dos helpers não é
 * proteção no choke, e o caller que ninguém enumerou (`copilot-v2-worker`)
 * atravessou.
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

export type VoipScope = "call";

export interface SignArgs {
  /** Escopo da credencial. Hoje só `call` — admin e stream são outras fatias. */
  sc: VoipScope;
  /** Ações que este token autoriza na VPS. Uma rota, uma ação. */
  act: readonly string[];
  /** Validade em segundos a partir de agora. */
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
  /** Lead vinculado, quando existe. */
  lead?: string | null;
}

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
    // Fail-closed e ruidoso. Um assinador que "funciona" sem chave é pior do que
    // um que não sobe: ele emitiria tokens que a VPS não aceita, e o sintoma
    // apareceria como chamada que não completa, não como erro de configuração.
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

  const seed = raw.slice(0, SEED_BYTES);
  const pub = raw.slice(SEED_BYTES);

  cachedKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "OKP",
      crv: "Ed25519",
      d: b64urlFromBytes(seed),
      x: b64urlFromBytes(pub),
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
 * Assina um JWS compacto EdDSA.
 *
 * `aud` é o host EXATO da VPS e `env` carimba o ambiente: token de dev não disca
 * em prod nem por acidente nem por cópia de secret.
 */
export async function signVoipToken(args: SignArgs): Promise<SignedToken> {
  const { key, kid } = await getKey();

  const now = Math.floor(Date.now() / 1000);
  const exp = now + args.ttlSeconds;
  const jti = crypto.randomUUID();

  const header = { alg: "EdDSA", typ: "JWT", kid };
  const payload: Record<string, unknown> = {
    iss: "torque-crm",
    aud: requireEnv("TORQUECALLS_AUDIENCE"),
    env: requireEnv("TORQUECALLS_ENV"),
    iat: now,
    exp,
    jti,
    sc: args.sc,
    act: [...args.act],
    org: args.org,
    sub: args.sub,
    sid: args.sid,
    cid: args.cid,
    peer: args.peer,
  };
  if (args.lead) payload.lead = args.lead;

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

/** Só para teste: descarta a chave em cache entre casos. */
export function __resetKeyCacheForTests(): void {
  cachedKey = null;
  cachedKid = null;
}
