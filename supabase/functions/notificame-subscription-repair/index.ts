/**
 * notificame-subscription-repair — O LEITOR QUE FALTAVA.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  UM SINAL PRODUZIDO SEM LEITOR É O MESMO QUE NENHUM SINAL.               ║
 * ║                                                                          ║
 * ║  `notificame-channel-finish` devolvia `subscription_pending: true` quando ║
 * ║  o registro de `POST /v1/subscriptions` falhava. NINGUÉM lia esse campo.  ║
 * ║  Resultado real: o canal conecta, a tela diz SUCESSO, e o recebimento     ║
 * ║  nunca é registrado — as mensagens não chegam e não há erro em lugar      ║
 * ║  nenhum. É o modo de falha mais caro que existe: PARECE QUE FUNCIONOU.    ║
 * ║                                                                          ║
 * ║  Esta função é o leitor. Ela roda de 5 em 5 minutos, encontra os canais   ║
 * ║  `status='connected'` cujo `inbound_subscription_status` não é 'active',  ║
 * ║  e tenta de novo — sem depender de nenhum humano perceber nada.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── POR QUE UMA FILA, E NÃO UM BOTÃO ───────────────────────────────────────
 *
 * A causa dominante desta falha é TRANSITÓRIA (rede, 5xx do fornecedor) ou de
 * CONFIGURAÇÃO (`NOTIFICAME_WEBHOOK_SECRET` ausente no momento do vínculo). As
 * duas se curam sozinhas — com o tempo, ou com um `secrets set`. Um botão exigiria
 * que alguém PERCEBESSE, e perceber é exatamente o que falta: a tela diz
 * "conectado".
 *
 * E há um caminho que NENHUM botão de "tentar de novo" alcançaria: as duas rotas
 * idempotentes do finish (sessão já fechada; corrida perdida no índice único)
 * devolvem 200 sem reavaliar a subscription. Quem clicasse "reconectar" receberia
 * sucesso e continuaria sem receber mensagem nenhuma. A fila alcança.
 *
 * O botão não morre: o estado agora mora em COLUNAS de `messaging_channels`, lidas
 * sob RLS por qualquer membro da org. A UI pode mostrar "recebimento pendente"
 * quando houver fatia de front. O que esta função garante é que a RECUPERAÇÃO NÃO
 * DEPENDE dessa fatia existir.
 *
 * ─── AUTENTICAÇÃO: SÓ CRON ──────────────────────────────────────────────────
 *
 * `x-cron-secret`, fail-closed (`requireCronAuth` recusa quando o env falta). Não
 * há caminho de usuário aqui de propósito: esta função fala com o fornecedor em
 * nome de QUALQUER org, com o token da subconta decifrado. A superfície certa para
 * um humano é o front chamando o finish — que já valida org do auth, flag e
 * `whatsapp.manage_instances`.
 *
 * O corpo aceita `{"organization_id": "<uuid>"}` para reparo dirigido de UMA org.
 * É ferramenta de operação (curl com o cron secret, que só existe no servidor),
 * não rota de produto.
 *
 * ─── O VEREDITO SAI DO CORPO, NUNCA DE `res.ok` ─────────────────────────────
 *
 * `registerInboundSubscription` já garante isso — a API devolve HTTP 200 com
 * `{"error":{"code":"Hub404"}}` para rota desconhecida e HTTP 404 para falha de
 * AUTENTICAÇÃO. Aqui a consequência de errar é dupla: marcaríamos 'active' um
 * canal que não recebe (o defeito original, de volta) e pararíamos de tentar.
 *
 * ─── O QUE ESTA FUNÇÃO NÃO FAZ ──────────────────────────────────────────────
 *
 *   • NÃO consulta a flag `notificame_instagram`. Flag gateia CONECTAR e MOSTRAR,
 *     não RECEBER — mesma decisão documentada no cabeçalho de `notificame-webhook`.
 *     Um canal já vinculado com a flag desligada continua sendo do cliente, e
 *     deixá-lo sem recebimento seria escolher perder mensagem por causa de um
 *     toggle de produto;
 *   • NÃO desregistra nada. Não existe rota de remoção nesta fatia e inventar uma
 *     por dedução da doc, contra uma conta viva, é como se apaga o recebimento de
 *     um cliente por engano;
 *   • NÃO desfaz vínculo, NUNCA. O canal é faturável e irremovível no fornecedor;
 *   • NÃO toca em `whatsapp_instances`. O WhatsApp Oficial não recebe por esta
 *     rota nesta fatia — registrar subscription para ele mandaria eventos de
 *     WhatsApp a um endpoint que só sabe gravar `channel='instagram'`.
 *
 * ─── ORDEM DE DEPLOY ────────────────────────────────────────────────────────
 *
 * MIGRATION `20270816120000_notificame_subscription_repair` PRIMEIRO. Sem as
 * colunas, o SELECT desta função erra e ela vira no-op barulhento a cada 5
 * minutos — fail-closed, mas ruidoso e inútil.
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireCronAuth } from "../_shared/auth.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  type SeamlessChannelType,
  buildInboundWebhookUrl,
  orgConfigFrom,
  readNotificameParentConfig,
  registerInboundSubscription,
  vendorLogFields,
} from "../_shared/notificame.ts";
import { loadNotificameSubaccount } from "../_shared/notificame-credentials.ts";

const FUNCTION_NAME = "notificame-subscription-repair";

const SOCIAL_TABLE = "messaging_channels";

/**
 * Teto de canais por execução. Com o cron de 5 minutos isso é 300/hora — folga de
 * ordens de grandeza sobre a população real (dezenas de orgs), e um teto existe
 * para que um dia ruim no fornecedor não vire uma execução de dez minutos que o
 * runtime mata no meio, deixando metade da fila com o carimbo pela metade.
 */
const BATCH_LIMIT = 25;

/** Deadline por chamada ao fornecedor. Sem isto, um socket pendurado come o run. */
const REGISTER_TIMEOUT_MS = 10_000;

/**
 * BACKOFF EXPONENCIAL, com teto. 5min → 10 → 20 → 40 → 80 → 160 → 320 → 6h.
 *
 * O teto existe porque a causa que sobrevive a sete tentativas não é transitória:
 * é `AUTHENTICATION_ERROR` (token da subconta inválido) ou `Hub404` (a rota mudou).
 * Nenhuma das duas melhora com pressa, e continuar tentando de 5 em 5 minutos para
 * sempre transformaria um canal quebrado num gerador de tráfego.
 *
 * Mas NUNCA para de tentar. Estado terminal aqui significaria que consertar o
 * token não religa o recebimento sozinho — e voltaríamos a depender de alguém
 * perceber, que é o defeito de origem.
 */
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;

/**
 * A partir daqui a falha é ESCALADA (linha de erro própria em `runtime_logs`, com
 * a org e o canal). 6 tentativas ≈ 4h de silêncio — tempo suficiente para
 * descartar transitório, curto o bastante para o mesmo dia útil.
 *
 * ⚠️ "Detectar não é alertar": `runtime_logs` não tem leitor automático neste
 * produto. O que esta linha garante é que a resposta EXISTE quando alguém
 * perguntar. O grito de verdade é a CONTAGEM na coluna indexada
 * (`idx_messaging_channels_subscription_due`), que é o que um painel consulta —
 * e o consumidor que grita é fatia própria, declarada e não fingida.
 */
const ESCALATE_AFTER_ATTEMPTS = 6;

/** Colunas do estado. Nomeadas uma vez: aparecem no SELECT e em cada UPDATE. */
const STATE_COLUMNS =
  "id, organization_id, external_channel_id, channel_type, subaccount_id, " +
  "inbound_subscription_status, inbound_subscription_attempts";

interface DueChannel {
  id: string;
  organization_id: string;
  external_channel_id: string;
  channel_type: string;
  subaccount_id: string;
  inbound_subscription_status: string;
  inbound_subscription_attempts: number;
  /**
   * De qual TABELA a linha veio. É o que decide onde o carimbo escreve — e um
   * carimbo na tabela errada silencia a fila para sempre: a linha some do
   * predicado sem nunca ter sido registrada.
   */
  source_table: "messaging_channels" | "whatsapp_instances";
  /** `instagram` | `whatsapp`, já normalizado. Vai para `criteria.channel`. */
  kind: SeamlessChannelType;
}

/** Colunas do estado em `whatsapp_instances` — não há `external_channel_id` nem
 * `channel_type` ali; os dois moram no jsonb `provider_config`. */
const WA_STATE_COLUMNS =
  "id, organization_id, provider_config, " +
  "inbound_subscription_status, inbound_subscription_attempts";

/** `attempts` = quantas falhas já aconteceram INCLUINDO esta. */
function backoffMs(attempts: number): number {
  const exp = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(exp, BACKOFF_MAX_MS);
}

/**
 * `fetch` com deadline DURO que aborta o socket.
 *
 * O timer sozinho devolveria o controle com a requisição ainda EM VOO — e uma
 * requisição em voo depois de marcarmos 'failed' é como se cria uma SEGUNDA
 * subscription no fornecedor (o próximo ciclo tenta de novo e as duas vingam),
 * que duplica cada mensagem no inbox do cliente.
 */
const fetchWithDeadline: typeof fetch = (input, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REGISTER_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

Deno.serve(withErrorBoundary(FUNCTION_NAME, async (req: Request) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  if (!requireCronAuth(req).authorized) {
    // 401 e não 404: ao contrário do webhook, esta rota não é alcançável por quem
    // não conhece o nome dela, e o interlocutor legítimo é o nosso próprio cron.
    return json(401, { error: "unauthorized" });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Corpo ausente ou ilegível = varredura completa. É o caminho do cron.
    body = {};
  }
  const onlyOrg = typeof body.organization_id === "string" ? body.organization_id.trim() : "";

  const admin = createAdminClient(FUNCTION_NAME);

  // ── 1. Configuração. SEM ELA NÃO SE QUEIMA TENTATIVA ─────────────────────
  //
  // ⚠️ Este é o ponto mais fácil de errar do desenho inteiro. Se um env faltando
  // contasse como tentativa, o backoff cresceria até 6h enquanto o conserto é um
  // `secrets set` — e o recebimento só voltaria HORAS depois de o problema já
  // estar resolvido. A espera puniria o conserto. Por isso: sai antes de tocar em
  // qualquer linha, e nenhum `attempts` é incrementado.
  const parent = readNotificameParentConfig(Deno.env);
  const webhookSecret = (Deno.env.get("NOTIFICAME_WEBHOOK_SECRET") ?? "").trim();
  const functionsBaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();

  const missing = [
    parent ? null : "NOTIFICAME_API_TOKEN",
    webhookSecret ? null : "NOTIFICAME_WEBHOOK_SECRET",
    functionsBaseUrl ? null : "SUPABASE_URL",
    // A chave do cofre entra AQUI e não lá embaixo de propósito. Sem ela,
    // `loadNotificameSubaccount` devolve `null` para TODA org — indistinguível de
    // "esta subconta não está pronta" — e cada canal da fila queimaria uma
    // tentativa por ciclo, empurrando o backoff para 6h por causa de um env. É a
    // mesma armadilha do parágrafo acima, uma camada abaixo.
    (Deno.env.get("NOTIFICAME_ENCRYPTION_KEY") ?? "").trim() ? null : "NOTIFICAME_ENCRYPTION_KEY",
  ].filter(Boolean) as string[];

  if (missing.length > 0) {
    console.error(
      `[${FUNCTION_NAME}] env ausente: ${missing.join(", ")} — nenhum canal foi tocado e ` +
        `nenhuma tentativa foi consumida. Configure e o proximo ciclo (5 min) repara.`,
    );
    await logRuntime({
      module: "channel",
      action: "notificame.subscription_repair_not_configured",
      status: "error",
      errorMessage: `env ausente: ${missing.join(", ")}`,
    });
    // 200: não é falha DESTA execução, é configuração pendente. Um 5xx faria o
    // job de cron parecer quebrado quando ele está funcionando como projetado.
    return json(200, { status: "skipped", reason: "not_configured", missing });
  }

  // ── 2. A fila ────────────────────────────────────────────────────────────
  //
  // `status='connected'`: um canal desconectado não deve receber, e registrar
  // subscription para ele contrariaria a única forma de kill-switch que existe.
  //
  // `channel_type='instagram'`: ver "o que esta função NÃO faz".
  const agoraIso = new Date().toISOString();

  let query = admin
    .from(SOCIAL_TABLE)
    .select(STATE_COLUMNS)
    .eq("provider", "notificame")
    .eq("channel_type", "instagram")
    .eq("status", "connected")
    .in("inbound_subscription_status", ["pending", "failed"])
    .lte("inbound_subscription_next_attempt_at", agoraIso)
    .order("inbound_subscription_next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (onlyOrg) query = query.eq("organization_id", onlyOrg);

  const { data, error } = await query;

  // ── 2b. A MESMA fila, na tabela do WhatsApp oficial ──────────────────────
  //
  // Duas leituras e não um JOIN/VIEW: as tabelas têm colunas diferentes
  // (`whatsapp_instances` guarda canal e tipo dentro de `provider_config`) e o
  // custo é uma consulta a mais num cron de 5 em 5 minutos. O índice parcial
  // gêmeo (`idx_whatsapp_instances_subscription_due`) atende esta query.
  //
  // O `BATCH_LIMIT` vale POR TABELA de propósito: uma fila social cheia não pode
  // deixar o WhatsApp sem recebimento indefinidamente, que é o que um limite
  // global compartilhado produziria.
  let waQuery = admin
    .from("whatsapp_instances")
    .select(WA_STATE_COLUMNS)
    .eq("provider", "notificame")
    .eq("status", "connected")
    .in("inbound_subscription_status", ["pending", "failed"])
    .lte("inbound_subscription_next_attempt_at", agoraIso)
    .order("inbound_subscription_next_attempt_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (onlyOrg) waQuery = waQuery.eq("organization_id", onlyOrg);

  const { data: waData, error: waError } = await waQuery;

  if (error || waError) {
    // Schema velho sob função nova cai aqui. 500 para que o erro apareça — este é
    // o único consumidor do estado, e um no-op silencioso reproduziria o defeito
    // que a função existe para fechar.
    console.error(
      `[${FUNCTION_NAME}] leitura da fila falhou: ` +
        `social=${error?.message ?? "ok"} whatsapp=${waError?.message ?? "ok"}`,
    );
    return json(500, { error: "queue_read_failed" });
  }

  const dueSocial: DueChannel[] = ((data ?? []) as unknown as DueChannel[]).map((c) => ({
    ...c,
    source_table: "messaging_channels",
    kind: "instagram",
  }));

  // `provider_config` guarda o que a tabela social tem em coluna. `subaccount_id`
  // dali é CONFERÊNCIA no envio, mas AQUI é o que compõe a URL do webhook — e
  // uma referência errada entregaria os eventos desta org no path de outra.
  const dueWhatsApp: DueChannel[] = ((waData ?? []) as unknown as Array<Record<string, unknown>>)
    .map((raw) => {
      const cfg = (raw.provider_config ?? {}) as Record<string, unknown>;
      return {
        id: String(raw.id),
        organization_id: String(raw.organization_id),
        external_channel_id: typeof cfg.channel_id === "string" ? cfg.channel_id : "",
        channel_type: typeof cfg.channel_type === "string" ? cfg.channel_type : "whatsapp",
        subaccount_id: typeof cfg.subaccount_id === "string" ? cfg.subaccount_id : "",
        inbound_subscription_status: String(raw.inbound_subscription_status),
        inbound_subscription_attempts: Number(raw.inbound_subscription_attempts ?? 0),
        source_table: "whatsapp_instances" as const,
        kind: "whatsapp" as const,
      };
    })
    // Sem `channel_id` ou sem `subaccount_id` não há o que assinar, e tentar
    // cairia no fallback que assina a PALAVRA — aceito calado, sem assinar nada.
    .filter((c) => c.external_channel_id && c.subaccount_id);

  const due = [...dueSocial, ...dueWhatsApp];
  if (due.length === 0) return json(200, { status: "idle", repaired: 0, failed: 0 });

  // ── 3. Um token de subconta por ORG, não por canal ───────────────────────
  // Decifrar é AEAD + ida ao banco. Duas orgs com dois canais cada custariam
  // quatro decifragens para dois segredos.
  const tokenByOrg = new Map<string, string | null>();
  const loadToken = async (organizationId: string): Promise<string | null> => {
    if (tokenByOrg.has(organizationId)) return tokenByOrg.get(organizationId)!;
    const sub = await loadNotificameSubaccount(admin, organizationId);
    const token = sub?.companyUuid ?? null;
    tokenByOrg.set(organizationId, token);
    return token;
  };

  /**
   * O CARIMBO. Único ponto que escreve o estado — para que "o que conta como
   * sucesso" tenha uma definição só.
   *
   * ⚠️ `attempts` NUNCA volta a zero no fracasso e SEMPRE volta no sucesso: é ele
   * que segura o backoff e a escalada, e reiniciá-lo por engano transformaria uma
   * falha permanente numa tentativa a cada 5 minutos, para sempre.
   */
  const stamp = async (
    channel: DueChannel,
    outcome: { ok: true } | { ok: false; code: string },
  ): Promise<void> => {
    const nowIso = new Date().toISOString();
    const patch = outcome.ok
      ? {
        inbound_subscription_status: "active",
        inbound_subscription_attempts: 0,
        inbound_subscription_last_error: null,
        inbound_subscription_last_attempt_at: nowIso,
        inbound_subscription_next_attempt_at: nowIso,
        inbound_subscription_registered_at: nowIso,
      }
      : (() => {
        const attempts = (channel.inbound_subscription_attempts ?? 0) + 1;
        return {
          inbound_subscription_status: "failed",
          inbound_subscription_attempts: attempts,
          inbound_subscription_last_error: outcome.code,
          inbound_subscription_last_attempt_at: nowIso,
          inbound_subscription_next_attempt_at:
            new Date(Date.now() + backoffMs(attempts)).toISOString(),
        };
      })();

    const { error: upErr } = await admin.from(channel.source_table).update(patch).eq("id", channel.id);
    if (upErr) {
      // O registro pode ter acontecido e o carimbo não. O próximo ciclo tentaria
      // de novo e criaria uma SEGUNDA subscription — por isso isto é `error` e
      // não um `warn` engolido: é o caminho pelo qual a duplicação nasce.
      console.error(
        `[${FUNCTION_NAME}] registro=${outcome.ok} mas o carimbo falhou no canal ` +
          `${channel.id}: ${upErr.message}`,
      );
      await logRuntime({
        organizationId: channel.organization_id,
        module: "channel",
        action: "notificame.subscription_stamp_failed",
        status: "error",
        errorMessage: `carimbo do estado falhou (registro ok=${outcome.ok})`,
        entityType: "messaging_channel",
        entityId: channel.id,
      });
    }
  };

  // ── 4. Reparo, canal a canal ─────────────────────────────────────────────
  // SEQUENCIAL de propósito: o fornecedor é o mesmo host para todas as orgs, e o
  // paralelismo aqui compraria milissegundos ao preço de uma rajada contra quem
  // acabou de nos recusar. `BATCH_LIMIT` já limita o run.
  let repaired = 0;
  let failed = 0;

  for (const channel of due) {
    const token = await loadToken(channel.organization_id);
    if (!token) {
      // Cofre não pronto, chave errada, cifra corrompida. Falha NOSSA, mas
      // legítima como tentativa: ela não se resolve com um env e o backoff é o
      // comportamento certo.
      failed++;
      await stamp(channel, { ok: false, code: "subaccount_unavailable" });
      continue;
    }

    const webhookUrl = buildInboundWebhookUrl({
      supabaseUrl: functionsBaseUrl,
      secret: webhookSecret,
      // A URL carrega o uuid da linha do COFRE — é dele que o webhook deriva o
      // tenant. `channel.subaccount_id` é COLUNA com FK; usar qualquer outra
      // referência aqui entregaria os eventos desta org no path de outra.
      subaccountRowId: channel.subaccount_id,
    });

    const registration = await registerInboundSubscription(
      orgConfigFrom(parent!.baseUrl, token),
      {
        webhookUrl,
        // O kind REAL. Chumbar "instagram" mandaria o fallback assinar a palavra
        // errada para o WhatsApp — e assinar a palavra é o defeito descrito logo
        // abaixo, que custou um dia.
        channelKind: channel.kind,
        // ⚠️ `channelId` NÃO É OPCIONAL NA PRÁTICA, e omiti-lo aqui foi o defeito
        // que segurou o inbound por um dia inteiro (2026-08-17).
        //
        // Sem ele, `registerInboundSubscription` cai no fallback e assina a
        // PALAVRA 'instagram' como se fosse o token do canal. O fornecedor
        // ACEITA CALADO — responde sucesso, carimbamos `active` — e a
        // subscription não assina canal nenhum: a "URL de retorno" do canal
        // continua VAZIA no painel dele e nenhum evento é entregue.
        //
        // O sintoma é indistinguível de "ninguém mandou mensagem ainda", que é
        // exatamente o que o comentário daquela função previa. A coluna já vinha
        // selecionada em STATE_COLUMNS desde sempre — só não era usada.
        channelId: channel.external_channel_id,
      },
      fetchWithDeadline,
    );

    if (registration.ok) {
      repaired++;
      await stamp(channel, { ok: true });
      await logRuntime({
        organizationId: channel.organization_id,
        module: "channel",
        action: "notificame.subscription_registered",
        status: "success",
        entityType: "messaging_channel",
        entityId: channel.id,
        payloadSnapshot: {
          channel_id: channel.external_channel_id,
          // Quantas falhas antecederam. Distingue "primeira tentativa do reparo"
          // de "voltou depois de quatro horas fora" — leituras opostas.
          recovered_after_attempts: channel.inbound_subscription_attempts ?? 0,
        },
      });
      continue;
    }

    failed++;
    const attempts = (channel.inbound_subscription_attempts ?? 0) + 1;
    await stamp(channel, { ok: false, code: registration.code });

    await logRuntime({
      organizationId: channel.organization_id,
      module: "channel",
      action: attempts >= ESCALATE_AFTER_ATTEMPTS
        // Ação PRÓPRIA no limiar: é o que permite filtrar "está travado de
        // verdade" sem ler as seis tentativas anteriores, que são ruído esperado.
        ? "notificame.subscription_repair_stuck"
        : "notificame.subscription_register_failed",
      status: "error",
      errorMessage: attempts >= ESCALATE_AFTER_ATTEMPTS
        ? `canal conectado ha ${attempts} tentativas SEM RECEBER (${registration.code}) — ` +
          `o cliente ve "conectado" e nenhuma mensagem chega`
        : `NotificaMe recusou o registro da subscription (${registration.code})`,
      entityType: "messaging_channel",
      entityId: channel.id,
      payloadSnapshot: {
        channel_id: channel.external_channel_id,
        // O nosso CÓDIGO estável — é ele que a coluna guarda e é ele que decide o
        // backoff. A prosa do fornecedor não entra em resposta HTTP nenhuma
        // (`withErrorBoundary` devolve `error.message` cru num 500).
        code: registration.code,
        // MAS ELA ENTRA NO LOG, e é aqui que ela mais importa: esta função é um
        // CRON, não tem ninguém olhando enquanto roda, e um canal pode ficar horas
        // em backoff. `subscription_register_failed` repetido seis vezes sem o
        // motivo DELES é seis linhas que não respondem por que o cliente não
        // recebe. Escalares com nome nosso, por spread — nunca o corpo serializado
        // sob chave genérica, que a redação por NOME DE CHAVE atravessaria.
        ...vendorLogFields(registration.vendor),
        attempts,
        next_attempt_in_minutes: Math.round(backoffMs(attempts) / 60_000),
      },
    });
  }

  await logRuntime({
    module: "channel",
    action: "notificame.subscription_repair_run",
    status: failed > 0 ? "error" : "success",
    errorMessage: failed > 0 ? `${failed} canal(is) seguem sem recebimento` : undefined,
    payloadSnapshot: { due: due.length, repaired, failed, scoped_to_org: onlyOrg || null },
  });

  return json(200, { status: "done", due: due.length, repaired, failed });
}));
