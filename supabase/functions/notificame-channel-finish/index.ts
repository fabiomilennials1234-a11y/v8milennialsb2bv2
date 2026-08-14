/**
 * notificame-channel-finish — descobre QUAL canal acabou de nascer na SUBCONTA da
 * org e o VINCULA à org do contexto de auth.
 *
 * POR QUE "DESCOBRIR": o `postMessage` do popup Seamless só diz
 * `{status:"channel-success"}` — sem id, sem telefone. A identidade do canal é
 * DEDUZIDA por diferença:
 *
 *     candidatos = (listados na subconta \ já reivindicados) \ baseline da sessão
 *
 * A listagem usa o token DA SUBCONTA, então ela já chega ESCOPADA àquela org: a
 * captura cross-tenant não é filtrada aqui, ela é INALCANÇÁVEL por construção.
 * Era esse o bloqueante do desenho anterior, que listava a conta-mãe inteira e
 * pegava "o único canal sem dono" — de qualquer org.
 *
 * A BASELINE (foto tirada no clique, em `notificame-channel-start` com
 * `open_session:true`) resolve o que a subconta sozinha NÃO resolve: um popup
 * abandonado deixa um canal livre DENTRO da própria subconta, e sem a foto toda
 * conexão seguinte daquela org bateria em `ambiguous_channel` para sempre, sem
 * saída pela UI.
 *
 *   Zero candidatos → 409 `no_channel_found`, RETENTÁVEL (`/v1/channels` é
 *   eventualmente consistente). Dois ou mais → 409 `ambiguous_channel` e PARA:
 *   adivinhar em vínculo de tenant é entregar as mensagens de uma empresa a
 *   outra. COM sessão, 2+ significa concorrência real e a resposta é retentável.
 *   O índice único parcial `uq_whatsapp_instances_notificame_channel` torna o
 *   double-binding impossível mesmo sob corrida.
 *
 * ─── A SESSÃO SÓ FECHA DEPOIS DO VÍNCULO ────────────────────────────────────
 *
 * O canal criado no NotificaMe é FATURÁVEL e IRREMOVÍVEL. Um canal que nasce e
 * nunca é vinculado não é um erro de tela: é um órfão permanente dentro da
 * subconta, consumindo cota, inalcançável por qualquer UI. Toda a ordem desta
 * função existe para tornar esse desfecho inalcançável:
 *
 *   1. LÊ a sessão (não fecha) — barato, e uma sessão inválida morre aqui, antes
 *      de qualquer chamada ao fornecedor;
 *   2. lista os canais da subconta;
 *   3. lê os canais já vinculados NESTA org;
 *   4. decide;
 *   5. INSERE a linha;
 *   6. só então FECHA a sessão.
 *
 * Qualquer desfecho retentável (canal ainda não listado, ambiguidade sob
 * concorrência, INSERT que falhou) deixa a sessão 'open' — a mesma
 * `session_id` volta na retentativa seguinte e encontra a MESMA foto. O teto
 * dessa janela mora em `_shared/notificame-sessions.ts` (prazo, não contador).
 *
 * IDEMPOTÊNCIA: reenviar o finish de um canal que já foi vinculado responde 200
 * com a MESMA linha, nunca uma segunda linha e nunca um erro. Dois caminhos
 * chegam lá — a sessão já fechada (`state: "finished"`, e a foto que sobrevive
 * nela identifica o canal daquela sessão) e a corrida perdida no índice único,
 * quando o vínculo vencedor é DESTA org.
 *
 * SEGURANÇA:
 *   • A org vem de `requireAuth({ requireOrganization: true })` — o body PROPÕE,
 *     o SELECT em `team_members` CONFIRMA. Sem `requireOrganization`, um usuário
 *     multi-org cairia no fallback legado por `created_at` e vincularia o canal
 *     na org errada em silêncio.
 *   • Gate de flag E permissão (`whatsapp.manage_instances`, a MESMA chave da UI)
 *     repetidos server-side: `verify_jwt = false` deixa a função publicamente
 *     alcançável, e gate só no frontend não é gate.
 *   • O `session_id` do body NÃO é bearer. Ele é correlação: a autorização inteira
 *     mora no predicado de leitura e de escrita da sessão (org do auth + usuário
 *     do auth). Sessão inválida é 403 e NÃO cai em silêncio para o caminho sem
 *     baseline — uma sessão forjada ou vencida não pode ALARGAR a regra.
 *   • O `NOTIFICAME_API_TOKEN` é da CONTA-MÃE (a revenda inteira) e não é usado
 *     aqui: esta função fala com a subconta. O token da subconta nunca chega ao
 *     browser por esta rota, nunca a uma coluna, nunca a uma mensagem de erro.
 *     Erros do fornecedor viram 502 com CÓDIGO estável e mensagem NOSSA — o
 *     `withErrorBoundary` devolve `error.message` CRU no corpo do 500, então
 *     interpolar corpo de terceiro aqui viraria vazamento lá.
 *   • ⚠️ ISSO VALE PARA A RESPOSTA, NÃO PARA O LOG. O `code` e a `message` de erro
 *     do fornecedor entram em `runtime_logs` — por `vendorLogFields()`, em campos
 *     ESCALARES com nome nosso (`vendor_code`, `vendor_message`), nunca como corpo
 *     serializado sob chave genérica (a redação de `logRuntime` é por NOME DE
 *     CHAVE e uma string opaca a atravessa inteira). Suprimi-los do servidor não
 *     protegia nada e já custou uma hora de diagnóstico numa falha de
 *     provisionamento.
 *
 * ─── DUAS TABELAS DE DESTINO (fatia 1.1) ────────────────────────────────────
 *
 * O TIPO DO CANAL escolhe onde a linha nasce:
 *
 *   `whatsapp`  → `whatsapp_instances` (caminho da fatia 1, INTOCADO);
 *   `instagram` → `messaging_channels` (canais sociais não-WhatsApp).
 *
 * E o tipo vem de UMA fonte só: o `type` que o FORNECEDOR declara PARA ESTE canal
 * em `/v1/channels`. O tipo PEDIDO (gravado na sessão no clique) NÃO escolhe
 * tabela — ele CONFERE o que o fornecedor declarou, e estreita o diff. Fornecedor
 * não declarou ⇒ a função PARA (`channel_type_undetermined`, 409 RETENTÁVEL) sem
 * gravar nada.
 *
 * Ver o passo 6, onde a regra está justificada. Duas versões anteriores erraram
 * aqui, cada uma um pouco menos: primeiro `else → 'whatsapp'` (ausência de tipo
 * virava WhatsApp em silêncio), depois `pedido ?? observado` (o pedido, que é
 * INTENÇÃO e não observação, ainda escolhia a tabela quando o fornecedor calava).
 * As duas eram o caminho pelo qual um canal entrava na tabela errada sem que nada
 * no desenho reclamasse.
 *
 * A fronteira é o TIPO DE CANAL, não o vendor. Gravar Instagram em
 * `whatsapp_instances` custaria: o rótulo `WhatsApp Oficial …` chumbado, 13
 * superfícies de front + ~8 caminhos de edge que leem instância sem filtro de
 * provider, e uma vaga PAGA de `max_whatsapp_instances` comida por um canal que
 * não é número. Fora dela, o isolamento é POR CONSTRUÇÃO.
 *
 * O `requested_channel_type` também estreita o DIFF: o `postMessage` do Seamless é
 * idêntico para os dois tipos, então sem ele um canal de WhatsApp nascido em
 * paralelo na mesma subconta poderia ser vinculado como Instagram.
 *
 * ⚠️ `loadClaimedChannels` lê as DUAS tabelas. Esquecer a metade social faria um
 * canal de Instagram já vinculado voltar a ser candidato e travaria a org em
 * `ambiguous_channel` — o mesmo defeito que a baseline existe para consertar.
 *
 * FORA DE ESCOPO (fatia 2): nenhum branch em `_shared/whatsapp-client.ts`. Sem
 * ele, qualquer caminho de ENVIO que alcance esta linha morre alto com
 * "Unknown provider" — fail-closed, correto até a fatia 2. Instagram não tem
 * caminho de envio nenhum nesta fatia: `POST /v2/channels/instagram/messages` é
 * fatia 2-IG.
 *
 * ─── RECEBIMENTO: A SUBSCRIPTION É REGISTRADA AQUI (fatia 2-IG) ─────────────
 *
 * Depois do INSERT, e SÓ para Instagram, esta função registra em
 * `POST /v1/subscriptions` a URL de entrada
 * `…/notificame-webhook/<SECRET>/<subaccount_row_id>` — ver o passo 6d. É o único
 * ponto que tem, no mesmo request, o token da subconta já decifrado, a org
 * validada e a linha recém-criada.
 *
 * ⚠️ FALHA DE REGISTRO NÃO DESFAZ O VÍNCULO. O canal já é faturável e irremovível
 * no fornecedor; desvincular por causa disso fabricaria a órfã que a fatia 1.1
 * existe para evitar. O canal fica vinculado com
 * `messaging_channels.inbound_subscription_status = 'failed'` e a resposta carrega
 * `subscription_pending: true`.
 *
 * ⚠️ E O ESTADO TEM UM LEITOR — antes não tinha, e essa era a falha mais cara do
 * desenho: o canal conectava, a tela dizia SUCESSO, e o recebimento nunca era
 * registrado. `subscription_pending` era o único vestígio, e `grep
 * subscription_pending src/` devolvia VAZIO. Um sinal sem leitor é o mesmo que
 * nenhum sinal, e o sintoma ("o Instagram não recebe") é indistinguível de
 * "ninguém mandou mensagem".
 *
 * O leitor é `notificame-subscription-repair` (cron de 5 min, migration
 * 20270816120000): ele varre `inbound_subscription_status IN ('pending','failed')`
 * e retenta com backoff exponencial até conseguir. A recuperação não depende de
 * ninguém PERCEBER — e alcança inclusive os dois caminhos idempotentes desta
 * função (sessão já fechada, corrida perdida no índice único), que respondem 200
 * SEM reavaliar a subscription e por isso nenhum botão de "tentar de novo"
 * consertaria.
 *
 * Sempre devolve JSON. No sucesso:
 *   `{ channel_kind:'whatsapp', instance_id, channel_id, phone_number, status }` ou
 *   `{ channel_kind:'instagram', messaging_channel_id, channel_id, phone_number:null,
 *      status, subscription_pending? }`.
 * `instance_id` sai SÓ no caminho WhatsApp — o cliente em prod lê essa chave.
 * No erro: `{ error, code }` com código de máquina.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { canUserAccessFeature } from "../_shared/permission_engine.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getTraceContext } from "../_shared/request-trace.ts";
import {
  readNotificameParentConfig,
  isNotificameEnabledForOrg,
  listChannels,
  orgConfigFrom,
  pickNewChannel,
  buildNotificameInstanceRow,
  buildMessagingChannelRow,
  normalizeSeamlessType,
  readClaimedChannelId,
  buildInboundWebhookUrl,
  redactWebhookUrl,
  registerInboundSubscription,
  vendorLogFields,
  NotificameError,
  type SeamlessChannelType,
} from "../_shared/notificame.ts";
import { loadNotificameSubaccount } from "../_shared/notificame-credentials.ts";
import {
  readConnectSession,
  finalizeConnectSession,
  type ConnectSessionState,
} from "../_shared/notificame-sessions.ts";
import { isMissingColumnError, isMissingTableError } from "../_shared/notificame-schema-guard.ts";

const FUNCTION_NAME = "notificame-channel-finish";

/**
 * A tabela da fatia 1.1. Nomeada uma vez porque o nome aparece na query E na
 * guarda que reconhece a ausência dela.
 *
 * ⚠️ ELA NÃO EXISTE EM PROD NO MOMENTO EM QUE ISTO É ESCRITO — a fatia 1 está no
 * ar, a migration `20270814093000_notificame_instagram_channel` não foi aplicada.
 *
 * A LEITURA degrada sozinha nesse estado (ver `loadClaimedChannels`), porque ela
 * está no caminho de TODA conexão — inclusive as de WhatsApp, que funcionam hoje.
 *
 * A ESCRITA não ganha guarda, e a razão é que não existe guarda que a ajude: se o
 * canal é de Instagram, `messaging_channels` é o único destino, e a ausência da
 * tabela não tem contorno — gravar em `whatsapp_instances` é exatamente o defeito
 * que a separação existe para impedir. Falhar alto é o desfecho certo. Ela
 * também é praticamente inalcançável nesse estado: um canal de Instagram só nasce
 * pelo start, que o recusa sem a flag `notificame_instagram` — ligada pela MESMA
 * migration.
 *
 * Ordem correta: MIGRATION PRIMEIRO, FUNÇÕES DEPOIS.
 */
const SOCIAL_TABLE = "messaging_channels";

/** A mesma feature key que `useCanManageWhatsApp` aplica na UI. Igualar, não endurecer. */
const MANAGE_INSTANCES_FEATURE = "whatsapp.manage_instances";

/** Teto defensivo do nome de instância desambiguado. */
const INSTANCE_NAME_MAX = 120;

/** Últimos 4 dígitos — o que basta para reconhecer o número numa trilha sem o PII inteiro. */
function last4(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length <= 4 ? phone : phone.slice(-4);
}

// ─── Vínculos já existentes nesta org ────────────────────────────────────────

/**
 * Um canal do NotificaMe já reivindicado por esta org — venha ele de
 * `whatsapp_instances` ou de `messaging_channels`.
 *
 * `kind` NÃO é decoração: é ele que escolhe se a resposta devolve `instance_id`
 * (o cliente em prod depende dessa chave) ou `messaging_channel_id`, e qual
 * queryKey o cliente invalida.
 */
interface ClaimedChannel {
  /** PK da linha na tabela de origem. */
  id: string;
  kind: "whatsapp" | "instagram";
  channelId: string;
  phoneNumber: string | null;
  status: string | null;
}

/**
 * Canais NotificaMe já reivindicados por ESTA org, indexados pelo id do canal NO
 * FORNECEDOR — a UNIÃO das duas tabelas.
 *
 * ⚠️ AS DUAS METADES SÃO OBRIGATÓRIAS. Sem `messaging_channels`, um canal de
 * Instagram já vinculado voltaria a ser CANDIDATO no diff, e a conexão seguinte da
 * org — de qualquer tipo — bateria em `ambiguous_channel` sem saída pela UI. É o
 * mesmo modo de falha que a baseline existe para consertar, reintroduzido pela
 * porta dos fundos.
 *
 * ÚNICA exceção, e ela não abre buraco nenhum: a tabela AINDA NÃO EXISTIR (funções
 * novas sobre schema velho). Tabela ausente ⇒ nenhuma linha pode existir nela ⇒ não
 * há metade social a perder. Ver o bloco no corpo.
 *
 * COM `.eq('organization_id')` nas duas: sob subconta, a lista de canais já é da
 * org, e perguntar por canais de outros tenants seria leitura cross-tenant com
 * service_role sem nenhum ganho. Os índices únicos GLOBAIS
 * (`uq_whatsapp_instances_notificame_channel`, `uq_messaging_channels_external`)
 * seguem sendo a última linha de defesa contra atribuição errada.
 *
 * Devolve o mapa, e não só os ids, porque as duas rotas idempotentes (sessão já
 * fechada e corrida perdida no índice único) precisam DEVOLVER a linha existente,
 * não apenas saber que ela existe.
 */
async function loadClaimedChannels(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ ok: true; byChannel: Map<string, ClaimedChannel> } | { ok: false; message: string }> {
  const byChannel = new Map<string, ClaimedChannel>();

  const instances = await admin
    .from("whatsapp_instances")
    .select("id, phone_number, status, provider_config")
    .eq("organization_id", organizationId)
    .eq("provider", "notificame");

  if (instances.error) return { ok: false, message: instances.error.message };

  for (const raw of (instances.data ?? []) as Array<Record<string, unknown>>) {
    const channelId = readClaimedChannelId(raw.provider_config);
    if (!channelId) continue;
    byChannel.set(channelId, {
      id: String(raw.id),
      kind: "whatsapp",
      channelId,
      phoneNumber: (raw.phone_number as string | null) ?? null,
      status: (raw.status as string | null) ?? null,
    });
  }

  const social = await admin
    .from(SOCIAL_TABLE)
    .select("id, external_channel_id, status")
    .eq("organization_id", organizationId)
    .eq("provider", "notificame");

  // ⚠️ SCHEMA VELHO (migration …093000 ainda não aplicada, o estado de PROD hoje).
  // A tabela não existe ⇒ o PostgREST devolve ERRO, e o `return {ok:false}` de
  // baixo viraria 500 `claimed_lookup_failed` para TODA conexão de WhatsApp —
  // derrubando um fluxo que hoje funciona, por deploy fora de ordem.
  //
  // Tratar como "nenhum canal social reivindicado" não é chute nem tolerância: se
  // a tabela não existe, NENHUMA linha pode existir nela, e o conjunto vazio é a
  // VERDADE do banco — não uma aproximação dela. Não há vínculo a esquecer.
  //
  // Qualquer OUTRO erro segue derrubando, e é por isso que a guarda exige o NOME da
  // tabela: encolher o conjunto de reivindicados por engano é justamente o que faz
  // um canal JÁ VINCULADO voltar a ser candidato do diff.
  if (social.error && !isMissingTableError(social.error, SOCIAL_TABLE)) {
    return { ok: false, message: social.error.message };
  }
  if (social.error) {
    console.warn(
      `[notificame] tabela ${SOCIAL_TABLE} ausente — nenhum canal social reivindicado. ` +
        "Apliquem a migration 20270814093000_notificame_instagram_channel: " +
        "MIGRATION PRIMEIRO, FUNÇÕES DEPOIS.",
    );
  }

  for (const raw of (social.data ?? []) as Array<Record<string, unknown>>) {
    const channelId = typeof raw.external_channel_id === "string"
      ? raw.external_channel_id.trim()
      : "";
    if (!channelId) continue;
    byChannel.set(channelId, {
      id: String(raw.id),
      kind: "instagram",
      channelId,
      // Canal social não tem telefone, e não é ausência de dado: é ausência de
      // conceito. Nunca preencher com o que quer que o fornecedor devolva.
      phoneNumber: null,
      status: (raw.status as string | null) ?? null,
    });
  }

  return { ok: true, byChannel };
}

// ─── Discriminação de violação de unicidade ──────────────────────────────────

/**
 * QUAL unicidade estourou. São defeitos DIFERENTES e mandam o operador para
 * lugares diferentes:
 *
 *   `channel`       — `uq_whatsapp_instances_notificame_channel`: este canal do
 *                     fornecedor já tem dono. Se o dono é esta org, é sucesso
 *                     idempotente; se é outra, é o dano que o índice existe para
 *                     impedir.
 *   `instance_name` — `whatsapp_instances_organization_id_instance_name_key`:
 *                     NOME de instância repetido dentro da org. Não diz nada
 *                     sobre canal nem sobre tenant — tratá-lo como
 *                     "channel_already_bound" (o que este arquivo fazia) manda
 *                     investigar vínculo cruzado quando o problema é um rótulo.
 *   `unknown`       — 23505 de alguma outra unicidade. Reportar como genérico é
 *                     mais honesto do que chutar qual das duas foi.
 *
 * Casa pelo NOME da constraint em `message`/`details`/`hint` — não pelo SQLSTATE
 * sozinho, que só diz "alguma unicidade" — e cai no formato da chave
 * (`Key (organization_id, instance_name)=…`) como segunda leitura, para o caso de
 * o nome não atravessar o PostgREST.
 *
 * ⚠️ As duas tabelas têm nomes de constraint DIFERENTES para o MESMO invariante, e
 * cada par precisa do seu regex. Reaproveitar os de `whatsapp_instances` para
 * `messaging_channels` classificaria toda violação social como `unknown` — o
 * caminho que NÃO tenta desambiguar o nome, e que por isso deixaria um canal de
 * Instagram faturável e irremovível vinculado a ninguém por causa de um rótulo
 * repetido.
 */
type UniqueViolation = "channel" | "instance_name" | "unknown";

interface PgErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

function classifyUniqueViolation(err: PgErrorLike | null | undefined): UniqueViolation | null {
  if (!err) return null;
  const text = `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`;

  if (
    /uq_whatsapp_instances_notificame_channel/i.test(text) ||
    /provider_config\s*->>\s*'channel_id'/i.test(text) ||
    /uq_messaging_channels_external/i.test(text) ||
    /\(\s*provider\s*,\s*external_channel_id\s*\)/i.test(text)
  ) {
    return "channel";
  }

  if (
    /whatsapp_instances_organization_id_instance_name_key/i.test(text) ||
    /\(\s*organization_id\s*,\s*instance_name\s*\)/i.test(text) ||
    /uq_messaging_channels_org_name/i.test(text) ||
    /\(\s*organization_id\s*,\s*display_name\s*\)/i.test(text)
  ) {
    return "instance_name";
  }

  return err.code === "23505" ? "unknown" : null;
}

/**
 * Nome alternativo para quando o rótulo derivado do canal já existe na org.
 *
 * Existe porque o desfecho alternativo é o caro: recusar o vínculo por causa de
 * um NOME repetido deixaria vivo, no fornecedor, um canal faturável e irremovível
 * que nenhuma tela alcança. O sufixo é o prefixo do id do canal — estável entre
 * retentativas do mesmo canal, e único entre canais.
 */
function disambiguateInstanceName(base: string, channelId: string): string {
  const suffix = channelId.slice(0, 8);
  const room = INSTANCE_NAME_MAX - suffix.length - 3;
  const head = base.length > room ? base.slice(0, Math.max(room, 1)).trimEnd() : base;
  return `${head} (${suffix})`;
}

/**
 * Traduz um tipo de canal para a TABELA onde ele mora. `null` = não há tabela
 * para esse tipo, e o chamador PARA.
 *
 * ⚠️ O `else` desta função é `null`, NUNCA `'whatsapp'`. `SeamlessChannelType`
 * inclui `facebook`, que não tem destino nesta fatia; e um tipo novo do
 * fornecedor amanhã também não terá. Um mapeamento que caísse em 'whatsapp' por
 * omissão gravaria Messenger — ou o que vier depois — como número de WhatsApp: o
 * rótulo `WhatsApp Oficial …` chumbado, 13 telas que só sabem falar de número, e
 * uma vaga PAGA de `max_whatsapp_instances` comida por um canal que não é número.
 *
 * É EXAUSTIVA de propósito (lista os dois casos em vez de negar um): assim um
 * `SeamlessChannelType` novo entra aqui como `null` — fail-closed — em vez de ser
 * absorvido pelo ramo do WhatsApp em silêncio.
 */
function tableKindForChannelType(
  type: SeamlessChannelType | null,
): "whatsapp" | "instagram" | null {
  if (type === "whatsapp") return "whatsapp";
  if (type === "instagram") return "instagram";
  return null;
}

Deno.serve(withErrorBoundary(FUNCTION_NAME, async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed", code: "method_not_allowed" }),
      { status: 405, headers },
    );
  }

  /**
   * 200 com a linha vinculada. `idempotent` marca as rotas de replay.
   *
   * `instance_id` continua saindo NO CAMINHO WHATSAPP e só nele: o cliente já em
   * produção lê exatamente essa chave. O caminho de Instagram devolve
   * `messaging_channel_id` — chave diferente porque é OUTRA tabela, e reaproveitar
   * o nome faria o cliente invalidar a queryKey errada e procurar um canal social
   * na lista de números.
   */
  const boundResponse = (params: {
    rowId: string;
    kind: "whatsapp" | "instagram";
    channelId: string;
    phoneNumber: string | null;
    status: string | null;
    idempotent?: boolean;
    /**
     * O canal está VINCULADO, mas o registro da subscription de entrada falhou —
     * a UI diz "conectado, recebimento pendente" e oferece o reparo. Sai só quando
     * é verdade: ausente = nada a dizer.
     */
    subscriptionPending?: boolean;
  }) =>
    new Response(
      JSON.stringify({
        channel_kind: params.kind,
        ...(params.kind === "whatsapp"
          ? { instance_id: params.rowId }
          : { messaging_channel_id: params.rowId }),
        channel_id: params.channelId,
        phone_number: params.phoneNumber,
        status: params.status,
        ...(params.idempotent ? { idempotent: true } : {}),
        ...(params.subscriptionPending ? { subscription_pending: true } : {}),
      }),
      { status: 200, headers },
    );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body", code: "invalid_body" }), {
      status: 400,
      headers,
    });
  }

  // ── Auth: a org vem da membresia VALIDADA, nunca do body ───────────────────
  let auth;
  try {
    auth = await requireAuth(req, { body, requireOrganization: true });
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  const orgId = auth.organizationId;
  if (!orgId) {
    return new Response(
      JSON.stringify({ error: "organization_id_required", code: "organization_id_required" }),
      { status: 400, headers },
    );
  }

  const admin = createAdminClient(FUNCTION_NAME);

  // ── Gate de feature, server-side ───────────────────────────────────────────
  // SÓ a flag `notificame`. A flag `notificame_instagram` é gate de ENTRADA e é
  // exigida no start, não aqui: neste ponto o canal JÁ NASCEU no fornecedor, é
  // faturável e irremovível, e recusar o vínculo porque alguém desligou a flag
  // durante o popup deixaria um órfão permanente que nenhuma tela alcança. O gate
  // certo é o que impede a criação, não o que impede o registro do que já existe.
  if (!(await isNotificameEnabledForOrg(admin, orgId))) {
    return new Response(
      JSON.stringify({
        error: "Recurso não habilitado para esta organização",
        code: "feature_disabled",
      }),
      { status: 403, headers },
    );
  }

  const trace = getTraceContext(req);

  // ── Permissão server-side — a MESMA chave do frontend ──────────────────────
  if (!(await canUserAccessFeature(admin, auth.userId, orgId, MANAGE_INSTANCES_FEATURE))) {
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.permission_denied",
      status: "error",
      errorMessage: "usuário sem whatsapp.manage_instances tentou concluir conexão",
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error: "Você não tem permissão para conectar números nesta organização",
        code: "permission_denied",
      }),
      { status: 403, headers },
    );
  }

  // ── Não configurado → 503. Aqui é AÇÃO (não sonda): segue o precedente ─────
  const parent = readNotificameParentConfig(Deno.env);
  if (!parent) {
    return new Response(
      JSON.stringify({ error: "NotificaMe ainda não configurado", code: "not_configured" }),
      { status: 503, headers },
    );
  }

  // ── A subconta da org. Sem ela não há com que token listar nada ────────────
  // Esta função NÃO provisiona: provisionar é ato do start, e criar subconta aqui
  // significaria criá-la DEPOIS de o usuário ter completado o popup — ordem
  // impossível. Ausente = o fluxo começou errado; reabrir resolve.
  const subaccount = await loadNotificameSubaccount(admin, orgId);
  if (!subaccount) {
    return new Response(
      JSON.stringify({
        error: "Sua conta oficial ainda não está pronta. Comece a conexão novamente.",
        code: "subaccount_missing",
      }),
      { status: 409, headers },
    );
  }

  // ── 1. Sessão: LÊ a foto do clique. NÃO consome ────────────────────────────
  // Antes da chamada ao fornecedor de propósito: uma sessão inválida não deve
  // custar uma listagem no NotificaMe.
  //
  // Sessão AUSENTE é caminho degradado legítimo (cliente antigo, ou o start de
  // sessão falhou) — a lista já vem escopada pela subconta. Sessão PRESENTE e
  // inválida é 403: forjada, vencida, de outra org, de outro usuário. Cair em
  // silêncio para o caminho sem baseline aqui deixaria uma sessão inválida
  // ALARGAR a regra que decide qual canal é vinculado.
  //
  // A CONSUMAÇÃO acontece lá embaixo, depois do INSERT. Consumir aqui era o
  // defeito: a primeira tentativa queimava a sessão, `/v1/channels` ainda não
  // mostrava o canal recém-nascido (é por isso que o hook retenta), e a
  // retentativa morria em `session_invalid` — deixando um canal faturável e
  // irremovível vinculado a ninguém.
  const rawSessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  let session: ConnectSessionState | null = null;
  if (rawSessionId) {
    session = await readConnectSession(admin, {
      sessionId: rawSessionId,
      organizationId: orgId,
      userId: auth.userId,
    });
    if (session.state === "invalid") {
      return new Response(
        JSON.stringify({
          error: "A sessão de conexão expirou. Comece a conexão novamente.",
          code: "session_invalid",
          retryable: false,
        }),
        { status: 403, headers },
      );
    }
  }
  const baseline: Set<string> | null = session ? new Set(session.baselineChannelIds) : null;

  // O TIPO pedido no clique. `null` = sessão AUSENTE ⇒ o diff não filtra por tipo.
  //
  // ⚠️ `null` aqui NÃO significa mais "então é WhatsApp". Significa apenas "a
  // sessão não sabe" — e quem decide a tabela de destino é o passo 6, que sem
  // sessão pergunta ao fornecedor e PARA quando nem ele responde.
  const requestedChannelType: SeamlessChannelType | null = session
    ? session.requestedChannelType
    : null;

  // ── 2. Lista os canais DA SUBCONTA (decide pelo CORPO, nunca por res.ok) ───
  const orgCfg = orgConfigFrom(parent.baseUrl, subaccount.companyUuid);
  let channels;
  try {
    channels = await listChannels(orgCfg, fetch);
  } catch (e) {
    if (e instanceof NotificameError) {
      // ⚠️ ESTE 502 SAÍA SEM TRILHA NENHUMA. O usuário via "não foi possível
      // concluir", o canal já existia no fornecedor (faturável e irremovível), e o
      // servidor não guardava uma linha sequer sobre o motivo. Agora guarda — com
      // o código E a mensagem DELES, que é o que separa "token da subconta
      // recusado" de "a rota /v1/channels mudou".
      //
      // Campos escalares com nome nosso, por spread. Nunca o corpo serializado sob
      // chave genérica: `redactSecrets` redige por NOME DE CHAVE e uma string
      // opaca atravessa inteira.
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.channel_list_failed",
        status: "error",
        errorMessage: e.vendor?.code
          ? `NotificaMe recusou a listagem de canais (${e.code}; NotificaMe: ${e.vendor.code})`
          : `NotificaMe recusou a listagem de canais (${e.code})`,
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { code: e.code, ...vendorLogFields(e.vendor) },
        ...trace,
      });
      // Código estável + mensagem NOSSA. O corpo do fornecedor não atravessa.
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: 502,
        headers,
      });
    }
    throw e;
  }

  // ── 3. Canais já reivindicados por ESTA org (as DUAS tabelas) ──────────────
  const bound = await loadClaimedChannels(admin, orgId);
  if (!bound.ok) {
    return new Response(
      JSON.stringify({ error: bound.message, code: "claimed_lookup_failed" }),
      { status: 500, headers },
    );
  }
  const claimedIds = new Set(bound.byChannel.keys());

  // ── 4. Replay de uma sessão JÁ FECHADA → resposta idempotente ──────────────
  // Chega aqui o finish reenviado depois de um vínculo bem-sucedido cuja resposta
  // se perdeu. A foto SOBREVIVE ao fechamento da sessão, e é ela que identifica o
  // canal daquela sessão: o que nasceu depois da foto e hoje pertence a esta org.
  // Sem isto, o replay veria o canal já reivindicado, acharia zero candidatos e
  // devolveria `no_channel_found` — um erro por cima de um sucesso.
  //
  // O recorte é por TIPO também, e não só pela foto. Sem ele, uma org que
  // conectou WhatsApp e Instagram dentro da MESMA janela tem dois canais
  // pós-baseline reivindicados, e o replay: (a) com um só match do outro tipo,
  // devolveria a linha ERRADA — o `instance_id` de um número como desfecho de uma
  // conexão de Instagram, e o cliente invalidaria a queryKey errada e anunciaria
  // "Instagram conectado!" apontando para um telefone; (b) com dois, contaria 2 e
  // devolveria `session_invalid` por cima de um vínculo que deu certo.
  //
  // O filtro usa `claimed.kind` — EM QUAL TABELA a linha nasceu, fato NOSSO — e
  // não o `type` que o fornecedor devolve na listagem, que é a rota indocumentada
  // e pode mudar de vocabulário sem aviso.
  if (session?.state === "finished") {
    const expectedKind = tableKindForChannelType(session.requestedChannelType);
    const fromThisSession = channels.filter((c) => {
      if (baseline!.has(c.id)) return false;
      const claimed = bound.byChannel.get(c.id);
      // `expectedKind === null` (tipo sem tabela na sessão) não casa com nada e
      // cai no ramo de baixo: reabrir é a saída, e nada é devolvido no escuro.
      return !!claimed && claimed.kind === expectedKind;
    });

    if (fromThisSession.length === 1) {
      const claimed = bound.byChannel.get(fromThisSession[0].id)!;
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.channel_bound",
        status: "success",
        entityType: "whatsapp_instance",
        entityId: claimed.id,
        triggeredBy: auth.userId,
        payloadSnapshot: {
          channel_id: claimed.channelId,
          channel_kind: claimed.kind,
          phone_last4: last4(claimed.phoneNumber),
          had_baseline: true,
          // Distingue o vínculo NOVO do replay. Sem isto, a trilha contaria duas
          // conexões onde houve uma.
          idempotent: true,
        },
        ...trace,
      });
      return boundResponse({
        rowId: claimed.id,
        kind: claimed.kind,
        channelId: claimed.channelId,
        phoneNumber: claimed.phoneNumber,
        status: claimed.status,
        idempotent: true,
      });
    }

    // 0 = a instância daquela sessão foi apagada depois; 2+ = não dá para dizer
    // qual das duas foi ESTA sessão. Nos dois casos a sessão está encerrada e não
    // pode vincular de novo — reabrir a conexão é a saída, e `session_invalid` é
    // o código que o cliente já traduz para exatamente essa instrução.
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.session_replay_unresolved",
      status: "error",
      errorMessage:
        `sessão já fechada e ${fromThisSession.length} canais dela reivindicados nesta org`,
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      // O tipo entra na trilha porque agora ele FAZ PARTE do recorte: sem ele,
      // "0 matches" não distingue "a linha foi apagada" de "a linha existe, mas é
      // do outro tipo" — leituras opostas do mesmo número.
      payloadSnapshot: {
        matches: fromThisSession.length,
        requested_channel_type: session.requestedChannelType,
      },
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error: "A sessão de conexão expirou. Comece a conexão novamente.",
        code: "session_invalid",
        retryable: false,
      }),
      { status: 403, headers },
    );
  }

  // ── 5. O canal novo é o diff — ou para, com a sessão INTACTA ───────────────
  // O quarto argumento estreita por TIPO antes de contar. Sem ele, "um canal de
  // WhatsApp e um de Instagram nasceram depois da foto" morreria em
  // `ambiguous_channel` mesmo sendo perfeitamente decidível.
  const pick = pickNewChannel(channels, baseline, claimedIds, requestedChannelType);
  if (!pick.ok) {
    if (pick.code === "ambiguous_channel") {
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.channel_bind_ambiguous",
        status: "error",
        errorMessage: baseline
          ? `${pick.candidates} canais nascidos depois da foto — vínculo abortado`
          : `${pick.candidates} canais livres na subconta e sem baseline — vínculo abortado`,
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: {
          candidates: pick.candidates,
          had_baseline: !!baseline,
          requested_channel_type: requestedChannelType,
        },
        ...trace,
      });
    }
    // A sessão continua 'open': é o que permite a retentativa reencontrar a MESMA
    // foto. O teto dessa janela é o prazo armado em `readConnectSession`.
    return new Response(
      JSON.stringify({
        error: pick.code === "ambiguous_channel"
          ? "Outra conexão está em andamento nesta organização"
          : "Nenhum canal novo encontrado ainda",
        code: pick.code,
        candidates: pick.candidates,
        // Com baseline, ambíguo = concorrência real (dois canais nascidos DEPOIS
        // da foto), e concorrência real se resolve esperando. Sem baseline é
        // estado parado: retentar só repetiria o mesmo erro.
        retryable: pick.code === "no_channel_found" ||
          (pick.code === "ambiguous_channel" && !!baseline),
      }),
      { status: 409, headers },
    );
  }

  // ── 6. Vincula: insere a linha do canal na org do auth ─────────────────────
  //
  // ONDE a linha nasce sai de UMA fonte só: o `type` que o FORNECEDOR declara
  // PARA ESTE CANAL, em `/v1/channels`. O tipo PEDIDO (o da sessão) NÃO escolhe
  // tabela — ele só CONFERE o que o fornecedor disse. Sem declaração do
  // fornecedor não há escrita: a função para, e para de forma retentável.
  //
  // ─── POR QUE O PEDIDO NÃO PODE ESCOLHER A TABELA ──────────────────────────
  //
  // O pedido é uma INTENÇÃO do clique, não uma observação sobre o canal. Ele diz
  // por qual card o usuário entrou; não diz o que nasceu do outro lado. O
  // `postMessage` do Seamless é IDÊNTICO para os dois tipos e não carrega id, e a
  // janela do fornecedor é dele — nada garante que o usuário terminou o fluxo do
  // card que abriu. Deixar a intenção decidir a tabela é gravar uma suposição
  // como se fosse fato, e o custo do erro é assimétrico e caro nos dois sentidos:
  // um canal de Instagram gravado em `whatsapp_instances` nasce com o rótulo
  // `WhatsApp Oficial …` chumbado, vira candidato a disparo em 13 telas que só
  // sabem falar de número e come uma vaga PAGA de `max_whatsapp_instances`.
  //
  // ESTA É A SEGUNDA VOLTA DO MESMO DEFEITO. A primeira versão fazia
  // `requestedChannelType === 'instagram' ? … : 'whatsapp'` — ausência de tipo
  // virava WhatsApp em silêncio. A segunda estreitou para
  // `tableKindForChannelType(requested) ?? tableKindForChannelType(observed)`, o
  // que fecha o default mas mantém o pedido como PRIMEIRA fonte: com sessão e sem
  // `type` do fornecedor, a tabela ainda saía de um tipo que NINGUÉM confirmou.
  // Estreitar não é fechar. Aqui fecha: sem tipo observado, não grava.
  //
  // ─── E O CANAL FATURÁVEL QUE FICA ÓRFÃO? ──────────────────────────────────
  //
  // Era o argumento para degradar, e ele é real — só que o preço dele estava
  // sendo pago na moeda errada. Recusar deixa um canal criado e não vinculado, que
  // o operador resolve com a trilha abaixo (`channel_id` + `raw_type` no log) e
  // que a PRÓXIMA tentativa reivindica sozinha — o canal continua livre, nada foi
  // escrito, a sessão segue intacta. Degradar deixa uma linha ERRADA no banco de
  // um cliente, num lugar que 13 telas leem e que a cota fatura, e isso ninguém
  // desfaz sem migration de dado. Um canal órfão é trabalho; uma linha errada é
  // dano.
  //
  // E é RETENTÁVEL de verdade: `/v1/channels` é eventualmente consistente (é o
  // motivo de `no_channel_found` existir), então um canal recém-nascido pode
  // aparecer primeiro sem `type` e ganhá-lo segundos depois. O cliente retenta
  // este código junto com `no_channel_found` (`useConnectNotificame`).
  const observedType = normalizeSeamlessType(pick.channel.type);

  if (observedType === null) {
    // PARA, e para em estado LIMPO: nada foi escrito, a sessão (se houver) segue
    // como estava, e o canal continua livre no fornecedor — pronto para ser
    // reivindicado pela tentativa seguinte, que é o que torna isto RETENTÁVEL.
    //
    // Código PRÓPRIO e não `channel_type_mismatch`: divergir de um tipo esperado e
    // não ter tipo nenhum mandam o operador para lugares diferentes — um é
    // "abriram pelo card errado", o outro é "o fornecedor mudou o vocabulário ou
    // não preencheu o campo". O cliente RETENTA este código (`useConnectNotificame`,
    // junto com `no_channel_found`) e, se ele persistir, mostra microcopy própria:
    // "o canal foi criado, fale com o suporte" — porque repetir a conexão criaria um
    // SEGUNDO canal faturável. Reusar `session_invalid` para pegar carona numa frase
    // pronta seria mentir o código de máquina para acertar uma tela.
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.channel_type_undetermined",
      status: "error",
      errorMessage: "fornecedor não declarou o tipo do canal — vínculo abortado",
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: {
        channel_id: pick.channel.id,
        // O valor CRU: é ele que ensina o vocabulário quando o fornecedor mudar.
        // Fica NO LOG e não na resposta — corpo de terceiro não atravessa.
        raw_type: pick.channel.type ?? null,
        // O pedido entra na trilha porque ele é a ÚNICA pista do que o usuário
        // tentou conectar — e é com ela que o operador vincula o canal à mão.
        requested_channel_type: requestedChannelType,
        had_baseline: !!baseline,
      },
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error:
          "Não foi possível identificar o tipo do canal conectado. Tente de novo em instantes; se continuar, fale com o suporte — o canal já foi criado e precisa ser vinculado.",
        code: "channel_type_undetermined",
        retryable: true,
      }),
      { status: 409, headers },
    );
  }

  // O fornecedor NOMEOU o tipo. A partir daqui só há dois desfechos: uma tabela
  // que corresponde ao que ele nomeou, ou uma recusa.
  const observedKind = tableKindForChannelType(observedType);
  const requestedKind = tableKindForChannelType(requestedChannelType);

  if (!observedKind || (requestedKind !== null && requestedKind !== observedKind)) {
    // DOIS casos, uma recusa — e os dois são estado PARADO, não transitório:
    //
    //   (a) `!observedKind` — tipo declarado que NÃO tem destino nesta fatia.
    //       `facebook` é membro de `SeamlessChannelType` e não tem tabela; um
    //       tipo novo do fornecedor amanhã também não terá. Diferente do ramo
    //       acima: aqui o fornecedor RESPONDEU, e retentar só traria a mesma
    //       resposta;
    //   (b) declarado ≠ pedido. Hoje é REDE e não caminho — `pickNewChannel` já
    //       filtra candidato por tipo quando há sessão. Fica porque a garantia
    //       mora em OUTRO lugar (o filtro daquela função), e o custo de perdê-la
    //       sem esta rede é gravar Instagram como número de WhatsApp.
    //
    // PARA, e a sessão fica intacta. Reabrir a conexão pelo card certo é a saída —
    // e o canal segue lá, pronto para ser reivindicado.
    await logRuntime({
      organizationId: orgId,
      module: "channel",
      action: "notificame.channel_type_mismatch",
      status: "error",
      errorMessage: observedKind
        ? `canal do tipo ${observedType} não pode ser vinculado como ${requestedKind}`
        : `canal do tipo ${observedType} não tem destino nesta plataforma`,
      entityType: "whatsapp_instance",
      triggeredBy: auth.userId,
      payloadSnapshot: {
        channel_id: pick.channel.id,
        raw_type: pick.channel.type ?? null,
        observed_type: observedType,
        requested_channel_type: requestedChannelType,
        had_baseline: !!baseline,
      },
      ...trace,
    });
    return new Response(
      JSON.stringify({
        error: "O canal conectado não é do tipo esperado. Comece a conexão novamente.",
        code: "channel_type_mismatch",
        retryable: false,
      }),
      { status: 409, headers },
    );
  }

  // A ÚNICA atribuição de `channelKind`, e ela vem do tipo OBSERVADO — conferido
  // contra o pedido logo acima. Não há ramo que a alcance sem tipo confirmado.
  const channelKind = observedKind;

  // `subaccountId` é o UUID da NOSSA linha do cofre — REFERÊNCIA, não o token.
  // As duas tabelas são lidas sob RLS por qualquer membro da org.
  const instanceRow = channelKind === "whatsapp"
    ? buildNotificameInstanceRow({
      organizationId: orgId,
      subaccountId: subaccount.id,
      channel: pick.channel,
    })
    : null;

  const socialRow = channelKind === "instagram"
    ? buildMessagingChannelRow({
      organizationId: orgId,
      subaccountId: subaccount.id,
      channel: pick.channel,
      channelType: "instagram",
    })
    : null;

  const baseName = instanceRow ? instanceRow.instance_name : socialRow!.display_name;
  const rowPhone = instanceRow ? instanceRow.phone_number : null;
  const rowStatus = instanceRow ? instanceRow.status : socialRow!.status;

  const insertWithName = (name: string) =>
    instanceRow
      ? admin
        .from("whatsapp_instances")
        .insert({
          organization_id: instanceRow.organization_id,
          provider: instanceRow.provider,
          instance_name: name,
          phone_number: instanceRow.phone_number,
          status: instanceRow.status,
          provider_config: instanceRow.provider_config,
          last_connection_at: new Date().toISOString(),
          // `instance_id` fica NULL de propósito: o id do canal tem UM dono só,
          // `provider_config->>'channel_id'`, onde mora o índice único parcial.
        })
        .select("id")
        .single()
      : admin
        .from(SOCIAL_TABLE)
        .insert({
          organization_id: socialRow!.organization_id,
          provider: socialRow!.provider,
          channel_type: socialRow!.channel_type,
          external_channel_id: socialRow!.external_channel_id,
          // COLUNA com FK e ON DELETE RESTRICT — não uma chave dentro do jsonb.
          subaccount_id: socialRow!.subaccount_id,
          display_name: name,
          handle: socialRow!.handle,
          status: socialRow!.status,
          provider_config: socialRow!.provider_config,
          connected_at: socialRow!.connected_at,
        })
        .select("id")
        .single();

  // Duas tentativas no MÁXIMO, e a segunda só existe para o choque de NOME: o
  // rótulo é cosmético e o canal do outro lado é faturável e irremovível, então
  // desistir do vínculo por causa dele seria trocar um problema de exibição por
  // um órfão permanente. Vale igual para `instance_name` e para `display_name`.
  let rowId: string | null = null;
  let insErr: PgErrorLike | null = null;
  let usedName = baseName;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await insertWithName(usedName);
    const id = (res.data as { id?: unknown } | null)?.id;
    if (!res.error && typeof id === "string" && id) {
      rowId = id;
      insErr = null;
      break;
    }
    insErr = (res.error as PgErrorLike | null) ??
      { code: null, message: "insert returned no row" };

    if (attempt === 0 && classifyUniqueViolation(insErr) === "instance_name") {
      usedName = disambiguateInstanceName(baseName, pick.channel.id);
      continue;
    }
    break;
  }

  if (!rowId) {
    const message = insErr?.message ?? "insert failed";
    const violation = classifyUniqueViolation(insErr);

    // ── 6a. O canal já tem dono ──────────────────────────────────────────────
    if (violation === "channel") {
      // Corrida perdida para o índice único parcial. Pode ter sido a retentativa
      // ANTERIOR desta mesma conexão (a resposta se perdeu, o vínculo aconteceu):
      // relê os vínculos DESTA org e, se o dono somos nós, isto é sucesso, não
      // erro. Só quando o dono é outra org é que o índice cumpriu o papel de
      // impedir que mensagens de um tenant fossem parar em outro.
      const recheck = await loadClaimedChannels(admin, orgId);
      const mine = recheck.ok ? recheck.byChannel.get(pick.channel.id) : undefined;

      if (mine) {
        if (rawSessionId) {
          await finalizeConnectSession(admin, {
            sessionId: rawSessionId,
            organizationId: orgId,
            userId: auth.userId,
          });
        }
        await logRuntime({
          organizationId: orgId,
          module: "channel",
          action: "notificame.channel_bound",
          status: "success",
          entityType: "whatsapp_instance",
          entityId: mine.id,
          triggeredBy: auth.userId,
          payloadSnapshot: {
            channel_id: mine.channelId,
            channel_kind: mine.kind,
            phone_last4: last4(mine.phoneNumber),
            had_baseline: !!baseline,
            idempotent: true,
          },
          ...trace,
        });
        return boundResponse({
          rowId: mine.id,
          kind: mine.kind,
          channelId: mine.channelId,
          phoneNumber: mine.phoneNumber,
          status: mine.status,
          idempotent: true,
        });
      }

      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.channel_bind_conflict",
        status: "error",
        errorMessage: "canal já vinculado a outra organização (índice único)",
        entityType: channelKind === "instagram" ? "messaging_channel" : "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { channel_id: pick.channel.id, channel_kind: channelKind },
        ...trace,
      });
      return new Response(
        JSON.stringify({
          error: "Este canal já está vinculado a uma organização",
          code: "channel_already_bound",
          retryable: false,
        }),
        { status: 409, headers },
      );
    }

    // ── 6b. NOME repetido dentro da org ──────────────────────────────────────
    // Outro defeito, outro código: não fala de canal nem de tenant. Chegar aqui
    // significa que até o nome desambiguado já existe na org.
    if (violation === "instance_name") {
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.instance_name_conflict",
        status: "error",
        errorMessage: "nome já usado nesta organização",
        entityType: channelKind === "instagram" ? "messaging_channel" : "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: {
          channel_id: pick.channel.id,
          channel_kind: channelKind,
          attempted_name: usedName,
        },
        ...trace,
      });
      return new Response(
        JSON.stringify({
          // Microcopy por tipo: mandar renomear "o número existente" numa tela de
          // Instagram manda o usuário procurar um objeto que não existe ali.
          error: channelKind === "instagram"
            ? "Já existe um canal com esse nome nesta organização. Renomeie o canal existente e tente de novo."
            : "Já existe um número com esse nome nesta organização. Renomeie o número existente e tente de novo.",
          code: "instance_name_taken",
          retryable: false,
        }),
        { status: 409, headers },
      );
    }

    // ── 6c. Alguma OUTRA unicidade ───────────────────────────────────────────
    // Não é o canal e não é o nome. Chutar entre os dois seria pior que admitir.
    if (violation === "unknown") {
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.instance_insert_conflict",
        status: "error",
        errorMessage: message,
        entityType: channelKind === "instagram" ? "messaging_channel" : "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { channel_id: pick.channel.id, channel_kind: channelKind },
        ...trace,
      });
      return new Response(
        JSON.stringify({
          error: channelKind === "instagram"
            ? "Não foi possível registrar este canal"
            : "Não foi possível registrar este número",
          code: "instance_conflict",
          retryable: false,
        }),
        { status: 409, headers },
      );
    }

    // O trigger BEFORE INSERT `enforce_whatsapp_instance_limit` conta SEM filtrar
    // provider (RAISE ... USING ERRCODE = 'P0001'), então o canal oficial consome
    // uma vaga de `max_whatsapp_instances`. É um número de verdade — a fatia só
    // traduz o erro para microcopy honesta.
    // ⚠️ NÃO ALCANÇÁVEL no caminho de Instagram: `messaging_channels` fica FORA do
    // trigger por decisão (canal social não consome vaga de número de WhatsApp).
    // Se um dia o pricing quiser cobrar por canal social, é quota PRÓPRIA — não
    // reaproveitar `max_whatsapp_instances`, que já é vendida como "números".
    // Casa pela MENSAGEM (verbatim do trigger), não pelo SQLSTATE: P0001 é o
    // código genérico de todo RAISE EXCEPTION, e depender dele deixaria a
    // microcopy honesta refém de o código chegar até aqui.
    const isQuota = /limite de inst[âa]ncias|max_whatsapp_instances/i.test(message);
    if (isQuota) {
      return new Response(
        JSON.stringify({
          error: "Limite de números da organização atingido",
          code: "quota_exceeded",
          retryable: false,
        }),
        { status: 409, headers },
      );
    }

    // Falha desconhecida: a sessão continua 'open' de propósito. O canal existe no
    // fornecedor e ainda pode ser vinculado pela retentativa seguinte.
    return new Response(JSON.stringify({ error: message, code: "instance_insert_failed" }), {
      status: 500,
      headers,
    });
  }

  // ── 6d. RECEBIMENTO: registra a subscription de entrada ────────────────────
  //
  // POR QUE AQUI, e não numa função própria: este é o ÚNICO ponto do sistema que
  // tem, no MESMO request, o token da subconta já decifrado (`orgCfg`, montado no
  // passo 2), a org validada pelo auth e a linha do canal recém-criada. Qualquer
  // outro lugar teria de decifrar o token de novo.
  //
  // ⚠️ FALHA AQUI NÃO DESFAZ O VÍNCULO E NÃO VIRA ERRO NO BROWSER. O canal já
  // nasceu no fornecedor: é FATURÁVEL e IRREMOVÍVEL. Desvincular por causa do
  // registro produziria exatamente a órfã permanente que a fatia 1.1 inteira
  // existe para evitar — o pior desfecho disponível, trocado por um erro de tela.
  //
  // ⚠️ O QUE MUDOU, E POR QUÊ (defeito real, não polimento): antes, o estado da
  // falha vivia em `provider_config.subscription` + `subscription_pending: true` na
  // resposta — e NENHUM consumidor lia nenhum dos dois (`grep subscription_pending
  // src/` = vazio). O desfecho era o pior possível: canal conectado, tela dizendo
  // SUCESSO, recebimento NUNCA registrado, e o sintoma ("o Instagram não recebe")
  // indistinguível de "ninguém mandou mensagem". Um sinal sem leitor é o mesmo que
  // nenhum sinal.
  //
  // Agora o estado é CARIMBADO EM COLUNAS de `messaging_channels`
  // (`inbound_subscription_*`, migration 20270816120000), e existe um leitor:
  // `notificame-subscription-repair`, cron de 5 em 5 minutos, que retenta com
  // backoff até conseguir. A recuperação não depende de ninguém PERCEBER — que é
  // justamente o que não acontece quando a tela diz "conectado".
  //
  // `subscription_pending` continua saindo na resposta: agora é informação
  // VERDADEIRA e com dono (a fila), e não mais o único vestígio de um problema.
  //
  // ⚠️ O VEREDITO SAI DO CORPO. `registerInboundSubscription` NUNCA lê
  // `res.ok`/`res.status`: rota desconhecida devolve 200 com `{error:{code:
  // 'Hub404'}}` e falha de auth devolve 404. Aqui isso importa de um jeito
  // particular — o sintoma de uma subscription que NUNCA existiu é indistinguível
  // de "ninguém mandou mensagem ainda", e some por semanas.
  //
  // SÓ INSTAGRAM: o WhatsApp Oficial do NotificaMe não recebe por esta rota nesta
  // fatia, e registrar uma subscription para ele mandaria eventos de WhatsApp para
  // um endpoint que só sabe gravar `channel='instagram'` — todos parkados.
  let subscriptionPending = false;
  if (channelKind === "instagram") {
    const webhookSecret = (Deno.env.get("NOTIFICAME_WEBHOOK_SECRET") ?? "").trim();
    const functionsBaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();

    /**
     * O CARIMBO DO ESTADO DE RECEBIMENTO — a linha que dá um LEITOR ao sinal.
     *
     * Colunas, e não `provider_config.subscription`: é o predicado que o worker
     * `notificame-subscription-repair` consulta (índice parcial
     * `idx_messaging_channels_subscription_due`) e é a CONTAGEM que responde
     * "quantos canais estão conectados sem receber?". A mesma pergunta dentro de
     * jsonb não usa índice e ninguém a faz.
     *
     * ⚠️ ESTA ESCRITA NUNCA PODE DERRUBAR O VÍNCULO. Ela roda DEPOIS do INSERT, o
     * canal já é faturável e irremovível, e a única consequência de falhar é o
     * canal ficar 'pending' com `next_attempt_at = now()` (o default da coluna) —
     * ou seja, na fila, que é onde ele já deveria estar. Guardas de schema pelo
     * mesmo motivo dos outros pontos de chamada: função nova sobre schema velho
     * degrada, não quebra.
     */
    const stampSubscription = async (patch: Record<string, unknown>): Promise<void> => {
      const { error: stampErr } = await admin.from(SOCIAL_TABLE).update(patch).eq("id", rowId);
      if (!stampErr) return;

      const knownGap = isMissingTableError(stampErr, SOCIAL_TABLE) ||
        Object.keys(patch).some((col) => isMissingColumnError(stampErr, col));

      if (!knownGap) {
        // Nem tabela ausente nem coluna ausente: é falha de verdade. O vínculo
        // está feito e não se desfaz — mas isto precisa aparecer, porque o canal
        // pode ter ficado fora da fila.
        console.error(
          `[notificame] canal ${rowId} vinculado mas o estado de recebimento nao foi ` +
            `carimbado: ${stampErr.message}`,
        );
      }
    };

    if (!webhookSecret || !functionsBaseUrl) {
      // Secret não configurado. NÃO é motivo para recusar o vínculo — é motivo
      // para o canal nascer com o recebimento pendente e alguém configurar.
      //
      // 'pending' com `attempts = 0`, NÃO 'failed': a falha é NOSSA e some com um
      // `secrets set`. Contá-la como tentativa faria o backoff crescer contra um
      // problema que o worker não pode resolver — e o reparo chegaria horas depois
      // de o env já estar no lugar.
      subscriptionPending = true;
      await stampSubscription({
        inbound_subscription_status: "pending",
        inbound_subscription_attempts: 0,
        inbound_subscription_last_error: "not_configured",
        inbound_subscription_last_attempt_at: new Date().toISOString(),
        inbound_subscription_next_attempt_at: new Date().toISOString(),
      });
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.subscription_register_failed",
        status: "error",
        errorMessage: "NOTIFICAME_WEBHOOK_SECRET ou SUPABASE_URL ausentes — canal sem recebimento",
        entityType: "messaging_channel",
        entityId: rowId,
        triggeredBy: auth.userId,
        payloadSnapshot: { channel_id: pick.channel.id, reason: "not_configured" },
        ...trace,
      });
    } else {
      // A URL carrega o secret E o uuid da subconta — é CREDENCIAL inteira. Só a
      // versão redigida pode encostar em log.
      const webhookUrl = buildInboundWebhookUrl({
        supabaseUrl: functionsBaseUrl,
        secret: webhookSecret,
        subaccountRowId: subaccount.id,
      });

      const registration = await registerInboundSubscription(
        orgCfg,
        // O id do canal NO FORNECEDOR é o que a doc corrente pede em
        // `criteria.channel` — a palavra "instagram" fica só como degrau de
        // fallback dentro da própria função.
        { webhookUrl, channelKind: "instagram", channelId: pick.channel.id },
        fetch,
      );
      subscriptionPending = !registration.ok;

      const nowIso = new Date().toISOString();

      // ⚠️ `redactWebhookUrl` continua sendo a ÚNICA forma de a URL encostar num
      // log: ela carrega o secret E o uuid da subconta, ou seja, é a credencial
      // inteira. O que saiu daqui foi a PERSISTÊNCIA dela na linha — o endpoint é
      // derivável de `subaccount_id`, que já é coluna, e guardar a versão redigida
      // criava um segundo estado para conferir na auditoria.
      await stampSubscription(
        registration.ok
          ? {
            inbound_subscription_status: "active",
            inbound_subscription_attempts: 0,
            inbound_subscription_last_error: null,
            inbound_subscription_last_attempt_at: nowIso,
            inbound_subscription_next_attempt_at: nowIso,
            inbound_subscription_registered_at: nowIso,
          }
          : {
            // 'failed' com UMA tentativa: o fornecedor RECUSOU, e o worker assume
            // daqui com backoff exponencial a partir de 5 minutos.
            inbound_subscription_status: "failed",
            inbound_subscription_attempts: 1,
            inbound_subscription_last_error: registration.code,
            inbound_subscription_last_attempt_at: nowIso,
            inbound_subscription_next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
      );

      // Rótulo do endpoint na trilha — REDIGIDO, e só na trilha. A recusa do
      // fornecedor entra aqui também: o console da função é o primeiro lugar onde
      // alguém olha, e chegar nele sem o motivo obriga a segunda consulta.
      console.info(
        `[notificame] subscription registrada=${registration.ok} em ${
          redactWebhookUrl(webhookUrl)
        }` +
          (registration.ok
            ? ""
            : ` — ${registration.code}` +
              (registration.vendor?.message ? ` :: ${registration.vendor.message}` : "")),
      );

      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: registration.ok
          ? "notificame.subscription_registered"
          : "notificame.subscription_register_failed",
        status: registration.ok ? "success" : "error",
        errorMessage: registration.ok
          ? undefined
          : `NotificaMe recusou o registro da subscription (${registration.code})`,
        entityType: "messaging_channel",
        entityId: rowId,
        triggeredBy: auth.userId,
        payloadSnapshot: {
          channel_id: pick.channel.id,
          // O nosso código estável — e, ao lado dele, o que o fornecedor DISSE.
          //
          // ⚠️ Aqui o par vale mais do que em qualquer outro ponto da fatia: o
          // sintoma de uma subscription que nunca existiu é indistinguível de
          // "ninguém mandou mensagem ainda", e some por semanas. Quem for
          // investigar depois só tem esta linha — `subscription_register_failed`
          // sozinho não diz se o token foi recusado, se a rota mudou ou se o
          // critério `direction` foi rejeitado.
          //
          // Escalares com nome nosso, por spread: `redactSecrets` redige por NOME
          // DE CHAVE, e um `JSON.stringify` do corpo deles sob uma chave genérica
          // atravessaria a redação inteiro.
          //
          // A RESPOSTA ao cliente continua sem nada disto — ela só carrega
          // `subscription_pending`.
          ...(registration.ok
            ? {}
            : { code: registration.code, ...vendorLogFields(registration.vendor) }),
        },
        ...trace,
      });
    }
  }

  // ── 7. Vínculo feito. SÓ AGORA a sessão fecha ──────────────────────────────
  // Falhar aqui não desfaz o vínculo nem muda a resposta: a linha existe, e uma
  // sessão pendurada expira sozinha. O contrário — fechar antes — é que produz
  // canal órfão.
  if (rawSessionId) {
    const closed = await finalizeConnectSession(admin, {
      sessionId: rawSessionId,
      organizationId: orgId,
      userId: auth.userId,
    });
    if (!closed) {
      console.warn(
        "[notificame] canal vinculado mas a sessão não fechou (já fechada ou expirada):",
        rawSessionId,
      );
    }
  }

  await logRuntime({
    organizationId: orgId,
    module: "channel",
    action: "notificame.channel_bound",
    status: "success",
    entityType: channelKind === "instagram" ? "messaging_channel" : "whatsapp_instance",
    entityId: rowId,
    triggeredBy: auth.userId,
    payloadSnapshot: {
      channel_id: pick.channel.id,
      // EM QUAL TABELA a linha nasceu. Sem isto, uma auditoria futura não
      // distingue um canal social de um número olhando só a trilha.
      channel_kind: channelKind,
      phone_last4: last4(rowPhone),
      // QUAL regra decidiu o vínculo. Sem isto, um vínculo errado no futuro seria
      // indistinguível entre "a baseline estava errada" e "não havia baseline".
      had_baseline: !!baseline,
      // Rótulo desambiguado por colisão de nome — some da trilha quando não houve.
      ...(usedName !== baseName ? { renamed_to: usedName } : {}),
    },
    ...trace,
  });

  return boundResponse({
    rowId,
    kind: channelKind,
    channelId: pick.channel.id,
    phoneNumber: rowPhone,
    status: rowStatus,
    subscriptionPending,
  });
}));
