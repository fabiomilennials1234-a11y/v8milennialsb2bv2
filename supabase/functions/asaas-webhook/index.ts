/**
 * asaas-webhook — o pagamento vira fato no banco (SCRUM-287, Fatia 6).
 *
 * `payment_history` e `org_subscriptions` são tabelas modeladas e nunca
 * ligadas: ZERO linhas as duas. O Torque cobra e o sistema não registra. Esta
 * função é o que tira as duas do papel.
 *
 * ═══ AUTENTICAÇÃO — mais fraca do que se gostaria, e por isso COMPOSTA ═══
 *
 * O Asaas NÃO assina o corpo. Não há HMAC: existe apenas um TOKEN ESTÁTICO no
 * header `asaas-access-token`, que NÓS escolhemos ao registrar o webhook, e ele
 * é OPCIONAL do lado deles. O padrão de envelope assinado do
 * `torquecalls-webhook` NÃO porta para cá — lá controlamos o emissor, aqui não.
 *
 * A defesa, portanto, é em três camadas, e nenhuma delas sozinha basta:
 *   1. CAMINHO SECRETO na URL (molde do `whatsapp-webhook`), comparado em tempo
 *      constante;
 *   2. o TOKEN do header, também em tempo constante;
 *   3. ALLOWLIST DE IP — ver a decisão registrada abaixo.
 *
 * O token é CREDENCIAL: nunca em log, em erro ou em telemetria.
 *
 * ═══ POR QUE ESTA FUNÇÃO NUNCA DEVOLVE ERRO PARA A FILA ═══
 *
 * 15 falhas consecutivas PAUSAM a fila daquele webhook; evento pausado morre em
 * 14 dias; e em modo SEQUENTIALLY UM evento envenenado BLOQUEIA todos os
 * seguintes. Devolver 500 num evento que não sabemos tratar derruba o
 * recebimento de TODA a receita — não só daquele evento.
 *
 * Então: persiste primeiro, responde 200, processa depois. E responde
 * EXATAMENTE 200, nunca 204 — a documentação do provedor se contradiz (uma
 * página diz 2xx, a FAQ e a de fila pausada dizem 200 e listam 204 como
 * FALHA), e 200 é o lado seguro da contradição.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { decidir, proximoStatus, deveProvisionar, type PaymentStatus } from "./decide.ts";

/**
 * IPs publicados de PRODUÇÃO do Asaas.
 *
 * DECISÃO REGISTRADA: a allowlist só é EXIGIDA quando `ASAAS_ENV=production`.
 * O Sandbox entrega de IPs que NÃO estão nesta lista — travar por IP em
 * desenvolvimento deixaria o sandbox de fora e o time testaria contra uma porta
 * que nunca abre. Fora de produção o IP é REGISTRADO e não bloqueia: perde-se
 * uma camada onde não há dinheiro, e mantêm-se as outras duas (caminho secreto
 * e token), que valem nos dois ambientes.
 */
const ASAAS_PROD_IPS = ["52.67.12.206", "18.230.8.159", "54.94.136.112", "54.94.183.101"];

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

/** 200 sempre que a mensagem foi recebida. Nunca 204 — o provedor conta como falha. */
function ok(headers: HeadersInit, corpo: Record<string, unknown> = { received: true }) {
  return new Response(JSON.stringify(corpo), { status: 200, headers });
}

Deno.serve(
  withErrorBoundary("asaas-webhook", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
    }

    const PATH_SECRET = Deno.env.get("ASAAS_WEBHOOK_PATH_SECRET") ?? "";
    const TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";
    const EM_PRODUCAO = (Deno.env.get("ASAAS_ENV") ?? "sandbox") === "production";

    // ── Camada 1: caminho secreto ──────────────────────────────────────────
    const segmentos = new URL(req.url).pathname.split("/").filter(Boolean);
    const segredoDaUrl = segmentos[segmentos.length - 1] ?? "";
    if (!PATH_SECRET || !timingSafeCompare(segredoDaUrl, PATH_SECRET)) {
      // 404, não 401: para quem varre, a porta não existe.
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    // ── Camada 2: token do header (nunca registrado) ───────────────────────
    if (TOKEN && !timingSafeCompare(req.headers.get("asaas-access-token") ?? "", TOKEN)) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    // ── Camada 3: IP, exigida só em produção (ver decisão no topo) ─────────
    const ip = clientIp(req);
    if (EM_PRODUCAO && !ASAAS_PROD_IPS.includes(ip)) {
      await logRuntime({
        module: "billing",
        action: "asaas_webhook_ip_rejected",
        status: "error",
        payloadSnapshot: { ip },
      });
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let corpo: unknown;
    try {
      corpo = await req.json();
    } catch {
      // Corpo ilegível NÃO vira erro para a fila: 15 falhas consecutivas a
      // pausam, e nós não temos como consertar o que o provedor mandou.
      await logRuntime({
        module: "billing",
        action: "asaas_webhook_malformed",
        status: "error",
        payloadSnapshot: { ip: EM_PRODUCAO ? ip : null },
      });
      return ok(headers, { received: true, ignored: "malformed_body" });
    }

    const d = decidir(corpo as Record<string, never>);

    if (!d.usavel) {
      await logRuntime({
        module: "billing",
        action: "asaas_webhook_sem_event_id",
        status: "error",
        payloadSnapshot: { event_type: d.eventType },
      });
      return ok(headers, { received: true, ignored: "missing_event_id" });
    }

    // ── PERSISTE PRIMEIRO. A idempotência é do BANCO ───────────────────────
    // `ON CONFLICT DO NOTHING` sobre UNIQUE(provider, provider_event_id): a
    // re-entrega bate no índice, não insere e é SUCESSO. Um SELECT-antes-de-
    // INSERT perderia a corrida entre duas entregas simultâneas.
    const { data: gravado, error: erroLivro } = await supabase
      .from("payment_webhook_events")
      .insert({
        provider: "asaas",
        provider_event_id: d.eventId,
        event_type: d.eventType,
        provider_payment_id: d.paymentId,
        status: d.registro === "applied" ? "received" : d.registro,
        payload: corpo,
      })
      .select("id")
      .maybeSingle();

    if (erroLivro && erroLivro.code !== "23505") {
      // Falha real de banco. Registra e AINDA ASSIM responde 200: o provedor
      // reentrega em 30s, e pausar a fila é pior do que perder uma janela.
      await logRuntime({
        module: "billing",
        action: "asaas_webhook_ledger_falhou",
        status: "error",
        errorMessage: erroLivro.message,
        payloadSnapshot: { event_id: d.eventId, event_type: d.eventType },
      });
      return ok(headers, { received: true, retry_expected: true });
    }

    // Sem linha nova = re-entrega. Nada a processar, e isso é o caminho FELIZ.
    if (!gravado) {
      await logRuntime({
        module: "billing",
        action: "asaas_webhook_reentrega",
        status: "skipped",
        payloadSnapshot: { event_id: d.eventId, event_type: d.eventType },
      });
      return ok(headers, { received: true, duplicate: true });
    }

    if (d.registro === "unknown_type" || !d.status || !d.paymentId) {
      await logRuntime({
        module: "billing",
        action: "asaas_webhook_tipo_desconhecido",
        status: "skipped",
        payloadSnapshot: { event_id: d.eventId, event_type: d.eventType },
      });
      return ok(headers, { received: true, absorbed: true });
    }

    // ── Aplica: histórico primeiro, acesso depois ──────────────────────────
    const { data: existente } = await supabase
      .from("payment_history")
      .select("id, organization_id, status, coupon_id")
      .eq("asaas_payment_id", d.paymentId)
      .maybeSingle();

    const statusAnterior = (existente?.status ?? null) as PaymentStatus | null;
    // A escada só sobe: `CONFIRMED` atrasado não rebaixa quem já está
    // `RECEIVED`, porque a ordem de entrega não é garantida fora do modo
    // SEQUENTIALLY.
    const statusFinal = proximoStatus(statusAnterior, d.status);
    const liberaAgora = deveProvisionar(statusAnterior, d.status);

    if (existente) {
      await supabase
        .from("payment_history")
        .update({
          status: statusFinal,
          paid_at: d.paidAt ?? undefined,
          invoice_url: d.invoiceUrl ?? undefined,
          receipt_url: d.receiptUrl ?? undefined,
          billing_type: d.billingType ?? undefined,
        })
        .eq("id", existente.id);
    }

    // Consumo do cupom: INSERIR no livro. A segunda vez é recusada pelo banco
    // (UNIQUE coupon_id, payment_id), então re-entrega não queima uso — e o
    // consumo pertence à CONFIRMAÇÃO, não à validação, porque validar é leitura
    // e o cliente abre o link dez vezes sem pagar.
    if (liberaAgora && existente?.coupon_id) {
      const { error: erroCupom } = await supabase.from("coupon_redemptions").insert({
        coupon_id: existente.coupon_id,
        payment_id: d.paymentId,
        organization_id: existente.organization_id,
      });
      if (erroCupom && erroCupom.code !== "23505") {
        await logRuntime({
          module: "billing",
          action: "asaas_webhook_resgate_falhou",
          status: "error",
          errorMessage: erroCupom.message,
          payloadSnapshot: { event_id: d.eventId },
        });
      }
    }

    await supabase
      .from("payment_webhook_events")
      .update({
        status: "applied",
        organization_id: existente?.organization_id ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", gravado.id);

    await logRuntime({
      module: "billing",
      organizationId: existente?.organization_id ?? undefined,
      action: "asaas_webhook_aplicado",
      status: "success",
      payloadSnapshot: {
        event_id: d.eventId,
        event_type: d.eventType,
        status_anterior: statusAnterior,
        status_final: statusFinal,
        provisionou: liberaAgora,
        // Cobrança sem linha em payment_history é o sinal de que a fatia que
        // CRIA a cobrança ainda não gravou — aparece aqui em vez de sumir.
        cobranca_conhecida: !!existente,
      },
    });

    return ok(headers, { received: true });
  }),
);
