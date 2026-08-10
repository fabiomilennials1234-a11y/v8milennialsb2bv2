// deno-lint-ignore-file no-explicit-any

/**
 * whatsapp-instance-reconcile — relatório do passivo de Instances no provider.
 *
 * READ-ONLY, por decisão explícita (#1478, PRD #1472). Não deleta, não escreve.
 *
 * Por que não automatizar a limpeza: "ausente do nosso banco" NÃO significa
 * "lixo". Instância criada direto no painel da Uazapi — para teste, para
 * investigação — é legitimamente ausente do CRM. Uma rotina que lesse ausência
 * como sinal de exclusão destruiria exatamente essas, e instância deletada no
 * provider não volta: o pareamento morre e alguém precisa parear de novo.
 *
 * O que dá critério forte HOJE: `createInstance` carimba
 * `adminField01 = organization_id` e `adminField02 = whatsapp_instances.id` desde
 * 2026-04-22, e todas as 116 instâncias vivas foram criadas depois disso. Então
 * "carimbada como nossa E ausente do banco" é afirmação medível de posse.
 *
 * A classificação é da policy pura em _shared/whatsapp-instance-reconcile.ts.
 * Esta função só faz IO: lista o provider, lê o banco, devolve o relatório.
 *
 * Sem cron: rodada sob demanda. Auth: x-cron-secret ou service_role.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { UazapiClient } from "../_shared/uazapi-client.ts";
import {
  reconcileInstances,
  type LocalInstance,
  type ProviderInstance,
} from "../_shared/whatsapp-instance-reconcile.ts";

/**
 * A resposta de /instance/all não é fixada pela spec pública: algumas
 * implantações devolvem array puro, outras embrulham. Normaliza sem inventar.
 */
function normaliseProviderList(raw: unknown): ProviderInstance[] | null {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.instances)
      ? (raw as any).instances
      : Array.isArray((raw as any)?.data)
        ? (raw as any).data
        : null;

  if (!arr) return null;

  return arr
    .filter((i: any) => i && typeof i === "object" && i.id)
    .map((i: any) => ({
      id: String(i.id),
      name: i.name ?? undefined,
      status: typeof i.status === "string" ? i.status : undefined,
      adminField01: i.adminField01 ?? undefined,
      adminField02: i.adminField02 ?? undefined,
      created: i.created ?? undefined,
      lastDisconnectReason: i.lastDisconnectReason ?? undefined,
    }));
}

Deno.serve(
  withErrorBoundary(
    "whatsapp-instance-reconcile",
    async (req: Request): Promise<Response> => {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
      const SUPABASE_SERVICE_ROLE_KEY =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
      const UAZAPI_BASE_URL = Deno.env.get("UAZAPI_BASE_URL") ?? "";
      const UAZAPI_ADMIN_TOKEN = Deno.env.get("UAZAPI_ADMIN_TOKEN") ?? "";

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

      if (!UAZAPI_BASE_URL || !UAZAPI_ADMIN_TOKEN) {
        return new Response(
          JSON.stringify({
            error: "UAZAPI_BASE_URL / UAZAPI_ADMIN_TOKEN not set",
          }),
          { status: 500, headers }
        );
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Lista do provider. Falha aqui NÃO pode virar "o provider apagou tudo":
      // a policy devolve inconclusive e nada é classificado.
      let providerRaw: unknown = null;
      let providerError: string | null = null;
      try {
        const client = new UazapiClient({
          baseUrl: UAZAPI_BASE_URL,
          adminToken: UAZAPI_ADMIN_TOKEN,
          timeoutMs: 20_000,
        });
        providerRaw = await client.listAllInstances();
      } catch (e) {
        providerError = (e as Error).message ?? "provider list failed";
      }

      const providerInstances = providerError
        ? null
        : normaliseProviderList(providerRaw);

      const { data: localRows, error: dbErr } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_id, organization_id, instance_name")
        .eq("provider", "uazapi")
        .returns<LocalInstance[]>();

      if (dbErr) {
        await logRuntime({
          module: "whatsapp",
          action: "instance_reconcile_db_error",
          status: "error",
          errorMessage: dbErr.message,
        });
        return new Response(JSON.stringify({ error: dbErr.message }), {
          status: 500,
          headers,
        });
      }

      const report = reconcileInstances({
        providerInstances,
        localInstances: localRows ?? [],
      });

      const summary = {
        provider_total: providerInstances?.length ?? null,
        local_total: localRows?.length ?? 0,
        matched: report.matched,
        confirmed_orphans: report.confirmedOrphans.length,
        unstamped_unknown: report.unstampedUnknown.length,
        phantoms: report.phantoms.length,
        inconclusive: report.inconclusive,
        provider_error: providerError,
      };

      await logRuntime({
        module: "whatsapp",
        action: "instance_reconcile_run",
        status: report.inconclusive ? "skipped" : "success",
        payloadSnapshot: summary,
        ...(providerError && { errorMessage: providerError }),
      });

      return new Response(
        JSON.stringify(
          {
            summary,
            // Nada aqui é deletado. A decisão sobre cada linha é humana —
            // especialmente para unstamped_unknown, que provavelmente são
            // instâncias criadas de propósito fora do CRM.
            confirmed_orphans: report.confirmedOrphans,
            unstamped_unknown: report.unstampedUnknown,
            phantoms: report.phantoms,
          },
          null,
          2
        ),
        { status: 200, headers }
      );
    }
  )
);
