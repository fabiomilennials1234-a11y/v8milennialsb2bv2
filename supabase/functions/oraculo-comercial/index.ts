import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { unauthorizedResponse } from "../_shared/auth.ts";
import { assertPlanFeature, PlanFeatureDeniedError, planDeniedResponse } from "../_shared/plan-gate.ts";

import { oraculoCommercialMode } from "./mode.ts";

async function fetchConversationContext(
  supabase: any,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  // 1. Prioritize conversation_summaries — richest source
  const { data: summaries } = await supabase
    .from("conversation_summaries")
    .select("summary, key_points, sentiment, lead_temperature, objections, questions_asked, next_action, coaching_tips, created_at")
    .eq("organization_id", organizationId)
    .gte("created_at", startDate)
    .lte("created_at", endDate)
    .order("created_at", { ascending: false })
    .limit(15);

  if (summaries && summaries.length > 0) {
    const objections = new Map<string, number>();
    const questions = new Map<string, number>();
    const sentiments = { positive: 0, neutral: 0, negative: 0 };
    const temperatures = { hot: 0, warm: 0, cold: 0 };
    const tips: string[] = [];

    for (const s of summaries) {
      if (s.sentiment) sentiments[s.sentiment as keyof typeof sentiments] = (sentiments[s.sentiment as keyof typeof sentiments] || 0) + 1;
      if (s.lead_temperature) temperatures[s.lead_temperature as keyof typeof temperatures] = (temperatures[s.lead_temperature as keyof typeof temperatures] || 0) + 1;
      for (const obj of (s.objections || [])) {
        objections.set(obj, (objections.get(obj) || 0) + 1);
      }
      for (const q of (s.questions_asked || [])) {
        questions.set(q, (questions.get(q) || 0) + 1);
      }
      if (s.coaching_tips) tips.push(...s.coaching_tips.slice(0, 2));
    }

    const topObjections = [...objections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topQuestions = [...questions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    return `
CONTEXTO DE CONVERSAS (${summaries.length} conversas analisadas no período):
- Sentimento: ${sentiments.positive} positivas, ${sentiments.neutral} neutras, ${sentiments.negative} negativas
- Temperatura: ${temperatures.hot} quentes, ${temperatures.warm} mornas, ${temperatures.cold} frias
- Objeções mais frequentes: ${topObjections.length > 0 ? topObjections.map(([o, c]) => `"${o}" (${c}x)`).join(", ") : "nenhuma registrada"}
- Perguntas mais comuns dos leads: ${topQuestions.length > 0 ? topQuestions.map(([q, c]) => `"${q}" (${c}x)`).join(", ") : "nenhuma registrada"}
- Dicas de coaching: ${tips.slice(0, 3).join("; ") || "nenhuma"}
- Últimos resumos:
${summaries.slice(0, 3).map((s: any) => `  • ${s.summary?.slice(0, 200) || "sem resumo"}`).join("\n")}`;
  }

  // 2. Fallback: conversation_messages via conversations join
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .gte("last_message_at", startDate)
    .lte("last_message_at", endDate)
    .order("last_message_at", { ascending: false })
    .limit(10);

  if (conversations && conversations.length > 0) {
    const convIds = conversations.map((c: any) => c.id);
    const { data: convMessages } = await supabase
      .from("conversation_messages")
      .select("role, content, created_at, conversation_id")
      .in("conversation_id", convIds)
      .neq("role", "system")
      .order("created_at", { ascending: false })
      .limit(40);

    if (convMessages && convMessages.length > 0) {
      const userMsgs = convMessages.filter((m: any) => m.role === "user");
      const assistantMsgs = convMessages.filter((m: any) => m.role === "assistant");
      return `
CONTEXTO DE CONVERSAS (amostra de ${convMessages.length} mensagens de ${conversations.length} conversas no período):
- Mensagens de leads: ${userMsgs.length}
- Mensagens do agente: ${assistantMsgs.length}
- Últimas mensagens de leads:
${userMsgs.slice(0, 5).map((m: any) => `  • "${m.content?.slice(0, 150)}"`).join("\n")}
- Últimas respostas do agente:
${assistantMsgs.slice(0, 3).map((m: any) => `  • "${m.content?.slice(0, 150)}"`).join("\n")}`;
    }
  }

  // 3. Fallback: recent whatsapp_messages sample
  const { data: recentMessages } = await supabase
    .from("whatsapp_messages")
    .select("direction, content, created_at")
    .eq("organization_id", organizationId)
    .eq("message_type", "text")
    .not("content", "is", null)
    .gte("created_at", startDate)
    .lte("created_at", endDate)
    .order("created_at", { ascending: false })
    .limit(30);

  if (recentMessages && recentMessages.length > 0) {
    const incoming = recentMessages.filter((m: any) => m.direction === "incoming");
    const outgoing = recentMessages.filter((m: any) => m.direction === "outgoing");
    return `
CONTEXTO DE CONVERSAS (amostra de ${recentMessages.length} mensagens WhatsApp do período):
- Mensagens de leads: ${incoming.length}
- Mensagens da equipe: ${outgoing.length}
- Últimas mensagens de leads:
${incoming.slice(0, 5).map((m: any) => `  • "${m.content?.slice(0, 150)}"`).join("\n")}`;
  }

  return "\nCONTEXTO DE CONVERSAS: Nenhuma conversa registrada no período.";
}

// ---- TV Analysis mode handler (structured diagnosis for TV Dashboard) ----
async function handleTVAnalysisMode(body: any, corsHeaders: Record<string, string>) {
  const { organization_id, tv_data, team_members } = body;

  if (!organization_id) {
    return new Response(
      JSON.stringify({ error: "Missing organization_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Auth is already validated in the main handler — organization_id is the verified one from JWT

  // Sanitize tv_data input
  const safeTvData = tv_data && typeof tv_data === "object" ? {
    metaVendasMes: Number(tv_data.metaVendasMes) || 0,
    vendasRealizadas: Number(tv_data.vendasRealizadas) || 0,
    ondeDeveriamEstar: Number(tv_data.ondeDeveriamEstar) || 0,
    propostasQuentes: Array.isArray(tv_data.propostasQuentes) ? tv_data.propostasQuentes.slice(0, 20) : [],
  } : { metaVendasMes: 0, vendasRealizadas: 0, ondeDeveriamEstar: 0, propostasQuentes: [] };

  // Sanitize team_members
  const safeTeamMembers = Array.isArray(team_members) ? team_members.slice(0, 50) : [];

  const now = new Date();
  const targetMonth = Number(body.month) || (now.getMonth() + 1);
  const targetYear = Number(body.year) || now.getFullYear();
  const isCurrentMonth = targetMonth === (now.getMonth() + 1) && targetYear === now.getFullYear();

  const dayOfMonth = isCurrentMonth ? now.getDate() : new Date(Date.UTC(targetYear, targetMonth, 0)).getDate();
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const diasRestantes = isCurrentMonth ? daysInMonth - dayOfMonth : 0;
  const progressoEsperado = ((dayOfMonth / daysInMonth) * 100).toFixed(0);

  // Fetch rich context
  const startOfMonth = new Date(Date.UTC(targetYear, targetMonth - 1, 1)).toISOString();
  const endOfMonth = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999)).toISOString();

  const [metricsRes, rankingRes, conversationContext] = await Promise.all([
    supabase.rpc("get_dashboard_metrics", {
      p_org_id: organization_id,
      p_start_date: startOfMonth,
      p_end_date: endOfMonth,
      p_filter_member_id: null,
    }),
    supabase.rpc("get_ranking_data", {
      p_month: targetMonth,
      p_year: targetYear,
      p_organization_id: organization_id,
    }),
    fetchConversationContext(supabase, organization_id, startOfMonth, endOfMonth),
  ]);

  const m = Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data;
  const ranking = Array.isArray(rankingRes.data) ? rankingRes.data[0] : rankingRes.data;

  // Build the rich context prompt
  const tvMetrics = safeTvData;
  const metaVendas = tvMetrics.metaVendasMes || 0;
  const vendasRealizadas = tvMetrics.vendasRealizadas || m?.vendaTotal || 0;
  const ondeDeveria = tvMetrics.ondeDeveriamEstar || ((metaVendas * dayOfMonth) / daysInMonth);
  const diferenca = vendasRealizadas - ondeDeveria;

  const salesRanking = ranking?.salesRanking || [];
  const meetingsRanking = ranking?.meetingsRanking || ranking?.sdrRanking || [];

  // Build team member context
  const membersContext = safeTeamMembers.map((tm: any) => {
    const isSales = tm.metric_type === "sales";
    return `- ${tm.name} (${isSales ? "Vendedor" : "Pré-Venda"}): ${
      isSales
        ? `R$ ${(tm.current || 0).toLocaleString("pt-BR")} / meta R$ ${(tm.goal || 0).toLocaleString("pt-BR")} (${tm.percentage || 0}%)`
        : `${tm.current || 0} / meta ${tm.goal || 0} reuniões (${tm.percentage || 0}%)`
    }`;
  }).join("\n");

  const systemPrompt = `Você é o Oráculo Comercial — um executivo comercial sênior que analisa a operação em tempo real e entrega diagnósticos acionáveis.

Você NÃO é um coach motivacional. Você é um analista de receita pragmático. Seu trabalho é identificar gargalos, oportunidades e dar direção clara.

DADOS OPERACIONAIS DO MÊS (dia ${dayOfMonth} de ${daysInMonth}, faltam ${diasRestantes} dias):

RECEITA:
- Meta: R$ ${metaVendas.toLocaleString("pt-BR")}
- Realizado: R$ ${vendasRealizadas.toLocaleString("pt-BR")}
- Deveria estar em: R$ ${Math.round(ondeDeveria).toLocaleString("pt-BR")}
- Diferença: ${diferenca >= 0 ? "+" : ""}R$ ${Math.round(diferenca).toLocaleString("pt-BR")} (${diferenca >= 0 ? "ACIMA" : "ATRÁS"})
- Progresso esperado: ${progressoEsperado}% do mês

FUNIL:
- Leads captados: ${m?.totalLeads || 0}
- Reuniões marcadas: ${m?.reunioesMarcadas || 0}
- Reuniões comparecidas: ${m?.reunioesComparecidas || 0}
- Propostas enviadas: ${m?.propostasEnviadas || 0}
- Vendas fechadas: ${m?.novosClientes || 0}
- Taxa de conversão geral: ${(m?.taxaConversao || m?.taxaConversaoGeral || 0).toFixed(1)}%
- Taxa no-show: ${(m?.taxaNoShow || 0).toFixed(1)}%
- Ticket médio recorrência: R$ ${(m?.ticketMedioMRR || 0).toLocaleString("pt-BR")}
- Ticket médio projeto: R$ ${(m?.ticketMedioProjeto || 0).toLocaleString("pt-BR")}

PROPOSTAS QUENTES: ${(tvMetrics.propostasQuentes || []).length} em andamento
${(tvMetrics.propostasQuentes || []).slice(0, 5).map((p: any) => `- ${p.lead?.name || "Lead"}: R$ ${(p.sale_value || 0).toLocaleString("pt-BR")}`).join("\n")}

METAS INDIVIDUAIS:
${membersContext || "Sem dados de metas individuais"}

TOP VENDEDORES:
${salesRanking.slice(0, 5).map((s: any, i: number) => `${i + 1}. ${s.name}: R$ ${(s.value || 0).toLocaleString("pt-BR")} (${s.goalProgress || 0}% da meta)`).join("\n") || "Sem dados"}

TOP SDRs:
${meetingsRanking.slice(0, 5).map((s: any, i: number) => `${i + 1}. ${s.name}: ${s.meetings || s.value || 0} reuniões (${s.goalProgress || 0}% da meta)`).join("\n") || "Sem dados"}
${conversationContext}

REGRAS DE RESPOSTA:
- Responda APENAS em JSON válido conforme o formato abaixo
- Use SOMENTE dados acima — NUNCA invente números
- Seja direto, executivo, pragmático
- Foque em AÇÃO, não em motivação
- Cada campo deve ter no máximo 2 frases
- Para vendor_actions: identifique os 3 vendedores que mais precisam de atenção (pior desempenho, maior oportunidade, ou risco)

FORMATO JSON OBRIGATÓRIO:
{
  "diagnostico": "Frase principal: qual o estado real da operação AGORA",
  "causa": "Por que está acontecendo — gargalo específico identificado",
  "acao_prioritaria": "A ÚNICA coisa mais importante que precisa acontecer HOJE",
  "acao_secundaria": "Segunda ação de maior impacto",
  "oportunidade": "Ganho rápido identificado nos dados (ou null se não houver)",
  "alerta": "Risco crítico que precisa de atenção (ou null se estiver tudo ok)",
  "vendor_actions": [
    { "name": "Nome do vendedor", "action": "O que essa pessoa precisa fazer agora", "reason": "Por que" }
  ]
}`;

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  const referer = Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com";

  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Analise a operação e entregue o diagnóstico completo em JSON." },
      ],
      temperature: 0.5,
      max_tokens: 800,
    }),
  });

  const fallbackResult: Record<string, any> = {
    diagnostico: "Análise temporariamente indisponível",
    causa: "O serviço de IA está temporariamente fora do ar",
    acao_prioritaria: "Revise o pipeline e priorize follow-ups pendentes",
    acao_secundaria: "Atualize as metas individuais no sistema",
    oportunidade: null,
    alerta: null,
    vendor_actions: [],
  };

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("OpenRouter error:", aiResponse.status, errorText);

    if (aiResponse.status === 429) {
      fallbackResult.causa = "Rate limit atingido — tentando novamente em breve";
    } else if (aiResponse.status === 402) {
      fallbackResult.causa = "Créditos de IA insuficientes";
      fallbackResult.alerta = "Créditos OpenRouter esgotados. Recarregue para restaurar o Coach IA.";
    }

    return new Response(JSON.stringify(fallbackResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const aiData = await aiResponse.json();
  const content = aiData.choices?.[0]?.message?.content || "";

  let result: any = null;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      result = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse TV analysis response:", content);
  }

  if (!result) {
    result = fallbackResult;
  }

  await logRuntime({
    module: "copilot",
    action: "oraculo_tv_analysis",
    status: "success",
    payloadSnapshot: { organization_id, day: dayOfMonth },
  });

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---- Main handler ----
serve(withErrorBoundary('oraculo-comercial', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Auth: validate JWT and resolve caller's org ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorizedResponse("Missing Authorization header", corsHeaders);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const jwt = authHeader.slice(7);
  const supabaseUser = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return unauthorizedResponse("Invalid token", corsHeaders);
  }
  const userId = userData.user.id;

  const supabaseAdmin = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();

    // Resolve caller's organization via team_members.
    // If body includes organization_id, verify the user belongs to that org
    // (handles master users with multiple team_member rows).
    let memberQuery = supabaseAdmin
      .from("team_members")
      .select("organization_id")
      .eq("user_id", userId);
    if (body.organization_id) {
      memberQuery = memberQuery.eq("organization_id", body.organization_id);
    }
    const { data: member } = await memberQuery.limit(1).single();
    if (!member?.organization_id) {
      return unauthorizedResponse("User has no organization", corsHeaders);
    }
    const verifiedOrgId = member.organization_id;

    body.organization_id = verifiedOrgId;
    body.user_id = userId;

    // Plan gate — oraculo fora do plano → 403 antes de qualquer modo/side-effect.
    // Addon turbo materializa via organization_features (coberto pela RPC).
    try {
      await assertPlanFeature(supabaseAdmin, verifiedOrgId, "oraculo");
    } catch (e) {
      if (e instanceof PlanFeatureDeniedError) return planDeniedResponse(e, corsHeaders);
      throw e; // fail-closed: catch externo devolve 500
    }

    if (oraculoCommercialMode(body) !== "tv_analysis") {
      return new Response(
        JSON.stringify({ error: "mode_not_supported" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return await handleTVAnalysisMode(body, corsHeaders);
  } catch (e) {
    console.error("oraculo-comercial error:", e);
    await logRuntime({
      module: "copilot",
      action: "oraculo_error",
      status: "error",
      errorMessage: e instanceof Error ? e.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
