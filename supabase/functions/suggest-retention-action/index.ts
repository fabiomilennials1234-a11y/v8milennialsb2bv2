/**
 * suggest-retention-action
 *
 * AI-powered next-best-action for client retention.
 * Fetches full client context, generates personalized suggestion via Gemini.
 * Caches result in retention_suggestions (24h TTL).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Você é um consultor de retenção B2B especializado em distribuidoras e fábricas.
Analise o contexto do cliente e retorne EXATAMENTE um JSON com:
{
  "action_type": "follow_up" | "offer" | "escalate" | "reactivate" | "upsell",
  "message": "mensagem sugerida para enviar ao cliente via WhatsApp (máx 300 chars, tom profissional mas amigável)",
  "reasoning": "explicação curta de por que essa ação (máx 200 chars)"
}

Regras:
- Se cliente está atrasado na recompra: priorize follow_up com referência ao produto habitual
- Se ticket está caindo: sugira offer com bundle ou condição especial
- Se churn_probability > 70: escalate para contato humano urgente
- Se health < 30 e sem pedido > 60 dias: reactivate com proposta de retorno
- Se health > 80 e ticket estável: upsell com produto complementar
- Nunca use emojis excessivos. Tom: profissional, consultivo, direto.
- A mensagem deve poder ser copiada e colada no WhatsApp sem edição.`;

Deno.serve(
  withSentry("suggest-retention-action", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    const jsonHeaders = { ...headers, "Content-Type": "application/json" };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      const { client_id } = await req.json();
      if (!client_id) {
        return new Response(
          JSON.stringify({ error: "client_id required" }),
          { status: 400, headers: jsonHeaders },
        );
      }

      const authHeader = req.headers.get("authorization") ?? "";
      const supabaseUser = createClient(SUPABASE_URL, authHeader.replace("Bearer ", "").trim() || SUPABASE_SERVICE_ROLE_KEY);
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      // Check cache (24h TTL)
      const { data: cached } = await supabaseUser
        .from("retention_suggestions")
        .select("*")
        .eq("client_id", client_id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (cached) {
        return new Response(JSON.stringify({ suggestion: cached, cached: true }), {
          status: 200,
          headers: jsonHeaders,
        });
      }

      // Fetch client context
      const { data: client } = await supabaseAdmin
        .from("upsell_clients")
        .select("id, organization_id, name, company, health_score, health_status, segment, avg_ticket, lifetime_value, order_count, reorder_cycle_days, days_since_last_order, next_order_expected, churn_probability, trend")
        .eq("id", client_id)
        .single();

      if (!client) {
        return new Response(
          JSON.stringify({ error: "Client not found" }),
          { status: 404, headers: jsonHeaders },
        );
      }

      // Fetch recent orders
      const { data: orders } = await supabaseAdmin
        .from("upsell_orders")
        .select("product_name, sale_value, sold_at")
        .eq("client_id", client_id)
        .order("sold_at", { ascending: false })
        .limit(5);

      // Fetch active alerts
      const { data: alerts } = await supabaseAdmin
        .from("client_alerts")
        .select("alert_type, severity, title")
        .eq("client_id", client_id)
        .eq("is_resolved", false)
        .limit(5);

      // Build context for AI
      const context = `
Cliente: ${client.name} (${client.company || "sem empresa"})
Segmento: ${client.segment || "indefinido"}
Health Score: ${client.health_score}/100 (${client.health_status})
Churn Probability: ${client.churn_probability}%
Ticket Médio: R$ ${client.avg_ticket?.toLocaleString("pt-BR") || "0"}
LTV: R$ ${client.lifetime_value?.toLocaleString("pt-BR") || "0"}
Pedidos: ${client.order_count || 0}
Ciclo de Recompra: ${client.reorder_cycle_days || "?"} dias
Dias sem pedido: ${client.days_since_last_order || "?"}
Tendência: ${client.trend || "estável"}
Próximo pedido esperado: ${client.next_order_expected ? new Date(client.next_order_expected).toLocaleDateString("pt-BR") : "indeterminado"}

Últimos pedidos:
${(orders || []).map((o: any) => `- ${o.product_name}: R$ ${o.sale_value} em ${new Date(o.sold_at).toLocaleDateString("pt-BR")}`).join("\n") || "Nenhum pedido registrado"}

Alertas ativos:
${(alerts || []).map((a: any) => `- [${a.severity}] ${a.title}`).join("\n") || "Nenhum alerta"}`;

      // Call Gemini via OpenRouter
      const apiKey = Deno.env.get("OPENROUTER_API_KEY");
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "AI not configured" }),
          { status: 503, headers: jsonHeaders },
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const aiResponse = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://torquecrm.com.br",
          "X-Title": "Torque CRM",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: context },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("[suggest-retention-action] AI error:", errText);
        return new Response(
          JSON.stringify({ error: "AI generation failed" }),
          { status: 502, headers: jsonHeaders },
        );
      }

      const aiData = await aiResponse.json();
      const content = aiData?.choices?.[0]?.message?.content ?? "";

      // Parse JSON from AI response
      let suggestion: { action_type: string; message: string; reasoning: string };
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        suggestion = JSON.parse(jsonMatch?.[0] ?? content);
      } catch {
        suggestion = {
          action_type: "follow_up",
          message: content.slice(0, 300),
          reasoning: "Sugestão gerada por IA",
        };
      }

      // Cache suggestion (upsert, 24h TTL)
      await supabaseAdmin.from("retention_suggestions").upsert(
        {
          client_id,
          organization_id: client.organization_id,
          action_type: suggestion.action_type,
          message: suggestion.message,
          reasoning: suggestion.reasoning,
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "client_id" },
      );

      return new Response(
        JSON.stringify({ suggestion, cached: false }),
        { status: 200, headers: jsonHeaders },
      );
    } catch (err) {
      console.error("[suggest-retention-action] Error:", err);
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
        { status: 500, headers: jsonHeaders },
      );
    }
  }),
);
