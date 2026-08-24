// deno-lint-ignore-file no-explicit-any
/**
 * process-blast-recipients — o worker da fila do Disparo pelo Canal Oficial (#1722).
 *
 * Cron-only (pg_cron → pg_net → aqui, auth por `x-cron-secret`). A cada minuto:
 * reivindica destinatários pendentes de Disparos oficiais, manda um Template
 * aprovado para cada um, e marca a linha com o que o fornecedor respondeu.
 *
 * POR QUE ESTE WORKER EXISTE (ADR-0028): o canal oficial não tem o `/sender/*`
 * da Uazapi — o provider dele define `senderAdvanced` só para lançar
 * `NotSupportedError`. Não é allowlist a alargar, é a ausência de um laço. Este
 * é o laço.
 *
 * O QUE MORA AQUI e o que NÃO mora:
 *   · aqui: autenticação de cron, credencial de serviço, o transporte real
 *   · em `_shared/blast-official-runner.ts`: o laço, testado com dublês
 *   · em `_shared/decisao-do-disparo.ts`: enviar/pular/recusar, puro
 *
 * A divisão não é enfeite: é o que permite provar o laço sem banco e sem
 * fornecedor, e é onde as fatias seguintes (#1725 teto, #1727 supressão, #1728
 * ritmo) encostam sem precisar de um segundo worker.
 *
 * ⚠️ NÃO grava a mensagem na conversa. O provider já a escreve dentro do envio;
 * gravar aqui duplicaria a linha na thread do vendedor. Ver o cabeçalho do
 * runner.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { sendTemplateViaInstance } from "../_shared/whatsapp-dispatch.ts";
import { processarTiqueDoDisparo } from "../_shared/blast-official-runner.ts";

const FUNCTION_NAME = "process-blast-recipients";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/**
 * Ritmo FIXO e conservador desta fatia.
 *
 * 20 por tique, com 3 segundos entre envios, é ~1 minuto de trabalho num cron
 * de 1 minuto — o tique termina antes do próximo começar, e a fila anda a ~20
 * mensagens/minuto. É devagar de propósito: o fornecedor não publica rate limit
 * nenhum (a tabela de erros dele não tem sequer um 429, ADR-0029), então o
 * número seguro é desconhecido e o piso é a resposta honesta.
 *
 * O ritmo ADAPTATIVO — sobe enquanto as entregas voltam limpas, recua em
 * qualquer 5xx — é a #1728, e depende deste laço existir primeiro.
 */
const BATCH_SIZE = 20;
const PER_ORG_CAP = 5;
const PAUSA_ENTRE_ENVIOS_MS = 3_000;

Deno.serve(
  withErrorBoundary(FUNCTION_NAME, async (req: Request) => {
    const corsHeaders = withSecurityHeaders(
      getCorsHeaders(req.headers.get("origin") ?? undefined),
    );
    const headers = { ...corsHeaders, "Content-Type": "application/json" };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Cron-only. Não há caminho de usuário para cá: quem dispara é o pg_cron, e
    // quem controla o Disparo pela tela usa `blast-plan-control`.
    const secret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !secret || !timingSafeCompare(secret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers,
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const resultado = await processarTiqueDoDisparo(
      {
        supabaseAdmin: supabase,
        // O transporte de produção. Ele traz o choke único por dentro: dedup,
        // governor, accounting e espelhamento da mídia de cabeçalho — que a
        // Meta recusa por callback se a URL do CDN dela for repassada crua.
        enviarTemplate: ({ instance, phone, template, trackSource, trackId }) =>
          sendTemplateViaInstance(
            supabase,
            instance as any,
            phone,
            {
              name: template.name,
              language: template.language,
              components: template.components as unknown[],
              previewText: template.previewText,
              buttonLabels: template.buttonLabels,
            },
            { trackSource, trackId },
          ),
        esperar: (ms: number) => new Promise((r) => setTimeout(r, ms)),
        agora: () => new Date(),
      },
      { batchSize: BATCH_SIZE, perOrgCap: PER_ORG_CAP, pausaMs: PAUSA_ENTRE_ENVIOS_MS },
    );

    // Tique vazio não vira log: o cron roda a cada minuto e a fila fica vazia na
    // maior parte do tempo. Registrar silêncio 1.440 vezes por dia afogaria o
    // sinal que importa.
    if (resultado.reivindicados > 0) {
      await logRuntime({
        module: "campaign",
        action: `${FUNCTION_NAME}.tique`,
        status: resultado.falhas > 0 ? "error" : "success",
        payloadSnapshot: resultado as unknown as Record<string, unknown>,
        errorMessage:
          resultado.falhas > 0
            ? `${resultado.falhas} envio(s) recusado(s) pelo fornecedor neste tique`
            : undefined,
      });
    }

    return new Response(JSON.stringify(resultado), { status: 200, headers });
  }),
);
