// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-instance-reaper — remove no provider as Instances já apagadas no CRM.
 *
 * Fonte: `whatsapp_instance_reap_queue` (a lápide, #1475), gravada por trigger
 *   BEFORE DELETE em `whatsapp_instances` e em `whatsapp_instance_secrets`.
 *
 * Por que existe: apagar uma Instance no CRM não a removia no provider, e o
 *   token morria em CASCADE junto com a linha — sem ele a órfã fica inalcançável
 *   para sempre. O caminho pior é apagar uma ORG: cascateia direto no Postgres,
 *   sem rodar código, sem chamada ao provider e sem log. O trigger cobre todos os
 *   caminhos; este coletor é quem efetivamente limpa.
 *
 * Estratégia:
 *   - Pega até BATCH_LIMIT lápides vencidas (não confirmadas, não desistidas,
 *     next_attempt_at <= now).
 *   - Chama DELETE /instance com o token preservado, via UazapiClient — que é a
 *     costura com teste assertando método, path e header. Rota errada foi o bug
 *     original (405 engolido), e reusar o client impede a recaída.
 *   - A decisão (confirmar / retentar / desistir) é da policy pura em
 *     _shared/whatsapp-reap-policy.ts. 404 conta como sucesso: instância que não
 *     existe é o estado desejado.
 *   - **NÃO purga lápide confirmada.** A lápide deixou de ser fila descartável e
 *     virou ARQUIVO PERMANENTE: com `phone_number`, ela é o mapa
 *     chip → instance_ids históricos que faz o chat reencontrar a conversa de um
 *     chip cuja Instance foi apagada. Apagar a linha apaga o endereço do
 *     histórico. Ver o bloco "RETENÇÃO REMOVIDA" abaixo.
 *   - Devolve contagens da fila. Sem isso, o desenho assíncrono trocaria
 *     vazamento silencioso por acúmulo silencioso.
 *
 * Schedule: a cada 5 minutos via pg_cron.
 * Auth: x-cron-secret ou service_role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { UazapiClient } from "../_shared/uazapi-client.ts";
import {
  decideReap,
  type ReapAttemptOutcome,
} from "../_shared/whatsapp-reap-policy.ts";

const BATCH_LIMIT = 50;

/*
 * RETENÇÃO REMOVIDA — não existe mais purga de lápide confirmada, e a ausência
 * é intencional.
 *
 * Havia `CONFIRMED_RETENTION_DAYS = 7`, que apagava daqui as lápides
 * confirmadas há mais de uma semana. O motivo original era encurtar a janela do
 * token de terceiro em repouso; mas o token JÁ é zerado no instante da
 * confirmação (ver `provider_token: null` no ramo `confirm`, abaixo), então a
 * linha arquivada não guarda segredo nenhum — sobra `instance_id`,
 * `phone_number`, nome e provider.
 *
 * E é exatamente esse resto que virou indispensável: com `phone_number`, a
 * lápide é o mapa chip → instance_ids históricos usado por
 * `whatsapp_chip_instance_ids()` para o chat reencontrar a conversa de um chip
 * cuja Instance foi apagada. Purgar em 7 dias significava perder o histórico
 * daquele chip no oitavo.
 *
 * O banco também protege isso (trigger BEFORE DELETE cancela a linha), mas
 * guarda de banco é defesa, não substituto: mantido o DELETE aqui, o coletor
 * ficaria tentando apagar de 5 em 5 minutos, para sempre, reportando
 * `purged: 0` — trabalho invisível fingindo ser rotina.
 */

/**
 * Teto de tempo de parede por rodada.
 *
 * O UazapiClient tem timeout de 15s e retenta internamente, então uma rodada com
 * o provider fora poderia gastar minutos por lápide — e é exatamente aí que a
 * fila está cheia. O orçamento faz a rodada parar e devolver o resto para a
 * próxima (5 min depois), em vez de ser morta no meio pelo runtime, o que
 * deixaria linhas com attempts incrementado e nenhum registro do motivo.
 */
const RUN_BUDGET_MS = 60_000;

/** Menor que o default de 15s: aqui latência não vale segurar a rodada. */
const PROVIDER_TIMEOUT_MS = 8_000;

type TombstoneRow = {
  id: string;
  organization_id: string | null;
  instance_id: string;
  instance_name: string | null;
  provider: string | null;
  provider_instance_id: string | null;
  provider_token: string | null;
  attempts: number;
};

/**
 * Tenta remover no provider. Nunca lança — devolve o desfecho para a policy
 * decidir, porque "falhou" e "falhou de forma permanente" são coisas diferentes.
 */
async function attemptProviderDelete(
  row: TombstoneRow,
  baseUrl: string
): Promise<ReapAttemptOutcome> {
  // Evolution exige credenciais e rota próprias; este coletor cobre Uazapi.
  // Desistir explicitamente é melhor que retentar para sempre um provider que
  // não sabemos limpar — e deixa o fato visível em vez de silencioso.
  if (row.provider && row.provider !== "uazapi") {
    return {
      ok: false,
      status: 501,
      error: `provider ${row.provider} não suportado pelo coletor`,
    };
  }

  try {
    const client = new UazapiClient({
      baseUrl,
      token: row.provider_token!,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    await client.deleteInstance();
    return { ok: true, status: 200 };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return {
      ok: false,
      status: typeof err.status === "number" ? err.status : undefined,
      error: err.message ?? "provider delete failed",
    };
  }
}

Deno.serve(
  withErrorBoundary(
    "whatsapp-instance-reaper",
    async (req: Request): Promise<Response> => {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
      const SUPABASE_SERVICE_ROLE_KEY =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
      const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";

      const corsHeaders = getCorsHeaders(req.headers.get("origin"));
      const headers = withSecurityHeaders({
        ...corsHeaders,
        "Content-Type": "application/json",
      });

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }
      if (req.method !== "POST" && req.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers,
        });
      }

      const cronSecret = req.headers.get("x-cron-secret") ?? "";
      const authHeader = req.headers.get("authorization") ?? "";
      const bearerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";
      const isAuthorized =
        (!!CRON_SECRET &&
          !!cronSecret &&
          timingSafeCompare(cronSecret, CRON_SECRET)) ||
        (!!SUPABASE_SERVICE_ROLE_KEY &&
          !!bearerToken &&
          timingSafeCompare(bearerToken, SUPABASE_SERVICE_ROLE_KEY));

      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers,
        });
      }

      if (!UAZAPI_BASE_URL) {
        await logRuntime({
          module: "whatsapp",
          action: "instance_reaper_misconfigured",
          status: "error",
          errorMessage: "UAZAPI_BASE_URL not set",
        });
        return new Response(
          JSON.stringify({ error: "UAZAPI_BASE_URL not set" }),
          { status: 500, headers }
        );
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const nowIso = new Date().toISOString();

      const { data: rows, error } = await supabase
        .from("whatsapp_instance_reap_queue")
        .select(
          "id, organization_id, instance_id, instance_name, provider, provider_instance_id, provider_token, attempts"
        )
        .is("confirmed_at", null)
        .is("gave_up_at", null)
        .lte("next_attempt_at", nowIso)
        .order("next_attempt_at", { ascending: true })
        .limit(BATCH_LIMIT)
        .returns<TombstoneRow[]>();

      if (error) {
        await logRuntime({
          module: "whatsapp",
          action: "instance_reaper_select_error",
          status: "error",
          errorMessage: error.message,
        });
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers,
        });
      }

      let confirmed = 0;
      let retried = 0;
      let gaveUp = 0;
      let processed = 0;
      let skippedForBudget = 0;

      const startedAt = Date.now();
      const picked = rows?.length ?? 0;

      for (const row of rows ?? []) {
        // Estourou o orçamento: devolve o resto para a próxima rodada. As linhas
        // não tocadas seguem intactas — next_attempt_at já venceu, então são as
        // primeiras da fila em 5 minutos.
        if (Date.now() - startedAt > RUN_BUDGET_MS) {
          skippedForBudget = picked - processed;
          break;
        }
        processed += 1;

        const hasToken = !!row.provider_token;

        // Sem credencial não há chamada a fazer — a policy resolve sem IO.
        const outcome = hasToken
          ? await attemptProviderDelete(row, UAZAPI_BASE_URL)
          : undefined;

        const decision = decideReap({
          hasToken,
          attempts: row.attempts,
          outcome,
        });

        if (decision.action === "confirm") {
          await supabase
            .from("whatsapp_instance_reap_queue")
            .update({
              confirmed_at: new Date().toISOString(),
              attempts: row.attempts + 1,
              last_error: null,
              // O token deixa de ser necessário no instante da confirmação.
              // Zerar aqui encurta a janela sem esperar a purga.
              provider_token: null,
            })
            .eq("id", row.id);
          confirmed += 1;
          continue;
        }

        if (decision.action === "give_up") {
          await supabase
            .from("whatsapp_instance_reap_queue")
            .update({
              gave_up_at: new Date().toISOString(),
              gave_up_reason: decision.reason ?? null,
              attempts: row.attempts + (hasToken ? 1 : 0),
              last_error: decision.reason ?? null,
            })
            .eq("id", row.id);
          gaveUp += 1;

          await logRuntime({
            organizationId: row.organization_id ?? undefined,
            module: "whatsapp",
            action: "instance_reap_gave_up",
            status: "error",
            entityType: "whatsapp_instance_reap_queue",
            entityId: row.id,
            errorMessage: decision.reason ?? "gave up",
            payloadSnapshot: {
              instance_id: row.instance_id,
              instance_name: row.instance_name,
              provider: row.provider,
            },
          });
          continue;
        }

        const nextAt = new Date(
          Date.now() + (decision.nextAttemptDelayMs ?? 60_000)
        ).toISOString();

        await supabase
          .from("whatsapp_instance_reap_queue")
          .update({
            attempts: row.attempts + 1,
            next_attempt_at: nextAt,
            last_error: decision.reason ?? null,
          })
          .eq("id", row.id);
        retried += 1;
      }

      // Nenhuma purga aqui — a lápide confirmada é arquivo permanente (ver o
      // bloco "RETENÇÃO REMOVIDA" no topo). `archived_total` mede esse arquivo,
      // que agora só cresce, no lugar do antigo `purged`.
      //
      // Contagens da fila. O desenho é assíncrono; sem isto, uma fila parada é
      // tão invisível quanto o vazamento que ela substituiu.
      const [pendingRes, overdueRes, gaveUpRes, archivedRes] = await Promise.all([
        supabase
          .from("whatsapp_instance_reap_queue")
          .select("id", { count: "exact", head: true })
          .is("confirmed_at", null)
          .is("gave_up_at", null),
        supabase
          .from("whatsapp_instance_reap_queue")
          .select("id", { count: "exact", head: true })
          .is("confirmed_at", null)
          .is("gave_up_at", null)
          .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()),
        supabase
          .from("whatsapp_instance_reap_queue")
          .select("id", { count: "exact", head: true })
          .not("gave_up_at", "is", null),
        supabase
          .from("whatsapp_instance_reap_queue")
          .select("id", { count: "exact", head: true })
          .not("confirmed_at", "is", null),
      ]);

      const queue = {
        pending: pendingRes.count ?? 0,
        pending_over_1h: overdueRes.count ?? 0,
        gave_up_total: gaveUpRes.count ?? 0,
        archived_total: archivedRes.count ?? 0,
      };

      await logRuntime({
        module: "whatsapp",
        action: "instance_reaper_run",
        // O resumo da rodada é sempre "success": a rodada rodou. Cada desistência
        // já emitiu seu próprio log com status "error" acima, que é o que deve
        // acender alarme — não o fato de o coletor ter executado.
        status: "success",
        payloadSnapshot: {
          picked,
          processed,
          confirmed,
          retried,
          gave_up: gaveUp,
          skipped_for_budget: skippedForBudget,
          queue,
        },
      });

      return new Response(
        JSON.stringify({
          picked,
          processed,
          confirmed,
          retried,
          gave_up: gaveUp,
          skipped_for_budget: skippedForBudget,
          queue,
        }),
        { status: 200, headers }
      );
    }
  )
);
