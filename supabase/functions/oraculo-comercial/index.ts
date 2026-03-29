import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logRuntime } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MetricsData {
  role?: "sdr" | "closer"; // deprecated, use metric_type
  metric_type?: "meetings" | "sales";
  // Meetings (SDR) metrics
  confirmados?: number;
  metaReuniao?: number;
  percentualMeta?: number;
  // Sales (Closer) metrics
  faturamento?: number;
  metaVendas?: number;
  totalGanhos?: number;
  numeroVendas?: number;
  // Common
  diaDoMes?: number;
  diasRestantes?: number;
}

// ---- Chat mode handler ----
async function handleChatMode(body: any) {
  const { question, user_id, organization_id } = body;

  if (!question || !user_id || !organization_id) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: question, user_id, organization_id" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create supabase client with service role for DB access
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Check + record rate limit in one call (backend enforcement)
  const { data: limitResult, error: limitError } = await supabase.rpc("record_oraculo_usage", {
    p_user_id: user_id,
    p_org_id: organization_id,
    p_question: question,
    p_response: null,
  });

  if (limitError) {
    console.error("Rate limit check error:", limitError);
    return new Response(
      JSON.stringify({ error: "Erro ao verificar limite de uso" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const limitData = Array.isArray(limitResult) && limitResult.length > 0 ? limitResult[0] : limitResult;
  if (limitData?.error === "limit_exceeded") {
    return new Response(
      JSON.stringify({ error: "limit_exceeded", used: limitData.used, remaining: 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch org metrics for context
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();
  const endOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

  const [metricsRes, rankingRes] = await Promise.all([
    supabase.rpc("get_dashboard_metrics", {
      p_org_id: organization_id,
      p_start_date: startOfMonth,
      p_end_date: endOfMonth,
      p_filter_member_id: null,
    }),
    supabase.rpc("get_ranking_data", {
      p_month: now.getMonth() + 1,
      p_year: now.getFullYear(),
      p_organization_id: organization_id,
    }),
  ]);

  const metrics = Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data;
  const ranking = Array.isArray(rankingRes.data) ? rankingRes.data[0] : rankingRes.data;

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const contextPrompt = `Você é o Oráculo Comercial, um assistente de inteligência comercial B2B. Responda com base nos dados reais do sistema.

DADOS DA OPERAÇÃO (mês atual):
- Receita: R$ ${metrics?.vendaTotal || 0}
- Leads captados: ${metrics?.totalLeads || 0}
- Reuniões marcadas: ${metrics?.reunioesMarcadas || 0}
- Reuniões comparecidas: ${metrics?.reunioesComparecidas || 0}
- Propostas enviadas: ${metrics?.propostasEnviadas || 0}
- Vendas fechadas: ${metrics?.novosClientes || 0}
- Ticket médio: R$ ${metrics?.ticketMedio || 0}
- Ticket médio MRR: R$ ${metrics?.ticketMedioMRR || 0}
- Ticket médio Projeto: R$ ${metrics?.ticketMedioProjeto || 0}
- Taxa no-show: ${metrics?.taxaNoShow || 0}%
- Dia ${dayOfMonth} de ${daysInMonth}

RANKING DE VENDEDORES:
${JSON.stringify(ranking?.salesRanking?.slice(0, 5) || [], null, 2)}

RANKING SDRs:
${JSON.stringify(ranking?.sdrRanking?.slice(0, 5) || [], null, 2)}

REGRAS:
- Responda SEMPRE com base nos dados acima
- NUNCA invente números
- Seja direto e executivo
- Use linguagem de operação comercial B2B
- Se não tiver dados suficientes para responder, diga claramente
- Mantenha respostas concisas (máximo 4 parágrafos)`;

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
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: contextPrompt },
        { role: "user", content: question },
      ],
      temperature: 0.6,
      max_tokens: 500,
    }),
  });

  if (!aiResponse.ok) {
    if (aiResponse.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Tente novamente em alguns segundos." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (aiResponse.status === 402) {
      return new Response(
        JSON.stringify({ error: "Créditos insuficientes." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    throw new Error("OpenRouter error");
  }

  const aiData = await aiResponse.json();
  const responseText = aiData.choices?.[0]?.message?.content || "Não consegui gerar uma resposta.";

  // Update the usage record with the response
  await supabase
    .from("oraculo_usage")
    .update({ response: responseText })
    .eq("user_id", user_id)
    .eq("question", question)
    .order("created_at", { ascending: false })
    .limit(1);

  await logRuntime({
    module: "copilot",
    action: "oraculo_chat",
    status: "success",
    payloadSnapshot: { user_id, question_length: question.length },
  });

  return new Response(
    JSON.stringify({ response: responseText, remaining: limitData?.remaining ?? 0 }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ---- Legacy mode handler (problema + tarefa) ----
async function handleLegacyMode(metrics: MetricsData) {
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  const referer = Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com";

  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const systemPrompt = `Você é um coach comercial direto e pragmático. Você analisa métricas e dá UMA única tarefa prioritária do dia.

REGRAS:
- Responda APENAS em formato JSON válido
- Seja direto e específico
- Foque no problema mais urgente
- Dê uma tarefa prática e executável
- Use linguagem informal e motivadora
- Limite a 2 frases curtas no máximo por campo

FORMATO OBRIGATÓRIO (JSON):
{
  "problema": "frase curta descrevendo o problema principal",
  "tarefa": "ação específica e prática para resolver"
}`;

  let userPrompt = "";

  const isMeetings = metrics.metric_type === "meetings" || (!metrics.metric_type && metrics.role === "sdr");

  if (isMeetings) {
    const progresso = metrics.percentualMeta || 0;
    const confirmados = metrics.confirmados || 0;
    const meta = metrics.metaReuniao || 20;
    const diasRestantes = metrics.diasRestantes || 15;
    const faltam = meta - confirmados;

    userPrompt = `Métricas do SDR:
- Confirmados no mês: ${confirmados}
- Meta de reuniões: ${meta}
- Progresso: ${progresso.toFixed(0)}%
- Faltam: ${faltam} reuniões
- Dias restantes no mês: ${diasRestantes}
- Média necessária: ${(faltam / diasRestantes).toFixed(1)} confirmações/dia

Qual o problema principal e qual a tarefa prioritária de hoje?`;
  } else {
    const faturamento = metrics.faturamento || 0;
    const meta = metrics.metaVendas || 10000;
    const progresso = metrics.percentualMeta || 0;
    const diasRestantes = metrics.diasRestantes || 15;
    const vendas = metrics.numeroVendas || 0;
    const falta = meta - faturamento;

    userPrompt = `Métricas do Closer:
- Faturamento no mês: R$ ${faturamento.toLocaleString("pt-BR")}
- Meta de vendas: R$ ${meta.toLocaleString("pt-BR")}
- Progresso: ${progresso.toFixed(0)}%
- Faltam: R$ ${falta.toLocaleString("pt-BR")}
- Número de vendas: ${vendas}
- Dias restantes no mês: ${diasRestantes}

Qual o problema principal e qual a tarefa prioritária de hoje?`;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Tente novamente em alguns segundos." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (response.status === 402) {
      return new Response(
        JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao workspace." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const errorText = await response.text();
    console.error("OpenRouter error:", response.status, errorText);
    throw new Error("OpenRouter error");
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  let result = { problema: "", tarefa: "" };
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      result = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse AI response:", content);
    result = {
      problema: "Não consegui analisar as métricas",
      tarefa: "Revise seu pipeline e priorize follow-ups pendentes",
    };
  }

  await logRuntime({
    module: "copilot",
    action: "oraculo_analyze",
    status: "success",
    payloadSnapshot: { metric_type: metrics.metric_type || (metrics.role === "sdr" ? "meetings" : "sales"), role: metrics.role },
  });

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---- TV Analysis mode handler (structured diagnosis for TV Dashboard) ----
async function handleTVAnalysisMode(body: any) {
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

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const diasRestantes = daysInMonth - dayOfMonth;
  const progressoEsperado = ((dayOfMonth / daysInMonth) * 100).toFixed(0);

  // Fetch rich context
  const startOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString();
  const endOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

  const [metricsRes, rankingRes] = await Promise.all([
    supabase.rpc("get_dashboard_metrics", {
      p_org_id: organization_id,
      p_start_date: startOfMonth,
      p_end_date: endOfMonth,
      p_filter_member_id: null,
    }),
    supabase.rpc("get_ranking_data", {
      p_month: now.getMonth() + 1,
      p_year: now.getFullYear(),
      p_organization_id: organization_id,
    }),
  ]);

  const m = Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data;
  const ranking = Array.isArray(rankingRes.data) ? rankingRes.data[0] : rankingRes.data;

  // Build the rich context prompt
  const tvMetrics = tv_data || {};
  const metaVendas = tvMetrics.metaVendasMes || 0;
  const vendasRealizadas = tvMetrics.vendasRealizadas || m?.vendaTotal || 0;
  const ondeDeveria = tvMetrics.ondeDeveriamEstar || ((metaVendas * dayOfMonth) / daysInMonth);
  const diferenca = vendasRealizadas - ondeDeveria;

  const salesRanking = ranking?.salesRanking || [];
  const meetingsRanking = ranking?.meetingsRanking || ranking?.sdrRanking || [];

  // Build team member context
  const membersContext = (team_members || []).map((tm: any) => {
    const isSales = tm.metric_type === "sales";
    return `- ${tm.name} (${isSales ? "Closer" : "SDR"}): ${
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
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Analise a operação e entregue o diagnóstico completo em JSON." },
      ],
      temperature: 0.5,
      max_tokens: 800,
    }),
  });

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("OpenRouter error:", aiResponse.status, errorText);
    throw new Error(`OpenRouter error: ${aiResponse.status}`);
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
    result = {
      diagnostico: "Não foi possível gerar análise completa",
      causa: "Dados insuficientes ou erro de processamento",
      acao_prioritaria: "Revise o pipeline e priorize follow-ups pendentes",
      acao_secundaria: "Atualize as metas individuais no sistema",
      oportunidade: null,
      alerta: null,
      vendor_actions: [],
    };
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
serve(withSentry('oraculo-comercial', async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Route to appropriate mode
    if (body.mode === "chat") {
      return await handleChatMode(body);
    }
    if (body.mode === "tv_analysis") {
      return await handleTVAnalysisMode(body);
    }

    // Legacy mode: expects { metrics: MetricsData }
    const metrics = body.metrics as MetricsData;
    return await handleLegacyMode(metrics);
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
