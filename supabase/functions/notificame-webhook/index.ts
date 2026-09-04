/**
 * notificame-webhook — a PORTA DE ENTRADA dos eventos do NotificaMe.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  O TENANT NÃO VEM DO CORPO. VEM DO PATH QUE NÓS ESCREVEMOS.              ║
 * ║                                                                          ║
 * ║      /notificame-webhook/<SECRET>/<notificame_subaccounts.id>            ║
 * ║                                                                          ║
 * ║  A subscription é registrada com o `X-Api-Token` DA SUBCONTA, e subconta  ║
 * ║  é 1:1 com org. Logo, a URL que o fornecedor chama já carrega a org — num ║
 * ║  uuid que NÓS geramos e NÓS registramos. Nada que o remetente controle    ║
 * ║  escolhe tenant. É essa inversão que substitui a assinatura que o         ║
 * ║  fornecedor não faz.                                                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── TRÊS ESTADOS, NÃO DOIS ─────────────────────────────────────────────────
 *
 * ⚠️ NENHUM EVENTO REAL FOI OBSERVADO. Nenhum canal foi conectado ainda; todo o
 * formato é derivado de doc, e a doc do fornecedor já se provou errada uma vez
 * (dois hosts, duas versões). Por isso o receptor tem TRÊS desfechos:
 *
 *   (a) INTERPRETÁVEL   → linha em `channel_messages`, `raw_payload` com o corpo
 *                         cru integral, **200**;
 *   (b) NÃO-INTERPRETÁVEL → o CORPO INTEIRO em `notificame_webhook_events` com
 *                         `status='parked'` + `reason`, **200**. 200 aqui
 *                         significa "está guardado", nunca "entendi" — é a lição
 *                         do `enqueueDlq` (incidente 2026-08-06);
 *   (c) NEM GUARDOU     → **5xx**, para o fornecedor reentregar. O único desfecho
 *                         em que perder o evento ainda é possível.
 *
 * FILA E NÃO SÓ LOG, e a razão é medida: fila tem CONTAGEM
 * (`SELECT count(*) ... WHERE status='parked'`); `runtime_logs` não tem leitor
 * neste produto. "Detectar não é alertar" morde exatamente aqui — o consumidor que
 * GRITA é fatia própria, e até lá a leitura é manual, o que só é aceitável porque
 * o volume esperado é ZERO até o primeiro evento real.
 *
 * O primeiro evento real é lido DA FILA, com o corpo inteiro na mão, e os pickers
 * de `_shared/notificame-inbound.ts` são ajustados a partir dele. Isso é o desenho
 * FUNCIONANDO, não falhando.
 *
 * ─── SEM HMAC: A DEFESA É COMPOSTA, E A CAMADA QUE MAIS LIMITA O DANO É A (d) ─
 *
 *   (a) SECRET NO PATH, `timingSafeCompare`, falha → **404** (nunca 401: 401
 *       confirma que a rota existe). Secret PRÓPRIO `NOTIFICAME_WEBHOOK_SECRET`;
 *       reusar o do Uazapi compartilharia o raio de explosão com ~30 orgs.
 *   (b) UUID DA SUBCONTA no segundo segmento — segundo fator de portador. Com o
 *       secret vazado, o atacante ainda precisa do uuid daquela subconta, e o dano
 *       fica confinado a UMA org: o secret sozinho não escolhe tenant.
 *   (c) ALLOWLIST DE IP `NOTIFICAME_WEBHOOK_IPS`, FAIL-CLOSED POR CONSTRUÇÃO: env
 *       ausente ⇒ 503. O único jeito de rodar sem allowlist é setar a env com o
 *       literal exato `unrestricted` (mesmo truque de `ASAAS_ENV === 'sandbox'`).
 *       Omissão não abre a porta; só um ato escrito abre. ⚠️ LEIA O BLOCO
 *       "ANTES DE DEPLOYAR" abaixo: hoje o valor correto É `unrestricted`.
 *   (d) O QUE ESTA FUNÇÃO **NÃO** DISPARA. Autenticidade de CONTEÚDO não fecha sem
 *       assinatura: quem tiver secret + uuid injeta uma mensagem falsa naquela org.
 *       Por isso o inbound de Instagram desta fatia é INERTE POR DECISÃO — NÃO
 *       chama `triggerReactions`, NÃO acorda Copilot, NÃO dispara workflow. No
 *       `whatsapp-webhook` isso existe (L1032) e aqui faria um agente IA responder
 *       a um corpo forjado. Ligar gatilho é gate de PRODUTO: exige assinatura do
 *       fornecedor ou aceite explícito do CTO, e não é detalhe de implementação.
 *
 * ─── POR QUE O INGRESS NÃO TEM GATE DE FEATURE (decisão, não esquecimento) ───
 *
 * As flags `notificame` / `notificame_instagram` gateiam CONECTAR
 * (`notificame-channel-start` / `-finish`, via `readNotificameFlags`) e MOSTRAR (o
 * front). Elas NÃO gateiam RECEBER, e isso é escolhido, não esquecido:
 *
 *   1. QUANDO ESTE CÓDIGO RODA, A MENSAGEM JÁ CHEGOU. Desligar a flag não desliga
 *      a subscription do lado do fornecedor — ele continua entregando. Recusar
 *      aqui não impede o evento de existir; só escolhe DESTRUÍ-LO. Flag de produto
 *      significa "pare de mostrar / pare de enviar", nunca "apague o que o cliente
 *      do cliente mandou";
 *   2. O DESFECHO DE RECUSAR É PERMANENTE E SILENCIOSO. 4xx faz o fornecedor
 *      desistir depois das tentativas dele e o dado morre sem uma linha em lugar
 *      nenhum — o oposto exato dos três desfechos que esta função promete. Um
 *      cliente que desligou a flag por engano perderia a caixa de entrada inteira
 *      da janela, e o sintoma seria silêncio;
 *   3. FLAG DESLIGADA NÃO É SUPERFÍCIE ABERTA. Gravar exige subconta do path
 *      EXISTENTE + canal REGISTRADO + `status='connected'` NAQUELA org. Uma org que
 *      nunca conectou não tem canal, e todo evento dela parka. O custo de uma org
 *      que já conectou e desligou a flag é limitado pelo teto POR TENANT abaixo;
 *   4. É REVERSÍVEL DOS DOIS LADOS. Com a flag desligada a linha existe mas fica
 *      invisível no produto (o front não monta a caixa), e religar a flag traz a
 *      conversa de volta inteira. A decisão oposta não tem volta.
 *
 * O kill-switch REAL do ingress é de fora: remover a subscription no fornecedor ou
 * tirar o IP da allowlist (camada (c)). Os dois param a ENTREGA — não o dado que
 * já foi entregue. Se um dia o produto precisar de "esta org não recebe mais",
 * isso é `messaging_channels.status='disconnected'` + parada da subscription, não
 * um 403 aqui.
 *
 * ─── O TETO DO CORPO É NOSSO, E A FILA ACEITA QUALQUER CORPO ────────────────
 *
 * `content-length` é DECLARAÇÃO do remetente. Com `Transfer-Encoding: chunked` ou
 * sem o cabeçalho, um corpo de qualquer tamanho atravessaria um teto que só lê
 * header — teto que só vale quando o remetente coopera não é teto. Por isso o
 * limite é aplicado NA LEITURA (`readBodyCapped`), byte a byte: o cabeçalho segue
 * como recusa BARATA, o stream é a recusa REAL.
 *
 * E a fila aceita QUALQUER corpo, não só objeto JSON — senão a promessa "nunca
 * descartar" vale só para o corpo bem-comportado:
 *   - corpo VAZIO ou não-JSON      → `{raw_text, truncated}`;
 *   - JSON que NÃO É OBJETO (`""`, `null`, `3`, `[…]`) → embrulhado em `raw_json`.
 *     Sem o embrulho o PostgREST manda `''` para uma coluna `jsonb` e o Postgres
 *     devolve 22P05: o park falha, a função cai em 5xx e o corpo se perde
 *     JUSTAMENTE no caso mais estranho — o que mais ensina;
 *   - corpo ACIMA DO TETO          → a CABEÇA (64 KB) vai para a fila como
 *     evidência e a resposta é 413. Recusar sem guardar nada seria jogar fora o
 *     único exemplar de um formato que ninguém viu;
 *   - conteúdo que o `jsonb` recusa mesmo DENTRO de um objeto (`\u0000` numa
 *     string é o caso vivo) → o park REPETE com o corpo serializado como TEXTO,
 *     onde o `\u0000` vira os seis caracteres `\`,`u`,`0`,`0`,`0`,`0` e passa.
 *   Um park que falha por causa do CONTEÚDO é a única forma de esta função perder
 *   dado — e é essa a razão da segunda tentativa.
 *
 * ─── IDEMPOTÊNCIA: SEM ID DO FORNECEDOR, A LINHA NÃO NASCE ──────────────────
 *
 * `.upsert(row, { onConflict: 'external_id,channel,organization_id',
 * ignoreDuplicates: true })` — o molde do `whatsapp-webhook` (`ON CONFLICT DO
 * NOTHING`), NÃO o do `meta-webhook`, que faz SELECT-antes-de-INSERT (L274) e
 * perde a corrida entre duas entregas simultâneas. Zero linhas devolvidas =
 * reentrega = caminho FELIZ.
 *
 * ⚠️ E JAMAIS `notificame_${Date.now()}`. O defeito a não copiar mora em
 * `send-meta-message/index.ts:137`: id sintético é novo a cada reentrega, derrota
 * a UNIQUE que é a própria guarda, e duplica a mensagem no inbox do cliente. Sem
 * `external_id` do fornecedor, o evento PARKA.
 *
 * ═══ ANTES DE DEPLOYAR: `NOTIFICAME_WEBHOOK_IPS` ═══════════════════════════
 *
 * ⛔ SEM ESTA ENV, ESTA FUNÇÃO RECUSA **TUDO** COM 503. Não é bug; é a camada (c)
 * funcionando. E hoje o valor certo é `unrestricted`, porque:
 *
 *     O FORNECEDOR NÃO PUBLICA OS IPs DELE. A doc não os lista, e nenhum evento
 *     real chegou ainda para observá-los. Não existe lista para escrever.
 *
 * Então o ato de deploy tem DOIS passos, não um:
 *
 *     supabase secrets set NOTIFICAME_WEBHOOK_IPS=unrestricted --project-ref <ref>
 *     supabase functions deploy notificame-webhook --project-ref <ref>
 *
 * `unrestricted` é ATO ESCRITO, e é isso que ele significa: "sabemos que não há
 * lista, e aceitamos rodar com as camadas (a) secret + (b) uuid da subconta". Um
 * default no código diria a mesma coisa sem ninguém ter decidido nada — é essa a
 * diferença, e é por isso que a env continua sem default.
 *
 * ⚠️ COMO DESCOBRIR O ESTADO **ANTES** DO PRIMEIRO EVENTO — porque descobrir
 * depois é descobrir por silêncio, e silêncio aqui é indistinguível de "ninguém
 * mandou mensagem":
 *
 *     curl -i https://<ref>.supabase.co/functions/v1/notificame-webhook/health
 *
 *   `200 {"ok":true}`  → a env está setada (com lista ou com `unrestricted`);
 *   `503 {"ok":false,"error":"ip_allowlist_unset","remedy":"…"}` → NÃO ESTÁ, e o
 *   `remedy` traz o comando exato. O `/health` mente por omissão se responder 200
 *   com a função incapaz de aceitar um evento — por isso ele NÃO é um `ok:true`
 *   fixo. Ele não revela QUAL é o valor: só se existe. E o boot da função grita a
 *   mesma coisa em `console.error`, visível no primeiro `functions logs`.
 *
 * QUANDO O FORNECEDOR PUBLICAR OS IPs: troque `unrestricted` pela lista
 * (`1.2.3.0/24,5.6.7.8`) e leia a nota sobre QUAL HOP decide, em `trustedSourceIp`
 * — a allowlist compara contra o hop confiável, que NÃO é o primeiro do
 * `x-forwarded-for`.
 *
 * ─── ORDEM DE DEPLOY ────────────────────────────────────────────────────────
 *
 * MIGRATION PRIMEIRO, FUNÇÕES DEPOIS. Esta função depende de
 * `notificame_webhook_events`, de `messaging_channels` e das colunas
 * `channel_messages.messaging_channel_id` / `.contact_external_id`. Sem elas o
 * caminho inteiro degrada para 5xx — que é fail-closed correto (o fornecedor
 * reentrega), mas nenhuma mensagem entra até o apply.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { timingSafeCompare, checkRateLimit, checkRateLimitPersistent } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  NOTIFICAME_DEFAULT_BASE_URL,
  normalizeSeamlessType,
  orgConfigFrom,
} from "../_shared/notificame.ts";
import { loadNotificameSubaccount } from "../_shared/notificame-credentials.ts";
import {
  buildInboundChannelMessageRow,
  buildPayloadSnapshot,
  pickAccountHandle,
  pickChannelId,
  pickChannelWord,
  pickContact,
  pickExternalId,
  pickInterlocutorDeSaida,
  pickProviderMessageId,
  pickTimestampIso,
  readDirection,
  readEventType,
  readMessageStatus,
  OUTBOUND_STATUS_RANK,
  type InboundEventType,
} from "../_shared/notificame-inbound.ts";
import { isMissingTableError } from "../_shared/notificame-schema-guard.ts";
import { mirrorContactAvatar } from "../_shared/notificame-avatar.ts";
import { normalizarConteudo } from "../_shared/notificame-content.ts";
import { reacoesDoEvento } from "../_shared/notificame-reacoes.ts";
import { findLeadByPhoneOrEmail } from "../_shared/lead-service.ts";
import { fireTrigger } from "../_shared/workflow-trigger.ts";
import { espelharMidiaRecebida } from "../_shared/mirror-inbound-media.ts";
import { baixarMidiaPeloFornecedor } from "../_shared/notificame-media-download.ts";
import {
  type ClienteDoFechamento,
  fecharLinhaDoDisparo,
} from "../_shared/quick-blast/fechar-entrega.ts";

const FUNCTION_NAME = "notificame-webhook";

/** A fila. Nomeada uma vez: aparece na escrita e na mensagem do operador. */
const PARK_TABLE = "notificame_webhook_events";

/**
 * Teto de corpo, APLICADO NA LEITURA (`readBodyCapped`), não no `content-length`.
 *
 * ⚠️ `content-length` é DECLARAÇÃO do remetente: com `Transfer-Encoding: chunked`
 * ele nem existe, e sem ele um teto que só lê header deixa passar qualquer
 * tamanho. O header segue sendo consultado — recusar antes de ler é mais barato —,
 * mas quem GARANTE o teto é o contador de bytes do stream.
 */
const BODY_SIZE_LIMIT = 2 * 1024 * 1024;

/**
 * Teto do `raw_text` guardado quando o corpo NÃO É JSON (ou não coube). Aqui não há
 * objeto para guardar; guarda-se o texto, e um texto de 2 MB numa coluna jsonb por
 * evento é como a fila deixa de caber. 64 KB é o bastante para reconhecer o formato.
 */
const RAW_TEXT_PARK_LIMIT = 64 * 1024;

/**
 * DISJUNTOR POR IP, PRÉ-AUTENTICAÇÃO, em memória. NÃO é o teto do produto.
 *
 * ⚠️ TODOS os eventos de TODAS as orgs chegam dos MESMOS poucos IPs do fornecedor.
 * Um teto por IP dimensionado para uma org vira, na prática, um teto GLOBAL
 * COMPARTILHADO: a org que mais recebe consome a cota e as outras 29 levam 429 sem
 * ter feito nada — e quem tiver secret + uuid derruba a entrega de TODO MUNDO com
 * um laço, sem nunca escrever uma linha. Por isso este número é ALTO de propósito:
 * ele existe só para uma enxurrada não pagar ida ao banco por requisição. A
 * JUSTIÇA entre tenants é o `TENANT_RATE_LIMIT_MAX` abaixo, cobrado por org.
 */
const INGRESS_BURST_MAX = 20_000;

/**
 * O TETO DE VERDADE, cobrado POR TENANT (subconta = org, 1:1).
 *
 * A chave é a ORG resolvida a partir do uuid do path — nossa, não do remetente —, e
 * não o IP. Estourar aqui devolve 429, que para o fornecedor é "volte depois": o
 * evento sobrevive na fila DELE. Cardinalidade limitada ao nº de orgs, o que
 * importa porque `check_rate_limit` cria uma linha por (chave, janela): chavear por
 * um uuid não-validado deixaria qualquer varredura inflar a tabela `rate_limits`.
 */
const TENANT_RATE_LIMIT_MAX = 1000;

const RATE_LIMIT_WINDOW_MS = 60_000;

/** Deadline do processamento. Acima disso o fornecedor reentrega. */
const PROCESS_TIMEOUT_MS = 12_000;

/**
 * Quantos canais conectados a org pode ter e ainda assim caberem no diagnóstico de
 * empate. Maior que o `limit(3)` original de propósito: quando o desempate falha, é
 * a LISTA DE CANDIDATOS que vai para a fila e para o log, e uma lista truncada em 3
 * manda o operador consertar um empate que ele não consegue ver inteiro.
 */
const CHANNEL_CANDIDATE_LIMIT = 25;

/**
 * O literal — e SÓ ele — que desarma a allowlist de IP. Ver a camada (c) do
 * cabeçalho: env ausente NÃO desarma.
 */
const IP_ALLOWLIST_DISABLED = "unrestricted";

/**
 * A FRASE QUE CONSERTA. Ela sai no corpo do 503, no log de boot e no `/health` —
 * um texto só, porque três textos divergem e o operador acaba lendo o errado.
 *
 * ⚠️ Ela diz o VALOR a setar, não só o nome da env. "defina NOTIFICAME_WEBHOOK_IPS"
 * manda o leitor procurar uma lista de IPs que NÃO EXISTE (o fornecedor não os
 * publica) — e é exatamente aí que se perde a tarde e se conclui "está quebrado".
 */
/**
 * ⚠️ ASCII PURO, SEM ACENTO E SEM TRAVESSÃO — restrição de transporte, não
 * descuido: esta frase vai também num CABEÇALHO HTTP, e valor de header fora de
 * Latin-1 faz o `Headers` do Deno LANÇAR. Uma exceção montando a resposta de erro
 * trocaria um 503 explicativo por um 500 mudo, exatamente no caminho que existe
 * para explicar. O acento morre; a resposta vive.
 */
const IP_ALLOWLIST_REMEDY =
  `defina NOTIFICAME_WEBHOOK_IPS: as faixas do fornecedor separadas por virgula ` +
  `(ex.: 1.2.3.0/24,5.6.7.8) ou o literal exato '${IP_ALLOWLIST_DISABLED}' quando ` +
  `nao houver lista publicada. Comando: supabase secrets set ` +
  `NOTIFICAME_WEBHOOK_IPS=${IP_ALLOWLIST_DISABLED} --project-ref <ref>`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NOTIFICAME_WEBHOOK_SECRET = Deno.env.get("NOTIFICAME_WEBHOOK_SECRET") ?? "";

/**
 * VOCABULÁRIO FECHADO de motivos de parking.
 *
 * Fechado de propósito: `reason` é o que um humano vai AGRUPAR quando abrir a fila
 * pela primeira vez ("87 eventos, todos `unresolved_channel`" resolve em um olhar;
 * 87 frases livres não resolvem nada). Fechado NO CÓDIGO e SEM CHECK na migration,
 * de propósito: um `reason` novo que fizesse o INSERT falhar (23514) perderia o
 * corpo cru, que é o dado que a fila existe para guardar.
 *
 * ⚠️ E é POR SER a coluna que se agrupa que dois motivos nunca podem dividir um
 * rótulo. `missing_external_id` e `missing_contact_id` são o par que mais tenta:
 * os dois são "faltou um id", mas o primeiro é o id DA MENSAGEM (sem ele a linha
 * não nasce, porque é a UNIQUE de idempotência que fica sem chave) e o segundo é o
 * id do INTERLOCUTOR (sem ele a linha nasceria e ficaria INVISÍVEL, porque a RPC
 * agrupa a conversa por `contact_external_id`). São ajustes DIFERENTES em pickers
 * DIFERENTES — `pickExternalId` vs. `pickContact` —, e colapsá-los num rótulo só
 * mandaria o operador editar o alias errado.
 */
type ParkReason =
  | "invalid_json"
  /** Corpo acima de `BODY_SIZE_LIMIT`. Só a CABEÇA foi guardada — ver o cabeçalho. */
  | "oversized_body"
  | "missing_subaccount_segment"
  | "unknown_subaccount"
  | "unresolved_channel"
  | "ambiguous_channel"
  | "channel_org_mismatch"
  | "channel_type_mismatch"
  /** Faltou o id da MENSAGEM (`pickExternalId`). Nome casa com a coluna `external_id`. */
  | "missing_external_id"
  /** Faltou o id do INTERLOCUTOR (`pickContact`). Coluna `contact_external_id`. */
  | "missing_contact_id"
  | "unreadable_direction"
  | "unhandled_event"
  /** `MESSAGE_STATUS` cujo corpo não diz id da mensagem ou status legível. */
  | "unreadable_status"
  /** `MESSAGE_STATUS` de uma mensagem que não é nossa (ou já superada). */
  | "status_no_match"
  | "insert_failed";

// ─── Allowlist de IP (puro) ──────────────────────────────────────────────────

/** `null` = a entrada não é um IPv4 legível. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/**
 * `ip` pertence a `entry`? `entry` é um IPv4 com máscara (`1.2.3.0/24`), um IPv4
 * solto, ou — para IPv6 e qualquer outra forma — igualdade literal.
 *
 * ⚠️ Igualdade literal para IPv6 é ESTREITO de propósito: um matcher de IPv6
 * meia-boca erra para o lado de ACEITAR, e esta é uma camada de defesa. Se o
 * fornecedor publicar faixas IPv6, elas entram como IPs soltos ou a env vira
 * `unrestricted` por decisão escrita — nunca por um regex otimista.
 */
function ipMatchesEntry(ip: string, entry: string): boolean {
  const clean = entry.trim();
  if (!clean) return false;

  const slash = clean.indexOf("/");
  if (slash < 0) return ip.trim() === clean;

  const network = ipv4ToInt(clean.slice(0, slash));
  const bits = Number(clean.slice(slash + 1));
  const candidate = ipv4ToInt(ip);
  if (network === null || candidate === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;

  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (network & mask) === (candidate & mask);
}

type AllowlistVerdict = "unset" | "disabled" | "allowed" | "denied";

/**
 * FAIL-CLOSED POR CONSTRUÇÃO. Env ausente ou vazia ⇒ `unset` ⇒ o chamador devolve
 * 503. Esquecer de configurar não abre a porta — só o literal `unrestricted` abre,
 * e escrevê-lo é um ato deliberado que fica registrado no secret.
 */
function checkIpAllowlist(rawEnv: string | undefined, sourceIp: string): AllowlistVerdict {
  const raw = (rawEnv ?? "").trim();
  if (!raw) return "unset";
  if (raw === IP_ALLOWLIST_DISABLED) return "disabled";

  const entries = raw.split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return "unset";

  return entries.some((entry) => ipMatchesEntry(sourceIp, entry)) ? "allowed" : "denied";
}

/** Teto do que ecoamos do `x-forwarded-for`: a cadeia é texto DO CHAMADOR. */
const MAX_CHAIN_HOPS = 8;
const MAX_HOP_CHARS = 64;

/**
 * O ENDEREÇO CONTRA O QUAL A ALLOWLIST DECIDE — e por que ele é o **ÚLTIMO** hop
 * do `x-forwarded-for`, não o primeiro.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  `x-forwarded-for: <cliente>, <proxy1>, <proxy2>`                        ║
 * ║                                                                          ║
 * ║  Cada proxy APENDA o endereço de quem falou com ele. Logo:               ║
 * ║    • o ÚLTIMO item foi escrito pelo proxy MAIS PRÓXIMO de nós, sobre um  ║
 * ║      peer TCP que ele mesmo observou — o remetente não o escolhe;        ║
 * ║    • todos os anteriores, inclusive o PRIMEIRO, são texto que veio de     ║
 * ║      fora e sobreviveu. Quem manda `X-Forwarded-For: 1.2.3.4` e cai num   ║
 * ║      gateway que APENDA (em vez de sobrescrever) acabou de escolher o     ║
 * ║      primeiro item.                                                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ POR QUE NÃO MANTIVEMOS O PRIMEIRO: manter exigiria PROVAR que o gateway
 * deste runtime SOBRESCREVE o cabeçalho. Não temos essa prova — a doc do Supabase
 * não a dá, e nenhum evento real passou por aqui para observarmos a cadeia. O
 * resto do repo usa o primeiro hop (`_shared/auth.ts:getClientIdentifier`,
 * `asaas-webhook`, `billing-*`), e ali o valor só alimenta RATE LIMIT e LOG:
 * errar significa contar errado. Aqui ele decide AUTORIZAÇÃO — errar significa
 * que a camada (c) some, e some em silêncio, porque um 200 forjado é
 * indistinguível de um 200 legítimo. Entre "assumir que o gateway sobrescreve" e
 * "usar o único item que ninguém de fora pôde escrever", a segunda não depende de
 * suposição nenhuma.
 *
 * ⚠️ E POR QUE `cf-connecting-ip` NÃO ENTRA NA DECISÃO: ele só vale se a Cloudflare
 * terminar a conexão à nossa frente (ela remove o cabeçalho do cliente). Não temos
 * essa prova aqui; sem ela, `cf-connecting-ip` é 100% palavra do remetente, e um
 * atacante escreveria nele o IP que quisesse. Ele fica DE FORA da autorização e
 * entra só como rótulo de diagnóstico quando não há `x-forwarded-for` nenhum.
 *
 * ⚠️ O MODO DE FALHA DESTA ESCOLHA É BARULHENTO, e isso é o ponto: se o runtime
 * tiver DOIS proxies apendando, o último hop será um endereço interno, ele não vai
 * casar com a lista do fornecedor e TODO evento vira 403 — visível de imediato,
 * com a cadeia inteira no log de `notificame_ip_denied` para o operador ler e
 * ajustar. O modo de falha da escolha oposta é um atacante entrando sem que nada
 * apareça em lugar nenhum. Nunca troque um erro visível por um furo silencioso.
 *
 * Devolve também a CADEIA (truncada), que é o dado que ensina a topologia real no
 * dia em que a allowlist deixar de ser `unrestricted`.
 */
function trustedSourceIp(req: Request): { ip: string; chain: string[] } {
  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim().slice(0, MAX_HOP_CHARS))
    .filter(Boolean);

  if (chain.length > 0) {
    return { ip: chain[chain.length - 1], chain: chain.slice(-MAX_CHAIN_HOPS) };
  }

  // Sem `x-forwarded-for`: não há hop confiável. `cf-connecting-ip` serve de
  // RÓTULO (log, chave de rate limit), e como a allowlist não vai casar com ele
  // numa lista de verdade, o desfecho continua sendo fail-closed.
  const labelOnly = req.headers.get("cf-connecting-ip")?.trim().slice(0, MAX_HOP_CHARS);
  return { ip: labelOnly || "unknown", chain: [] };
}

/**
 * BOOT. Roda no cold start, ANTES de qualquer evento — que é o único momento em
 * que ainda dá para consertar sem ter perdido nada.
 *
 * `console.error` e não `warn`: é o nível que a UI de logs do Supabase destaca, e
 * um aviso que não se destaca é o mesmo que não existir.
 */
if (!(Deno.env.get("NOTIFICAME_WEBHOOK_IPS") ?? "").trim()) {
  console.error(
    `[${FUNCTION_NAME}] ⛔ NOTIFICAME_WEBHOOK_IPS AUSENTE — esta função vai recusar ` +
      `TODOS os eventos com 503 (fail-closed). ${IP_ALLOWLIST_REMEDY}`,
  );
}

// ─── O CORPO: teto REAL e formas que a coluna `jsonb` aceita ─────────────────

type CappedBody =
  | { kind: "ok"; text: string }
  | { kind: "oversized"; head: string; bytesRead: number };

/**
 * Lê o corpo CONTANDO BYTES, e para no primeiro chunk que estoura o teto.
 *
 * ⚠️ POR QUE NÃO `req.text()` COM O TETO NO `content-length`: o header é declaração
 * do remetente. Em `Transfer-Encoding: chunked` ele não existe; num cliente que
 * mente, ele mente. `req.text()` materializa o que vier — e um corpo de centenas de
 * MB derruba o isolate ANTES de qualquer park, que é o único desfecho em que o
 * evento se perde. Teto que só vale quando o remetente coopera não é teto.
 *
 * Estourado, ainda devolvemos a CABEÇA já lida: ela é evidência do formato, e o
 * chamador a guarda na fila antes de responder 413. O custo de memória é o teto
 * mais UM chunk — o que estourou.
 */
async function readBodyCapped(req: Request, limit: number): Promise<CappedBody> {
  const stream = req.body;
  // POST sem corpo: `""` segue o caminho de `invalid_json` e é GUARDADO como os
  // outros. Corpo vazio não é motivo para descartar evento.
  if (!stream) return { kind: "ok", text: "" };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let oversized = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total > limit) {
        oversized = true;
        break;
      }
    }
  } finally {
    // Solta a conexão sem esperar o resto: já decidimos recusar.
    try {
      await reader.cancel();
    } catch {
      // stream já encerrado — nada a fazer.
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(merged);

  return oversized
    ? { kind: "oversized", head: text.slice(0, RAW_TEXT_PARK_LIMIT), bytesRead: total }
    : { kind: "ok", text };
}

function describeJsonKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * O que a coluna `notificame_webhook_events.payload JSONB` ACEITA.
 *
 * ⚠️ Objeto passa INTACTO — o corpo cru integral é o ativo da fila e não sofre
 * recorte aqui. O embrulho existe só para o que NÃO é objeto: um corpo que parseia
 * para `""`, `null`, `3` ou `[…]` chega ao PostgREST como valor escalar de uma
 * coluna jsonb, e `""` vira `22P05 invalid input syntax for type json`. O park
 * falharia, a função cairia em 5xx e o corpo se perderia JUSTAMENTE no caso mais
 * estranho — o que mais tem a ensinar sobre um formato que ninguém viu.
 */
function toJsonbSafePayload(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { raw_json: value === undefined ? null : value, raw_kind: describeJsonKind(value) };
}

/**
 * O ÚLTIMO RECURSO do park: o corpo inteiro serializado como TEXTO.
 *
 * ⚠️ Existe por um caso que nenhum embrulho de forma resolve: `jsonb` do Postgres
 * RECUSA `\u0000` dentro de string, mesmo escapado, e um corpo com um byte nulo
 * (binário mal rotulado como JSON, por exemplo) reprova o INSERT com 22P05 por
 * CONTEÚDO, não por forma. `JSON.stringify` transforma esse byte nos seis
 * caracteres `\`,`u`,`0`,`0`,`0`,`0` — texto comum, que entra.
 *
 * Guardar degradado é PIOR que guardar inteiro e MUITO melhor que 5xx com o corpo
 * na mão: o operador continua vendo o formato, e o `park_degraded` diz por que a
 * primeira tentativa não passou.
 */
function toTextParkPayload(payload: Record<string, unknown>, cause: string): Record<string, unknown> {
  let text: string;
  try {
    text = JSON.stringify(payload) ?? String(payload);
  } catch {
    text = String(payload);
  }
  return {
    raw_text: text.slice(0, RAW_TEXT_PARK_LIMIT),
    truncated: text.length > RAW_TEXT_PARK_LIMIT,
    park_degraded: cause.slice(0, 500),
  };
}

/** `@Milennials` e `milennials` são o MESMO handle. Comparação só depois disto. */
function normalizeHandleForMatch(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/^@+/, "").toLowerCase();
  return clean || null;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("processing_timeout")), ms)),
  ]);
}

Deno.serve(withErrorBoundary(FUNCTION_NAME, async (req: Request) => {
  const startedAt = Date.now();
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  const json = (
    status: number,
    body: Record<string, unknown> = {},
    extraHeaders?: Record<string, string>,
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: extraHeaders ? { ...headers, ...extraHeaders } : headers,
    });

  // ── 1. Preflight e método ────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    // PRONTIDÃO, não sinal de vida. Um `ok:true` fixo aqui mentiria exatamente no
    // estado que mais custa caro — env de allowlist ausente, função incapaz de
    // aceitar um único evento — e o operador só descobriria pelo silêncio, semanas
    // depois. Este é o passo de smoke test que roda LOGO APÓS o deploy, e é onde a
    // descoberta tem que acontecer.
    //
    // NÃO revela o valor da env nem se a lista é real ou `unrestricted`: só se ela
    // EXISTE. Quem varre não aprende postura de segurança; quem deployou aprende o
    // que falta.
    if (!(Deno.env.get("NOTIFICAME_WEBHOOK_IPS") ?? "").trim()) {
      return json(503, {
        ok: false,
        error: "ip_allowlist_unset",
        remedy: IP_ALLOWLIST_REMEDY,
      });
    }
    return json(200, { ok: true });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // O hop CONFIÁVEL — ver `trustedSourceIp`. É ele que a allowlist compara, e é
  // ele que vira chave de rate limit: uma chave que o remetente escolhe é uma
  // chave que ele rotaciona para escapar do teto.
  const { ip: sourceIp, chain: ipChain } = trustedSourceIp(req);

  // ── 2. DISJUNTOR por IP — não é o teto do produto ────────────────────────
  //
  // ⚠️ O IP AQUI É COMPARTILHADO POR TODAS AS ORGS: os eventos das ~30 orgs saem
  // dos MESMOS poucos endereços do fornecedor. Um teto por IP dimensionado para
  // uma org viraria um teto GLOBAL — a org mais movimentada consumiria a cota e as
  // outras levariam 429 sem ter feito nada, e quem tivesse secret + uuid derrubaria
  // a entrega de TODO MUNDO com um laço. Por isso este número é alto: ele é
  // DISJUNTOR (não pagar ida ao banco numa enxurrada), não justiça. A justiça é o
  // teto POR TENANT do passo 9, cobrado sobre a org que o PATH resolve.
  //
  // Em memória, e portanto por isolate (o Supabase roda vários): aproximado de
  // propósito. O autoritativo é o do banco, e ele é por tenant.
  if (!checkRateLimit(`${FUNCTION_NAME}:ip:${sourceIp}`, INGRESS_BURST_MAX, RATE_LIMIT_WINDOW_MS).allowed) {
    await logRuntime({
      module: "webhook",
      action: "notificame_ingress_burst",
      status: "error",
      errorMessage:
        `disjuntor de ingress: mais de ${INGRESS_BURST_MAX} req/min do MESMO IP. ` +
        `Isso é volume de TODAS as orgs somadas — se for tráfego legítimo, suba ` +
        `INGRESS_BURST_MAX; o teto por org é outro (TENANT_RATE_LIMIT_MAX)`,
      payloadSnapshot: buildPayloadSnapshot({ sourceIp }),
    });
    return json(429, { error: "rate_limited" });
  }

  // ── 3. Path: /notificame-webhook/<SECRET>/<SUBACCOUNT_ID> ────────────────
  //
  // ⚠️ DECODIFICAR É OBRIGATÓRIO, não higiene. `URL.pathname` NÃO desfaz o
  // percent-encoding, e `buildInboundWebhookUrl` monta a URL com
  // `encodeURIComponent`. Um `NOTIFICAME_WEBHOOK_SECRET` que contenha `+`, `/` ou
  // qualquer caractere que o encoder escape chegaria aqui como `a%2Bb%2Fc`,
  // `timingSafeCompare` falharia contra o secret CORRETO, e a função devolveria
  // 404 a TODOS os eventos — para sempre, com a configuração certa no lugar. O
  // sintoma seria "o Instagram não recebe nada", indistinguível de "ninguém
  // mandou mensagem", e o secret é justamente o valor que ninguém inspeciona.
  //
  // `decodeURIComponent` LANÇA em sequência `%` malformada (`URIError`) — que é
  // exatamente o que uma varredura produz. Cai no valor cru, que não vai casar, e
  // o pedido morre no 404 de baixo.
  const decodeSegment = (raw: string | undefined): string | undefined => {
    if (raw === undefined) return undefined;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  const segments = url.pathname.split("/").filter(Boolean);
  const idx = segments.findIndex((s) => s === FUNCTION_NAME);
  const pathSecret = idx >= 0 ? decodeSegment(segments[idx + 1]) : undefined;
  const subaccountRef = idx >= 0 ? decodeSegment(segments[idx + 2]) : undefined;

  // ── 4. Secret. Falha → 404, NUNCA 401 ────────────────────────────────────
  // 401 confirmaria que a rota existe e que só falta a credencial. 404 devolve a
  // mesma resposta que qualquer caminho inexistente — quem varre não aprende nada.
  if (
    !pathSecret ||
    !NOTIFICAME_WEBHOOK_SECRET ||
    !timingSafeCompare(pathSecret, NOTIFICAME_WEBHOOK_SECRET)
  ) {
    await logRuntime({
      module: "webhook",
      action: "notificame_auth_fail",
      status: "error",
      payloadSnapshot: {
        source_ip: sourceIp,
        // PREFIXO só. O valor inteiro num log é o próprio secret numa tabela que
        // humanos leem; 8 chars bastam para distinguir "secret velho depois de uma
        // rotação" de "varredura aleatória", que é a única pergunta que este campo
        // precisa responder.
        path_secret_prefix: pathSecret ? pathSecret.slice(0, 8) : null,
      },
    });
    return json(404, { error: "not_found" });
  }

  // ── 5. Allowlist de IP, FAIL-CLOSED ──────────────────────────────────────
  const ipVerdict = checkIpAllowlist(Deno.env.get("NOTIFICAME_WEBHOOK_IPS"), sourceIp);
  if (ipVerdict === "unset") {
    await logRuntime({
      module: "webhook",
      action: "notificame_ip_allowlist_unset",
      status: "error",
      // A MESMA frase do 503, do boot e do /health. Um texto só, para não haver
      // versão desatualizada do conserto circulando.
      errorMessage: `NOTIFICAME_WEBHOOK_IPS ausente — ${IP_ALLOWLIST_REMEDY}`,
      payloadSnapshot: buildPayloadSnapshot({ sourceIp }),
    });
    // 503 e não 500: é configuração faltando, e o fornecedor deve REENTREGAR
    // depois que ela existir. Nada foi perdido.
    //
    // O CONSERTO VIAJA NA PRÓPRIA RESPOSTA — mandar o operador caçar a explicação
    // em `runtime_logs`, que este produto não lê, seria reproduzir o defeito.
    //
    // Em CABEÇALHO, e não no corpo, por separação de audiência: o corpo desta rota
    // é contrato de MÁQUINA (quem o recebe é o fornecedor reentregando, e `{error}`
    // é o que ele lê), enquanto o remédio é para o HUMANO que está com o `curl -i`
    // na mão. O `curl -i` documentado no cabeçalho deste arquivo mostra os dois, e
    // a rota /health — cuja audiência é só humana — carrega o remédio no corpo.
    return json(503, { error: "ip_allowlist_unset" }, {
      "X-Notificame-Remedy": IP_ALLOWLIST_REMEDY,
    });
  }
  if (ipVerdict === "denied") {
    await logRuntime({
      module: "webhook",
      action: "notificame_ip_denied",
      status: "error",
      // O hop USADO e a CADEIA inteira. Sem os dois, "403 em tudo" não distingue
      // "o fornecedor mudou de IP" de "o hop confiável deste runtime é interno e a
      // lista precisa contê-lo" — leituras opostas com a mesma aparência. Ver o
      // modo de falha barulhento documentado em `trustedSourceIp`.
      errorMessage: `IP fora de NOTIFICAME_WEBHOOK_IPS (hop confiável: ${sourceIp})`,
      // A cadeia entra POR FORA de `buildPayloadSnapshot`: ela só interessa a este
      // ponto (o veredito de allowlist), e alargar o molde compartilhado faria
      // toda linha de todo evento carregar um campo nulo.
      payloadSnapshot: { ...buildPayloadSnapshot({ sourceIp }), ip_chain: ipChain },
    });
    return json(403, { error: "forbidden" });
  }

  // ── 6. Tamanho DECLARADO — recusa BARATA, e só isso ──────────────────────
  //
  // ⚠️ Este teste NÃO É O TETO. `content-length` é palavra do remetente: em
  // `Transfer-Encoding: chunked` ele nem existe, e um cliente que mente passa
  // direto. Ele fica porque recusar antes de abrir o stream é de graça. O teto que
  // VALE é o contador de bytes de `readBodyCapped`, no passo 10 — e lá o corpo
  // grande ainda deixa evidência na fila antes do 413, coisa que este atalho não
  // faz (aqui nem cliente do banco existe ainda).
  if (Number(req.headers.get("content-length") ?? 0) > BODY_SIZE_LIMIT) {
    return json(413, { error: "body_too_large" });
  }

  // ── 7. Cliente ANTES do corpo ────────────────────────────────────────────
  // Ordem deliberada: parkar um corpo ilegível PRECISA de cliente. Criá-lo depois
  // do parse deixaria o caso `invalid_json` sem para onde ir — e é justamente o
  // caso em que o corpo cru é o ativo mais valioso que existe.
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(`[${FUNCTION_NAME}] SUPABASE_URL/SERVICE_ROLE_KEY ausentes`);
    return json(503, { error: "not_configured" });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /**
   * GUARDA O EVENTO. É a única razão pela qual responder 200 a um corpo que não
   * entendemos é honesto.
   *
   * ⚠️ `payload` recebe o CORPO CRU INTEGRAL. A tabela é RLS service_role-only
   * exatamente porque isto é PII de terceiro e não passa por redação nenhuma.
   * `url_path` vai REDIGIDO — a URL carrega o secret.
   *
   * Devolve `false` quando nem guardar deu — e aí o chamador responde 5xx, para o
   * fornecedor reentregar. Nunca lança: uma exceção aqui viraria 500 com a
   * mensagem do banco no corpo.
   *
   * ─── DUAS TENTATIVAS, E A SEGUNDA É A QUE HONRA A PROMESSA ─────────────────
   *
   * A coluna é `jsonb NOT NULL`, e ela RECUSA duas classes de corpo que o parse do
   * JS aceita numa boa:
   *
   *   (i)  FORMA — o corpo parseia para algo que não é objeto (`""`, `null`, `3`,
   *        `[…]`). O PostgREST manda `''` para a coluna e o Postgres devolve
   *        `22P05`. `toJsonbSafePayload` desarma isto ANTES da primeira tentativa;
   *   (ii) CONTEÚDO — um ` ` dentro de uma string. `jsonb` recusa mesmo
   *        escapado, e nenhum embrulho de forma resolve. A SEGUNDA tentativa
   *        serializa tudo como TEXTO, onde o byte nulo vira seis caracteres
   *        comuns, e o evento entra DEGRADADO em vez de virar 5xx.
   *
   * "Nunca descartar" só vale se valer para o corpo esquisito — o corpo bem-
   * comportado nunca precisou de promessa nenhuma.
   */
  const park = async (params: {
    reason: ParkReason;
    payload: unknown;
    organizationId?: string | null;
    messagingChannelId?: string | null;
    externalId?: string | null;
    eventType?: InboundEventType | null;
    error?: string | null;
  }): Promise<boolean> => {
    const base = {
      source_ip: sourceIp,
      url_path: `/${FUNCTION_NAME}/<redacted>/${subaccountRef ?? ""}`,
      organization_id: params.organizationId ?? null,
      messaging_channel_id: params.messagingChannelId ?? null,
      external_id: params.externalId ?? null,
      event_type: params.eventType ?? null,
      status: "parked",
      reason: params.reason,
    };

    /** `null` = entrou. String = a mensagem do erro. Nunca lança. */
    const attempt = async (
      payload: Record<string, unknown>,
      lastError: string | null,
    ): Promise<string | null> => {
      try {
        const { error } = await admin.from(PARK_TABLE).insert({
          ...base,
          payload,
          last_error: lastError,
        });
        return error ? (error.message || "erro sem mensagem") : null;
      } catch (err) {
        return (err as Error)?.message || "exceção no insert do park";
      }
    };

    // Objeto passa INTACTO; só o que não é objeto é embrulhado.
    const primary = toJsonbSafePayload(params.payload);
    const firstError = await attempt(primary, params.error ?? null);
    if (firstError === null) return true;

    const degradedNote = [params.error, `park degradado para texto: ${firstError}`]
      .filter(Boolean)
      .join(" | ");
    const secondError = await attempt(toTextParkPayload(primary, firstError), degradedNote);
    if (secondError === null) {
      console.warn(
        `[${FUNCTION_NAME}] park DEGRADADO (${params.reason}): o corpo entrou como TEXTO ` +
          `porque a coluna jsonb recusou o objeto — ${firstError}`,
      );
      return true;
    }

    console.error(
      `[${FUNCTION_NAME}] PARK FALHOU NAS DUAS TENTATIVAS (${params.reason}) — o evento será ` +
        `perdido se o fornecedor não reentregar. Tabela ${PARK_TABLE} existe? ` +
        `jsonb: ${firstError} | texto: ${secondError}`,
    );
    return false;
  };

  /**
   * A resposta de um parking. 200 = "está guardado" (o fornecedor pode seguir em
   * frente); 503 = "não guardei" (reentregue).
   *
   * Um código estável e nenhuma prosa do banco: o interlocutor aqui é uma máquina,
   * e mensagem de erro de Postgres no corpo de uma resposta pública é vazamento de
   * schema de graça.
   */
  const parkResponse = async (
    stored: boolean,
    reason: ParkReason,
  ): Promise<Response> => {
    await logRuntime({
      module: "webhook",
      action: stored ? "notificame_event_parked" : "notificame_park_failed",
      status: stored ? "skipped" : "error",
      errorMessage: stored ? undefined : `não foi possível guardar o evento (${reason})`,
      payloadSnapshot: buildPayloadSnapshot({
        sourceIp,
        subaccountHint: subaccountRef ?? null,
        reason,
      }),
      durationMs: Date.now() - startedAt,
    });
    return stored
      ? json(200, { status: "parked", reason })
      : json(503, { error: "park_failed", reason });
  };

  /**
   * O CORPO, LIDO UMA VEZ SÓ — e com o teto valendo de verdade.
   *
   * ⚠️ TEXTO PRIMEIRO, JSON depois: `req.json()` direto PERDE o corpo quando o
   * parse falha, e o corpo é o ativo. Memoizado porque três caminhos diferentes
   * (`missing_subaccount_segment`, `unknown_subaccount` e o fluxo normal) precisam
   * dele, e o stream de uma Request só se lê uma vez.
   */
  type LoadedBody =
    | { kind: "oversized"; head: string; bytesRead: number }
    | { kind: "invalid_json"; parkPayload: Record<string, unknown> }
    | { kind: "json"; value: unknown };

  let bodyOnce: Promise<LoadedBody> | null = null;
  const loadBody = (): Promise<LoadedBody> =>
    (bodyOnce ??= (async (): Promise<LoadedBody> => {
      const read = await readBodyCapped(req, BODY_SIZE_LIMIT);
      if (read.kind === "oversized") {
        return { kind: "oversized", head: read.head, bytesRead: read.bytesRead };
      }
      try {
        return { kind: "json", value: JSON.parse(read.text) };
      } catch {
        // Corpo vazio cai AQUI (`JSON.parse('')` lança) e é guardado como qualquer
        // outro corpo ilegível. Não há objeto para guardar; guarda-se o texto.
        return {
          kind: "invalid_json",
          parkPayload: {
            raw_text: read.text.slice(0, RAW_TEXT_PARK_LIMIT),
            truncated: read.text.length > RAW_TEXT_PARK_LIMIT,
          },
        };
      }
    })());

  /** O que dá para guardar, seja qual for o desfecho do parse. */
  const parkableBody = (body: LoadedBody): unknown =>
    body.kind === "invalid_json" ? body.parkPayload : body.kind === "json" ? body.value : null;

  /**
   * Corpo acima do teto: 413, MAS com a cabeça guardada antes.
   *
   * Recusar sem guardar nada seria jogar fora o único exemplar de um formato que
   * ninguém neste projeto viu — e um corpo grande demais é justamente o sintoma que
   * mais precisa ser lido (lote? mídia embutida? o formato não é o que a doc diz?).
   */
  const oversizedResponse = async (
    body: Extract<LoadedBody, { kind: "oversized" }>,
    organizationId: string | null,
  ): Promise<Response> => {
    const stored = await park({
      reason: "oversized_body",
      payload: {
        raw_text: body.head,
        truncated: true,
        bytes_read_at_least: body.bytesRead,
        limit_bytes: BODY_SIZE_LIMIT,
      },
      organizationId,
      error: `corpo acima de ${BODY_SIZE_LIMIT} bytes — só a cabeça foi guardada`,
    });
    await logRuntime({
      organizationId: organizationId ?? undefined,
      module: "webhook",
      action: "notificame_body_too_large",
      status: "error",
      errorMessage:
        `corpo acima do teto (${BODY_SIZE_LIMIT} bytes, lidos ${body.bytesRead}+). ` +
        `Evidência guardada na fila: ${stored}`,
      payloadSnapshot: buildPayloadSnapshot({
        sourceIp,
        subaccountHint: subaccountRef ?? null,
        reason: "oversized_body",
        organizationId,
      }),
      durationMs: Date.now() - startedAt,
    });
    return json(413, { error: "body_too_large", evidence_parked: stored });
  };

  // ── 8. Resolução do TENANT — do PATH, e ANTES de ler o corpo ─────────────
  //
  // A ordem importa: o tenant sai do PATH, então dá para conhecê-lo sem tocar no
  // corpo. Resolver antes é o que permite cobrar o teto POR ORG (passo 9) antes de
  // materializar até 2 MB de corpo por requisição.
  if (!subaccountRef || !UUID_RE.test(subaccountRef)) {
    // ⚠️ NÃO existe fallback aqui, e a tentação a resistir tem nome: "é a única org
    // com a flag ligada". Hoje é verdade (só Milennials), amanhã não é, e o
    // fallback teria virado entrega cross-tenant sem nenhum sintoma.
    const body = await loadBody();
    if (body.kind === "oversized") return await oversizedResponse(body, null);
    const stored = await park({
      reason: "missing_subaccount_segment",
      payload: parkableBody(body),
    });
    return await parkResponse(stored, "missing_subaccount_segment");
  }

  const subaccountRow = await admin
    .from("notificame_subaccounts")
    .select("id, organization_id")
    .eq("id", subaccountRef)
    .maybeSingle();

  const organizationId = (subaccountRow.data as { organization_id?: string } | null)
    ?.organization_id ?? null;

  if (subaccountRow.error || !organizationId) {
    const body = await loadBody();
    if (body.kind === "oversized") return await oversizedResponse(body, null);
    const stored = await park({
      reason: "unknown_subaccount",
      payload: parkableBody(body),
      error: subaccountRow.error?.message ?? null,
    });
    return await parkResponse(stored, "unknown_subaccount");
  }

  // ── 9. Teto POR TENANT — o AUTORITATIVO, e o único que é justo ───────────
  //
  // ⚠️ A CHAVE É A ORG, NÃO O IP. Todos os eventos de todas as orgs chegam dos
  // mesmos poucos IPs do fornecedor: chavear por IP faria o teto de UMA org valer
  // para TODAS — um cliente movimentado calaria o inbox dos outros 29, e o sintoma
  // seria "o Instagram parou", sem nada apontando para a org que consumiu a cota.
  //
  // A org vem do uuid do path, que NÓS geramos e registramos, e só depois de
  // existir em `notificame_subaccounts`. Isso também limita a cardinalidade da
  // chave ao nº de orgs — `check_rate_limit` cria uma linha por (chave, janela), e
  // chavear por um uuid não-validado deixaria uma varredura inflar `rate_limits`.
  //
  // 429 aqui não perde nada: para o fornecedor é "volte depois", e o evento
  // continua na fila DELE.
  const tenantRateKey = `${FUNCTION_NAME}:org:${organizationId}`;
  const persistentRl = await checkRateLimitPersistent(
    admin,
    tenantRateKey,
    TENANT_RATE_LIMIT_MAX,
    Math.floor(RATE_LIMIT_WINDOW_MS / 1000),
  );
  if (!persistentRl.allowed) {
    await logRuntime({
      organizationId,
      module: "webhook",
      action: "notificame_rate_limit_tenant",
      status: "error",
      errorMessage:
        `org acima de ${TENANT_RATE_LIMIT_MAX} eventos/min — 429 devolvido ao fornecedor ` +
        `(o evento permanece na fila de reentrega dele). Só ESTA org é afetada`,
      payloadSnapshot: buildPayloadSnapshot({
        sourceIp,
        subaccountHint: subaccountRef,
        organizationId,
      }),
    });
    return json(429, { error: "rate_limited" });
  }

  // ── 10. O CORPO ──────────────────────────────────────────────────────────
  const body = await loadBody();
  if (body.kind === "oversized") return await oversizedResponse(body, organizationId);
  if (body.kind === "invalid_json") {
    const stored = await park({
      reason: "invalid_json",
      payload: body.parkPayload,
      // A org JÁ é conhecida aqui (veio do path): guardá-la na linha da fila é o
      // que permite ao operador filtrar `invalid_json` por cliente.
      organizationId,
    });
    return await parkResponse(stored, "invalid_json");
  }
  const payload = body.value;

  const eventType = readEventType(payload);

  // ── 10.5. STATUS DE ENVIO ────────────────────────────────────────────────
  //
  // ⚠️ ANTES da resolução de canal, e é o ponto inteiro deste bloco. O evento de
  // status não traz canal social: em produção (2026-08-19) os seis
  // `MESSAGE_STATUS` da Chique foram parkados como `unresolved_channel`, porque a
  // resolução procura em `messaging_channels` e a caixa oficial mora em
  // `whatsapp_instances`. O resultado é que a recusa da Meta
  //
  //   131053 — "Audio file uploaded with mimetype as audio/mp4, however on
  //   processing it is of type application/octet-stream"
  //
  // chegou 2s depois do envio e foi descartada. A tela seguiu dizendo "enviado", e
  // achar a causa exigiu ler a tabela de eventos à mão.
  //
  // O eixo aqui não é o canal — é a MENSAGEM: `external_id` já identifica a linha,
  // e `organization_id` (que veio da subconta, autenticada) fecha o tenant.
  if (eventType === "message_status") {
    const st = readMessageStatus(payload);
    if (!st) {
      const stored = await park({
        reason: "unreadable_status",
        payload,
        organizationId,
        eventType,
      });
      return await parkResponse(stored, "unreadable_status");
    }

    // ─── ACHAR A LINHA ────────────────────────────────────────────────────
    //
    // DUAS chaves, e a ordem importa. O `messageId` do evento NÃO é estável por
    // mensagem: medido em prod (19/08), o `SENT` veio com o id que está em
    // `external_id` e o `ERROR` da MESMA mensagem, 0,4s depois, veio com outro.
    // O que os liga é o `providerMessageId` — idêntico nos dois.
    //
    // Por isso o primeiro evento que casar GRAVA esse id na linha, e os
    // seguintes o usam como chave. Sem isso a recusa da Meta cai em
    // `status_no_match` e o defeito volta a ser invisível — foi o que aconteceu
    // com a primeira versão deste bloco.
    // ⚠️ `external_id` NÃO é usado para achar a linha (ele é o filtro da 1ª
    // chave), mas SIM para sair dela: é por esse valor que a linha do
    // destinatário do Disparo é encontrada (#1724 — o worker o grava em
    // `blast_plan_recipients.provider_message_id`, `blast-official-runner.ts:288`).
    // Tirá-lo daqui não quebra nada visível: a entrega simplesmente nunca fecha,
    // em silêncio — e por ser silêncio, nenhum teste de COMPORTAMENTO o pega: o
    // dublê de PostgREST descarta a lista de campos e devolve a linha inteira.
    // Quem reprova é a guarda ESTÁTICA em
    // `tests/unit/notificame-webhook-status-blast.test.ts`, que lê este texto.
    const colunas = "id, status, raw_payload, provider_message_id, external_id";
    const porExternalId = await admin
      .from("channel_messages")
      .select(colunas)
      .eq("organization_id", organizationId)
      .eq("external_id", st.messageId)
      .limit(1);

    type Linha = {
      id: string;
      status: string | null;
      raw_payload: unknown;
      provider_message_id: string | null;
      external_id: string | null;
    };
    let linha = (porExternalId.data as Linha[] | null)?.[0] ?? null;

    if (!linha && st.providerMessageId) {
      const porProvider = await admin
        .from("channel_messages")
        .select(colunas)
        .eq("organization_id", organizationId)
        .eq("provider_message_id", st.providerMessageId)
        .limit(1);
      linha = (porProvider.data as Linha[] | null)?.[0] ?? null;
    }

    if (!linha) {
      const stored = await park({
        reason: "status_no_match",
        payload,
        organizationId,
        eventType,
        error: `nem external_id=${st.messageId} nem provider=${st.providerMessageId ?? "null"} nesta org`,
      });
      return await parkResponse(stored, "status_no_match");
    }

    // ─── O QUE ESCREVER ───────────────────────────────────────────────────
    //
    // O `status_event` é SEMPRE atualizado, inclusive quando o status não
    // progride: é ele que carrega o `provider_message_id`, e é essa gravação que
    // permite ao evento SEGUINTE (a recusa) achar esta linha. Tratar "mesmo
    // status" como ruído e sair sem escrever foi o defeito da primeira versão.
    //
    // O STATUS, esse sim, só avança. Callbacks chegam fora de ordem e um
    // DELIVERED atrasado não pode apagar um READ. `failed` fica FORA da escala de
    // propósito: recusa vale sempre, inclusive depois de "entregue" — foi
    // exatamente a sequência que a Meta produziu (SENT e, 2s depois, ERROR).
    const progride = st.status === "failed" ||
      (OUTBOUND_STATUS_RANK[st.status] ?? 99) >
        (OUTBOUND_STATUS_RANK[linha.status ?? "pending"] ?? 0);

    const anterior = (typeof linha.raw_payload === "object" && linha.raw_payload
      ? linha.raw_payload as Record<string, unknown>
      : {});

    const eventoAnterior = (typeof anterior.status_event === "object" && anterior.status_event
      ? anterior.status_event as Record<string, unknown>
      : {});

    const upd = await admin
      .from("channel_messages")
      .update({
        // `raw_payload` é MESCLADO: a coluna guarda a requisição e a resposta do
        // envio, e o PostgREST substitui o jsonb inteiro. Escrever só o
        // `status_event` apagaria a evidência que motivou esta fatia.
        ...(progride ? { status: st.status } : {}),
        // A chave de correlação, gravada pelo PRIMEIRO callback que casar. Um
        // evento sem ela não pode apagar o que o anterior guardou.
        ...(st.providerMessageId ? { provider_message_id: st.providerMessageId } : {}),
        raw_payload: {
          ...anterior,
          status_event: {
            ...eventoAnterior,
            code: st.status,
            provider_code: st.providerCode,
            detail: st.detail,
            // Só grava se veio; um evento sem ele não pode apagar o que o
            // anterior guardou — é a chave de correlação.
            at: new Date().toISOString(),
          },
        },
      })
      .eq("id", linha.id)
      .select("id");

    if (upd.error) {
      const stored = await park({
        reason: "status_no_match",
        payload,
        organizationId,
        eventType,
        error: upd.error.message,
      });
      return await parkResponse(stored, "status_no_match");
    }

    // ─── O CICLO DE ENTREGA DO DISPARO (#1724) ────────────────────────────
    //
    // A Meta cobra NA ENTREGA (ADR-0029). Daqui em diante o callback fecha
    // também a linha do destinatário do Disparo, quando esta mensagem for de um.
    //
    // O casamento sai de `external_id`, não do id estável: são espaços de
    // identificador DIFERENTES (747/747 medidos em prod, zero coincidências), e
    // é a linha resolvida acima que faz a ponte entre os dois.
    //
    // `"sem_linha"` é o desfecho COMUM — quase todo callback de status é de
    // conversa normal. Nunca lança: o fornecedor precisa do 200 de qualquer
    // jeito, e uma entrega perdida é infinitamente mais barata que uma
    // assinatura de webhook suspensa por erro repetido.
    //
    // O cast é necessário e não é preguiça: `fecharLinhaDoDisparo` DESCREVE o
    // cliente (dois encadeamentos, nada mais) em vez de aceitar `any`, e o
    // `admin` real satisfaz essa forma — mas provar isso faz o compilador
    // instanciar os genéricos do postgrest-js até estourar (`TS2589 Type
    // instantiation is excessively deep`). A alternativa seria tipar o parâmetro
    // como `any`, que jogaria fora o estreitamento dentro do módulo inteiro para
    // poupar uma linha aqui.
    const blast = linha.external_id
      ? await fecharLinhaDoDisparo(admin as unknown as ClienteDoFechamento, {
        externalId: linha.external_id,
        organizationId,
        status: st.status,
        agora: () => new Date(),
      })
      : "sem_linha";

    return json(200, {
      status: "updated",
      message_status: st.status,
      advanced: progride,
      blast,
    });
  }

  // ── 11. Resolução do CANAL ───────────────────────────────────────────────
  const channelHint = pickChannelId(payload);

  interface ResolvedChannel {
    id: string;
    organizationId: string;
    channelType: string;
    handle: string | null;
    /**
     * De qual TABELA a linha veio, e é o que decide o endereçamento da mensagem:
     * canal social é `messaging_channels` → `messaging_channel_id`; WhatsApp
     * oficial é `whatsapp_instances` → `instance_id`.
     */
    kind: "instagram" | "whatsapp";
  }

  const readChannelRow = (raw: Record<string, unknown>): ResolvedChannel => ({
    id: String(raw.id),
    organizationId: String(raw.organization_id),
    channelType: String(raw.channel_type),
    handle: (raw.handle as string | null) ?? null,
    kind: "instagram",
  });

  /**
   * O canal de WhatsApp oficial, procurado por `provider_config->>'channel_id'`.
   *
   * Busca GLOBAL pelo mesmo motivo da irmã em `messaging_channels`: encontrar a
   * linha e COMPARAR a org com a do path é o que transforma uma forja em
   * `channel_org_mismatch` VISÍVEL. Filtrar por org aqui devolveria "não achei" e
   * a forja viraria indistinguível de um canal desconhecido.
   *
   * `channel_type` sai de `provider_config`, onde o `channel-finish` gravou o que
   * o FORNECEDOR declarou — tipicamente `whatsapp_business_account`. O gate 11b
   * normaliza antes de comparar; comparar cru recusaria o canal oficial, que foi
   * exatamente o defeito do PR #1640.
   */
  const findWhatsAppInstanceByChannelId = async (
    channelIdHint: string,
  ): Promise<ResolvedChannel | null> => {
    const res = await admin
      .from("whatsapp_instances")
      .select("id, organization_id, provider_config")
      .eq("provider", "notificame")
      .eq("provider_config->>channel_id", channelIdHint)
      .maybeSingle();

    if (res.error || !res.data) return null;

    const row = res.data as Record<string, unknown>;
    const cfg = (row.provider_config ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      channelType: typeof cfg.channel_type === "string" ? cfg.channel_type : "whatsapp",
      handle: null,
      kind: "whatsapp",
    };
  };

  let channel: ResolvedChannel | null = null;

  if (channelHint) {
    // Busca GLOBAL, sem filtro de org — e é de propósito. O UNIQUE global
    // `uq_messaging_channels_external` garante um dono só por canal, então
    // encontrar a linha e COMPARAR a org dela com a do path é o que transforma uma
    // tentativa de forja em `channel_org_mismatch` visível. Filtrar por org aqui
    // devolveria "não achei" e a forja viraria indistinguível de um canal
    // desconhecido.
    const res = await admin
      .from("messaging_channels")
      .select("id, organization_id, channel_type, handle")
      .eq("provider", "notificame")
      .eq("external_channel_id", channelHint)
      .maybeSingle();

    // Não é canal social? Pode ser WhatsApp oficial, que mora em outra tabela.
    // A ordem é social→whatsapp e não o contrário porque o volume é social; o
    // desfecho não depende dela (um `channel_id` tem um dono só, garantido pelo
    // UNIQUE global e pelo índice único parcial).
    const comoWhatsApp = (res.error || !res.data)
      ? await findWhatsAppInstanceByChannelId(channelHint)
      : null;

    if (comoWhatsApp) {
      channel = comoWhatsApp;
    } else if (res.error || !res.data) {
      // O remetente NOMEOU um canal que não conhecemos. Cair no canal único da org
      // aqui seria adivinhar por cima de uma declaração explícita — e é justamente
      // o caso em que o picker pode estar lendo o campo errado. Parka e ensina.
      const stored = await park({
        reason: "unresolved_channel",
        payload,
        organizationId,
        eventType,
        error: res.error?.message ?? null,
      });
      return await parkResponse(stored, "unresolved_channel");
    } else {
      // ⚠️ ESTE `else` É LOAD-BEARING. Sem ele, o caminho do WhatsApp — que já
      // resolveu `channel` acima — cai aqui com `res.data` NULO e
      // `readChannelRow(null)` estoura em `String(raw.id)`, devolvendo 500 e
      // perdendo o evento. Foi exatamente o que aconteceu na primeira reinjeção
      // do payload real (2026-08-18): a peça 2 encontrava a instância e a linha
      // seguinte a sobrescrevia com lixo.
      channel = readChannelRow(res.data as Record<string, unknown>);
    }

    if (channel.organizationId !== organizationId) {
      // FORJA, ou bug grave de registro de subscription. ZERO escrita em
      // `channel_messages` — o corpo inteiro vai para a fila e um humano decide.
      await logRuntime({
        organizationId,
        module: "webhook",
        action: "notificame_channel_org_mismatch",
        status: "error",
        errorMessage: "canal do payload pertence a outra organização — evento parkado",
        payloadSnapshot: buildPayloadSnapshot({
          sourceIp,
          subaccountHint: subaccountRef,
          channelHint,
          eventType,
          reason: "channel_org_mismatch",
          organizationId,
          messagingChannelId: channel.id,
        }),
      });
      const stored = await park({
        reason: "channel_org_mismatch",
        payload,
        organizationId,
        messagingChannelId: channel.id,
        eventType,
      });
      return await parkResponse(stored, "channel_org_mismatch");
    }
  } else {
    // Corpo sem id de canal. NÃO é adivinhação: a org já foi resolvida por um uuid
    // NOSSO, o tipo é fixo, e o desempate falha FECHADO quando há mais de um. Numa
    // org com exatamente um canal de Instagram conectado — o caso da Milennials
    // hoje — isto funciona sem o campo. Mesma forma do `pickNewChannel` da 1.1.
    const res = await admin
      .from("messaging_channels")
      .select("id, organization_id, channel_type, handle")
      .eq("organization_id", organizationId)
      .eq("provider", "notificame")
      .eq("channel_type", "instagram")
      .eq("status", "connected")
      // Buscamos MAIS que o necessário de propósito: quando há empate, os
      // candidatos vão para a linha da fila e para o log, e é essa lista que
      // transforma "parou tudo" em uma correção mecânica.
      .limit(CHANNEL_CANDIDATE_LIMIT);

    const rows = (res.data ?? []) as Array<Record<string, unknown>>;
    if (res.error || rows.length === 0) {
      const stored = await park({
        reason: "unresolved_channel",
        payload,
        organizationId,
        eventType,
        error: res.error?.message ?? null,
      });
      return await parkResponse(stored, "unresolved_channel");
    }

    const candidates = rows.map(readChannelRow);

    if (candidates.length === 1) {
      channel = candidates[0];
    } else {
      // ── DESEMPATE PELO HANDLE DA CONTA QUE RECEBEU ─────────────────────────
      //
      // ⚠️ ISTO NÃO É ADIVINHAÇÃO, e a diferença é o que separa esta ponte de um
      // fallback perigoso: comparamos o @ da conta DESTINATÁRIA declarado no corpo
      // com o `handle` que NÓS já gravamos naquela linha (backfill do passo (d)).
      // Casou exatamente um ⇒ é aquele. Não casou, ou casou mais de um ⇒ continua
      // fechado. Nenhum caminho aqui escolhe "o primeiro" nem "o mais recente".
      //
      // POR QUE VALE A PENA: sem isto, a SEGUNDA conta de Instagram conectada numa
      // org desliga AS DUAS — todo evento sem `channelId` vira `ambiguous_channel`,
      // e o cliente que acabou de conectar uma conta a mais perde o inbox da que
      // já funcionava. O desempate devolve o caso comum (o corpo diz para quem
      // veio) sem afrouxar o fail-closed do caso duvidoso.
      const declaredAccount = normalizeHandleForMatch(pickAccountHandle(payload));
      const matches = declaredAccount
        ? candidates.filter((c) => normalizeHandleForMatch(c.handle) === declaredAccount)
        : [];

      if (matches.length === 1) {
        channel = matches[0];
        await logRuntime({
          organizationId,
          module: "webhook",
          action: "notificame_channel_disambiguated",
          status: "success",
          entityType: "messaging_channel",
          entityId: channel.id,
          payloadSnapshot: buildPayloadSnapshot({
            sourceIp,
            subaccountHint: subaccountRef,
            eventType,
            organizationId,
            messagingChannelId: channel.id,
          }),
        });
      } else {
        // FALHA FECHADA, mas NUNCA silenciosa. Escolher um dos dois seria entregar
        // a mensagem de um cliente na caixa de entrada de outra conta da mesma org.
        //
        // ⚠️ O que muda em relação a só parkar: o `reason` sozinho não diz QUAIS
        // canais empataram nem o que fazer. A lista de candidatos vai para
        // `last_error` (fila) e para o log em nível de ERRO com a frase que nomeia
        // a consequência — "TODAS as contas desta org param". Com ela, a correção é
        // mecânica: preencher `messaging_channels.handle` das contas (ou ajustar os
        // aliases de `pickChannelId`) e reprocessar a fila, que tem o corpo inteiro.
        const candidateList = candidates
          .map((c) => `${c.id}${c.handle ? ` (@${c.handle})` : " (handle NULL)"}`)
          .join(", ");
        const declaredNote = declaredAccount
          ? `corpo declarou a conta '@${declaredAccount}', que não casou com nenhum handle gravado`
          : "corpo não nomeou canal (pickChannelId) nem conta (pickAccountHandle)";

        await logRuntime({
          organizationId,
          module: "webhook",
          action: "notificame_channel_ambiguous",
          status: "error",
          errorMessage:
            `${candidates.length} canais de Instagram conectados nesta org e nada no corpo ` +
            `escolhe um — TODAS as contas dela param até alguém agir. ${declaredNote}. ` +
            `Candidatos: ${candidateList}. Saída: gravar o handle de cada canal ` +
            `(messaging_channels.handle) ou ensinar o alias certo a pickChannelId, e ` +
            `reprocessar ${PARK_TABLE} (o corpo inteiro está lá)`,
          payloadSnapshot: buildPayloadSnapshot({
            sourceIp,
            subaccountHint: subaccountRef,
            channelHint,
            eventType,
            reason: "ambiguous_channel",
            organizationId,
          }),
          durationMs: Date.now() - startedAt,
        });

        const stored = await park({
          reason: "ambiguous_channel",
          payload,
          organizationId,
          eventType,
          error: `${declaredNote}; candidatos: ${candidateList}`,
        });
        return await parkResponse(stored, "ambiguous_channel");
      }
    }
  }

  // ── 11b. O TIPO que decide o destino é o NOSSO ───────────────────────────
  // `payload.channel` é declarado pelo REMETENTE e não escolhe nada; ele só é
  // CONFERIDO. Divergiu do `channel_type` da nossa linha ⇒ parka.
  const declaredWord = pickChannelWord(payload);
  const declaredType = normalizeSeamlessType(declaredWord);

  // ⚠️ NORMALIZADO dos dois lados. O `channel_type` do WhatsApp oficial vem do
  // fornecedor como `whatsapp_business_account`; comparar cru recusaria o canal
  // que acabamos de vincular — o defeito do PR #1640, terceira ocorrência do
  // mesmo padrão nesta fatia.
  const nossoType = normalizeSeamlessType(channel.channelType) ?? channel.channelType;

  if (nossoType !== channel.kind || (declaredType && declaredType !== nossoType)) {
    const stored = await park({
      reason: "channel_type_mismatch",
      payload,
      organizationId,
      messagingChannelId: channel.id,
      eventType,
      error: `nosso=${channel.channelType} (${nossoType}) declarado=${declaredType ?? "null"}`,
    });
    return await parkResponse(stored, "channel_type_mismatch");
  }

  // ── 12. Despacho por tipo de evento ──────────────────────────────────────
  if (eventType !== "message") {
    // ⚠️ `MESSAGE_STATUS` e desconhecido PARKAM — não são descartados. Esta fatia é
    // inbound-only: não há linha de saída para atualizar, e um `eventType` que a
    // doc não listou pode ser a própria mensagem sob outro nome. Descartar
    // produziria silêncio, indistinguível de "ninguém mandou nada".
    const stored = await park({
      reason: "unhandled_event",
      payload,
      organizationId,
      messagingChannelId: channel.id,
      eventType,
    });
    return await parkResponse(stored, "unhandled_event");
  }

  /**
   * O caminho feliz. Devolve o desfecho como DADO para o chamador responder — não
   * monta Response, para o deadline valer sobre o trabalho e não sobre a resposta.
   */
  const handleMessageEvent = async (): Promise<
    | { kind: "stored"; id: string }
    | { kind: "duplicate" }
    | { kind: "park"; reason: ParkReason; error?: string | null }
  > => {
    // (a) IDENTIDADE DA MENSAGEM. Sem id do fornecedor a linha NÃO nasce — a
    // UNIQUE de idempotência ficaria sem chave. Ver o cabeçalho.
    const externalId = pickExternalId(payload);
    if (!externalId) return { kind: "park", reason: "missing_external_id" };

    // (b) DIREÇÃO.
    //
    // ⚠️ ISTO JÁ PARKOU AS RESPOSTAS DO VENDEDOR. Até 2026-08-20, tudo que não
    // fosse `incoming` era guardado sob o rótulo `unreadable_direction` — que
    // MENTIA: `readDirection` lê `"OUT"` perfeitamente. Foram 193 eventos em 51
    // conversas, entre 17 e 19/08, e o efeito na tela era o cliente aparecendo a
    // falar sozinho: o vendedor respondia pelo aplicativo do fornecedor e o
    // Torque descartava.
    //
    // Agora a saída ENTRA, como linha `outgoing`. Só a direção de fato ilegível
    // parka, e aí o rótulo passa a dizer a verdade.
    const direcao = readDirection(payload);
    if (direcao === null) {
      return { kind: "park", reason: "unreadable_direction" };
    }
    const ehSaida = direcao === "outgoing";

    // (c) INTERLOCUTOR. Sem ele não há conversa para agrupar, e uma linha sem
    // `contact_external_id` seria invisível na lista (a RPC agrupa por essa
    // coluna) — pior que parkada, porque pareceria entregue.
    //
    // ⚠️ `missing_contact_id`, NÃO `missing_external_id`. As duas faltas parkam,
    // mas apontam para pickers diferentes: esta manda ajustar os aliases de
    // `pickContact`; a de (a), os de `pickExternalId`. Um rótulo só faria o
    // operador — que vai AGRUPAR por `reason` ao abrir a fila — editar o alias
    // errado e continuar sem entender por que nada entra.
    // ⚠️ NA SAÍDA O INTERLOCUTOR TROCA DE LADO: `message.to` é o cliente,
    // `message.from` é o id do CANAL e `visitor` descreve QUEM MANDOU — o
    // vendedor. Reusar `pickContact` aqui criaria uma conversa endereçada à
    // própria caixa e batizada com o nome de quem respondeu.
    const contact = ehSaida
      ? (pickInterlocutorDeSaida(payload) ?? { externalId: "", name: null, avatarUrl: null, handle: null })
      : pickContact(payload);
    if (!contact.externalId) {
      return { kind: "park", reason: "missing_contact_id" };
    }

    // (c2) VÍNCULO COM O LEAD — **RESOLVE, JAMAIS CRIA**.
    //
    // A fonte da verdade é `lead_social_identities`, escrita SÓ por RPC SECURITY
    // DEFINER no clique de um humano autenticado no chat. Aqui é um SELECT: se a
    // identidade já foi vinculada, a mensagem nova nasce com `lead_id` preenchido
    // e entra direto na ficha do lead; se não, entra como hoje, com nulo.
    //
    // ⚠️ NÃO EXISTE CAMINHO DE CRIAÇÃO NESTE ENDPOINT, E NÃO PODE PASSAR A
    // EXISTIR. O fornecedor confirmou por escrito que NÃO ASSINA o corpo — quem
    // descobrir o secret do path e o uuid da subconta consegue POSTAR mensagem
    // forjada nesta org. Um `getOrCreateLead` aqui viraria um botão de inflar a
    // base de leads de qualquer cliente, uma requisição por lead. O molde é o do
    // WhatsApp: `whatsapp-webhook` não cria lead nenhum; quem cria é o front, no
    // clique de uma pessoa.
    //
    // BEST-EFFORT, e o formato do best-effort importa: a tabela pode ainda não
    // existir (função deployada antes do apply da 20270817090000), e nesse caso o
    // silêncio é CORRETO — a mensagem entra sem vínculo, como antes da fatia.
    // Qualquer OUTRO erro (RLS, timeout, coluna renomeada) vira `console.warn`,
    // porque tolerância larga aqui viraria "verde por ausência": o inbox ficaria
    // sem vínculo por semanas e ninguém saberia por quê.
    let linkedLeadId: string | null = null;
    try {
      const { data: identity, error: identityError } = await admin
        .from("lead_social_identities")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .eq("channel_type", channel!.channelType)
        .eq("external_user_id", contact.externalId)
        .maybeSingle();

      if (identityError) {
        if (!isMissingTableError(identityError, "lead_social_identities")) {
          console.warn(
            `[${FUNCTION_NAME}] resolve de lead_social_identities falhou:`,
            identityError.message,
          );
        }
      } else {
        linkedLeadId = (identity as { lead_id: string } | null)?.lead_id ?? null;
      }
    } catch (err) {
      console.warn(
        `[${FUNCTION_NAME}] resolve de lead_social_identities falhou:`,
        (err as Error)?.message,
      );
    }

    // ── Avatar: espelhado ANTES de gravar, e best-effort ──────────────────
    //
    // A URL que a Meta manda é ASSINADA E TEMPORÁRIA (~104h, medido no primeiro
    // payload real). Guardar a URL não é guardar a foto: sem esta cópia, todo
    // avatar do inbox vira ícone quebrado em quatro dias, e o banco continua
    // parecendo correto — a coluna preenchida, apontando para o nada.
    //
    // `null` aqui NÃO é erro: significa "siga com a URL da Meta", que ao menos
    // funciona pelos próximos dias. Avatar é decoração; a mensagem é o produto,
    // e um webhook que falha por causa de uma imagem perde a mensagem.
    const avatarEspelhado = await mirrorContactAvatar({
      supabase: admin,
      organizationId,
      channelType: "instagram",
      externalUserId: contact.externalId,
      sourceUrl: contact.avatarUrl,
    });

    // ── Conteúdo: normalizado, e com o arquivo trazido para casa ──────────
    //
    // `normalizarConteudo` CHAMA `pickContent` e acrescenta — o texto continua
    // saindo da mesma função de sempre. O que entra novo é `metadata`, a forma
    // NOSSA do corpo, e a URL da mídia, que o parser antigo nunca achava porque
    // procurava `url` e o fornecedor manda `fileUrl`.
    const conteudo = normalizarConteudo(payload);

    // Espelhar é best-effort e NUNCA decide se a mensagem existe: falha devolve
    // a URL original, que ao menos funciona pelos próximos dias. Um webhook que
    // falha por causa de um arquivo perde a mensagem, e a mensagem é o produto.
    let midiaFinal = conteudo.mediaUrl;
    let metadataFinal = conteudo.metadata;
    if (conteudo.metadata.midia) {
      const espelho = await espelharMidiaRecebida(conteudo.metadata.midia.url, {
        organizationId,
        especie: conteudo.metadata.midia.especie,
        mimeDeclarado: conteudo.metadata.midia.mime,
        storage: admin.storage,
        // ⚠️ O CDN DO WHATSAPP OFICIAL NÃO É ABERTO — 401 no acesso direto,
        // medido em 2026-08-20 no primeiro áudio real da Chique. O do Instagram
        // entrega 206 sem token, e por isso este caminho SÓ é acionado depois de
        // o direto ser recusado: gastar a chamada autenticada onde o arquivo é
        // público seria desperdício por mensagem.
        //
        // Best-effort como todo o resto do espelhamento: qualquer falha aqui
        // devolve `null` e a linha fica com a URL original.
        baixarPeloFornecedor: async (url, mime) => {
          try {
            const sub = await loadNotificameSubaccount(admin, organizationId);
            if (!sub?.companyUuid) return null;

            const canalDoFornecedor = typeof (payload as { subscriptionId?: unknown })
                ?.subscriptionId === "string"
              ? (payload as { subscriptionId: string }).subscriptionId
              : null;
            if (!canalDoFornecedor) return null;

            // `orgConfigFrom` é a MESMA fábrica que o provider usa — a base e o
            // token saem daqui, não de uma leitura de env reimplementada.
            const cfg = orgConfigFrom(
              (Deno.env.get("NOTIFICAME_BASE_URL") ?? "").trim() || NOTIFICAME_DEFAULT_BASE_URL,
              sub.companyUuid,
            );

            return await baixarMidiaPeloFornecedor(url, mime, {
              baseUrl: cfg.baseUrl,
              subaccountToken: cfg.subaccountToken,
              channelId: canalDoFornecedor,
            });
          } catch {
            return null;
          }
        },
      });
      midiaFinal = espelho.url;
      metadataFinal = {
        ...conteudo.metadata,
        midia: {
          ...conteudo.metadata.midia,
          url: espelho.url,
          // O content-type da RESPOSTA é a verdade — o declarado pelo
          // fornecedor foi `"text/html"` em todo arquivo real medido.
          mime: espelho.mime ?? conteudo.metadata.midia.mime,
          espelhada: espelho.espelhada,
        },
      };
    }

    const row = buildInboundChannelMessageRow({
      organizationId,
      target: channel!.kind === "whatsapp"
        ? { kind: "whatsapp", instanceId: channel!.id }
        : { kind: "instagram", messagingChannelId: channel!.id },
      externalId,
      contact: avatarEspelhado ? { ...contact, avatarUrl: avatarEspelhado } : contact,
      contactExternalId: contact.externalId,
      content: { ...conteudo, mediaUrl: midiaFinal },
      metadata: metadataFinal,
      // O id ESTÁVEL. É ele que uma reação aponta e que uma resposta citada
      // carrega — sem isto gravado, reagir a uma mensagem do cliente é apontar
      // para o nada.
      providerMessageId: pickProviderMessageId(payload),
      direction: ehSaida ? "outgoing" : "incoming",
      leadId: linkedLeadId,
      // O relógio mora AQUI, e não no módulo puro: é o que permite asserir por
      // grep que nenhum caminho de identidade toca `Date.now()`.
      timestampIso: pickTimestampIso(payload) ?? new Date().toISOString(),
      rawPayload: payload,
    });

    // ⚠️ GUARDA CONTRA ECO. As mensagens que saem DAQUI já são gravadas pelo
    // provider, no mesmo instante do envio. Se o fornecedor devolver um evento
    // de saída para elas, o `external_id` será outro — a UNIQUE não protege — e
    // a mesma mensagem apareceria duas vezes na conversa.
    //
    // O `provider_message_id` é a segunda chave, e é estável nos dois lados.
    // Medido em 2026-08-20: dos 193 eventos de saída existentes, ZERO casavam
    // com linha já gravada — ou seja, o fornecedor não ecoa o que mandamos hoje.
    // A guarda existe para o dia em que passar a ecoar, que é justamente o dia
    // em que ninguém estaria olhando.
    if (ehSaida && row.provider_message_id) {
      const { data: jaExiste } = await admin
        .from("channel_messages")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("provider_message_id", row.provider_message_id)
        .limit(1);

      if ((jaExiste as Array<{ id: string }> | null)?.length) {
        return { kind: "duplicate" };
      }
    }

    const { data, error } = await admin
      .from("channel_messages")
      .upsert(row, {
        onConflict: "external_id,channel,organization_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) return { kind: "park", reason: "insert_failed", error: error.message };

    const inserted = (data as Array<{ id: string }> | null)?.[0]?.id;
    // ZERO linhas = a UNIQUE absorveu. É REENTREGA, e reentrega é o caminho FELIZ.
    if (!inserted) return { kind: "duplicate" };

    // ── (c-bis) A PERNA DE VOLTA ──────────────────────────────────────────
    //
    // O segundo nó mais executado do produto é o "esperar resposta": 11.653
    // execuções em 7 dias. Ele destrava porque o webhook do chip chama esta RPC
    // quando chega mensagem do cliente. Enquanto isto não existiu, uma execução
    // que esperasse resposta no canal oficial esperava PARA SEMPRE — automação
    // de mão única, que envia e fica surda.
    //
    // ⚠️ BEST-EFFORT, como todo o resto das reações: uma falha aqui não pode
    // custar a mensagem. O contrato desta função é devolver 200 e guardar o
    // corpo; recusar faz o fornecedor desistir e o dado morre sem uma linha em
    // lugar nenhum.
    //
    // A REGRA de o que disparar mora em `notificame-reacoes.ts`, puro: é lá que
    // se decide que saída não conta como resposta, e que o identificador do
    // Instagram nunca vira telefone.
    const reacoes = reacoesDoEvento({
      direcao: ehSaida ? "outgoing" : "incoming",
      canal: channel!.kind === "whatsapp" ? "whatsapp" : "instagram",
      telefone: row.phone_number,
      leadId: row.lead_id,
    });

    // O GATILHO "lead respondeu" exige o id do lead, e a linha do canal oficial
    // nasce sem ele. Resolvemos por telefone — RESOLVE-ONLY, nunca criar: um
    // lead nascido de cada mensagem recebida encheria a base com quem só
    // perguntou preço, e no eixo social o identificador da plataforma entraria
    // como se fosse telefone (a normalização o devolve intacto).
    if (reacoes.dispararLeadRespondeu) {
      try {
        const lead = reacoes.resolverEsperaPorLead
          ? { id: reacoes.resolverEsperaPorLead }
          : await findLeadByPhoneOrEmail(
            admin,
            organizationId,
            reacoes.resolverEsperaPorTelefone,
          );

        if (lead?.id) {
          await fireTrigger({
            supabase: admin,
            organizationId,
            triggerType: "lead_replied",
            leadId: lead.id,
            source: "webhook",
            // Sem isto o filtro de canal do gatilho passava sempre: o matcher
            // só compara quando o contexto traz o campo.
            context: reacoes.contextoDoGatilho ?? undefined,
          });
        }
      } catch (err) {
        console.warn(
          `[${FUNCTION_NAME}] fireTrigger(lead_replied) falhou:`,
          (err as Error)?.message,
        );
      }
    }

    if (reacoes.resolverEsperaPorTelefone) {
      try {
        await admin.rpc("resolve_wait_response_by_phone", {
          p_phone: reacoes.resolverEsperaPorTelefone,
          p_organization_id: organizationId,
          p_channel: "whatsapp",
        });
      } catch (err) {
        console.warn(
          `[${FUNCTION_NAME}] resolve_wait_response_by_phone falhou:`,
          (err as Error)?.message,
        );
      }
    }

    // ── A MESMA PERNA, PELA OUTRA CHAVE — issue #1692 ─────────────────────
    //
    // No Instagram não existe telefone: o interlocutor é um identificador da
    // plataforma. Quem destrava aqui é a variante da RPC que recebe o LEAD
    // direto, e ela só tem o que receber quando um humano já vinculou a
    // conversa pelo botão do chat.
    //
    // ⚠️ SEM VÍNCULO, NADA ACONTECE — e isso NÃO é erro. Medido: 562 mensagens
    // de Instagram recebidas em produção, ZERO com lead vinculado. Enquanto
    // ninguém vincular, este caminho fica ocioso, que é o estado esperado; um
    // `console.warn` aqui encheria o log de ruído sobre uma conversa que só
    // ainda não tem dono. Quem decide isso é `notificame-reacoes.ts`, que
    // devolve `resolverEsperaPorLead: null` nesse caso.
    //
    // ⚠️ E o identificador do Instagram NUNCA chega como telefone: a regra pura
    // o descarta, porque `normalize_brazilian_phone` devolve 16 dígitos
    // INTACTOS e ele casaria com `leads.normalized_phone`.
    //
    // BEST-EFFORT como a irmã de cima: falhar ao acionar não pode custar a
    // gravação da mensagem nem o 200 que o fornecedor espera.
    if (reacoes.resolverEsperaPorLead) {
      try {
        await admin.rpc("resolve_wait_response", {
          p_lead_id: reacoes.resolverEsperaPorLead,
          p_organization_id: organizationId,
          p_channel: "instagram",
        });
      } catch (err) {
        console.warn(
          `[${FUNCTION_NAME}] resolve_wait_response falhou:`,
          (err as Error)?.message,
        );
      }
    }

    // (d) BACKFILL do handle da NOSSA conta. BEST-EFFORT: `buildMessagingChannelRow`
    // deixou a coluna NULL porque `GET /v1/channels` não devolve o @usuário, e o
    // evento de entrada é a primeira chance de saber. `handle IS NULL` no predicado
    // para não sobrescrever nada, e try/catch porque um rótulo NUNCA pode derrubar
    // uma mensagem já gravada.
    const accountHandle = pickAccountHandle(payload);
    if (accountHandle && !channel!.handle) {
      try {
        await admin
          .from("messaging_channels")
          .update({ handle: accountHandle })
          .eq("id", channel!.id)
          .is("handle", null);
      } catch (err) {
        console.warn(`[${FUNCTION_NAME}] backfill de handle falhou:`, (err as Error)?.message);
      }
    }

    return { kind: "stored", id: inserted };
  };

  let outcome: Awaited<ReturnType<typeof handleMessageEvent>>;
  try {
    outcome = await withTimeout(handleMessageEvent(), PROCESS_TIMEOUT_MS);
  } catch (err) {
    // Deadline ou falha inesperada. 5xx e o fornecedor reentrega — a UNIQUE
    // absorve a reentrega se a escrita tiver acontecido.
    await logRuntime({
      organizationId,
      module: "webhook",
      action: "notificame_process_error",
      status: "error",
      errorMessage: (err as Error)?.message ?? "unknown",
      payloadSnapshot: buildPayloadSnapshot({
        sourceIp,
        subaccountHint: subaccountRef,
        channelHint,
        eventType,
        organizationId,
        messagingChannelId: channel.id,
      }),
      durationMs: Date.now() - startedAt,
    });
    return json(500, { error: "processing_failed" });
  }

  if (outcome.kind === "park") {
    const stored = await park({
      reason: outcome.reason,
      payload,
      organizationId,
      messagingChannelId: channel.id,
      externalId: pickExternalId(payload),
      eventType,
      error: outcome.error ?? null,
    });
    return await parkResponse(stored, outcome.reason);
  }

  if (outcome.kind === "duplicate") {
    await logRuntime({
      organizationId,
      module: "webhook",
      action: "notificame_duplicate_ignored",
      status: "success",
      entityType: "channel_message",
      payloadSnapshot: buildPayloadSnapshot({
        sourceIp,
        subaccountHint: subaccountRef,
        channelHint,
        eventType,
        organizationId,
        messagingChannelId: channel.id,
      }),
      durationMs: Date.now() - startedAt,
    });
    return json(200, { status: "duplicate" });
  }

  await logRuntime({
    organizationId,
    module: "webhook",
    action: "notificame_process",
    status: "success",
    entityType: "channel_message",
    entityId: outcome.id,
    payloadSnapshot: buildPayloadSnapshot({
      sourceIp,
      subaccountHint: subaccountRef,
      channelHint,
      eventType,
      organizationId,
      messagingChannelId: channel.id,
    }),
    durationMs: Date.now() - startedAt,
  });

  return json(200, { status: "stored" });
}));
