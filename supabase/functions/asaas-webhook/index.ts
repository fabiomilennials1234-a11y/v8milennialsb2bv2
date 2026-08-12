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
 * DECISÃO REGISTRADA: a allowlist é dispensada SOMENTE quando `ASAAS_ENV` vale
 * exatamente `sandbox`. O Sandbox entrega de IPs que NÃO estão nesta lista, e
 * travar por IP em desenvolvimento deixaria o sandbox de fora — o time testaria
 * contra uma porta que nunca abre.
 *
 * E a dispensa é FECHADA POR PADRÃO: variável ausente, vazia ou com valor
 * inesperado EXIGE o IP. Configuração que falha ABERTO é como a maioria dos
 * furos nasce — um `ASAAS_ENV` esquecido em produção não pode virar porta
 * aberta. Perde-se uma camada onde não há dinheiro; nunca onde há.
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
    // FALHA FECHADA: só o valor EXPLÍCITO "sandbox" dispensa a allowlist de IP.
    // Variável ausente, vazia ou com valor inesperado ⇒ EXIGE o IP. Segredo de
    // configuração que falha ABERTO é como a maioria dos furos nasce.
    const EXIGE_IP = (Deno.env.get("ASAAS_ENV") ?? "").trim() !== "sandbox";

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
    if (EXIGE_IP && !ASAAS_PROD_IPS.includes(ip)) {
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
        payloadSnapshot: { ip: EXIGE_IP ? ip : null },
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

    // ── Aplica: histórico, assinatura, cupom ──────────────────────────────
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

    // A cobrança conhecida vem do LINK, não do histórico: é o link que carrega
    // o `quote` congelado na geração — plano, ciclo e valores. `payment_history`
    // não tem coluna de plano, então montar a assinatura a partir dele seria
    // chutar o `plan_id`, que é NOT NULL sem default.
    const { data: charge } = await supabase
      .from("payment_link_charges")
      .select("payment_link_id")
      .eq("provider_charge_id", d.paymentId)
      .maybeSingle();

    const { data: link } = charge
      ? await supabase
          .from("payment_links")
          .select("organization_id, quote")
          .eq("id", charge.payment_link_id)
          .maybeSingle()
      : { data: null };

    const quote = (link?.quote ?? null) as Record<string, unknown> | null;
    const orgId = (link?.organization_id ?? existente?.organization_id ?? null) as string | null;
    let assinou = false;

    const inteiro = (v: unknown, padrao = 0) =>
      typeof v === "number" && Number.isFinite(v) ? v : padrao;

    // ── O HISTÓRICO. Medido antes de escrever: NINGUÉM insere em
    // `payment_history` neste repositório — nem a fatia que cria a cobrança.
    // Se este handler só ATUALIZASSE, a tabela continuaria com zero linhas e a
    // fatia não entregaria o que promete: fazer o pagamento virar fato.
    //
    // Upsert sobre `payment_history_asaas_payment_id_key` (UNIQUE que já
    // existia): a mesma cobrança nunca vira duas linhas, e de novo é o BANCO
    // que garante. Os valores de criação vêm do `quote` do link — que é a
    // única fonte que carrega ciclo e desconto congelados.
    const centavos = inteiro(quote?.charge_cents, inteiro(quote?.monthly_cents));
    const { error: erroHistorico } = await supabase
      .from("payment_history")
      .upsert({
        organization_id: orgId,
        asaas_payment_id: d.paymentId,
        asaas_subscription_id: d.subscriptionId,
        amount: existente ? undefined : centavos / 100,
        billing_cycle: existente ? undefined : (quote?.billing_cycle ?? "monthly"),
        discount_applied: existente
          ? undefined
          : (inteiro(quote?.cycle_discount_cents) + inteiro(quote?.coupon_discount_cents) +
             inteiro(quote?.manual_discount_cents)) / 100,
        coupon_id: existente ? undefined : (typeof quote?.coupon_id === "string" ? quote.coupon_id : null),
        status: statusFinal,
        paid_at: d.paidAt ?? undefined,
        // ⚠️ DEPENDE do #1523 (migration 20270811160000): estas três colunas já
        // existem em PRODUÇÃO, mas NÃO na cadeia de migrations desta branch.
        // Num ambiente montado só daqui, o upsert falha, cai no log abaixo e o
        // evento ainda responde 200 — fail-soft, não fail-open. A ordem de
        // merge #1523 → #1535 resolve; invertida, o histórico nasce sem recibo.
        invoice_url: d.invoiceUrl ?? undefined,
        receipt_url: d.receiptUrl ?? undefined,
        billing_type: d.billingType ?? undefined,
      }, { onConflict: "asaas_payment_id", ignoreDuplicates: false });

    if (erroHistorico) {
      await logRuntime({
        module: "billing",
        organizationId: orgId ?? undefined,
        action: "asaas_webhook_historico_falhou",
        status: "error",
        errorMessage: erroHistorico.message,
        payloadSnapshot: { event_id: d.eventId, payment_id: d.paymentId },
      });
    }

    if (liberaAgora && orgId && quote && typeof quote.plan_id === "string") {
      const base = inteiro(quote.base_amount_cents, inteiro(quote.subtotal_cents));
      const finalCents = inteiro(quote.charge_cents, base);

      // VIA RPC, e não pelo cliente. `org_subscriptions_one_current_per_org` é
      // um índice PARCIAL (WHERE cancelled_at IS NULL), e o Postgres só o infere
      // se o comando REPETIR o predicado — que o PostgREST não sabe expressar
      // (`on_conflict` aceita nome de coluna, não cláusula WHERE).
      //
      // Escrever daqui estourava 42P10 em TODA chamada. E como este handler
      // engole erro e responde 200 — a fila do provedor pausa em 15 falhas —, a
      // organização nunca seria ativada, EM SILÊNCIO. O modo de falha contra o
      // qual a fatia inteira foi desenhada, entrando pelo argumento de uma
      // chamada. A garantia continua no BANCO; só mudou de onde é chamada.
      const { error: erroAssinatura } = await supabase.rpc("billing_apply_paid_subscription", {
        p_organization_id: orgId,
        p_plan_id: quote.plan_id,
        p_billing_cycle: quote.billing_cycle,
        p_payment_method: quote.payment_method,
        p_provider_payment_id: d.paymentId,
        p_seats: inteiro(quote.seats, 1),
        p_base_amount_cents: base,
        p_discount_amount_cents: inteiro(quote.cycle_discount_cents) +
          inteiro(quote.coupon_discount_cents) + inteiro(quote.manual_discount_cents),
        p_final_amount_cents: finalCents,
        p_cycle_discount_pct: inteiro(quote.cycle_discount_pct),
        p_coupon_discount_pct: inteiro(quote.coupon_discount_pct),
        p_manual_discount_cents: inteiro(quote.manual_discount_cents),
        p_coupon_id: typeof quote.coupon_id === "string" ? quote.coupon_id : null,
        p_provider: "asaas",
      });

      if (erroAssinatura) {
        await logRuntime({
          module: "billing",
          organizationId: orgId,
          action: "asaas_webhook_assinatura_falhou",
          status: "error",
          errorMessage: erroAssinatura.message,
          payloadSnapshot: { event_id: d.eventId, payment_id: d.paymentId },
        });
      } else {
        assinou = true;
      }
    }

    // Consumo do cupom: INSERIR no livro. A segunda vez é recusada pelo banco
    // (UNIQUE coupon_id, payment_id), então re-entrega não queima uso — e o
    // consumo pertence à CONFIRMAÇÃO, não à validação, porque validar é leitura
    // e o cliente abre o link dez vezes sem pagar.
    const cupomId = (typeof quote?.coupon_id === "string" ? quote.coupon_id : null) ??
      existente?.coupon_id ?? null;

    if (liberaAgora && cupomId) {
      const { error: erroCupom } = await supabase.from("coupon_redemptions").insert({
        coupon_id: cupomId,
        payment_id: d.paymentId,
        organization_id: orgId,
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
        organization_id: orgId,
        processed_at: new Date().toISOString(),
      })
      .eq("id", gravado.id);

    await logRuntime({
      module: "billing",
      organizationId: orgId ?? undefined,
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
        cobranca_conhecida: !!charge,
        assinou,
      },
    });

    return ok(headers, { received: true });
  }),
);
