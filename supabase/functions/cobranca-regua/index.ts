/**
 * cobranca-regua — o worker da régua de cobrança (ADR-0040, entrega 2).
 *
 * Cron-only (pg_cron → `invoke_cobranca_regua` → pg_net → aqui, auth por
 * `x-cron-secret`). O invoker já planejou no banco e só chama quando há envio
 * vencido; aqui se reserva, envia e conclui.
 *
 * O QUE MORA AQUI e o que NÃO mora:
 *   · aqui: autenticação de cron, credencial de serviço, o transporte real
 *   · em `_shared/cobranca-regua-runner.ts`: o laço, testado com dublês
 *   · em `_shared/cobranca-regua-mensagem.ts`: o texto, puro (gêmeo no front)
 *   · no banco: quem, quando, janela, teto, ritmo, revalidação, backoff
 *
 * Transporte = o mesmo do resto do produto (`sendTextViaInstance`: governor,
 * breaker, classificação). O número é o reservado para a cobrança; o choke de
 * envio só deixa ele sair com trackSource 'cobranca' ou mão humana.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { sendTextViaInstance } from "../_shared/whatsapp-dispatch.ts";
import type { WhatsAppInstance } from "../_shared/whatsapp-client.ts";
import {
  assertRecipientReachable,
  isRetryableSendFailure,
  persistOutboundMessage,
} from "../_shared/action-handlers/whatsapp-helpers.ts";
import { type EnvioReservado, processarTiqueDaRegua } from "../_shared/cobranca-regua-runner.ts";

const FUNCTION_NAME = "cobranca-regua";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/**
 * O banco já entrega no máximo UMA mensagem por org por chamada (ritmo do
 * chip); o lote só limita quantas orgs um tique atende.
 */
const LOTE = 20;

Deno.serve(
  withErrorBoundary(FUNCTION_NAME, async (req: Request) => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));
    const headers = { ...corsHeaders, "Content-Type": "application/json" };

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const secret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !secret || !timingSafeCompare(secret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const resumo = await processarTiqueDaRegua(
      {
        reservar: async (lote) => {
          const { data, error } = await supabase.rpc("cobranca_regua_reservar", { p_lote: lote });
          if (error) throw new Error(`reservar: ${error.message}`);
          return (data ?? []) as EnvioReservado[];
        },
        concluir: async ({ envioId, resultado, texto, providerMessageId, erro }) => {
          const { error } = await supabase.rpc("cobranca_regua_concluir", {
            p_envio: envioId,
            p_resultado: resultado,
            p_texto: texto ?? null,
            p_provider_message_id: providerMessageId ?? null,
            p_erro: erro ?? null,
          });
          if (error) throw new Error(`concluir: ${error.message}`);
        },
        carregarInstancia: async (id) => {
          const { data } = await supabase.from("whatsapp_instances").select("*").eq("id", id).maybeSingle();
          return data ?? null;
        },
        verificarNumero: async (instancia, telefone) => {
          const v = await assertRecipientReachable(supabase, instancia, telefone, instancia.organization_id);
          return v.reachable ? null : (v.reason ?? "recipient_not_on_whatsapp");
        },
        enviarTexto: (instancia, telefone, texto, opts) =>
          sendTextViaInstance(supabase, instancia as unknown as WhatsAppInstance, telefone, texto, opts),
        gravarNoChat: ({ instancia, telefone, texto, providerMessageId }) =>
          persistOutboundMessage(supabase, {
            organizationId: instancia.organization_id,
            instanceId: instancia.id,
            provider: instancia.provider,
            providerMessageId,
            phone: telefone,
            messageType: "conversation",
            content: texto,
            fallbackIdPrefix: "cobranca",
            sentSource: "cobranca",
          }),
        ehRetentavel: isRetryableSendFailure,
      },
      { lote: LOTE },
    );

    // Tique vazio não vira log (o invoker só chama com fila, mas a reserva pode
    // não achar nada elegível — fora da janela, teto, revalidação).
    if (resumo.reservados > 0) {
      await logRuntime({
        module: "outbound",
        action: `${FUNCTION_NAME}.tique`,
        status: resumo.falhas > 0 ? "error" : "success",
        payloadSnapshot: resumo as unknown as Record<string, unknown>,
        errorMessage: resumo.falhas > 0 ? `${resumo.falhas} envio(s) da régua falharam neste tique` : undefined,
      });
    }

    return new Response(JSON.stringify(resumo), { status: 200, headers });
  }),
);
