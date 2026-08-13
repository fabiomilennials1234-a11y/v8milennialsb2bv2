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
 *
 * FORA DE ESCOPO (fatia 2): nenhum branch em `_shared/whatsapp-client.ts`. Sem
 * ele, qualquer caminho de ENVIO que alcance esta linha morre alto com
 * "Unknown provider" — fail-closed, correto até a fatia 2.
 *
 * Sempre devolve JSON: `{ instance_id, channel_id, phone_number, status }` no
 * sucesso, ou `{ error, code }` com código de máquina no erro.
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
  readClaimedChannelId,
  NotificameError,
} from "../_shared/notificame.ts";
import { loadNotificameSubaccount } from "../_shared/notificame-credentials.ts";
import {
  readConnectSession,
  finalizeConnectSession,
  type ConnectSessionState,
} from "../_shared/notificame-sessions.ts";

const FUNCTION_NAME = "notificame-channel-finish";

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

interface BoundInstance {
  id: string;
  channelId: string;
  phoneNumber: string | null;
  status: string | null;
}

/**
 * Canais NotificaMe já vinculados por ESTA org, indexados por `channel_id`.
 *
 * COM `.eq('organization_id')`: sob subconta, a lista de canais já é da org, e
 * perguntar por canais de outros tenants seria leitura cross-tenant com
 * service_role sem nenhum ganho. O índice único GLOBAL segue sendo a última
 * linha de defesa contra atribuição errada.
 *
 * Devolve o mapa, e não só os ids, porque as duas rotas idempotentes (sessão já
 * fechada e corrida perdida no índice único) precisam DEVOLVER a linha existente,
 * não apenas saber que ela existe.
 */
async function loadBoundInstances(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ ok: true; byChannel: Map<string, BoundInstance> } | { ok: false; message: string }> {
  const { data, error } = await admin
    .from("whatsapp_instances")
    .select("id, phone_number, status, provider_config")
    .eq("organization_id", organizationId)
    .eq("provider", "notificame");

  if (error) return { ok: false, message: error.message };

  const byChannel = new Map<string, BoundInstance>();
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const channelId = readClaimedChannelId(raw.provider_config);
    if (!channelId) continue;
    byChannel.set(channelId, {
      id: String(raw.id),
      channelId,
      phoneNumber: (raw.phone_number as string | null) ?? null,
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
    /provider_config\s*->>\s*'channel_id'/i.test(text)
  ) {
    return "channel";
  }

  if (
    /whatsapp_instances_organization_id_instance_name_key/i.test(text) ||
    /\(\s*organization_id\s*,\s*instance_name\s*\)/i.test(text)
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

  /** 200 com a linha vinculada. `idempotent` marca as rotas de replay. */
  const boundResponse = (params: {
    instanceId: string;
    channelId: string;
    phoneNumber: string | null;
    status: string | null;
    idempotent?: boolean;
  }) =>
    new Response(
      JSON.stringify({
        instance_id: params.instanceId,
        channel_id: params.channelId,
        phone_number: params.phoneNumber,
        status: params.status,
        ...(params.idempotent ? { idempotent: true } : {}),
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

  // ── 2. Lista os canais DA SUBCONTA (decide pelo CORPO, nunca por res.ok) ───
  const orgCfg = orgConfigFrom(parent.baseUrl, subaccount.companyUuid);
  let channels;
  try {
    channels = await listChannels(orgCfg, fetch);
  } catch (e) {
    if (e instanceof NotificameError) {
      // Código estável + mensagem NOSSA. O corpo do fornecedor não atravessa.
      return new Response(JSON.stringify({ error: e.message, code: e.code }), {
        status: 502,
        headers,
      });
    }
    throw e;
  }

  // ── 3. Canais já reivindicados por ESTA org ────────────────────────────────
  const bound = await loadBoundInstances(admin, orgId);
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
  if (session?.state === "finished") {
    const fromThisSession = channels.filter(
      (c) => !baseline!.has(c.id) && bound.byChannel.has(c.id),
    );

    if (fromThisSession.length === 1) {
      const instance = bound.byChannel.get(fromThisSession[0].id)!;
      await logRuntime({
        organizationId: orgId,
        module: "channel",
        action: "notificame.channel_bound",
        status: "success",
        entityType: "whatsapp_instance",
        entityId: instance.id,
        triggeredBy: auth.userId,
        payloadSnapshot: {
          channel_id: instance.channelId,
          phone_last4: last4(instance.phoneNumber),
          had_baseline: true,
          // Distingue o vínculo NOVO do replay. Sem isto, a trilha contaria duas
          // conexões onde houve uma.
          idempotent: true,
        },
        ...trace,
      });
      return boundResponse({
        instanceId: instance.id,
        channelId: instance.channelId,
        phoneNumber: instance.phoneNumber,
        status: instance.status,
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
      payloadSnapshot: { matches: fromThisSession.length },
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
  const pick = pickNewChannel(channels, baseline, claimedIds);
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
        payloadSnapshot: { candidates: pick.candidates, had_baseline: !!baseline },
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
  // `subaccountId` é o UUID da NOSSA linha do cofre — REFERÊNCIA, não o token.
  // `whatsapp_instances` é lida sob RLS por qualquer membro da org.
  const row = buildNotificameInstanceRow({
    organizationId: orgId,
    subaccountId: subaccount.id,
    channel: pick.channel,
  });

  const insertWithName = (instanceName: string) =>
    admin
      .from("whatsapp_instances")
      .insert({
        organization_id: row.organization_id,
        provider: row.provider,
        instance_name: instanceName,
        phone_number: row.phone_number,
        status: row.status,
        provider_config: row.provider_config,
        last_connection_at: new Date().toISOString(),
        // `instance_id` fica NULL de propósito: o id do canal tem UM dono só,
        // `provider_config->>'channel_id'`, onde mora o índice único parcial.
      })
      .select("id")
      .single();

  // Duas tentativas no MÁXIMO, e a segunda só existe para o choque de NOME: o
  // rótulo é cosmético e o canal do outro lado é faturável e irremovível, então
  // desistir do vínculo por causa dele seria trocar um problema de exibição por
  // um órfão permanente.
  let instanceId: string | null = null;
  let insErr: PgErrorLike | null = null;
  let usedName = row.instance_name;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await insertWithName(usedName);
    const id = (res.data as { id?: unknown } | null)?.id;
    if (!res.error && typeof id === "string" && id) {
      instanceId = id;
      insErr = null;
      break;
    }
    insErr = (res.error as PgErrorLike | null) ??
      { code: null, message: "insert returned no row" };

    if (attempt === 0 && classifyUniqueViolation(insErr) === "instance_name") {
      usedName = disambiguateInstanceName(row.instance_name, pick.channel.id);
      continue;
    }
    break;
  }

  if (!instanceId) {
    const message = insErr?.message ?? "insert failed";
    const violation = classifyUniqueViolation(insErr);

    // ── 6a. O canal já tem dono ──────────────────────────────────────────────
    if (violation === "channel") {
      // Corrida perdida para o índice único parcial. Pode ter sido a retentativa
      // ANTERIOR desta mesma conexão (a resposta se perdeu, o vínculo aconteceu):
      // relê os vínculos DESTA org e, se o dono somos nós, isto é sucesso, não
      // erro. Só quando o dono é outra org é que o índice cumpriu o papel de
      // impedir que mensagens de um tenant fossem parar em outro.
      const recheck = await loadBoundInstances(admin, orgId);
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
            phone_last4: last4(mine.phoneNumber),
            had_baseline: !!baseline,
            idempotent: true,
          },
          ...trace,
        });
        return boundResponse({
          instanceId: mine.id,
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
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { channel_id: pick.channel.id },
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
        errorMessage: "nome de instância já usado nesta organização",
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { channel_id: pick.channel.id, attempted_name: usedName },
        ...trace,
      });
      return new Response(
        JSON.stringify({
          error:
            "Já existe um número com esse nome nesta organização. Renomeie o número existente e tente de novo.",
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
        entityType: "whatsapp_instance",
        triggeredBy: auth.userId,
        payloadSnapshot: { channel_id: pick.channel.id },
        ...trace,
      });
      return new Response(
        JSON.stringify({
          error: "Não foi possível registrar este número",
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
    entityType: "whatsapp_instance",
    entityId: instanceId,
    triggeredBy: auth.userId,
    payloadSnapshot: {
      channel_id: pick.channel.id,
      phone_last4: last4(row.phone_number),
      // QUAL regra decidiu o vínculo. Sem isto, um vínculo errado no futuro seria
      // indistinguível entre "a baseline estava errada" e "não havia baseline".
      had_baseline: !!baseline,
      // Rótulo desambiguado por colisão de nome — some da trilha quando não houve.
      ...(usedName !== row.instance_name ? { renamed_to: usedName } : {}),
    },
    ...trace,
  });

  return boundResponse({
    instanceId,
    channelId: pick.channel.id,
    phoneNumber: row.phone_number,
    status: row.status,
  });
}));
