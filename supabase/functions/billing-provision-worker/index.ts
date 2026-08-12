/**
 * billing-provision-worker — o pagamento vira ACESSO (Fatia 9, parte 1).
 *
 * ═══ POR QUE É WORKER, E NÃO PARTE DO WEBHOOK ═══
 *
 * O `asaas-webhook` devolve 200 SEMPRE, porque a fila do provedor pausa em 15
 * falhas consecutivas e um evento envenenado bloqueia todos os seguintes.
 * Provisionar lá dentro herdaria essa regra: a ativação falharia, o Asaas
 * receberia 200, e a organização ficaria PAGA E INACESSÍVEL em silêncio.
 *
 * Aqui não. Falha deste worker é vermelha e visível — `runtime_logs` com status
 * `error`, e a linha continua pendente para a próxima passada. O preço é
 * latência de um ciclo de cron; o ganho é que ninguém paga e fica de fora sem
 * nada aparecer.
 *
 * ═══ ESCOPO: SÓ `existing_org` ═══
 *
 * Ativar organização que já existe não precisa de e-mail nem documento do
 * comprador — e esses dados NÃO são persistidos em lugar nenhum hoje (medido:
 * nem `payment_links` nem `payment_link_charges` os têm). `new_org` entra
 * quando a captura existir; a costura difícil (idempotência, cota, renovação)
 * já fica provada por este caminho.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { requireCronAuth } from "../_shared/auth.ts";

/** Teto por passada. Fila grande não vira uma requisição de dez minutos. */
const LOTE = 50;

Deno.serve(
  withErrorBoundary("billing-provision-worker", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (!requireCronAuth(req).authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Pendente = assinatura viva, com cobrança, que ainda não tem linha no livro.
    // A verdade de "já provisionei" mora no livro, não numa coluna de estado —
    // coluna de estado diz AGORA, o livro diz por qual pagamento e quando.
    const { data: jaFeitos, error: erroLivro } = await supabase
      .from("subscription_provisionings")
      .select("provider_payment_id");

    if (erroLivro) {
      await logRuntime({
        module: "billing",
        action: "provision_worker_falhou",
        status: "error",
        errorMessage: erroLivro.message,
      });
      return new Response(JSON.stringify({ error: "ledger_unreadable" }), { status: 500, headers });
    }

    const feitos = new Set((jaFeitos ?? []).map(r => r.provider_payment_id as string));

    const { data: assinaturas, error: erroSub } = await supabase
      .from("org_subscriptions")
      .select("provider_payment_id, organization_id")
      .not("provider_payment_id", "is", null)
      .is("cancelled_at", null)
      .order("updated_at", { ascending: true })
      .limit(LOTE * 4);

    if (erroSub) {
      await logRuntime({
        module: "billing",
        action: "provision_worker_falhou",
        status: "error",
        errorMessage: erroSub.message,
      });
      return new Response(JSON.stringify({ error: "subscriptions_unreadable" }), { status: 500, headers });
    }

    const pendentes = (assinaturas ?? [])
      .filter(s => !feitos.has(s.provider_payment_id as string))
      .slice(0, LOTE);

    const feito: string[] = [];
    const recusado: string[] = [];
    const falhou: string[] = [];

    for (const s of pendentes) {
      const pagamento = s.provider_payment_id as string;
      const { data, error } = await supabase.rpc("billing_provision_existing_org", {
        p_provider_payment_id: pagamento,
      });

      if (error) {
        falhou.push(pagamento);
        // Vermelho VISÍVEL. É a diferença entre este worker e o webhook: aqui
        // ninguém precisa fingir sucesso para não pausar fila de terceiro.
        await logRuntime({
          module: "billing",
          organizationId: (s.organization_id as string) ?? undefined,
          action: "provision_falhou",
          status: "error",
          errorMessage: error.message,
          payloadSnapshot: { payment_id: pagamento },
        });
        continue;
      }

      const resultado = (data ?? {}) as { ok?: boolean; code?: string };
      if (resultado.ok) {
        feito.push(pagamento);
        await logRuntime({
          module: "billing",
          organizationId: (s.organization_id as string) ?? undefined,
          action: "provisionado",
          status: "success",
          payloadSnapshot: { payment_id: pagamento, code: resultado.code },
        });
      } else {
        // Recusa esperada (assinatura ainda não gravada, plano ausente) não é
        // incidente: fica como `skipped` para não afogar o sinal de erro real.
        recusado.push(pagamento);
        await logRuntime({
          module: "billing",
          organizationId: (s.organization_id as string) ?? undefined,
          action: "provision_recusado",
          status: "skipped",
          payloadSnapshot: { payment_id: pagamento, code: resultado.code },
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        pendentes: pendentes.length,
        provisionados: feito.length,
        recusados: recusado.length,
        falhas: falhou.length,
      }),
      { status: 200, headers },
    );
  }),
);
