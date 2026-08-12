/**
 * billing-quote — cotação do pacote para a tela de montagem do Master.
 *
 * POR QUE ESTA FUNÇÃO EXISTE, e por que NÃO é um wrapper RPC
 * ---------------------------------------------------------
 * `billing_quote_price` é `service_role`-only DE PROPÓSITO. A tela do Master
 * precisa cotar, e havia dois caminhos:
 *
 *   (a) um wrapper SECURITY DEFINER no banco, alcançável por `authenticated`;
 *   (b) esta edge function fina.
 *
 * O (a) foi descartado: seria uma função nova, com grant a `authenticated`,
 * cujo ÚNICO propósito é dar ao navegador acesso a algo deliberadamente posto
 * fora do alcance dele. Mesmo com `is_master_user()` no corpo, o desenho piora
 * — some a fronteira entre "o que o navegador alcança" e "o que só o servidor
 * alcança", e foi essa fronteira que separou as 23 RPCs fechadas em 2026-08-11
 * das que ficaram. Uma fronteira que se abre "só desta vez" não é fronteira.
 *
 * O (b) mantém a fronteira: o navegador fala com a edge, a edge fala com o
 * banco como `service_role`.
 *
 * SEM RATE LIMIT, e isto é escolha medida, não esquecimento
 * --------------------------------------------------------
 * A primeira versão deste raciocínio dizia que a edge seria "o lugar natural do
 * rate limit da cotação", porque o Master vai marretar isto mexendo nos
 * sliders. Olhando o motor, não se sustenta: `billing_quote_price` é `STABLE` e
 * lê uma linha de `subscription_plans` e uma de `coupons`. O custo de martelar
 * é desprezível, e um rate limit por requisição precisaria de ESCRITA de estado
 * — mais cara que a leitura que ela protegeria.
 *
 * O problema real é round-trip inútil a cada pixel de slider, e ele se resolve
 * com debounce NO HOOK, onde o martelo nasce. Se um dia a cotação ficar cara
 * (consulta ao gateway, imposto por município), o rate limit entra AQUI e este
 * comentário é o lugar de justificá-lo.
 *
 * AUTH: master-gate no mesmo padrão de `create-gestor` — anon key em
 * `Authorization: Bearer`, JWT real do usuário em `X-User-JWT`.
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

interface QuoteBody {
  plan_id: string;
  user_count: number;
  billing_cycle: string;
  payment_method?: string | null;
  coupon_code?: string | null;
  manual_final_cents?: number | null;
}

function json(data: Record<string, unknown>, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(
  withErrorBoundary("billing-quote", async (req: Request): Promise<Response> => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // ----- Master-gate (fail-closed) -----
    const userJwt =
      req.headers.get("X-User-JWT")?.trim() ||
      req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")?.trim() ||
      "";
    if (!userJwt || !SUPABASE_ANON_KEY) {
      return json({ success: false, error: "Unauthorized" }, 401, corsHeaders);
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await anonClient.auth.getUser(userJwt);
    if (userError || !user?.id) {
      return json({ success: false, error: "Unauthorized" }, 401, corsHeaders);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: masterRow } = await supabase
      .from("master_users")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!masterRow?.id) {
      return json({ success: false, error: "Forbidden" }, 403, corsHeaders);
    }

    // ----- Body -----
    let body: QuoteBody;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400, corsHeaders);
    }

    if (!body.plan_id || !body.billing_cycle) {
      return json({ success: false, error: "plan_id e billing_cycle são obrigatórios" }, 400, corsHeaders);
    }

    // ----- A cotação, e SÓ a cotação -----
    //
    // Esta função não decide preço, não aplica regra de venda e não guarda
    // nada: ela repassa o que o motor devolveu. Toda regra — pix não vende
    // mensal, desconto de ciclo, cupom, piso do preço manual — mora em
    // `billing_quote_price`, e é lá que ela deve continuar morando. Uma
    // validação "adiantada" aqui viraria a segunda cópia da regra, e cópia de
    // regra diverge.
    const { data, error } = await supabase.rpc("billing_quote_price", {
      p_plan_id: body.plan_id,
      p_user_count: body.user_count ?? 1,
      p_billing_cycle: body.billing_cycle,
      p_payment_method: body.payment_method ?? null,
      p_coupon_code: body.coupon_code ?? null,
      p_manual_final_cents: body.manual_final_cents ?? null,
    });

    if (error) {
      // A recusa do motor é RESPOSTA, não incidente: combinação impossível
      // (pix mensal) e plano inexistente chegam aqui como erro do Postgres e
      // precisam virar mensagem para o operador, não 500.
      return json(
        { success: false, error: "quote_refused", message: error.message },
        422,
        corsHeaders,
      );
    }

    return json({ success: true, quote: data }, 200, corsHeaders);
  }),
);
