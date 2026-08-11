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
import { assertPlanFeature, PlanFeatureDeniedError, planDeniedResponse } from "../_shared/plan-gate.ts";
import {
  getWhatsAppProvider,
  type WhatsAppInstance,
} from "../_shared/whatsapp-client.ts";
import { isActiveGestorForOrg } from "../_shared/gestor-auth.ts";
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

// ---------------------------------------------------------------------------
// Rate limit state (in-memory, per org)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(orgId: string): boolean {
  const now = Date.now();
  const rl = rateLimitState.get(orgId);
  if (rl && rl.resetAt > now) {
    if (rl.count >= RATE_LIMIT_MAX) return false;
    rl.count += 1;
    return true;
  }
  rateLimitState.set(orgId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  return true;
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
 * O DROP da FK é a migration `20270811000000_whatsapp_messages_drop_instance_fk.sql`,
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
      return jsonResponse(400, { error: "Invalid JSON body" }, corsHeaders);
    }

    const action = body?.action;
    if (!action || typeof action !== "string") {
      return jsonResponse(400, { error: "Missing action" }, corsHeaders);
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

    if (isMaster) {
      // Master can act on any org. Require explicit target so we never assume.
      if (!targetOrgId) {
        return jsonResponse(
          400,
          { error: "Master must provide organization_id" },
          corsHeaders
        );
      }
      const { data: orgRow } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .eq("id", targetOrgId)
        .maybeSingle();
      if (!orgRow) {
        return jsonResponse(404, { error: "Organization not found" }, corsHeaders);
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
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (orgErr || !userOrg?.organization_id) {
        return jsonResponse(403, { error: "No organization" }, corsHeaders);
      }
      callerOrgId = userOrg.organization_id;

      // If a target org was supplied, it must match the user's own org —
      // prevents a regular user from acting on another tenant via the param.
      if (targetOrgId && targetOrgId !== callerOrgId) {
        return jsonResponse(
          403,
          { error: "Cannot target a different organization" },
          corsHeaders
        );
      }
    }

    // -------------------------------------------------------------------------
    // 4. Rate limit (per org)
    // -------------------------------------------------------------------------
    if (!checkRateLimit(callerOrgId)) {
      return jsonResponse(429, { error: "Rate limit exceeded" }, corsHeaders);
    }

    // -------------------------------------------------------------------------
    // 4.5 Plan gate — chat fora do plano → 403 (master opera qualquer org)
    // -------------------------------------------------------------------------
    if (!isMaster) {
      try {
        await assertPlanFeature(supabaseAdmin, callerOrgId, "chat");
      } catch (e) {
        if (e instanceof PlanFeatureDeniedError) return planDeniedResponse(e, corsHeaders);
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
          return jsonResponse(
            400,
            { error: "Missing payload.instance_name" },
            corsHeaders
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
        return jsonResponse(400, { error: "Missing instance_id" }, corsHeaders);
      }

      const { data: instance, error: instErr } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("*")
        .eq("id", instanceId)
        .maybeSingle();

      if (instErr || !instance) {
        return jsonResponse(404, { error: "Instance not found" }, corsHeaders);
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
          // migration `20270811000000_whatsapp_messages_drop_instance_fk.sql`, ainda um
          // passo MANUAL — a ordem real é (1) migration em prod, (2) deploy
          // deste proxy, (3) backfill. Nada aqui pode supor o estado (1).
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
      // Para ações de envio (sendText/sendMedia/sendAudio) que carregam
      // `payload.lead_id` opcional: se a flag está ON na org, exigir
      //   (a) responsible_user_id do lead → instância vinculada == instance_id
      //   (b) caller pode escrever via instância (owner / admin / master)
      //
      // Quando lead_id ausente, comportamento legado é preservado.
      // Frontend (Etapa C) passa a anexar lead_id no composer humano.
      // -----------------------------------------------------------------------
      const SEND_ACTIONS = new Set(["sendText", "sendMedia", "sendAudio"]);
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
      const NUMBER_ACTIONS = new Set(["sendText", "sendMedia", "sendAudio", "setPresence"]);
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
          if (!message_id || !number || !emoji) {
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
          const { number, type, text, choices, footer, selectableCount } = payload as {
            number?: string;
            type?: "button" | "list" | "poll" | "carousel";
            text?: string;
            choices?: Array<string | { title: string; description?: string }>;
            footer?: string;
            selectableCount?: number;
          };
          if (!number || !type || !text || !choices?.length) {
            return jsonResponse(400, { error: "Missing number/type/text/choices" }, corsHeaders);
          }
          // Uazapi expects choices as string[] — flatten objects from frontend
          const flatChoices = choices.map((c) =>
            typeof c === "string" ? c : c.title
          );
          result = await provider.sendMenu({ number, type, text, choices: flatChoices, footer, selectableCount });
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
