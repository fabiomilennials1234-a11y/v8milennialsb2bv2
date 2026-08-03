/**
 * torquecalls-webhook — a porta de entrada dos eventos assinados da VPS (S11).
 *
 * A VPS assina cada evento (`auth-state`, `call-status`, `call-ended`) com
 * Ed25519 num envelope JWS e o entrega aqui. Esta função NÃO decide estado: ela
 * autentica o envelope e repassa `(jti, sid, epoch, seq, signed_at, payload)`
 * para `fn_voip_apply_vps_event`, que resolve anti-replay, ordem, transição e
 * ledger NUMA transação. Espalhar essas quatro coisas em chamadas separadas do
 * PostgREST devolveria o `jti` reservado sem o estado aplicado.
 *
 * SEM CORS E SEM OPTIONS — EXCEÇÃO DELIBERADA, NÃO ESQUECIMENTO
 * -------------------------------------------------------------
 * O `CLAUDE.md` da raiz manda todo edge function devolver `getCorsHeaders(req)`
 * e responder OPTIONS cedo. Quem chama ESTA função é a VPS, um processo Go — não
 * existe navegador, não existe preflight, e um `Access-Control-Allow-Origin`
 * aqui só serviria para convidar página web a falar com a ingestão. É o mesmo
 * desvio que `whatsapp-webhook` já pratica pela mesma razão. Se você veio
 * "consertar" isto: não é defeito.
 *
 * (O `withErrorBoundary` ainda carimba CORS no 500 dele — é o caminho de crash,
 * e forkar o boundary para tirar três headers custaria mais do que vale. O que
 * NÃO se aceita dele é o corpo: ele ecoa `error.message`, e as mensagens de
 * configuração do verificador nomeiam variáveis de ambiente. Por isso todo
 * caminho previsível de erro é capturado AQUI e devolve corpo genérico; o
 * boundary é rede de segurança, não a resposta de rotina.)
 *
 * ORDEM DAS BARREIRAS
 * -------------------
 *   1. Rajada em memória, por isolate — antes de olhar método ou corpo.
 *   2. Método. Depois da rajada, para que GET em loop consuma ficha em vez de
 *      escapar do limitador.
 *   3. Teto de tamanho do corpo, medido nos BYTES lidos (o `content-length`
 *      é palavra do chamador; ele é conferido, mas não é a barreira).
 *   4. ASSINATURA, antes de qualquer consulta ao banco. Ed25519 custa
 *      microssegundos; consultar o Postgres com payload não autenticado é o que
 *      vira amplificação. O `checkRateLimitPersistent` do projeto falha ABERTO
 *      em erro de banco (`_shared/auth.ts`), então ele não podia ser a única
 *      barreira — e nem sequer é usado aqui, porque ele mesmo é uma ida ao
 *      banco por requisição não autenticada.
 *   5. Só então a RPC. `openAdmin` é uma FÁBRICA justamente para que essa ordem
 *      seja verificável em teste: nada abre cliente de banco antes do passo 4.
 *
 * AS DUAS RECUSAS SEM LINHA EM `runtime_logs` — 429 e 405, e só elas
 * ------------------------------------------------------------------
 * As duas ficam de fora pela MESMA razão, e a razão é que registrá-las seria a
 * amplificação que elas existem para impedir: uma linha de banco por pacote do
 * atacante. O 429 registra uma vez por janela por endereço; o 405 fica coberto
 * por ele, porque o limitador roda acima. Toda outra recusa — 401, 413, 400,
 * 409, 500 — gera uma linha, com ação própria por motivo.
 *
 * O CORPO É LIDO UMA VEZ, CRU
 * ---------------------------
 * O `bh` do envelope é o SHA-256 dos BYTES EXATOS do corpo. `req.json()`
 * seguido de `JSON.stringify` normaliza escapes (`&` do Go vira `&`),
 * ordem de chave numérica e formato de número — o hash não bate e TODO webhook
 * de produção é recusado, com o sintoma aparecendo como "o CRM ignora os
 * eventos", que não aponta para cá. Por isso o corpo é lido como texto uma
 * única vez, verificado com esse texto, e só depois passado ao `JSON.parse`.
 * `withErrorBoundary` foi lido e confirmado: ele toca só em headers, nunca no
 * corpo.
 *
 * CÓDIGOS DE RESPOSTA
 * -------------------
 * A VPS é nossa; a política de retry é escolha nossa. NÃO é o "200 sempre" do
 * `whatsapp-webhook`, que existe porque o Uazapi retenta com agressividade.
 *
 *   401  assinatura inválida/expirada/`bh` divergente     — não retente
 *   400  envelope autenticado mas malformado (jti, corpo) — não retente
 *   413  corpo acima do teto                              — não retente
 *   429  rajada                                           — retente depois
 *   200  applied | replay | out_of_order                  — consumido
 *   202  session_not_found | session_inert                — consumido, inerte
 *   409  transition_refused                               — olho humano
 *   500  configuração quebrada ou falha do banco          — retente
 *
 * O motivo da recusa NUNCA vai no corpo da resposta: dizer ao chamador qual
 * checagem falhou é dar oráculo de graça. Ele vai para `runtime_logs`.
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { adminClient } from "../_shared/voip/caller.ts";
import {
  verifyWebhookDetailed,
  type WebhookRejection,
} from "../_shared/voip/webhook-verify.ts";
import {
  asRecordingStore,
  type FetchLike,
  runRecordingIngest,
} from "../_shared/voip/recording.ts";

export type Admin = ReturnType<typeof adminClient>;

// ─── limites ────────────────────────────────────────────────────────────────

/**
 * A VPS inteira fala por UM endereço, para TODAS as organizações. O limite não
 * pode ser apertado como se fosse por tenant: ele existe para blindar contra
 * enxurrada anônima, não para modelar o tráfego legítimo. 20/s dá duas ordens
 * de grandeza de folga sobre o pico previsto (30 orgs, ~4 eventos por chamada).
 */
export const BURST_MAX_PER_IP = 1200;
const BURST_WINDOW_MS = 60_000;

/**
 * Teto de endereços rastreados por isolate. Sem ele, o próprio mapa do
 * limitador é o alvo: um endereço forjado por requisição cresce memória sem
 * limite. Estourado o teto, o mapa é varrido e — se ainda estourar — zerado.
 * Zerar afrouxa a CONTAGEM, nunca a assinatura, que é a barreira de verdade.
 */
export const BURST_MAX_TRACKED = 4096;

/** Os três eventos cabem em centenas de bytes. 64 KiB é folga de 100×. */
const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * O `detail` da recusa ecoa string DO ATACANTE (`aud`, `env`, `kid` vêm do
 * token, pré-assinatura) e o verificador não impõe teto. Sem este corte, uma
 * `aud` de um megabyte vira uma linha de um megabyte em `runtime_logs`.
 */
export const MAX_DETAIL_CHARS = 160;

/** `x-forwarded-for` também é palavra do chamador. Mesmo tratamento. */
export const MAX_IP_CHARS = 64;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── vocabulário de runtime_logs ────────────────────────────────────────────

/**
 * Ação própria por motivo de recusa. `Record<WebhookRejection, ...>` é
 * EXAUSTIVO de propósito: no dia em que a T7 ganhar um motivo novo, o
 * `deno check` do `scripts/test-voip-choke.sh` reprova este arquivo em vez de
 * deixar o motivo novo cair num rótulo genérico e sumir do diagnóstico.
 */
const REJECTION_ACTION: Record<WebhookRejection, string> = {
  malformed: "webhook_envelope_malformado",
  bad_header: "webhook_header_invalido",
  unknown_kid: "webhook_kid_desconhecido",
  bad_signature: "webhook_assinatura_invalida",
  bad_claims: "webhook_claims_invalidas",
  wrong_issuer: "webhook_emissor_errado",
  wrong_audience: "webhook_destino_errado",
  wrong_env: "webhook_ambiente_errado",
  expired: "webhook_envelope_expirado",
  not_yet_valid: "webhook_envelope_do_futuro",
  ttl_too_long: "webhook_ttl_longo_demais",
  body_hash_mismatch: "webhook_corpo_divergente",
};

/**
 * Código da RPC → status HTTP. Ver o contrato em
 * `supabase/migrations/20270730000010_voip_webhook_ingest.sql`.
 *
 * Código FORA desta tabela é deriva de contrato entre a migration e esta
 * função, e vira 500 — nunca um 200 silencioso sobre um desfecho que ninguém
 * mapeou.
 */
const CODE_TO_STATUS: Record<string, number> = {
  applied: 200,
  replay: 200,
  out_of_order: 200,
  session_not_found: 202,
  session_inert: 202,
  transition_refused: 409,
};

/**
 * Quais desfechos da RPC merecem linha em `runtime_logs`.
 *
 * `applied` e `replay` ficam de fora: são o caminho feliz e a retentativa
 * funcionando como projetada. Registrá-los dobraria a escrita de banco por
 * evento para não contar nada — e o que interessa deles a RPC já registra
 * sozinha (ressurreição, sessão falhando, chamada desconhecida).
 */
const CODE_ACTION: Record<string, { action: string; status: "error" | "skipped" }> = {
  out_of_order: { action: "webhook_evento_fora_de_ordem", status: "skipped" },
  session_not_found: { action: "webhook_sessao_desconhecida", status: "skipped" },
  session_inert: { action: "webhook_sessao_inerte", status: "skipped" },
  transition_refused: { action: "webhook_transicao_recusada", status: "error" },
};

// ─── barreira 1: rajada em memória ──────────────────────────────────────────

interface BurstEntry {
  count: number;
  resetAt: number;
  /** Já houve uma linha em `runtime_logs` para esta janela? */
  alerted: boolean;
}

const burst = new Map<string, BurstEntry>();

/**
 * Cópia deliberada de `getClientIdentifier` de `_shared/auth.ts`.
 *
 * Importar aquele módulo traria junto DOIS erros de tipo pré-existentes
 * (`crypto.subtle.timingSafeEqual` não existe no lib do Deno), e este arquivo
 * está na lista do `deno check` de `scripts/test-voip-choke.sh` — herdar os
 * erros alheios significaria ou o portão nascer vermelho, ou tirar este arquivo
 * do portão. Cinco linhas de duplicação valem menos que qualquer das duas.
 */
function clientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    forwardedFor?.split(",")[0]?.trim() ??
    "unknown";
}

/** Só para teste: zera o contador entre casos. */
export function __resetBurstForTests(): void {
  burst.clear();
}

/**
 * Só para teste: quantos endereços o mapa guarda agora.
 *
 * Existe porque `BURST_MAX_TRACKED` é invisível de fora — o comportamento que
 * ele protege (o mapa não cresce sem limite) não muda nenhuma resposta HTTP, e
 * sem esta janela um teste não conseguiria distinguir a guarda presente da
 * guarda removida.
 */
export function __burstSizeForTests(): number {
  return burst.size;
}

/**
 * A ÚNICA recusa que não vira uma linha de log por requisição.
 *
 * Escrever em `runtime_logs` a cada requisição barrada seria exatamente a
 * amplificação que este limitador existe para impedir: cada pacote do atacante
 * viraria um INSERT. Uma linha por janela por endereço registra o incidente; o
 * resto vai para o console, que não custa banco.
 */
function takeBurstToken(ip: string, now: number): { allowed: boolean; alertOnce: boolean } {
  if (burst.size > BURST_MAX_TRACKED) {
    for (const [k, v] of burst) if (now > v.resetAt) burst.delete(k);
    if (burst.size > BURST_MAX_TRACKED) burst.clear();
  }

  const entry = burst.get(ip);
  if (!entry || now > entry.resetAt) {
    burst.set(ip, { count: 1, resetAt: now + BURST_WINDOW_MS, alerted: false });
    return { allowed: true, alertOnce: false };
  }

  entry.count++;
  if (entry.count > BURST_MAX_PER_IP) {
    const alertOnce = !entry.alerted;
    entry.alerted = true;
    return { allowed: false, alertOnce };
  }
  return { allowed: true, alertOnce: false };
}

// ─── barreira 2: leitura ÚNICA do corpo, com teto nos bytes ─────────────────

type BodyRead =
  | { ok: true; raw: string }
  | { ok: false; reason: "too_large" | "read_failed" };

/**
 * Lê o corpo CRU uma única vez, cortando no teto.
 *
 * O `content-length` é conferido primeiro só para poupar trabalho quando o
 * chamador é honesto — a barreira de verdade é o acumulador, porque um chamador
 * pode omitir ou mentir o header (`Transfer-Encoding: chunked`).
 *
 * A volta UTF-8 é fiel para o que a VPS emite: `json.Marshal` do Go só produz
 * UTF-8 válido. Corpo que NÃO fosse UTF-8 válido ganharia U+FFFD na decodifi-
 * cação, o `bh` deixaria de bater e a entrega viraria 401 — fail-closed, que é
 * o lado certo de errar.
 */
async function readBodyCapped(req: Request, limit: number): Promise<BodyRead> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, reason: "too_large" };
  }
  if (!req.body) return { ok: true, raw: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, raw: new TextDecoder().decode(merged) };
}

// ─── resposta ───────────────────────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withSecurityHeaders({ "Content-Type": "application/json" }),
  });
}

function clip(value: string | undefined, max: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length <= max ? value : `${value.slice(0, max)}…[+${value.length - max}]`;
}

// ─── handler ────────────────────────────────────────────────────────────────

/**
 * `openAdmin` é uma fábrica, não um cliente pronto. Ela só é invocada depois da
 * assinatura passar — e é isso que torna a ordem das barreiras uma propriedade
 * TESTÁVEL ("o banco não foi aberto neste 401") em vez de uma promessa de
 * comentário.
 */
export async function handleVpsEvent(
  req: Request,
  openAdmin: () => Admin,
  /**
   * Só para teste: substitui a busca da gravação e o `fetch` que ela usa.
   *
   * A busca é EFEITO do evento, não parte da transação dele — e para prová-lo é
   * preciso poder observar que ela foi (ou não foi) disparada, e com quais
   * argumentos. Sem esta costura, o único jeito de testar seria bater na rede.
   */
  deps: {
    ingest?: typeof runRecordingIngest;
    fetch?: FetchLike;
  } = {},
): Promise<Response> {
  // ── 1. rajada ─────────────────────────────────────────────────────────────
  //
  // ANTES do teste de método, de propósito. Requisição com método errado também
  // consome ficha: se o 405 viesse primeiro, uma enxurrada de GET escaparia
  // inteira do limitador — e é justamente o tráfego que mais barato é de gerar.
  const ip = clip(clientIp(req), MAX_IP_CHARS) ?? "unknown";
  const gate = takeBurstToken(ip, Date.now());
  if (!gate.allowed) {
    if (gate.alertOnce) {
      await logRuntime({
        module: "voip",
        action: "webhook_rajada_barrada",
        status: "error",
        payloadSnapshot: { source_ip: ip, limite_por_minuto: BURST_MAX_PER_IP },
      });
    } else {
      console.warn(`[torquecalls-webhook] rajada barrada (${ip})`);
    }
    return json(429, { error: "rate_limited" });
  }

  // ── 2. método ─────────────────────────────────────────────────────────────
  //
  // Sem OPTIONS: quem chama é a VPS, não um navegador. OPTIONS cai aqui como
  // qualquer outro método e leva 405, que é a resposta honesta.
  //
  // A SEGUNDA — E ÚLTIMA — RECUSA SEM LINHA EM `runtime_logs`, e pela mesma
  // razão que o 429: o limitador de rajada roda ACIMA desta linha, então método
  // errado em loop já é barrado e já é registrado, uma vez por janela por
  // endereço. Logar aqui a cada requisição reabriria exatamente a amplificação
  // que o 429 fecha — cada GET de um varredor de porta viraria um INSERT. Todas
  // as outras recusas (401, 413, 400, 409, 500) geram uma linha cada.
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // ── 3. teto de tamanho + leitura ÚNICA do corpo cru ──────────────────────
  const body = await readBodyCapped(req, BODY_LIMIT_BYTES);
  if (!body.ok) {
    await logRuntime({
      module: "voip",
      action: body.reason === "too_large"
        ? "webhook_corpo_grande_demais"
        : "webhook_corpo_ilegivel",
      status: "error",
      payloadSnapshot: { source_ip: ip, limite_bytes: BODY_LIMIT_BYTES },
    });
    return json(body.reason === "too_large" ? 413 : 400, {
      error: body.reason === "too_large" ? "body_too_large" : "unreadable_body",
    });
  }
  const raw = body.raw;

  // ── 4. assinatura, ANTES de qualquer ida ao banco ────────────────────────
  //
  // O verificador LANÇA quando a configuração está quebrada e RECUSA quando o
  // token é ruim. Confundir os dois faz "chave pública ausente" virar 401 —
  // indistinguível de "a VPS está mandando lixo", que é o diagnóstico errado e
  // manda o plantonista olhar o lugar errado.
  let verified;
  try {
    verified = await verifyWebhookDetailed(
      req.headers.get("Authorization") ?? "",
      raw,
    );
  } catch (err) {
    // A mensagem NOMEIA variáveis de ambiente. Ela vai para `runtime_logs`,
    // nunca para o corpo da resposta.
    await logRuntime({
      module: "voip",
      action: "webhook_config_invalida",
      status: "error",
      errorMessage: String(err instanceof Error ? err.message : err).slice(0, 500),
      payloadSnapshot: { source_ip: ip },
    });
    return json(500, { error: "internal_error" });
  }

  if (!verified.ok) {
    await logRuntime({
      module: "voip",
      action: REJECTION_ACTION[verified.reason],
      status: "error",
      payloadSnapshot: {
        source_ip: ip,
        motivo: verified.reason,
        detalhe: clip(verified.detail, MAX_DETAIL_CHARS),
      },
    });
    return json(401, { error: "unauthorized" });
  }

  const claims = verified.claims;

  // A partir daqui tudo que decide roteamento vem das CLAIMS ASSINADAS. O corpo
  // é dado sobre a chamada; ele não escolhe sessão, ordem nem identidade de
  // evento — e a organização não sai nem de um nem de outro: quem a resolve é a
  // RPC, por `tc_session_id`.

  // `event_jti` é `uuid` na RPC. Um jti que não seja UUID levantaria 22P02 lá
  // dentro, abortaria a transação e viraria 500 — culpando o CRM por um
  // envelope malformado da VPS. Recusar aqui mantém o diagnóstico no lugar
  // certo.
  if (!UUID_RE.test(claims.jti)) {
    await logRuntime({
      module: "voip",
      action: "webhook_jti_nao_uuid",
      status: "error",
      payloadSnapshot: {
        source_ip: ip,
        tc_session_id: claims.sid,
        jti_recebido: clip(claims.jti, MAX_DETAIL_CHARS),
      },
    });
    return json(400, { error: "invalid_envelope" });
  }

  // O `JSON.parse` acontece SÓ AGORA, sobre o mesmo texto que a assinatura já
  // cobriu. Nada do que ele produz volta para a verificação.
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = undefined;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    await logRuntime({
      module: "voip",
      action: "webhook_corpo_nao_e_objeto",
      status: "error",
      payloadSnapshot: {
        source_ip: ip,
        tc_session_id: claims.sid,
        bytes: raw.length,
      },
    });
    return json(400, { error: "invalid_payload" });
  }

  // ── 5. a RPC ─────────────────────────────────────────────────────────────
  const db = openAdmin();
  const { data, error } = await db.rpc("fn_voip_apply_vps_event", {
    p_event_jti: claims.jti,
    p_sid: claims.sid,
    p_epoch: claims.epoch,
    p_seq: claims.seq,
    p_signed_at: new Date(claims.iat * 1000).toISOString(),
    p_payload: payload,
  });

  const evento = {
    tc_session_id: claims.sid,
    event_jti: claims.jti,
    seq_epoch: claims.epoch,
    seq: claims.seq,
    tipo: typeof (payload as Record<string, unknown>).type === "string"
      ? (payload as Record<string, unknown>).type
      : null,
  };

  if (error) {
    await logRuntime({
      module: "voip",
      action: "webhook_rpc_falhou",
      status: "error",
      errorMessage: String(error.message ?? error).slice(0, 500),
      payloadSnapshot: evento,
    });
    return json(500, { error: "internal_error" });
  }

  // `fetch_call_id`/`tc_call_id`/`organization_id` só existem no desfecho de
  // `recording-ready`, e só quando há de fato o que buscar. Ver a seção 3.3 de
  // 20270803000000_voip_recording_ingest.sql.
  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    detail?: string;
    fetch_call_id?: unknown;
    tc_call_id?: unknown;
    organization_id?: unknown;
  };
  const code = typeof result.code === "string" ? result.code : "";
  const status = CODE_TO_STATUS[code];

  if (status === undefined) {
    await logRuntime({
      module: "voip",
      action: "webhook_codigo_desconhecido",
      status: "error",
      payloadSnapshot: { ...evento, code: clip(code, MAX_DETAIL_CHARS) },
    });
    return json(500, { error: "internal_error" });
  }

  const registro = CODE_ACTION[code];
  if (registro) {
    await logRuntime({
      module: "voip",
      action: registro.action,
      status: registro.status,
      payloadSnapshot: { ...evento, detalhe: clip(result.detail, MAX_DETAIL_CHARS) },
    });
  }

  // ── 6. o efeito: buscar a gravação ───────────────────────────────────────
  //
  // A RPC decide; esta função obedece. `fetch_call_id` só vem preenchido quando
  // há de fato o que buscar — reentrega sobre gravação já guardada devolve
  // `already_stored` e nada acontece aqui.
  //
  // É EFEITO, NÃO PARTE DA TRANSAÇÃO. O evento já foi aplicado e o `jti` já foi
  // reservado; a busca acontece depois, e o que ela devolve não muda o status
  // HTTP. Amarrar as duas coisas faria uma rede ruim entre o CRM e a VPS virar
  // 500 sobre um evento que foi corretamente consumido — e a VPS não retenta.
  //
  // EM SEGUNDO PLANO, com `EdgeRuntime.waitUntil`. Um arquivo de 4,5 h leva mais
  // que os 5 s do cliente HTTP da VPS (`webhookTimeout`), e segurar a resposta
  // até o fim faria a VPS abortar a requisição — no Supabase Edge, cliente que
  // desconecta recicla o isolate, e o upload morreria no meio deixando a
  // gravação presa em `processing`. `waitUntil` mantém o isolate vivo até a
  // busca terminar. Fora do Supabase Edge (teste, dev local) cai numa promessa
  // aguardada, que é o que torna o efeito observável no teste.
  const fetchCallId = typeof result.fetch_call_id === "string" ? result.fetch_call_id : null;
  const fetchTcCallId = typeof result.tc_call_id === "string" ? result.tc_call_id : null;
  const fetchOrgId = typeof result.organization_id === "string" ? result.organization_id : null;

  if (fetchCallId && fetchTcCallId && fetchOrgId) {
    const ingest = deps.ingest ?? runRecordingIngest;
    const trabalho = ingest(
      asRecordingStore(db),
      {
        callId: fetchCallId,
        tcCallId: fetchTcCallId,
        sessionId: claims.sid,
        organizationId: fetchOrgId,
      },
      { fetch: deps.fetch },
    )
      .then(() => undefined)
      .catch((e) => {
        // `runRecordingIngest` já registra a falha no banco; isto cobre o que
        // escapar dele. Nunca propaga: o evento foi consumido.
        console.error("[torquecalls-webhook] busca da gravação explodiu:", e);
      });

    const edgeRuntime = (globalThis as {
      EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
    }).EdgeRuntime;
    if (typeof edgeRuntime?.waitUntil === "function") {
      edgeRuntime.waitUntil(trabalho);
    } else {
      await trabalho;
    }
  }

  return json(status, { ok: result.ok === true, code });
}

Deno.serve(
  withErrorBoundary(
    "torquecalls-webhook",
    (req: Request) => handleVpsEvent(req, adminClient),
  ),
);
