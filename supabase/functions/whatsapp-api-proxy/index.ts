// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-api-proxy — Edge Function
 *
 * ONLY entry point for the frontend to manage WhatsApp instances.
 * Enforces:
 *  1. Valid JWT authentication (Supabase Auth)
 *  2. Tenant isolation — instance must belong to caller's org
 *  3. Rate limit — 60 req/min per org (in-memory; Phase 2 migrates to KV)
 *  4. Service role token never reaches client
 *  5. Error messages sanitised — no stack traces leaked
 *
 * Phase 1 actions: createInstance, getStatus, connectQR, deleteInstance, logoutInstance
 * Phase 3 adds: sendText, sendMedia (via senders)
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isOrgBlocked } from "../_shared/org-status.ts";
import { assertPlanFeature, PlanFeatureDeniedError, planDeniedResponse } from "../_shared/plan-gate.ts";
import {
  getWhatsAppProvider,
  type WhatsAppInstance,
} from "../_shared/whatsapp-client.ts";
import { isActiveGestorForOrg } from "../_shared/gestor-auth.ts";
import {
  extractChatTarget,
  isChatTargetAllowed,
} from "../_shared/chat-owner-guard.ts";
import { readTemplateRequest } from "../_shared/whatsapp-template-request.ts";
import {
  espelharMidiaDosComponentes,
} from "../_shared/mirror-template-media.ts";
import {
  nullifyInBatches,
  type BatchNullifyIO,
} from "../_shared/whatsapp-instance-teardown.ts";

// Force bundler to include provider modules (used via dynamic import in
// whatsapp-client). meta-cloud is force-imported too so the human composer can
// send via a meta_cloud instance without a runtime dynamic-import miss in the
// eszip (REALSC incident class — CERTIFICATION Rule 15).
import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";
import "../_shared/whatsapp-providers/meta-cloud-provider.ts";
// notificame idem: o canal OFICIAL (API da Meta via NotificaMe) é resolvido em
// `whatsapp-client.ts:336` pelo mesmo `await import()` dinâmico. Sem esta linha o
// eszip não carrega o módulo e o envio da caixa oficial morre em runtime — a
// mesma classe de incidente que pôs o meta-cloud nesta lista.
import "../_shared/whatsapp-providers/notificame-provider.ts";

// ---------------------------------------------------------------------------
// Rate limit state (in-memory, per org)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

/**
 * Devolve `count` e `resetAt` junto do veredito porque um 429 sozinho não diz
 * NADA sobre o que fazer: o balde é por org e por isolate, então o mesmo clique
 * passa ou apanha conforme quem atendeu. Saber quanto do minuto ainda falta é a
 * diferença entre "o inbox desta org satura o teto" e "o teto está baixo".
 */
function checkRateLimit(
  orgId: string
): { allowed: boolean; count: number; resetAt: number } {
  const now = Date.now();
  const rl = rateLimitState.get(orgId);
  if (rl && rl.resetAt > now) {
    if (rl.count >= RATE_LIMIT_MAX) {
      return { allowed: false, count: rl.count, resetAt: rl.resetAt };
    }
    rl.count += 1;
    return { allowed: true, count: rl.count, resetAt: rl.resetAt };
  }
  const fresh = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  rateLimitState.set(orgId, fresh);
  return { allowed: true, count: fresh.count, resetAt: fresh.resetAt };
}

// ---------------------------------------------------------------------------
// Guarda de ordem de deploy — estado de `whatsapp_messages_instance_id_fkey`
// ---------------------------------------------------------------------------

/**
 * `present` = a FK ainda existe (ou não deu para saber). `dropped` = provado
 * que não existe mais.
 */
type WhatsAppMessagesFkState = "present" | "dropped";

/**
 * Cache no isolate. Assimétrico de propósito:
 *
 *  - `dropped` é TERMINAL e vale para sempre. A FK não volta: recriá-la exige
 *    `ADD CONSTRAINT`, que valida as 2,3M linhas contra órfãs que já violam a
 *    referência — a própria migration documenta que recriar é recriar o bug.
 *  - `present` expira em `FK_PRESENT_RECHECK_MS`, porque um isolate vivo desde
 *    ANTES do apply da migration precisa enxergar o DROP sem esperar reciclagem.
 *    Sem TTL, a guarda protegeria só isolates novos.
 */
let fkProbeCache: { state: WhatsAppMessagesFkState; at: number } | null = null;
const FK_PRESENT_RECHECK_MS = 60_000;

/**
 * Uuid que nunca casa com linha nenhuma. `whatsapp_messages.id` é uuid, então
 * este literal é aceito pelo parser (um valor de outro tipo viraria `22P02` e
 * mascararia o `PGRST200` que interessa) e resolve por PK sem ler dado.
 */
const FK_PROBE_SENTINEL_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Descobre, em runtime, se `whatsapp_messages_instance_id_fkey` ainda existe.
 *
 * Por que uma guarda em runtime, e não um comentário
 * --------------------------------------------------
 * O DROP da FK é a migration `20270811000010_whatsapp_messages_drop_instance_fk.sql`,
 * passo MANUAL; o deploy desta função é outro passo MANUAL. Um comentário
 * dizendo "aplique a migration antes" só vale enquanto alguém lê e obedece. Se
 * o proxy subir primeiro já tendo parado de limpar `whatsapp_messages`, o
 * DELETE da instância entrega as linhas ao `ON DELETE SET NULL` num statement
 * único — ~155k só na Alamaster — e estoura o statement timeout: a falha que
 * derrubou 34 de 95 exclusões. Perguntando, as duas ordens de deploy ficam
 * seguras e o passo 2 deixa de depender do passo 1.
 *
 * Como se pergunta sem `pg_constraint`
 * ------------------------------------
 * `pg_constraint` não é legível por PostgREST (fora dos schemas expostos), e o
 * único executor de SQL cru do projeto (`mcp_exec_readonly_sql`) é master-only
 * — service_role não passa no `is_master_user()`. Sobra o MESMO catálogo por
 * outro caminho: o grafo de relações do PostgREST é derivado de
 * `pg_constraint`, e um embed que cita a constraint PELO NOME responde 200 se
 * ela existe e `PGRST200` ("Could not find a relationship") se não existe.
 *
 * O `PGRST200` é levantado ao MONTAR a query, a partir do schema cache, antes de
 * executar — por isso o probe filtra por um uuid sentinela que nunca casa: zero
 * linha lida, zero PII em memória, e a validação do relacionamento acontece
 * igual. E é um GET, não um HEAD: resposta HEAD não tem corpo, então um
 * `PGRST200` viria sem `code` nem `message` e o probe travaria em "unknown"
 * para sempre — exatamente o modo de falha que ele existe para evitar.
 *
 * Qual é o lado seguro na dúvida
 * ------------------------------
 * Manter o nullify — e a assimetria é real, não covardia. Com a FK viva o banco
 * vai anular essas linhas no instante do DELETE de qualquer forma; o lote não
 * causa perda que o schema já não imponha, só troca um statement gigante por
 * vários curtos. Pular por engano não compra nada e ressuscita o timeout. Por
 * isso só um `PGRST200` explícito autoriza pular: erro desconhecido, exceção ou
 * resposta estranha caem em `present`.
 *
 * ⚠️ `unknown` PERMANENTE depois da migration aplicada inverte o sinal — aí o
 * nullify volta a apagar histórico. Por isso toda dúvida emite log de erro:
 * `delete_instance_fk_probe_failed` recorrente é para ser investigado, não
 * tolerado.
 */
async function whatsappMessagesFkState(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  orgId: string | null
): Promise<WhatsAppMessagesFkState> {
  const cached = fkProbeCache;
  if (cached) {
    if (cached.state === "dropped") return "dropped";
    if (Date.now() - cached.at < FK_PRESENT_RECHECK_MS) return "present";
  }

  try {
    const { error } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, whatsapp_instances!whatsapp_messages_instance_id_fkey(id)")
      .eq("id", FK_PROBE_SENTINEL_ID)
      .limit(1);

    if (!error) {
      fkProbeCache = { state: "present", at: Date.now() };
      return "present";
    }

    const relationshipGone =
      error.code === "PGRST200" ||
      /could not find a relationship/i.test(error.message ?? "");

    if (relationshipGone) {
      fkProbeCache = { state: "dropped", at: Date.now() };
      return "dropped";
    }

    // Só o `code` — a mensagem do PostgREST pode ecoar conteúdo da linha.
    await logRuntime({
      organizationId: orgId ?? undefined,
      module: "whatsapp",
      action: "delete_instance_fk_probe_failed",
      status: "error",
      entityType: "whatsapp_messages",
      errorMessage: `probe inconclusivo (${error.code ?? "sem code"}); mantendo o nullify de whatsapp_messages`,
    });
    return "present";
  } catch (e) {
    await logRuntime({
      organizationId: orgId ?? undefined,
      module: "whatsapp",
      action: "delete_instance_fk_probe_failed",
      status: "error",
      entityType: "whatsapp_messages",
      errorMessage: `probe lançou (${(e as Error).name ?? "erro"}); mantendo o nullify de whatsapp_messages`,
    });
    return "present";
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Porta fechada — 4xx que o roteamento nunca chega a ver
// ---------------------------------------------------------------------------

type DenyContext = {
  /** Ação pedida, quando o corpo já foi lido. */
  action?: string;
  organizationId?: string;
  /** `auth.users.id` de quem pediu — quem apanhou da porta. */
  userId?: string;
  instanceId?: string;
  /** Contexto do motivo. NUNCA dado de lead: isto vai para `runtime_logs`. */
  detail?: string;
};

/**
 * Devolve um 4xx de porta E registra a recusa em `runtime_logs`.
 *
 * O `catch` no fim do handler já registra tudo que ESTOURA dentro do
 * roteamento. O que não deixava rastro era o oposto: a requisição barrada
 * ANTES dele — plano, assinatura, tenant, rate limit —, que volta por `return`
 * e some.
 *
 * Isso não é hipótese. Investigando "o cliente não consegue criar instância"
 * (Mapila Alimentos, 2026-08-31), `runtime_logs` tinha ZERO linhas de
 * `createInstance` com `status='error'` em 14 dias, em 107 orgs. A leitura
 * ingênua desse zero — "então não falhou" — é a leitura errada, e ela custou o
 * diagnóstico inteiro: a falha só podia estar nas portas, e as portas eram
 * mudas. Um zero só é evidência quando o caminho que produziria a linha existe.
 *
 * Convenção do nome: `<action>:denied`, para que filtrar por ação continue
 * achando o fluxo (`action LIKE 'createInstance%'`) e o motivo estável more em
 * `payload_snapshot.reason` — agrupável, ao contrário de texto livre.
 *
 * Custo assumido: uma escrita por requisição recusada, no caminho quente da
 * recusa. Sob rajada de 429 isso multiplica INSERTs — e é aceito de propósito,
 * porque uma rajada de recusa é precisamente o evento que ninguém consegue ver
 * hoje. Se virar volume, a saída é amostrar aqui, não voltar ao silêncio.
 *
 * ⚠️ Requisição NÃO autenticada (401) fica de fora por decisão: escrita
 * disparável por quem não provou identidade é amplificação controlada pelo
 * atacante. Da resolução de org em diante, todo `return` de porta passa aqui.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function denied(
  httpStatus: number,
  reason: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  ctx: DenyContext = {}
): Promise<Response> {
  // `entity_id` é uuid na tabela e o valor vem do CORPO da requisição — em
  // "instancia_inexistente", que é justamente quando ele costuma vir torto, um
  // id malformado faria o INSERT estourar 22P02. `logRuntime` engole a falha
  // por design, então o efeito seria perder a linha exatamente no caso que ela
  // existe para registrar. Fora do formato, o id vai como texto no `detail`.
  const entityId =
    ctx.instanceId && UUID_RE.test(ctx.instanceId) ? ctx.instanceId : undefined;
  const detail =
    ctx.instanceId && !entityId
      ? [ctx.detail, `instance_id malformado: ${ctx.instanceId.slice(0, 64)}`]
          .filter(Boolean)
          .join(" — ")
      : ctx.detail;

  await logRuntime({
    organizationId: ctx.organizationId,
    module: "whatsapp",
    action: `${ctx.action ?? "unknown"}:denied`,
    status: "error",
    errorMessage: detail
      ? `${httpStatus} ${reason} — ${detail}`
      : `${httpStatus} ${reason}`,
    entityType: entityId ? "whatsapp_instances" : undefined,
    entityId,
    triggeredBy: ctx.userId,
    payloadSnapshot: { http_status: httpStatus, reason },
  });
  return jsonResponse(httpStatus, body, headers);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(
  withErrorBoundary("whatsapp-api-proxy", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const corsHeaders = withSecurityHeaders(
      getCorsHeaders(origin) as Record<string, string>
    );

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" }, corsHeaders);
    }

    // -------------------------------------------------------------------------
    // 1. Authenticate — validate JWT via Supabase
    // -------------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Missing auth" }, corsHeaders);
    }
    const userJwt = authHeader.slice(7);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userErr } =
      await supabaseUser.auth.getUser(userJwt);

    if (userErr || !userData?.user) {
      return jsonResponse(401, { error: "Invalid token" }, corsHeaders);
    }
    const user = userData.user;

    // -------------------------------------------------------------------------
    // 2. Parse body (needed before org resolution for master targeting)
    // -------------------------------------------------------------------------
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return await denied(400, "invalid_json", { error: "Invalid JSON body" }, corsHeaders, {
        userId: user.id,
      });
    }

    const action = body?.action;
    if (!action || typeof action !== "string") {
      return await denied(400, "missing_action", { error: "Missing action" }, corsHeaders, {
        userId: user.id,
      });
    }

    const instanceId = body?.instance_id as string | undefined;
    const payload = (body?.payload ?? {}) as Record<string, unknown>;
    const targetOrgId = (body?.organization_id ?? payload?.organization_id) as
      | string
      | undefined;

    // -------------------------------------------------------------------------
    // 3. Resolve caller's organization_id with master bypass
    // -------------------------------------------------------------------------
    const { data: masterRow } = await supabaseAdmin
      .from("master_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    const isMaster = !!masterRow;

    let callerOrgId: string;
    // NULL quando o ator não tem cadeira na org alvo (Master, Gestor de
    // Portfólio): a mensagem sai, apenas sem autor.
    let callerTeamMemberId: string | null = null;

    if (isMaster) {
      // Master can act on any org. Require explicit target so we never assume.
      if (!targetOrgId) {
        return await denied(
          400,
          "master_sem_org_alvo",
          { error: "Master must provide organization_id" },
          corsHeaders,
          { action, userId: user.id, instanceId }
        );
      }
      const { data: orgRow } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .eq("id", targetOrgId)
        .maybeSingle();
      if (!orgRow) {
        return await denied(
          404,
          "org_inexistente",
          { error: "Organization not found" },
          corsHeaders,
          { action, organizationId: targetOrgId, userId: user.id, instanceId }
        );
      }
      callerOrgId = targetOrgId;
    } else if (
      targetOrgId &&
      (await isActiveGestorForOrg(supabaseAdmin, user.id, targetOrgId))
    ) {
      // Gestor de Portfólio (scoped master — ADR-0021 §6): ator fora de
      // team_members com escrita operacional full nas orgs vinculadas. Como o
      // Master, precisa de organization_id explícito e só alcança orgs às quais
      // está vinculado. Enviar mensagem é operação → liberado.
      callerOrgId = targetOrgId;
    } else {
      const { data: userOrg, error: orgErr } = await supabaseAdmin
        .from("team_members")
        .select("id, organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (orgErr || !userOrg?.organization_id) {
        // `orgErr` e "sem linha" chegam aqui pela MESMA porta e não são a mesma
        // coisa: `maybeSingle()` devolve erro (PGRST116) quando o usuário tem
        // MAIS DE UMA linha ativa em `team_members` — o proxy inteiro morre para
        // ele, e o 403 diz "No organization", que é o oposto do problema. O
        // código do PostgREST separa os dois casos sem mudar o contrato.
        return await denied(
          403,
          orgErr ? "team_member_ambiguo" : "sem_team_member_ativo",
          { error: "No organization" },
          corsHeaders,
          {
            action,
            userId: user.id,
            instanceId,
            detail: orgErr ? `postgrest ${orgErr.code ?? "sem code"}` : undefined,
          }
        );
      }
      callerOrgId = userOrg.organization_id;
      // Autoria da mensagem enviada (SCRUM-593, ADR-0033 §4). Viaja com o
      // envio em `track_id` e volta no webhook — não há backfill, e casar dois
      // espaços de id depois já rendeu zero coincidências nesta base.
      callerTeamMemberId = userOrg.id;

      // If a target org was supplied, it must match the user's own org —
      // prevents a regular user from acting on another tenant via the param.
      if (targetOrgId && targetOrgId !== callerOrgId) {
        return await denied(
          403,
          "cross_tenant",
          { error: "Cannot target a different organization" },
          corsHeaders,
          { action, organizationId: callerOrgId, userId: user.id, instanceId }
        );
      }
    }

    // -------------------------------------------------------------------------
    // 3.5 Gate de assinatura — org bloqueada não opera WhatsApp
    // -------------------------------------------------------------------------
    // Este proxy é o caminho MANUAL (a pessoa mandando pelo inbox) e não passa
    // pelo choke `governSend`, então precisa do gate próprio. A tela já está
    // bloqueada para org suspensa, mas a sessão continua autenticada e o
    // endpoint é alcançável com o token que a pessoa já tem.
    // Master passa por fora, como no plan gate logo abaixo.
    if (!isMaster && (await isOrgBlocked(supabaseAdmin, callerOrgId))) {
      return await denied(
        402,
        "subscription_blocked",
        {
          error: "subscription_blocked",
          message: "Assinatura da organização suspensa.",
        },
        corsHeaders,
        { action, organizationId: callerOrgId, userId: user.id, instanceId }
      );
    }

    // -------------------------------------------------------------------------
    // 4. Rate limit (per org)
    // -------------------------------------------------------------------------
    const rate = checkRateLimit(callerOrgId);
    if (!rate.allowed) {
      return await denied(
        429,
        "rate_limit",
        { error: "Rate limit exceeded" },
        corsHeaders,
        {
          action,
          organizationId: callerOrgId,
          userId: user.id,
          instanceId,
          detail:
            `${rate.count}/${RATE_LIMIT_MAX} por min neste isolate, ` +
            `janela reabre em ${Math.max(0, rate.resetAt - Date.now())}ms`,
        }
      );
    }

    // -------------------------------------------------------------------------
    // 4.5 Plan gate — chat fora do plano → 403 (master opera qualquer org)
    // -------------------------------------------------------------------------
    if (!isMaster) {
      try {
        await assertPlanFeature(supabaseAdmin, callerOrgId, "chat");
      } catch (e) {
        if (e instanceof PlanFeatureDeniedError) {
          // A resposta continua sendo a do plan-gate (contrato do corpo: error +
          // feature + plan). Só o registro é nosso.
          await logRuntime({
            organizationId: callerOrgId,
            module: "whatsapp",
            action: `${action}:denied`,
            status: "error",
            errorMessage: `403 plan_feature — ${e.featureKey} fora do plano '${e.planName ?? "desconhecido"}'`,
            triggeredBy: user.id,
            payloadSnapshot: { http_status: 403, reason: "plan_feature", feature: e.featureKey },
          });
          return planDeniedResponse(e, corsHeaders);
        }
        // Não é recusa de plano: é o gate que não conseguiu decidir (RPC fora).
        // Sobe para o error boundary como antes — mas deixa a linha, porque este
        // ramo derruba TODA ação do proxy e é o mais fácil de confundir com
        // "o WhatsApp caiu".
        await logRuntime({
          organizationId: callerOrgId,
          module: "whatsapp",
          action: `${action}:denied`,
          status: "error",
          errorMessage: `500 plan_gate_indisponivel — ${(e as Error).message}`,
          triggeredBy: user.id,
          payloadSnapshot: { http_status: 500, reason: "plan_gate_indisponivel" },
        });
        throw e;
      }
    }

    // -------------------------------------------------------------------------
    // 5. Action routing
    // -------------------------------------------------------------------------
    try {
      // -----------------------------------------------------------------------
      // createInstance — does not require existing instance_id
      // -----------------------------------------------------------------------
      if (action === "createInstance") {
        const instanceName = payload.instance_name as string | undefined;
        if (!instanceName) {
          return await denied(
            400,
            "sem_instance_name",
            { error: "Missing payload.instance_name" },
            corsHeaders,
            { action, organizationId: callerOrgId, userId: user.id }
          );
        }

        console.log(`[createInstance] start: name=${instanceName} org=${callerOrgId}`);

        // Resolve provider: org override > payload > default uazapi
        let targetProvider: "uazapi" | "evolution" = "uazapi";
        try {
          const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("whatsapp_provider_override")
            .eq("id", callerOrgId)
            .maybeSingle();
          const override = (org as any)?.whatsapp_provider_override as
            | "uazapi"
            | "evolution"
            | null;
          if (override === "uazapi" || override === "evolution") {
            targetProvider = override;
          }
        } catch {
          // Fall back to default (uazapi)
        }

        console.log(`[createInstance] provider=${targetProvider}`);

        const webhookBaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const webhookSecret = Deno.env.get("UAZAPI_WEBHOOK_SECRET") ?? "";

        console.log(`[createInstance] webhookBaseUrl=${webhookBaseUrl ? "set" : "EMPTY"} webhookSecret=${webhookSecret ? "set" : "EMPTY"}`);

        // Insert row first to obtain a stable UUID
        const { data: newRow, error: insertErr } = await supabaseAdmin
          .from("whatsapp_instances")
          .insert({
            organization_id: callerOrgId,
            instance_name: instanceName,
            provider: targetProvider,
            status: "connecting",
          })
          .select("*")
          .single();

        if (insertErr || !newRow) {
          console.error(`[createInstance] DB insert failed: ${insertErr?.message}`);
          throw new Error(
            `Failed to create whatsapp_instances row: ${insertErr?.message}`
          );
        }

        const instance = newRow as WhatsAppInstance;
        console.log(`[createInstance] DB row created: ${instance.id}`);

        // Bootstrap: new instance has no credentials yet — factory skips credential lookup
        const provider = await getWhatsAppProvider(instance, supabaseAdmin, { bootstrap: true });
        console.log(`[createInstance] provider initialized: ${provider.provider}`);

        let result;
        try {
          result = await provider.createInstance({
            instance_id: instance.id,
            organization_id: callerOrgId,
            instance_name: instanceName,
            webhook_url: `${webhookBaseUrl}/functions/v1/whatsapp-webhook`,
            webhook_secret: webhookSecret,
          });
          console.log(`[createInstance] provider.createInstance OK: status=${JSON.stringify(result.status)}`);
        } catch (initErr) {
          console.error(`[createInstance] provider.createInstance FAILED: ${(initErr as Error).message}`);
          // Roll back the placeholder row so the unique
          // (organization_id, instance_name) constraint does not block retries.
          await supabaseAdmin
            .from("whatsapp_instances")
            .delete()
            .eq("id", instance.id);
          throw initErr;
        }

        // Update status from provider response
        await supabaseAdmin
          .from("whatsapp_instances")
          .update({ status: result.status.connected ? "connected" : "connecting" })
          .eq("id", instance.id);

        await logRuntime({
          organizationId: callerOrgId,
          module: "whatsapp",
          action: "createInstance",
          status: "success",
          entityType: "whatsapp_instances",
          entityId: instance.id,
        });

        console.log(`[createInstance] complete: instance_id=${instance.id}`);
        return jsonResponse(200, { ok: true, result, instance_id: instance.id }, corsHeaders);
      }

      // -----------------------------------------------------------------------
      // All other actions require instance_id + tenant check
      // -----------------------------------------------------------------------
      if (!instanceId) {
        return await denied(
          400,
          "sem_instance_id",
          { error: "Missing instance_id" },
          corsHeaders,
          { action, organizationId: callerOrgId, userId: user.id }
        );
      }

      const { data: instance, error: instErr } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("*")
        .eq("id", instanceId)
        .maybeSingle();

      if (instErr || !instance) {
        // A fronteira de tenant (logo abaixo) e a de existência devolvem coisas
        // diferentes e falham por motivos diferentes; `instErr` separa "a linha
        // não existe" de "a leitura quebrou".
        return await denied(
          404,
          instErr ? "leitura_da_instancia_falhou" : "instancia_inexistente",
          { error: "Instance not found" },
          corsHeaders,
          {
            action,
            organizationId: callerOrgId,
            userId: user.id,
            instanceId,
            detail: instErr ? `postgrest ${instErr.code ?? "sem code"}` : undefined,
          }
        );
      }

      // CRITICAL: tenant boundary check
      if ((instance as WhatsAppInstance).organization_id !== callerOrgId) {
        await logRuntime({
          organizationId: callerOrgId,
          module: "whatsapp",
          action: "cross_tenant_attempt",
          status: "error",
          payloadSnapshot: {
            caller_org: callerOrgId,
            instance_org: (instance as WhatsAppInstance).organization_id,
            user_id: user.id,
            action,
            instance_id: instanceId,
          },
        });
        return jsonResponse(403, { error: "Forbidden" }, corsHeaders);
      }

      // -----------------------------------------------------------------------
      // 4.7 Gate de escrita por responsável (#1635)
      //
      // A checagem acima é de ORG. Esta é de RESPONSÁVEL: com a política
      // chat_restrict_to_owner ligada, o membro não-admin só age sobre a
      // conversa dos leads de que é responsável.
      //
      // Fica AQUI, num choke único depois da fronteira de org e antes do
      // switch, e não replicado ação a ação — as 13 ações com alvo estão
      // enumeradas em _shared/chat-owner-guard.ts. O veredito é do banco:
      // normalização de telefone e leitura do message_id moram junto do
      // predicado.
      //
      // Master já é liberado pelo próprio predicado; a chamada usa o client do
      // USUÁRIO porque can_see_chat_scope depende de auth.uid().
      // -----------------------------------------------------------------------
      {
        const target = extractChatTarget(action, payload);
        if (target) {
          const allowed = await isChatTargetAllowed(
            supabaseUser,
            callerOrgId,
            instanceId,
            target,
          );
          if (!allowed) {
            await logRuntime({
              organizationId: callerOrgId,
              module: "whatsapp",
              action: "chat_owner_denied",
              status: "error",
              payloadSnapshot: {
                user_id: user.id,
                action,
                instance_id: instanceId,
                lead_id: target.leadId,
                message_id: target.messageId,
              },
            });
            return jsonResponse(
              403,
              { error: "Forbidden", reason: "chat_owner" },
              corsHeaders,
            );
          }
        }
      }

      // -----------------------------------------------------------------------
      // deleteInstance — handled before getWhatsAppProvider because orphan
      // instances (failed createInstance) have no provider credentials.
      // -----------------------------------------------------------------------
      if (action === "deleteInstance") {
          console.log(`[deleteInstance] starting for instance=${instanceId} org=${callerOrgId}`);

          // A REMOÇÃO no provider não acontece mais aqui (#1476).
          //
          // Antes era best-effort: quando falhava, a linha do CRM era apagada de
          // qualquer forma e o token morria em CASCADE — instância órfã
          // inalcançável para sempre. E o pior caminho (apagar uma org, que
          // cascateia no Postgres) nunca passava por aqui. Agora um trigger grava
          // a lápide (#1475) antes de qualquer linha morrer, e o coletor remove no
          // provider com retry — cobrindo TODOS os caminhos de exclusão com um
          // caminho único, que por isso é exercitado em 100% delas.
          //
          // O `disconnect` CONTINUA síncrono, e de propósito: ele não deleta nada,
          // libera a sessão do dispositivo vinculado. Sem isso o aparelho antigo
          // segue competindo com a próxima instância pareada e reaparece o
          // flapping "401 logged out from another device" — incidente já corrigido
          // que não pode voltar por causa dos minutos até o coletor rodar. A
          // falha dele é inofensiva: o coletor ainda vai deletar.
          let providerError: string | null = null;
          const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
            Promise.race([
              p,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`${label} timed out (5s)`)), 5000)
              ),
            ]);
          try {
            const provider = await getWhatsAppProvider(
              instance as WhatsAppInstance,
              supabaseAdmin
            );
            await withTimeout(provider.logoutInstance(), "provider disconnect");
            console.log(`[deleteInstance] provider session disconnected`);
          } catch (e) {
            // Sessão não liberada agora: o coletor ainda remove a instância, e com
            // ela a sessão. Registrado para diagnóstico, não é falha da operação.
            providerError = (e as Error).message ?? "provider disconnect skipped";
            console.log(
              `[deleteInstance] disconnect best-effort falhou (coletor assume a remoção): ${providerError}`
            );
          }

          // `whatsapp_messages` sai desta limpeza SOMENTE DEPOIS que a FK
          // `whatsapp_messages_instance_id_fkey` for dropada. Esse DROP é a
          // migration `20270811000010_whatsapp_messages_drop_instance_fk.sql`, ainda um
          // passo MANUAL — a ordem real é (1) migration em prod, (2) deploy
          // deste proxy. Nada aqui pode supor o estado (1).
          //
          // Esses dois passos ESTANCAM a perda; eles não recuperam o que já foi
          // perdido. As 385.828 linhas órfãs de antes só voltam com o script
          // `scripts/backfill-orphan-whatsapp-messages.sql`, que é OPCIONAL e
          // não está no caminho de deploy — decisão do CTO em 2026-08-11.
          //
          // Por que a saída é o conserto: enquanto existe FK ON DELETE SET NULL,
          // este nullify antecipa o cascade e desliga o histórico do chip a cada
          // exclusão de instância — o chat filtra por `instance_id`, então a
          // conversa inteira some da tela embora siga no banco (385.828 linhas
          // órfãs acumuladas). Sem a FK, `instance_id` passa a ser uuid
          // histórico da mensagem, apagar a instância não toca as 2,3M linhas, e
          // some junto a classe de statement timeout que justificava o lote
          // nessa tabela. Quem liga chip → ids históricos passa a ser a lápide
          // em `whatsapp_instance_reap_queue`.
          //
          // Quem decide não é este comentário: `whatsappMessagesFkState`
          // pergunta ao catálogo, a cada exclusão (com cache no isolate).
          // Enquanto a FK existir, `whatsapp_messages` continua na lista e o
          // comportamento é exatamente o de hoje; quando não existir mais, sai
          // sozinha. Deployar fora de ordem deixa de quebrar alguma coisa.
          //
          // `scheduled_user_messages.whatsapp_instance_id` continua com FK
          // ON DELETE SET NULL e continua sendo limpo antes do DELETE em
          // qualquer cenário: é fila de envio pendente, não histórico — perder o
          // vínculo ali não esconde conversa de ninguém, e limpar em lotes
          // curtos evita entregar tudo a um único statement de cascade.
          const fkState = await whatsappMessagesFkState(
            supabaseAdmin,
            callerOrgId
          );

          const nullifyTargets: Array<{ table: string; column: string }> = [];
          if (fkState === "present") {
            nullifyTargets.push({
              table: "whatsapp_messages",
              column: "instance_id",
            });
          }
          nullifyTargets.push({
            table: "scheduled_user_messages",
            column: "whatsapp_instance_id",
          });

          console.log(
            `[deleteInstance] whatsapp_messages FK=${fkState} → alvos: ${nullifyTargets
              .map((t) => t.table)
              .join(", ")}`
          );

          const nullifyIO: BatchNullifyIO = {
            async selectIds(table, column, value, limit) {
              const { data, error } = await supabaseAdmin
                .from(table)
                .select("id")
                .eq(column, value)
                .limit(limit);
              if (error) throw new Error(`${table} select failed: ${error.message}`);
              return (data ?? []).map((r: { id: string }) => r.id);
            },
            async nullifyByIds(table, column, ids) {
              const { error } = await supabaseAdmin
                .from(table)
                .update({ [column]: null })
                .in("id", ids);
              if (error) throw new Error(`${table} nullify failed: ${error.message}`);
            },
          };

          for (const target of nullifyTargets) {
            const outcome = await nullifyInBatches(nullifyIO, {
              ...target,
              value: instanceId,
            });
            console.log(
              `[deleteInstance] ${target.table}: cleared ${outcome.rows} rows in ${outcome.batches} batches`
            );

            // Ainda há linhas apontando pra instância. Seguir entregaria o resto
            // ao cascade — o statement único que o lote existe pra evitar.
            // Melhor parar e ser repetido do que falhar de forma opaca no
            // DELETE.
            if (outcome.hitBatchCeiling) {
              await logRuntime({
                organizationId: callerOrgId,
                module: "whatsapp",
                action: "deleteInstance",
                status: "error",
                entityType: "whatsapp_instances",
                entityId: instanceId,
                errorMessage: `${target.table} not drained after ${outcome.batches} batches (${outcome.rows} rows cleared); retry to continue`,
              });
              return jsonResponse(
                503,
                {
                  error:
                    "Exclusão em andamento: muitas mensagens vinculadas. Tente novamente para continuar.",
                  partial: { table: target.table, rows: outcome.rows },
                },
                corsHeaders
              );
            }
          }

          await supabaseAdmin
            .from("whatsapp_conversations")
            .delete()
            .eq("instance_id", instanceId);

          const { error: deleteErr } = await supabaseAdmin
            .from("whatsapp_instances")
            .delete()
            .eq("id", instanceId);

          console.log(`[deleteInstance] DB delete result: error=${deleteErr?.message ?? "none"}`);

          if (deleteErr) {
            await logRuntime({
              organizationId: callerOrgId,
              module: "whatsapp",
              action: "deleteInstance",
              status: "error",
              entityType: "whatsapp_instances",
              entityId: instanceId,
              errorMessage: deleteErr.message,
            });
            return jsonResponse(500, { error: `DB delete failed: ${deleteErr.message}` }, corsHeaders);
          }

          // Verify row is actually gone
          const { data: verifyRow } = await supabaseAdmin
            .from("whatsapp_instances")
            .select("id")
            .eq("id", instanceId)
            .maybeSingle();

          if (verifyRow) {
            console.error(`[deleteInstance] CRITICAL: row still exists after delete! instance=${instanceId}`);
            return jsonResponse(500, { error: "Delete failed: row still exists" }, corsHeaders);
          }

          console.log(`[deleteInstance] verified row deleted successfully`);

          await logRuntime({
            organizationId: callerOrgId,
            module: "whatsapp",
            action: "deleteInstance",
            status: "success",
            entityType: "whatsapp_instances",
            entityId: instanceId,
            ...(providerError && { errorMessage: providerError }),
          });

          return jsonResponse(200, { ok: true, providerError }, corsHeaders);
      }

      // -----------------------------------------------------------------------
      // Etapa B — vínculo user-instância (flag user_write_instance_strict).
      //
      // Para ações de envio (sendText/sendMedia/sendAudio/sendTemplate) que carregam
      // `payload.lead_id` opcional: se a flag está ON na org, exigir
      //   (a) responsible_user_id do lead → instância vinculada == instance_id
      //   (b) caller pode escrever via instância (owner / admin / master)
      //
      // Quando lead_id ausente, comportamento legado é preservado.
      // Frontend (Etapa C) passa a anexar lead_id no composer humano.
      // -----------------------------------------------------------------------
      const SEND_ACTIONS = new Set([
        "sendText",
        "sendMedia",
        "sendAudio",
        "sendTemplate",
        "sendMenu",
        "sendLocation",
        "sendContact",
        // Bloquear e desbloquear endereçam um contato — mesmo crivo. `listBlocked`
        // e `numberHealth` NÃO entram: eles não têm destinatário nenhum.
        "blockUser",
        "unblockUser",
      ]);
      const leadIdPayload = (payload?.lead_id ?? null) as string | null;
      if (SEND_ACTIONS.has(action) && leadIdPayload) {
        const {
          isStrictWriteEnabled,
          resolveLeadWriteInstance,
          assertUserCanWriteInstance,
          WriteAuthorizationError,
        } = await import("../_shared/instance-write-guard.ts");

        const strict = await isStrictWriteEnabled(supabaseAdmin, callerOrgId);
        if (strict) {
          // (a) responsible→instância vinculada deve casar com instance_id
          const resolved = await resolveLeadWriteInstance(supabaseAdmin, leadIdPayload);
          if (!resolved.ok || !resolved.instance) {
            await logRuntime({
              organizationId: callerOrgId,
              module: "whatsapp",
              action: "strict_write_blocked",
              status: "error",
              entityType: "leads",
              entityId: leadIdPayload,
              payloadSnapshot: { error_code: resolved.errorCode, action },
            });
            return jsonResponse(
              409,
              { error: `Strict write: ${resolved.errorCode ?? "no_instance"}` },
              corsHeaders,
            );
          }
          if (resolved.instance.instanceId !== instanceId) {
            await logRuntime({
              organizationId: callerOrgId,
              module: "whatsapp",
              action: "strict_write_instance_mismatch",
              status: "error",
              entityType: "leads",
              entityId: leadIdPayload,
              payloadSnapshot: {
                expected_instance: resolved.instance.instanceId,
                provided_instance: instanceId,
              },
            });
            return jsonResponse(
              409,
              {
                error: "Strict write: lead is bound to a different instance",
                expected_instance_id: resolved.instance.instanceId,
              },
              corsHeaders,
            );
          }

          // (b) Autorização do caller sobre a instância
          try {
            await assertUserCanWriteInstance(supabaseAdmin, user.id, instanceId);
          } catch (authErr) {
            if (authErr instanceof WriteAuthorizationError) {
              await logRuntime({
                organizationId: callerOrgId,
                module: "whatsapp",
                action: "strict_write_authz_denied",
                status: "error",
                entityType: "whatsapp_instances",
                entityId: instanceId,
                payloadSnapshot: { user_id: user.id },
              });
              return jsonResponse(
                403,
                { error: "User cannot write via this instance" },
                corsHeaders,
              );
            }
            throw authErr;
          }
        }
      }

      // Guard against malformed destination numbers reaching the provider.
      // A phone that cleans down to fewer than 10 digits (empty, a
      // whitespace-only lead phone, or a lone country code like "55") makes
      // Uazapi return a 500 that surfaces to the user as the opaque "Edge
      // Function returned a non-2xx status code". Reject early with a clear,
      // actionable message instead. Defense-in-depth: the frontend already
      // blocks these in formatPhoneForWhatsApp, but mass send / workflow /
      // followup paths reach this proxy too.
      const NUMBER_ACTIONS = new Set([
        "sendText",
        "sendMedia",
        "sendAudio",
        "sendTemplate",
        "setPresence",
        // As três novas do canal oficial passam pelo mesmo crivo: um telefone
        // que limpa para menos de 10 dígitos faz o fornecedor devolver um 500
        // que chega à tela como "Edge Function returned a non-2xx status code".
        "sendMenu",
        "sendLocation",
        "sendContact",
      ]);
      if (NUMBER_ACTIONS.has(action)) {
        const rawNumber = (payload?.number ?? "") as string;
        const digits = String(rawNumber).replace(/\D/g, "");
        if (digits.length < 10) {
          await logRuntime({
            organizationId: callerOrgId,
            module: "whatsapp-api-proxy",
            action: "invalid_number_blocked",
            status: "error",
            payloadSnapshot: { action, number: rawNumber },
          });
          return jsonResponse(
            422,
            { error: "Número de telefone inválido ou ausente para este contato." },
            corsHeaders,
          );
        }
      }

      const provider = await getWhatsAppProvider(
        instance as WhatsAppInstance,
        supabaseAdmin
      );

      let result: unknown;

      switch (action) {
        case "getStatus": {
          result = await provider.getStatus();
          break;
        }

        case "connectQR": {
          const phone = payload.phone as string | undefined;
          result = await provider.connectQR(phone);
          break;
        }



        case "reconfigureWebhook": {
          const webhookBaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
          const webhookSecret = Deno.env.get("UAZAPI_WEBHOOK_SECRET") ?? "";
          if (!webhookSecret) {
            return jsonResponse(500, { error: "UAZAPI_WEBHOOK_SECRET not set" }, corsHeaders);
          }
          const webhookUrl = `${webhookBaseUrl}/functions/v1/whatsapp-webhook/${webhookSecret}`;
          if (provider.provider === "uazapi" && typeof (provider as any).reconfigureWebhook === "function") {
            await (provider as any).reconfigureWebhook(webhookUrl);
          } else {
            return jsonResponse(400, { error: "reconfigureWebhook only supported for uazapi provider" }, corsHeaders);
          }
          result = { ok: true, webhook_url: webhookUrl.replace(webhookSecret, "***") };
          break;
        }

        case "logoutInstance": {
          await provider.logoutInstance();
          // Update local status
          await supabaseAdmin
            .from("whatsapp_instances")
            .update({ status: "disconnected" })
            .eq("id", instanceId);
          result = { loggedOut: true };
          break;
        }

        // -------------------------------------------------------------------
        // Direct send actions — routed through adapter
        // -------------------------------------------------------------------
        case "sendText": {
          const { number, text, delay, replyid } = payload as {
            number?: string;
            text?: string;
            delay?: number;
            replyid?: string;
          };
          if (!number || !text) {
            return jsonResponse(400, { error: "Missing number/text" }, corsHeaders);
          }
          result = await provider.sendText({
            number,
            text,
            delay,
            replyid,
            trackSource: "whatsapp-api-proxy",
            trackId: callerTeamMemberId ?? undefined,
          });
          break;
        }

        case "sendMedia": {
          const { number, type, file, filename, caption, delay } = payload as {
            number?: string;
            type?: "image" | "video" | "document" | "audio" | "ptt" | "sticker";
            file?: string;
            filename?: string;
            caption?: string;
            delay?: number;
          };
          if (!number || !type || !file) {
            return jsonResponse(400, { error: "Missing number/type/file" }, corsHeaders);
          }
          result = await provider.sendMedia({
            number,
            type,
            file,
            filename,
            caption,
            delay,
            trackSource: "whatsapp-api-proxy",
            trackId: callerTeamMemberId ?? undefined,
          });
          break;
        }

        case "sendAudio": {
          const { number, file, delay } = payload as {
            number?: string;
            file?: string;
            delay?: number;
          };
          if (!number || !file) {
            return jsonResponse(400, { error: "Missing number/file" }, corsHeaders);
          }
          result = await provider.sendMedia({
            number,
            type: "ptt",
            file,
            delay,
            trackSource: "whatsapp-api-proxy",
            trackId: callerTeamMemberId ?? undefined,
          });
          break;
        }

        // -------------------------------------------------------------------
        // Template — a ÚNICA saída fora da janela de 24 horas.
        //
        // Passadas 24h da última mensagem do cliente, a Meta recusa texto livre.
        // Até aqui o proxy não expunha esta ação: o provider a implementa desde
        // sempre, o front lista templates, e o fio estava cortado no meio.
        // -------------------------------------------------------------------
        case "sendTemplate": {
          // 422 e não `throw`, ao contrário dos vizinhos Uazapi-only: este
          // caminho é clicado por um VENDEDOR, e um 500 genérico viraria "não foi
          // possível enviar" numa hora em que ele precisa saber que este canal
          // não tem template — não que o sistema quebrou.
          if (!provider.sendTemplate) {
            return jsonResponse(
              422,
              {
                error: "Este canal não envia template",
                code: "template_not_supported",
              },
              corsHeaders,
            );
          }

          const pedido = readTemplateRequest(payload);
          if (!pedido.ok) {
            return jsonResponse(400, { error: pedido.error }, corsHeaders);
          }

          // ─── ESPELHAR A MÍDIA DO CABEÇALHO ────────────────────────────────
          //
          // A URL que a listagem devolve para a imagem aprovada é do CDN da Meta,
          // assinada. NÓS baixamos com 200; o pipeline de envio DELA recebe 403:
          //
          //   131053 ... Downloading media from weblink failed with http code 403
          //
          // Espelhar aqui, e não no navegador, porque o CDN não manda cabeçalho de
          // CORS — o front não consegue ler os bytes. Falha no espelhamento devolve
          // a URL original: um envio que talvez funcione é melhor que um erro
          // nosso no lugar da tentativa.
          // A caminhada até o link estava escrita aqui à mão, e o caminho da
          // AUTOMAÇÃO não tinha nenhuma (#1706). Agora os dois chamam a mesma
          // função: um lugar só onde a decisão mora. Comportamento idêntico ao
          // que este bloco fazia.
          const componentesEspelhados = await espelharMidiaDosComponentes(
            pedido.value.components ?? [],
            callerOrgId,
            { storage: supabaseAdmin.storage },
          );

          result = await provider.sendTemplate({
            ...pedido.value,
            components: componentesEspelhados,
          });
          break;
        }

        // -------------------------------------------------------------------
        // Message actions — Uazapi-only.
        // -------------------------------------------------------------------
        case "react": {
          if (!provider.react) throw new Error("Provider does not support react");
          const { message_id, number, emoji } = payload as {
            message_id?: string;
            number?: string;
            emoji?: string;
          };
          // ⚠️ `emoji` VAZIO É VÁLIDO: é o comando de REMOVER a reação, e é assim
          // que a Meta desfaz. Exigi-lo aqui deixava o vendedor sem como tirar
          // uma reação que ele mesmo pôs — a ação existia só de ida.
          if (!message_id || !number || emoji === undefined) {
            return jsonResponse(400, { error: "Missing message_id/number/emoji" }, corsHeaders);
          }
          await provider.react(message_id, number, emoji);
          result = { ok: true };
          break;
        }

        case "editMessage": {
          if (!provider.edit) throw new Error("Provider does not support edit");
          const { message_id, number, text } = payload as {
            message_id?: string;
            number?: string;
            text?: string;
          };
          if (!message_id || !number || !text) {
            return jsonResponse(400, { error: "Missing message_id/number/text" }, corsHeaders);
          }
          await provider.edit(message_id, number, text);
          // Reflect locally
          await supabaseAdmin
            .from("whatsapp_messages")
            .update({ content: text })
            .eq("message_id", message_id)
            .eq("instance_id", instanceId);
          result = { ok: true };
          break;
        }

        case "pinMessage": {
          if (!provider.pin) throw new Error("Provider does not support pin");
          const { message_id, number } = payload as {
            message_id?: string;
            number?: string;
          };
          if (!message_id || !number) {
            return jsonResponse(400, { error: "Missing message_id/number" }, corsHeaders);
          }
          await provider.pin(message_id, number);
          result = { ok: true };
          break;
        }

        case "deleteMessage": {
          if (!provider.deleteForAll) throw new Error("Provider does not support deleteForAll");
          const { message_id, number } = payload as {
            message_id?: string;
            number?: string;
          };
          if (!message_id || !number) {
            return jsonResponse(400, { error: "Missing message_id/number" }, corsHeaders);
          }
          await provider.deleteForAll(message_id, number);
          // Reflect locally: usa deleted_at (a UI esconde por deleted_at, MessagePrimitives.tsx).
          // status="deleted" violava o CHECK de status (rejeição silenciosa) e nem é o campo lido.
          await supabaseAdmin
            .from("whatsapp_messages")
            .update({ deleted_at: new Date().toISOString() })
            .eq("message_id", message_id)
            .eq("instance_id", instanceId);
          result = { ok: true };
          break;
        }

        case "markRead": {
          if (!provider.markRead) throw new Error("Provider does not support markRead");
          // Aceita os dois formatos de propósito: o frontend só é redeployado à
          // mão (EasyPanel), então o build em produção continua mandando
          // `message_id` string por um tempo depois desta função subir.
          // `number` é aceito e ignorado — o endpoint da Uazapi não usa.
          const { message_id, message_ids } = payload as {
            message_id?: string;
            message_ids?: string[];
            number?: string;
          };
          const ids = (
            Array.isArray(message_ids) ? message_ids : message_id ? [message_id] : []
          ).filter((id) => typeof id === "string" && id.length > 0);
          if (ids.length === 0) {
            return jsonResponse(
              400,
              { error: "Missing message_id/message_ids" },
              corsHeaders,
            );
          }
          await provider.markRead(ids);
          result = { ok: true, marked: ids.length };
          break;
        }

        // -------------------------------------------------------------------
        // Rich send — Uazapi-only
        // -------------------------------------------------------------------
        case "sendMenu": {
          if (!provider.sendMenu) throw new Error("Provider does not support sendMenu");
          const { number, type, text, choices, footer, selectableCount, listButtonLabel, ctaUrl } =
            payload as {
              number?: string;
              type?: "button" | "list" | "poll" | "carousel" | "cta";
              text?: string;
              choices?: Array<string | { title: string; description?: string }>;
              footer?: string;
              selectableCount?: number;
              listButtonLabel?: string;
              ctaUrl?: string;
            };
          if (!number || !type || !text || !choices?.length) {
            return jsonResponse(400, { error: "Missing number/type/text/choices" }, corsHeaders);
          }
          // Uazapi expects choices as string[] — flatten objects from frontend
          const flatChoices = choices.map((c) =>
            typeof c === "string" ? c : c.title
          );
          // ⚠️ A DESCRIÇÃO SOBREVIVE, em campo separado. O achatamento acima é o
          // que a Uazapi aceita, e por anos foi tudo que existia; a lista da Meta
          // tem uma linha de descrição por item, e jogá-la fora aqui deixava o
          // cliente com uma lista de títulos soltos. Campo novo para o caminho
          // antigo continuar byte a byte o mesmo.
          const richChoices = choices
            .map((c) => (typeof c === "string" ? { title: c } : c))
            .filter((c) => (c.title ?? "").trim() !== "");
          result = await provider.sendMenu({
            number,
            type,
            text,
            choices: flatChoices,
            richChoices,
            footer,
            selectableCount,
            listButtonLabel,
            ctaUrl,
          });
          break;
        }

        case "blockUser":
        case "unblockUser": {
          const fn = action === "blockUser" ? provider.blockUser : provider.unblockUser;
          if (!fn) {
            return jsonResponse(
              422,
              { error: "Este canal não bloqueia contatos", code: "block_not_supported" },
              corsHeaders,
            );
          }
          const { number } = payload as { number?: string };
          if (!number) return jsonResponse(400, { error: "Missing number" }, corsHeaders);
          await fn.call(provider, number);
          result = { ok: true };
          break;
        }

        case "listBlocked": {
          if (!provider.listBlocked) {
            return jsonResponse(
              422,
              { error: "Este canal não lista bloqueados", code: "block_not_supported" },
              corsHeaders,
            );
          }
          result = { blocked: await provider.listBlocked() };
          break;
        }

        case "createSignupInvite": {
          if (!provider.createSignupInvite) {
            return jsonResponse(
              422,
              { error: "Este canal não cria convite de cadastro", code: "signup_not_supported" },
              corsHeaders,
            );
          }
          const c = payload as {
            mensagem?: string;
            confirmacao?: string;
            nome?: string;
            politicaDePrivacidade?: string;
            site?: string;
            codigoPromocional?: string;
          };
          if (!c.mensagem || !c.confirmacao || !c.nome || !c.politicaDePrivacidade || !c.site) {
            return jsonResponse(
              400,
              { error: "Missing mensagem/confirmacao/nome/politicaDePrivacidade/site" },
              corsHeaders,
            );
          }
          result = {
            invite: await provider.createSignupInvite({
              mensagem: c.mensagem,
              confirmacao: c.confirmacao,
              nome: c.nome,
              politicaDePrivacidade: c.politicaDePrivacidade,
              site: c.site,
              codigoPromocional: c.codigoPromocional,
            }),
          };
          break;
        }

        case "listSignupInvites": {
          if (!provider.listSignupInvites) {
            return jsonResponse(
              422,
              { error: "Este canal não lista convites", code: "signup_not_supported" },
              corsHeaders,
            );
          }
          const { limite } = payload as { limite?: number };
          result = { invites: await provider.listSignupInvites(limite) };
          break;
        }

        case "numberHealth": {
          if (!provider.numberHealth) {
            return jsonResponse(
              422,
              { error: "Este canal não informa saúde do número", code: "health_not_supported" },
              corsHeaders,
            );
          }
          result = { health: await provider.numberHealth() };
          break;
        }

        case "sendLocation": {
          // 422 e não `throw`: quem clica é um VENDEDOR, e um 500 genérico viraria
          // "não foi possível enviar" numa hora em que ele precisa saber que este
          // canal não manda localização — não que o sistema quebrou.
          if (!provider.sendLocation) {
            return jsonResponse(
              422,
              { error: "Este canal não envia localização", code: "location_not_supported" },
              corsHeaders,
            );
          }
          const { number, latitude, longitude, name, address } = payload as {
            number?: string;
            latitude?: number;
            longitude?: number;
            name?: string;
            address?: string;
          };
          // `0` é coordenada — a checagem é de finitude, não de verdade.
          if (!number || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return jsonResponse(400, { error: "Missing number/latitude/longitude" }, corsHeaders);
          }
          result = await provider.sendLocation({
            number,
            latitude: latitude as number,
            longitude: longitude as number,
            name,
            address,
          });
          break;
        }

        case "sendContact": {
          if (!provider.sendContact) {
            return jsonResponse(
              422,
              { error: "Este canal não envia contato", code: "contact_not_supported" },
              corsHeaders,
            );
          }
          const { number, contacts } = payload as {
            number?: string;
            contacts?: Array<{
              nome?: string;
              telefones?: Array<{ numero?: string; waId?: string }>;
              emails?: string[];
            }>;
          };
          if (!number || !contacts?.length) {
            return jsonResponse(400, { error: "Missing number/contacts" }, corsHeaders);
          }
          result = await provider.sendContact({
            number,
            contacts: contacts.map((c) => ({
              nome: String(c.nome ?? "").trim(),
              telefones: (c.telefones ?? [])
                .map((t) => ({ numero: String(t.numero ?? "").trim(), waId: t.waId }))
                .filter((t) => t.numero !== ""),
              emails: c.emails,
            })),
          });
          break;
        }

        case "sendPixButton": {
          if (!provider.sendPixButton) throw new Error("Provider does not support sendPixButton");
          const { number, pixkey, pixkeyType, merchantName, amount, text } = payload as {
            number?: string;
            pixkey?: string;
            pixkeyType?: string;
            merchantName?: string;
            amount?: number;
            text?: string;
          };
          if (!number || !pixkey || !merchantName || amount == null) {
            return jsonResponse(400, { error: "Missing number/pixkey/merchantName/amount" }, corsHeaders);
          }
          result = await provider.sendPixButton({ number, pixkey, pixkeyType: pixkeyType as any, merchantName, amount, text });
          break;
        }

        // -------------------------------------------------------------------
        // Presence, media download, history, limits — Uazapi-only
        // -------------------------------------------------------------------
        case "setPresence": {
          if (!provider.setPresence) throw new Error("Provider does not support setPresence");
          const { number, state } = payload as {
            number?: string;
            state?: "composing" | "available";
          };
          if (!number || !state) {
            return jsonResponse(400, { error: "Missing number/state" }, corsHeaders);
          }
          await provider.setPresence(number, state);
          result = { ok: true };
          break;
        }

        case "downloadMedia": {
          if (!provider.downloadMedia) throw new Error("Provider does not support downloadMedia");
          const { message_id } = payload as { message_id?: string };
          if (!message_id) {
            return jsonResponse(400, { error: "Missing message_id" }, corsHeaders);
          }
          result = await provider.downloadMedia(message_id);
          break;
        }

        case "historySync": {
          if (!provider.historySync) throw new Error("Provider does not support historySync");
          const { chat_jid, limit, cursor } = payload as {
            chat_jid?: string;
            limit?: number;
            cursor?: string;
          };
          result = await provider.historySync({ chat_jid, limit, cursor });
          break;
        }

        case "getMessageLimits": {
          if (!provider.getMessageLimits) throw new Error("Provider does not support getMessageLimits");
          result = await provider.getMessageLimits();
          break;
        }

        default:
          return jsonResponse(
            400,
            { error: `Unknown action: ${action}` },
            corsHeaders
          );
      }

      return jsonResponse(200, { ok: true, result }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "Internal error";
      console.error(`[whatsapp-api-proxy] action=${action} UNHANDLED ERROR: ${msg}`, (e as Error).stack ?? e);

      await logRuntime({
        organizationId: callerOrgId,
        module: "whatsapp",
        action,
        status: "error",
        errorMessage: msg,
        entityType: instanceId ? "whatsapp_instances" : undefined,
        entityId: instanceId,
      });

      // Never leak stack trace to client
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  })
);
