/**
 * Verificação do envelope assinado que a VPS do TorqueCalls põe em cada webhook.
 *
 * ASSIMETRIA INVERTIDA
 * --------------------
 * `internal/sign.ts` é o sentido CRM → VPS: o CRM assina, a VPS verifica. Este
 * arquivo é o sentido VPS → CRM: a VPS assina, o CRM verifica. São PARES
 * DIFERENTES, e confundi-los destrói a propriedade dos dois: se a VPS pudesse
 * assinar com a chave do CRM, uma VPS comprometida cunharia autoridade para
 * discar em qualquer organização.
 *
 * POR QUE FORA DE `internal/`
 * ---------------------------
 * `scripts/test-voip-choke.sh` barra import de `internal/sign.ts` vindo de fora
 * de `_shared/voip/`, e este verificador precisa ser importável pela edge
 * function do webhook. Guardá-lo ao lado do assinador também convidaria alguém a
 * reusar a chave errada. Este arquivo lê SÓ `TORQUECALLS_WEBHOOK_PUBKEY` — nunca
 * o segredo de assinatura do CRM, nunca uma privada, e não assina nada.
 *
 * (O nome dessa variável de assinatura NÃO aparece aqui de propósito: o detector
 * de `scripts/test-voip-choke.sh` é um grep, e ele não tem como distinguir prosa
 * que cita o segredo de código que o lê. Citá-la reprovaria o choke — e afrouxar
 * o detector para acomodar um comentário seria trocar uma barreira real por
 * conforto de redação.)
 *
 * O AUTO-TESTE DA CHAVE
 * ---------------------
 * Validar a pública por tamanho não basta. O subgrupo de torção da Ed25519 tem
 * oito pontos, e contra qualquer um deles existe assinatura que vale para
 * QUALQUER mensagem — quem controlasse o que vai para o segredo do Supabase
 * (e é a própria VPS que imprime esse valor no log de boot, para o operador
 * copiar) poderia entregar uma dessas e passar a forjar evento de qualquer
 * sessão. Por isso a carga da chave é um TESTE, não uma inspeção:
 *
 *   1. Vetor conhecido do RFC 8032 tem que verificar `true`   — prova que este
 *      runtime realmente faz Ed25519 (e que `verify` não é um `return false`).
 *   2. A assinatura neutra tem que dar `false` contra a chave configurada, para
 *      uma BATERIA de sondas                                  — prova que a
 *      chave não pertence ao subgrupo pequeno.
 *   3. Uma assinatura válida de OUTRA chave tem que dar `false`.
 *
 * Falhou qualquer um, a função RECUSA SERVIR: lança, e não devolve `null`.
 * Distinguir os dois é o que permite à T8 responder 500 (config quebrada) em vez
 * de 401 (token ruim) — e 401 para todo mundo é indistinguível de "a VPS está
 * mandando lixo", que é o diagnóstico errado.
 *
 * POR QUE UMA BATERIA, E NÃO UMA SONDA
 * ------------------------------------
 * Medido em `deno 2.7.7` (BoringSSL, verificação SEM cofator): contra a chave
 * `00 × 32`, que é de ordem 4, a assinatura neutra vale para ~29% das mensagens
 * — não para todas. Uma sonda só teria deixado passar essa chave em 71% das
 * subidas. É o pior tipo de portão de segurança: o que fica verde quase sempre.
 * A bateria de sondas fixas leva a probabilidade de escape a ~1e-24 no pior
 * caso, sem sortear nada (gate determinístico não pisca entre deploys).
 *
 * Custo: uma vez por isolate, ~4 ms por chave configurada.
 */

// ─── contrato do envelope ───────────────────────────────────────────────────

/** Espelha `webhookClaims` de `cmd/server/webhooksign.go` na VPS. */
export interface VpsClaims {
  iss: "torquecalls-vps";
  aud: string;
  env: string;
  iat: number;
  exp: number;
  jti: string;
  /** Sessão do TorqueCalls. É por ela que o CRM deriva a organização. */
  sid: string;
  /** SHA-256 do corpo CRU, base64url sem padding. */
  bh: string;
  epoch: number;
  seq: number;
}

/**
 * Motivo da recusa. Existe para a T8 registrar em `runtime_logs` com ação
 * própria — `null` sozinho transformaria "assinatura forjada" e "relógio da VPS
 * atrasado" na mesma linha de log, e são incidentes diferentes.
 *
 * NÃO é para ir no corpo da resposta HTTP: dizer ao chamador exatamente qual
 * checagem falhou é dar oráculo de graça.
 */
export type WebhookRejection =
  | "malformed"
  | "bad_header"
  | "unknown_kid"
  | "bad_signature"
  | "bad_claims"
  | "wrong_issuer"
  | "wrong_audience"
  | "wrong_env"
  | "expired"
  | "not_yet_valid"
  | "ttl_too_long"
  | "body_hash_mismatch";

export type WebhookVerification =
  | { ok: true; claims: VpsClaims }
  | { ok: false; reason: WebhookRejection; detail?: string };

const ISSUER = "torquecalls-vps";
const PUBLIC_KEY_BYTES = 32;

/**
 * Tolerância de relógio, nos dois sentidos. Espelha o `skew` do verificador da
 * VPS (`cmd/server/token.go:105`) — as duas pontas erram igual ou uma delas
 * recusa o que a outra considera vivo.
 */
const CLOCK_SKEW_SECONDS = 30;

/**
 * Vida útil máxima aceita. Espelha `webhookTTL` de `cmd/server/webhooksign.go`,
 * onde `exp = iat + 300` é literal. Existe para que um envelope capturado do fio
 * (ou emitido por uma VPS já comprometida) seja útil por cinco minutos e não
 * para sempre.
 *
 * ACOPLAMENTO DELIBERADO: se `webhookTTL` subir na VPS, este número tem que
 * subir ANTES, senão o CRM recusa tudo. Está no relatório da tarefa.
 */
const MAX_ENVELOPE_TTL_SECONDS = 300;

/**
 * Rotação tem duas pontas: a que sai e a que entra. Um terceiro `kid` no segredo
 * é entrada esquecida de rotação anterior — chave que ninguém sabe mais de quem
 * é, ainda podendo assinar evento aceito.
 */
const MAX_KEYS = 2;

// ─── constantes do auto-teste ───────────────────────────────────────────────

/**
 * A "assinatura neutra": R = ponto-base compactado, S = 1.
 *
 * A equação da Ed25519 é `[S]B == R + [k]A`. Com S = 1 e R = B, ela vira
 * `[k]A == O` — verdadeira sempre que a pública A for de ordem pequena e o
 * escalar k derivado da mensagem for múltiplo dessa ordem. Contra uma chave
 * legítima (ordem L, primo de 253 bits) isso não acontece nunca.
 */
const NEUTRAL_SIGNATURE_HEX =
  "5866666666666666666666666666666666666666666666666666666666666666" +
  "01" + "00".repeat(31);

/**
 * Quantas mensagens de sonda. O pior caso é uma chave de ordem 4, que escapa de
 * cada sonda com probabilidade 3/4: `0.75^192 ≈ 4e-25`. Medido: as oito
 * codificações vivas do subgrupo caem na sonda #15 ou antes, então o número é
 * folga pura.
 */
const SELF_TEST_PROBES = 192;

/** RFC 8032 §7.1, TEST 1 — mensagem VAZIA. Verificado neste runtime. */
const RFC8032_PUBLIC_HEX =
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC8032_SIGNATURE_HEX =
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e0652249015" +
  "55fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

// ─── codificação ────────────────────────────────────────────────────────────

/**
 * `Uint8Array` cru é `Uint8Array<ArrayBufferLike>` desde o TS 5.7, e a WebCrypto
 * exige `ArrayBuffer` (não `SharedArrayBuffer`). Sem este apelido o `deno check`
 * reprova todas as chamadas de `digest`/`verify`/`importKey` deste arquivo.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const B64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

function bytesFromB64url(s: string): Bytes | null {
  if (!B64URL_ALPHABET.test(s)) return null;
  try {
    const bin = atob(
      s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4),
    );
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function b64urlFromBytes(bytes: Bytes): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromHex(hex: string): Bytes {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function hexFromBytes(bytes: Bytes): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function fail(msg: string): never {
  // Fail-closed e nomeando a variável. Um verificador que "funciona" com
  // configuração ruim recusaria todo evento em silêncio, e o sintoma apareceria
  // como "o CRM ignora os webhooks" — que não aponta para cá.
  throw new Error(`voip/webhook-verify: ${msg}`);
}

// ─── carga da chave ─────────────────────────────────────────────────────────

interface KeySet {
  keys: Map<string, CryptoKey>;
  audience: string;
  env: string;
}

let cached: Promise<KeySet> | null = null;

function probeMessage(i: number): Bytes {
  return new TextEncoder().encode(`torquecalls/webhook-verify/auto-teste/${i}`);
}

function verifyRaw(key: CryptoKey, sig: Bytes, msg: Bytes): Promise<boolean> {
  return crypto.subtle.verify({ name: "Ed25519" }, key, sig, msg).catch(() => false);
}

/**
 * (1) do auto-teste: este runtime faz Ed25519 de verdade?
 *
 * Roda uma vez por carga, não por chave: o que ele mede é o runtime, e o runtime
 * é o mesmo para as duas chaves de uma rotação. Sem ele, um ambiente sem Ed25519
 * (ou com `verify` degradado) passaria pelas outras checagens — todas elas
 * esperam `false`, e `false` é justamente o que um verificador quebrado devolve.
 */
async function assertRuntimeDoesEd25519(): Promise<void> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      bytesFromHex(RFC8032_PUBLIC_HEX),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch (e) {
    fail(`auto-teste do runtime: Ed25519 indisponível neste runtime (${e})`);
  }

  const good = bytesFromHex(RFC8032_SIGNATURE_HEX);
  if (!await verifyRaw(key, good, new Uint8Array(0))) {
    fail(
      "auto-teste do runtime: o vetor conhecido do RFC 8032 NÃO verificou — " +
        "este runtime não faz Ed25519 como o contrato exige, e recusar tudo " +
        "seria indistinguível de a VPS estar mandando lixo",
    );
  }

  const tampered = good.slice();
  tampered[0] ^= 0x01;
  if (await verifyRaw(key, tampered, new Uint8Array(0))) {
    fail(
      "auto-teste do runtime: assinatura adulterada foi ACEITA — a verificação " +
        "deste runtime não distingue assinatura boa de ruim",
    );
  }
}

/**
 * (2) e (3) do auto-teste, por chave.
 *
 * A parte que NÃO dá para fazer: um fixture "assinatura boa desta chave" exigiria
 * a privada, que mora na VPS. O que dá para fazer é o complemento — provar que
 * ela recusa o que tem que recusar, e a assinatura neutra é o `false` que só uma
 * chave do subgrupo pequeno erra.
 */
async function assertKeyIsSound(kid: string, key: CryptoKey): Promise<void> {
  const neutral = bytesFromHex(NEUTRAL_SIGNATURE_HEX);

  for (let i = 0; i < SELF_TEST_PROBES; i++) {
    if (await verifyRaw(key, neutral, probeMessage(i))) {
      fail(
        `auto-teste da chave ${kid}: a assinatura neutra foi ACEITA (sonda ${i}). ` +
          "Esta pública é de ordem pequena — contra ela existe assinatura válida " +
          "para QUALQUER corpo, e aceitá-la deixaria qualquer um forjar evento de " +
          "qualquer sessão. Gere um par novo na VPS e atualize " +
          "TORQUECALLS_WEBHOOK_PUBKEY.",
      );
    }
  }

  // Terceira perna: uma assinatura VÁLIDA, mas de outra chave, tem que dar
  // false. Pega dois defeitos que as duas primeiras deixam passar inteiros:
  //
  //   - um `verify` que ignora a chave e olha só a assinatura (a bateria acima
  //     não veria: ela só produz `false`, que é o que um verify assim devolve
  //     para a assinatura neutra, que é inválida de verdade);
  //   - a própria chave do vetor do RFC 8032 configurada como se fosse a da
  //     VPS. Ela é um ponto de ordem normal, então escapa da bateria — mas a
  //     PRIVADA dela está publicada no RFC e em todo livro de criptografia.
  //     Qualquer um assinaria evento para qualquer sessão. É um copiar-colar
  //     plausível: são os bytes que aparecem primeiro em qualquer exemplo de
  //     Ed25519 que alguém abra para "testar se funciona".
  if (
    await verifyRaw(key, bytesFromHex(RFC8032_SIGNATURE_HEX), new Uint8Array(0))
  ) {
    fail(
      `auto-teste da chave ${kid}: assinatura válida de OUTRA chave foi aceita. ` +
        "Ou a verificação não está levando esta chave em conta, ou o que foi " +
        "configurado é a chave de exemplo do RFC 8032 — cuja privada é pública. " +
        "Use a chave que a VPS imprime no boot.",
    );
  }
}

async function loadKeys(): Promise<KeySet> {
  const raw = (Deno.env.get("TORQUECALLS_WEBHOOK_PUBKEY") ?? "").trim();
  if (!raw) {
    fail("TORQUECALLS_WEBHOOK_PUBKEY ausente — não existe modo aberto");
  }

  const audience = (Deno.env.get("TORQUECALLS_WEBHOOK_AUDIENCE") ?? "").trim();
  if (!audience) {
    fail(
      "TORQUECALLS_WEBHOOK_AUDIENCE ausente — sem ela um envelope endereçado a " +
        "outro destino seria aceito",
    );
  }

  const env = (Deno.env.get("TORQUECALLS_ENV") ?? "").trim();
  if (!env) {
    fail("TORQUECALLS_ENV ausente — sem ela um evento de dev escreveria em prod");
  }

  await assertRuntimeDoesEd25519();

  const keys = new Map<string, CryptoKey>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const sep = trimmed.indexOf(":");
    if (sep < 0) {
      fail(`chave pública sem kid: esperado kid:base64url, veio ${JSON.stringify(trimmed)}`);
    }
    const declaredKid = trimmed.slice(0, sep).trim().toLowerCase();
    // O Go escreve com RawURLEncoding; tolerar padding na leitura é o mesmo que
    // o `TrimRight(b64, "=")` do lado de lá, e evita que um copia-e-cola com
    // "=" vire "o CRM ignora os eventos".
    const b64 = trimmed.slice(sep + 1).trim().replace(/=+$/, "");

    const pub = bytesFromB64url(b64);
    if (!pub) {
      fail(`chave pública do kid ${declaredKid} não é base64url`);
    }
    // ANTES do kid, de propósito: o importKey do Deno aceita qualquer tamanho
    // (medido: 0, 1, 31, 33 e 64 bytes passaram), e daí em diante `verify` só
    // devolve false. Sem esta linha, uma chave cortada no copia-e-cola vira
    // recusa universal e silenciosa.
    if (pub.length !== PUBLIC_KEY_BYTES) {
      fail(
        `chave pública do kid ${declaredKid} tem ${pub.length} bytes; ` +
          `esperado ${PUBLIC_KEY_BYTES} bytes`,
      );
    }

    // O kid é derivado da própria chave na VPS (`webhookKID`: 8 primeiros hex do
    // SHA-256 da pública). Conferir a derivação pega a entrada trocada — kid de
    // uma chave com os bytes de outra —, que de outro modo só apareceria como
    // metade dos eventos recusada durante uma rotação.
    const derivedKid = hexFromBytes((await sha256(pub)).slice(0, 4));
    if (derivedKid !== declaredKid) {
      fail(
        `kid ${declaredKid} não casa com a chave (derivado: ${derivedKid}). ` +
          "Copie a linha inteira que a VPS imprime no boot, kid e chave juntos.",
      );
    }
    if (keys.has(derivedKid)) {
      fail(
        `kid ${derivedKid} aparece duas vezes com chaves diferentes — qual delas ` +
          "verificaria ficaria por conta da ordem de leitura",
      );
    }

    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, [
        "verify",
      ]);
    } catch (e) {
      fail(`chave pública do kid ${declaredKid} não importa como Ed25519: ${e}`);
    }

    await assertKeyIsSound(derivedKid, key);
    keys.set(derivedKid, key);
  }

  if (keys.size === 0) {
    fail("TORQUECALLS_WEBHOOK_PUBKEY não continha nenhuma chave utilizável");
  }
  if (keys.size > MAX_KEYS) {
    fail(
      `${keys.size} chaves configuradas; rotação tem duas pontas. Uma terceira é ` +
        "sobra de rotação anterior, e chave que ninguém sabe mais de quem é " +
        "continua assinando evento aceito",
    );
  }

  return { keys, audience, env };
}

function keySet(): Promise<KeySet> {
  if (!cached) {
    cached = loadKeys();
    // O chamador é quem reporta; este catch só impede que uma configuração ruim
    // vire "unhandled rejection" antes de alguém dar await.
    cached.catch(() => {});
  }
  return cached;
}

/** Só para teste: descarta a chave em cache entre casos. */
export function __resetWebhookKeysForTests(): void {
  cached = null;
}

// ─── verificação ────────────────────────────────────────────────────────────

function decodeJsonPart(part: string): Record<string, unknown> | null {
  const bytes = bytesFromB64url(part);
  if (!bytes || bytes.length === 0) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function counter(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function reject(reason: WebhookRejection, detail?: string): WebhookVerification {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

/**
 * Verifica o envelope e devolve as claims, ou o motivo da recusa.
 *
 * `rawBody` tem que ser o corpo CRU (`await req.text()`), NUNCA um `req.json()`
 * reserializado: `JSON.stringify` normaliza ordem de chave e espaço em branco, o
 * SHA-256 muda, e todo webhook passa a ser recusado — com o sintoma aparecendo
 * como "o CRM ignora os eventos", que não aponta para a verificação.
 *
 * (A volta UTF-8 do `req.text()` é fiel: `json.Marshal` do Go só emite UTF-8
 * válido. Corpo que não fosse UTF-8 válido chegaria alterado e cairia no `bh` —
 * fail-closed, que é o lado certo de errar.)
 *
 * LANÇA quando a configuração está quebrada (chave ausente, truncada, de ordem
 * pequena, `kid` que não casa, runtime sem Ed25519). Recusa de token devolve
 * `{ok:false}`. A T8 usa a diferença: 500 para o primeiro, 401 para o segundo.
 */
export async function verifyWebhookDetailed(
  token: string,
  rawBody: string,
): Promise<WebhookVerification> {
  // Antes de tocar no token: configuração ruim é 500, não 401.
  const { keys, audience, env } = await keySet();

  // O TIPO NÃO PROTEGE ESTA LINHA. `headers.get()` devolve `string | null`, e
  // requisição SEM Authorization é o caso mais comum de todos — varredura de
  // porta, health check, chamada malfeita. Sem esta guarda, `null.trim()`
  // levanta TypeError, a T8 responde 500 onde devia responder 401, e some
  // justamente a distinção "config quebrada" × "token ruim" que este módulo
  // existe para preservar. Pior: o arquivo está fora do `deno check` do choke e
  // `deno task test` roda com `--no-check`, então o compilador não avisaria.
  // Ausência de credencial é entrada malformada como qualquer outra.
  if (typeof token !== "string" || typeof rawBody !== "string") {
    return reject("malformed", `token=${typeof token} corpo=${typeof rawBody}`);
  }

  // Tolerar o header inteiro poupa a T8 de um 401 universal e mudo no dia em que
  // alguém passar `req.headers.get("Authorization")` direto.
  const jws = token.trim().replace(/^bearer\s+/i, "");
  const parts = jws.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return reject("malformed", `${parts.length} partes`);
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeJsonPart(rawHeader);
  if (!header) return reject("bad_header", "header não decodifica");
  // `alg` conferido contra o valor único que este desenho aceita. Aceitar o que
  // o token declarar é a confusão de algoritmo clássica de JWT.
  if (header.alg !== "EdDSA" || header.typ !== "JWT") {
    return reject("bad_header", `alg=${String(header.alg)} typ=${String(header.typ)}`);
  }
  if (!nonEmptyString(header.kid)) return reject("bad_header", "kid ausente");

  const key = keys.get(header.kid.toLowerCase());
  if (!key) return reject("unknown_kid", header.kid);

  const signature = bytesFromB64url(rawSignature);
  if (!signature) return reject("malformed", "assinatura não é base64url");

  // Assinatura ANTES das claims: nenhum campo do payload merece ser lido como
  // dado enquanto ninguém provou quem escreveu.
  const signed = await verifyRaw(
    key,
    signature,
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!signed) return reject("bad_signature");

  const payload = decodeJsonPart(rawPayload);
  if (!payload) return reject("bad_claims", "payload não decodifica");

  if (payload.iss !== ISSUER) return reject("wrong_issuer", String(payload.iss));
  if (payload.aud !== audience) return reject("wrong_audience", String(payload.aud));
  if (payload.env !== env) return reject("wrong_env", String(payload.env));

  const { iat, exp } = payload;
  if (!counter(iat) || !counter(exp)) return reject("bad_claims", "iat/exp");
  if (exp <= iat) return reject("bad_claims", "exp <= iat");
  if (exp - iat > MAX_ENVELOPE_TTL_SECONDS) {
    return reject("ttl_too_long", `${exp - iat}s`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > exp + CLOCK_SKEW_SECONDS) return reject("expired", `${now - exp}s`);
  if (now < iat - CLOCK_SKEW_SECONDS) return reject("not_yet_valid", `${iat - now}s`);

  if (!nonEmptyString(payload.jti)) return reject("bad_claims", "jti");
  if (!nonEmptyString(payload.sid)) return reject("bad_claims", "sid");
  if (!nonEmptyString(payload.bh)) return reject("bad_claims", "bh");
  if (!counter(payload.epoch) || !counter(payload.seq)) {
    return reject("bad_claims", "epoch/seq");
  }

  // O `bh` amarra o envelope AO CORPO. Sem ele, um envelope válido interceptado
  // autorizaria qualquer payload. Comparação simples basta: os dois lados são
  // valores públicos, e o `bh` já veio autenticado pela assinatura acima.
  const digest = b64urlFromBytes(
    await sha256(new TextEncoder().encode(rawBody)),
  );
  if (digest !== payload.bh) return reject("body_hash_mismatch");

  return {
    ok: true,
    claims: {
      iss: ISSUER,
      aud: payload.aud as string,
      env: payload.env as string,
      iat,
      exp,
      jti: payload.jti,
      sid: payload.sid,
      bh: payload.bh,
      epoch: payload.epoch,
      seq: payload.seq,
    },
  };
}

/**
 * Porta estreita: as claims, ou `null`.
 *
 * Quem precisar do motivo da recusa para `runtime_logs` usa
 * `verifyWebhookDetailed`.
 */
export async function verifyWebhook(
  token: string,
  rawBody: string,
): Promise<VpsClaims | null> {
  const result = await verifyWebhookDetailed(token, rawBody);
  return result.ok ? result.claims : null;
}
