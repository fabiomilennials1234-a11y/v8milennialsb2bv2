/**
 * billing-payment-status — "e aí, caiu?" (SCRUM-289, Fatia 8).
 *
 * A página de checkout é pública e não tem JWT. A autorização é o CONHECIMENTO
 * DO TOKEN, igual à `billing-payment-link` — e as mesmas consequências valem,
 * todas deliberadas:
 *
 *  - O TOKEN É CREDENCIAL. Nunca em log, erro ou telemetria. Quando resolve, o
 *    rastro é o `link_id`; quando não resolve, são 8 hex do sha256, que não
 *    voltam para o token.
 *  - HTTP 200 nos quatro estados. "Expirado" e "falhou" são DESFECHOS, não
 *    incidentes: a página tem que renderizar, e 4xx sujaria a telemetria de erro
 *    de um caminho que funcionou como projetado.
 *  - Devolve `state`, nunca frase. A copy é do front, e microcopy em dois
 *    lugares vira drift na primeira vez que alguém mexe no tom.
 *
 * TETO PRÓPRIO, e por que o da porta do link NÃO serve
 * ---------------------------------------------------
 * `billing-payment-link` tem 20 requisições por 5 min por IP, e está certo lá:
 * o front a chama UMA vez por sessão. Aqui o front PERGUNTA — 3s nos primeiros
 * 2 min, 10s depois —, o que já dá 40 perguntas antes do segundo minuto. O teto
 * de 20 reprovaria o uso legítimo e a tela ficaria "aguardando" para quem pagou.
 * O número aqui é dimensionado pelo intervalo, e o intervalo mora em
 * `status.ts` junto com ele, porque dois números que precisam concordar não
 * moram em dois arquivos.
 *
 * NADA DE PII NA RESPOSTA. Este endpoint não devolve comprador, valor, nem
 * organização: devolve o estado e a hora do pagamento. O `paid_at` é do próprio
 * pagador, que é quem está com a página aberta.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { resolverStatusDeTela, type EventoDoLivro } from "./status.ts";

/**
 * 3s por 2 min = 40, mais 10s por ~4 min = 24. 80 em 5 min dá folga para uma
 * recarga de página no meio sem punir quem está pagando, e continua apertado
 * para quem quiser varrer.
 */
const RATE_LIMIT_MAX = 80;
const RATE_LIMIT_WINDOW = "5 minutes";
const RATE_LIMIT_ENDPOINT = "billing-payment-status";

/**
 * SEGUNDO teto, por IP, e MUITO mais frouxo — os dois medem coisas diferentes.
 *
 * O teto por token é o orçamento de UMA compra. Sozinho, ele não vê quem varre:
 * cada token novo estreia com orçamento cheio, então uma máquina sorteando
 * tokens nunca esbarra nele. O teto por IP é quem enxerga isso.
 *
 * E o inverso também vale, que é por que o de IP não pode ser o único: atrás de
 * CGNAT ou da rede de uma empresa, dois compradores legítimos dividem o mesmo
 * IP e um derrubaria o outro no meio do pagamento. Um teto aperta o abuso, o
 * outro protege o uso — trocar um pelo outro quebra metade.
 */
const RATE_LIMIT_IP_MAX = 400;
const RATE_LIMIT_IP_ENDPOINT = "billing-payment-status:ip";

async function sha256Hex(entrada: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entrada));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Rastro seguro de um token que NÃO resolveu: não volta para o segredo. */
async function hashPrefix(token: string): Promise<string> {
  return (await sha256Hex(token)).slice(0, 8);
}

/**
 * Chave de balde do teto por token — e ela NÃO é o hash do token.
 *
 * `payment_links.token_hash` É `sha256(token)` em hex. Se o balde usasse esse
 * mesmo valor, `auth_rate_limits` passaria a guardar, em claro, a chave de busca
 * da proposta — e essa tabela não tem o cuidado que `payment_links` tem. Quem
 * lesse os baldes teria a coluna por onde se resolve um link.
 *
 * Com o prefixo de domínio o valor é outro, não serve para procurar nada, e
 * continua estável por token — que é tudo o que um balde precisa.
 */
async function chaveDoBalde(token: string): Promise<string> {
  return (await sha256Hex(`ratelimit:billing-payment-status:${token}`)).slice(0, 32);
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

Deno.serve(
  withErrorBoundary("billing-payment-status", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
    }

    let token: unknown;
    try {
      token = (await req.json())?.token;
    } catch {
      return new Response(JSON.stringify({ error: "malformed_body" }), { status: 400, headers });
    }
    if (typeof token !== "string" || token.length === 0) {
      return new Response(JSON.stringify({ error: "malformed_body" }), { status: 400, headers });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // O parâmetro é `p_max`. A primeira versão daqui escrevia `p_max_attempts`,
    // que NÃO existe na assinatura — o PostgREST devolvia erro, e como o freio
    // falha ABERTO por desenho (ver abaixo), ele nunca teria contado nada. Freio
    // que nasce quebrado e falha aberto é pior que freio nenhum: dá a sensação
    // de proteção. A porta irmã já estava certa; conferi as duas lado a lado.
    //
    // `p_ip` é o nome da coluna do balde, não uma exigência de que seja um IP:
    // a função é um contador por (chave, endpoint). Aqui a chave é derivada do
    // TOKEN — cada compra tem o próprio orçamento.
    const { data: dentroDoTeto, error: erroTeto } = await supabase.rpc("check_auth_rate_limit", {
      p_ip: await chaveDoBalde(token),
      p_endpoint: RATE_LIMIT_ENDPOINT,
      p_max: RATE_LIMIT_MAX,
      p_window: RATE_LIMIT_WINDOW,
    });

    const { data: dentroDoTetoIp, error: erroTetoIp } = await supabase.rpc("check_auth_rate_limit", {
      p_ip: clientIp(req),
      p_endpoint: RATE_LIMIT_IP_ENDPOINT,
      p_max: RATE_LIMIT_IP_MAX,
      p_window: RATE_LIMIT_WINDOW,
    });

    if (dentroDoTetoIp === false) {
      await logRuntime({
        module: "billing",
        action: "payment_status_teto_ip_atingido",
        status: "error",
        payloadSnapshot: { endpoint: RATE_LIMIT_IP_ENDPOINT },
      });
      return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers });
    }
    if (erroTetoIp) {
      await logRuntime({
        module: "billing",
        action: "payment_status_freio_ip_falhou",
        status: "error",
        errorMessage: erroTetoIp.message,
        payloadSnapshot: { endpoint: RATE_LIMIT_IP_ENDPOINT },
      });
    }

    // Freio que falha REGISTRANDO. Um freio que barra sem deixar rastro é
    // indistinguível de um freio quebrado — e a distinção só aparece no dia em
    // que alguém pergunta por que ninguém consegue pagar.
    if (erroTeto || dentroDoTeto === false) {
      await logRuntime({
        module: "billing",
        action: erroTeto ? "payment_status_freio_falhou" : "payment_status_teto_atingido",
        status: "error",
        errorMessage: erroTeto?.message,
        payloadSnapshot: { endpoint: RATE_LIMIT_ENDPOINT },
      });
      if (erroTeto) {
        // Freio quebrado NÃO fecha a porta: quem está pagando não pode ficar
        // preso porque a nossa contagem falhou. Registra e segue.
      } else {
        return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers });
      }
    }

    const { data: resolvido, error: erroResolve } = await supabase.rpc(
      "billing_resolve_payment_link",
      { p_token: token },
    );

    if (erroResolve) {
      await logRuntime({
        module: "billing",
        action: "payment_status_resolve_falhou",
        status: "error",
        errorMessage: erroResolve.message,
        // O token NÃO entra. O prefixo do hash identifica a tentativa sem
        // devolver o segredo.
        payloadSnapshot: { token_hash_prefix: await hashPrefix(token) },
      });
      return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers });
    }

    const r = (resolvido ?? {}) as Record<string, unknown>;
    const linkCode = typeof r.code === "string" ? r.code : "link_not_found";
    const linkId = typeof r.link_id === "string" ? r.link_id : null;
    const expiresAt = typeof r.expires_at === "string" ? r.expires_at : null;

    // As cobranças DESTE link — é por elas que se acha o pagamento no livro. Sem
    // link resolvido não há o que casar, e o resolvedor puro já sabe o que
    // responder para cada código.
    let eventos: EventoDoLivro[] = [];
    if (linkId) {
      const { data: cobrancas } = await supabase
        .from("payment_link_charges")
        .select("provider_charge_id")
        .eq("payment_link_id", linkId);

      const ids = (cobrancas ?? [])
        .map(c => (c as { provider_charge_id?: string }).provider_charge_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);

      if (ids.length > 0) {
        // `payment_webhook_events` e não `org_subscriptions`: no ramo `new_org`
        // a organização só existe DEPOIS (Fatia 9), e `payment_history` recusa
        // linha sem organização. O porquê completo está em `status.ts` — leia
        // antes de "melhorar" esta consulta.
        const { data: linhas } = await supabase
          .from("payment_webhook_events")
          .select("provider_event_id, event_type, payload")
          .in("provider_payment_id", ids);

        eventos = (linhas ?? []).map(l => {
          const p = (l as { payload?: Record<string, unknown> }).payload ?? {};
          const pagamento = (p.payment ?? {}) as Record<string, unknown>;
          const data = pagamento.confirmedDate ?? pagamento.paymentDate;
          return {
            event_id: (l as { provider_event_id?: string }).provider_event_id ?? null,
            event_type: (l as { event_type?: string }).event_type ?? null,
            paid_at: typeof data === "string" ? data : null,
          };
        });
      }
    }

    const resultado = resolverStatusDeTela({
      linkCode,
      expiresAt,
      eventos,
      now: new Date(),
    });

    return new Response(JSON.stringify(resultado), { status: 200, headers });
  }),
);
