/**
 * billing-payment-link — a PORTA PÚBLICA do checkout (SCRUM-289, Fatia 6).
 *
 * A página do link de pagamento é pública: não há JWT. `billing_resolve_payment_link`
 * é service_role-only DE PROPÓSITO (Fatia 5), e é por isso que esta porta existe —
 * ela resolve o token pelo HASH usando service_role e devolve, para exibir, um
 * recorte de LISTA BRANCA.
 *
 * A autorização é o CONHECIMENTO DO TOKEN. Consequências, todas deliberadas:
 *
 *  - O TOKEN É CREDENCIAL. Nunca entra em log, em erro ou em telemetria. Quando
 *    resolve, o rastro é o `link_id`; quando não resolve, são os 8 primeiros hex
 *    do sha256, que não voltam para o token. Hoje mesmo apareceu backup em
 *    produção com credencial viva dentro — o custo desse descuido já é conhecido.
 *  - NADA DE `organization_id`, `link_id` ou do `quote` cru na resposta. O front
 *    pede CAMPO, nunca objeto (contrato fechado com o Fole antes do código).
 *  - HTTP 200 nos quatro estados conhecidos. Link vencido é desfecho, não
 *    incidente: a página tem que renderizar, e 4xx sujaria a telemetria de erro.
 *
 * Não confundir com os endpoints que ainda não existem: status do pagamento,
 * dados fiscais e criação da cobrança. Todos recebem o token de novo, mesma
 * costura, cada um na sua fatia.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { shapePublicLink, type PlanLabels, type ResolveResult } from "./shape.ts";

/**
 * Teto por IP. O token tem 16 bytes, então força bruta é inviável por
 * aritmética, não por freio — o freio existe contra enumeração barulhenta e
 * contra transformar a porta pública em bomba de leitura sobre o banco.
 * 20 em 5 min é folgado para o uso real (o front carrega UMA vez por sessão,
 * confirmado com o Fole) e apertado para quem estiver varrendo.
 */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = "5 minutes";
const RATE_LIMIT_ENDPOINT = "billing-payment-link";

/** Rastro seguro de um token que NÃO resolveu: não volta para o segredo. */
async function hashPrefix(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .slice(0, 4)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

Deno.serve(
  withErrorBoundary("billing-payment-link", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

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

    const { data: dentroDoTeto, error: erroTeto } = await supabase.rpc("check_auth_rate_limit", {
      p_ip: clientIp(req),
      p_endpoint: RATE_LIMIT_ENDPOINT,
      p_max: RATE_LIMIT_MAX,
      p_window: RATE_LIMIT_WINDOW,
    });

    // Freio quebrado NÃO vira porta aberta: sem conseguir contar, recusa. É o
    // lado seguro para errar numa porta sem autenticação.
    //
    // Para FORA, as duas causas devolvem o mesmo 429 — o visitante não tem que
    // aprender que o nosso freio quebrou. Para DENTRO, elas se separam: teto
    // estourado é o freio funcionando; erro de infra é o freio MORTO, e sem
    // registro próprio ele fecharia o checkout inteiro sem deixar rastro.
    if (erroTeto) {
      await logRuntime({
        module: "billing",
        action: "public_link_rate_limit",
        status: "error",
        errorMessage: erroTeto.message,
        payloadSnapshot: { fail_closed: true },
      });
    }

    if (erroTeto || dentroDoTeto === false) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { ...headers, "Retry-After": "300" },
      });
    }

    const { data, error } = await supabase.rpc("billing_resolve_payment_link", { p_token: token });

    if (error) {
      await logRuntime({
        module: "billing",
        action: "public_link_resolve",
        status: "error",
        errorMessage: error.message,
        payloadSnapshot: { token_hash_prefix: await hashPrefix(token) },
      });
      return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers });
    }

    const resolved = (data ?? { ok: false, code: "link_not_found" }) as ResolveResult;

    // Rótulos do plano: `quote.plan_name` é `subscription_plans.name`, a chave
    // estável. O rótulo de vitrine mora em `display_name`, e o front mapeia a
    // chave para linguagem de valor — regra do CTO: nunca exibir SKU.
    let plan: PlanLabels = { slug: null, name: null };
    let orgName: string | null = null;

    if (resolved.ok) {
      const planId = (resolved.quote as Record<string, unknown> | null)?.plan_id;
      if (typeof planId === "string") {
        const { data: planRow } = await supabase
          .from("subscription_plans")
          .select("name, display_name")
          .eq("id", planId)
          .maybeSingle();
        if (planRow) {
          plan = { slug: String(planRow.name ?? "") || null, name: String(planRow.display_name ?? "") || null };
        }
      }

      // Só para link de organização EXISTENTE, e só o nome. O `organization_id`
      // não sai daqui.
      if (resolved.target_kind === "existing_org" && resolved.organization_id) {
        const { data: orgRow } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", resolved.organization_id)
          .maybeSingle();
        orgName = orgRow?.name ? String(orgRow.name) : null;
      }
    }

    const body = shapePublicLink(resolved, plan, orgName, new Date());

    await logRuntime({
      module: "billing",
      action: "public_link_resolve",
      // `not_found` é onde uma VARREDURA aparece: rajada do mesmo IP é o sinal
      // de enumeração. Gravado como `success`, esse sinal ficaria enterrado no
      // mesmo balde do caso feliz — e quem procura ataque não filtra por
      // sucesso. `skipped` o separa sem mudar nada para o visitante.
      status: body.state === "not_found" ? "skipped" : "success",
      payloadSnapshot: {
        state: body.state,
        // Resolvido, o rastro é o id do link. Não resolvido, o prefixo do hash
        // — nunca o token.
        link_id: resolved.ok ? resolved.link_id ?? null : null,
        token_hash_prefix: resolved.ok ? null : await hashPrefix(token),
      },
    });

    return new Response(JSON.stringify(body), { status: 200, headers });
  }),
);
