import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { validateOrganizationAccess, unauthorizedResponse } from "../_shared/auth.ts";

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

// ---- Conversation context helper ----
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

// ---- Fetch 3 random full conversations for deep analysis ----
async function fetchConversationSamples(
  supabase: any,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  // Get recent conversations with enough messages to be meaningful
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, lead_id, status, last_message_at, leads:lead_id(name, company)")
    .eq("organization_id", organizationId)
    .gte("last_message_at", startDate)
    .lte("last_message_at", endDate)
    .order("last_message_at", { ascending: false })
    .limit(20);

  if (!conversations || conversations.length === 0) {
    return "\nAMOSTRA DE CONVERSAS: Nenhuma conversa disponível para análise detalhada.";
  }

  // Pick 3 random conversations from the pool
  const shuffled = conversations.sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, 3);
  const convIds = sampled.map((c: any) => c.id);

  const { data: messages } = await supabase
    .from("conversation_messages")
    .select("role, content, created_at, conversation_id")
    .in("conversation_id", convIds)
    .neq("role", "system")
    .order("created_at", { ascending: true })
    .limit(90); // ~30 messages per conversation

  if (!messages || messages.length === 0) {
    return "\nAMOSTRA DE CONVERSAS: Mensagens não encontradas para as conversas selecionadas.";
  }

  // Group messages by conversation
  const grouped = new Map<string, any[]>();
  for (const msg of messages) {
    const arr = grouped.get(msg.conversation_id) || [];
    arr.push(msg);
    grouped.set(msg.conversation_id, arr);
  }

  let output = `\nAMOSTRA DE 3 CONVERSAS PARA ANÁLISE DETALHADA:`;
  for (const conv of sampled) {
    const convMsgs = grouped.get(conv.id) || [];
    if (convMsgs.length === 0) continue;
    const leadName = conv.leads?.name || "Lead desconhecido";
    const company = conv.leads?.company || "";
    const label = company ? `${leadName} (${company})` : leadName;

    output += `\n\n--- Conversa com ${label} | Status: ${conv.status || "ativa"} ---`;
    // Limit to last 15 messages per conversation to manage token budget
    for (const m of convMsgs.slice(-15)) {
      const who = m.role === "user" ? "LEAD" : "AGENTE";
      output += `\n[${who}]: ${(m.content || "").slice(0, 300)}`;
    }
  }

  return output;
}

// ---- Fetch lost deals with reasons ----
async function fetchLostDeals(
  supabase: any,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<string> {
  // Query pipeline_entries for propostas with stage_key "perdido"
  const { data: pipelines } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", "propostas")
    .eq("type", "system")
    .maybeSingle();

  if (!pipelines?.id) {
    return "\nNEGÓCIOS PERDIDOS: Nenhum registro no período.";
  }

  const { data: lostEntries } = await supabase
    .from("pipeline_entries")
    .select("id, lead_id, stage_key, metadata, closed_at, created_at")
    .eq("pipeline_id", pipelines.id)
    .eq("stage_key", "perdido")
    .gte("closed_at", startDate)
    .lte("closed_at", endDate)
    .order("closed_at", { ascending: false })
    .limit(10);

  if (!lostEntries || lostEntries.length === 0) {
    return "\nNEGÓCIOS PERDIDOS: Nenhum registro no período.";
  }

  // Fetch leads + closers in batch
  const leadIds = lostEntries.map((e: any) => e.lead_id).filter(Boolean);
  const { data: leads } = leadIds.length > 0
    ? await supabase.from("leads").select("id, name, company, segment").in("id", leadIds)
    : { data: [] };
  const leadsMap = new Map((leads || []).map((l: any) => [l.id, l]));

  const closerIds = lostEntries
    .map((e: any) => (e.metadata as Record<string, unknown>)?.closer_id)
    .filter(Boolean);
  const { data: closers } = closerIds.length > 0
    ? await supabase.from("team_members").select("id, name").in("id", closerIds)
    : { data: [] };
  const closersMap = new Map((closers || []).map((c: any) => [c.id, c]));

  // Build output
  const lostDeals = lostEntries.map((e: any) => {
    const meta = (e.metadata || {}) as Record<string, unknown>;
    return {
      sale_value: meta.sale_value as number || 0,
      loss_reason: meta.loss_reason as string || null,
      lead: leadsMap.get(e.lead_id) || null,
      closer: closersMap.get(meta.closer_id as string) || null,
    };
  });

  const totalLostValue = lostDeals.reduce((sum: number, d: any) => sum + (d.sale_value || 0), 0);
  const reasons = new Map<string, number>();
  for (const d of lostDeals) {
    const reason = d.loss_reason || "Motivo não informado";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]);

  let output = `\nNEGÓCIOS PERDIDOS NO PERÍODO (${lostDeals.length} deals, R$ ${totalLostValue.toLocaleString("pt-BR")} em receita perdida):`;
  output += `\n- Motivos mais frequentes: ${topReasons.map(([r, c]) => `"${r}" (${c}x)`).join(", ")}`;
  output += `\n- Detalhes:`;
  for (const d of lostDeals.slice(0, 5)) {
    const leadName = d.lead?.name || "Lead";
    const company = d.lead?.company ? ` (${d.lead.company})` : "";
    const vendedor = d.closer?.name || "sem vendedor";
    output += `\n  • ${leadName}${company} — R$ ${(d.sale_value || 0).toLocaleString("pt-BR")} — Motivo: ${d.loss_reason || "não informado"} — Vendedor: ${vendedor}`;
  }

  return output;
}

// ---- Fetch historical metrics for trend comparison ----
async function fetchHistoricalMetrics(
  supabase: any,
  organizationId: string,
  currentMonth: number,
  currentYear: number,
): Promise<string> {
  const months: { label: string; month: number; year: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    let m = currentMonth - i;
    let y = currentYear;
    if (m <= 0) { m += 12; y -= 1; }
    const label = new Date(y, m - 1).toLocaleString("pt-BR", { month: "long", year: "numeric" });
    months.push({ label, month: m, year: y });
  }

  const results = await Promise.all(
    months.map(async ({ label, month, year }) => {
      const start = new Date(Date.UTC(year, month - 1, 1)).toISOString();
      const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();
      const { data } = await supabase.rpc("get_dashboard_metrics", {
        p_org_id: organizationId,
        p_start_date: start,
        p_end_date: end,
        p_filter_member_id: null,
      });
      const m = Array.isArray(data) ? data[0] : data;
      return { label, metrics: m };
    })
  );

  if (results.every(r => !r.metrics)) {
    return "\nHISTÓRICO: Sem dados de meses anteriores.";
  }

  let output = `\nHISTÓRICO DOS ÚLTIMOS 3 MESES (para análise de tendências):`;
  for (const { label, metrics: m } of results) {
    if (!m) { output += `\n- ${label}: sem dados`; continue; }
    output += `\n- ${label}: Receita R$ ${m.vendaTotal || 0} | Leads ${m.totalLeads || 0} | Reuniões ${m.reunioesMarcadas || 0}→${m.reunioesComparecidas || 0} | Vendas ${m.novosClientes || 0} | No-show ${(m.taxaNoShow || 0).toFixed(0)}% | Ticket MRR R$ ${m.ticketMedioMRR || 0} | Ticket Proj R$ ${m.ticketMedioProjeto || 0}`;
  }

  return output;
}

// ---- Chat mode handler ----
async function handleChatMode(body: any, corsHeaders: Record<string, string>) {
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

  // Use month/year from payload, fallback to current month
  const now = new Date();
  const targetMonth = Number(body.month) || (now.getMonth() + 1);
  const targetYear = Number(body.year) || now.getFullYear();
  const startOfMonth = new Date(Date.UTC(targetYear, targetMonth - 1, 1)).toISOString();
  const endOfMonth = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999)).toISOString();

  const isCurrentMonth = targetMonth === (now.getMonth() + 1) && targetYear === now.getFullYear();
  const monthLabel = new Date(targetYear, targetMonth - 1).toLocaleString("pt-BR", { month: "long", year: "numeric" });

  const dayOfMonth = isCurrentMonth ? now.getDate() : new Date(Date.UTC(targetYear, targetMonth, 0)).getDate();
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

  // Fetch all context in parallel: current metrics, ranking, conversations, history, lost deals, conversation samples
  const [metricsRes, rankingRes, conversationContext, historicalContext, lostDealsContext, conversationSamples] = await Promise.all([
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
    fetchHistoricalMetrics(supabase, organization_id, targetMonth, targetYear),
    fetchLostDeals(supabase, organization_id, startOfMonth, endOfMonth),
    fetchConversationSamples(supabase, organization_id, startOfMonth, endOfMonth),
  ]);

  const metrics = Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data;
  const ranking = Array.isArray(rankingRes.data) ? rankingRes.data[0] : rankingRes.data;

  const contextPrompt = `Você é o Diretor Comercial da operação. Não um assistente. Não um coach motivacional. Você é o executivo que responde pelo resultado.

Você tem acesso a TODOS os dados da operação: métricas atuais, histórico dos últimos 3 meses, ranking de vendedores, negócios perdidos, e transcrições reais de conversas com leads. Use TUDO isso para dar respostas com profundidade de quem dirige uma operação comercial B2B.

PERÍODO PRINCIPAL: ${monthLabel}${isCurrentMonth ? ` (mês em andamento — dia ${dayOfMonth} de ${daysInMonth})` : " (mês encerrado)"}

═══════════════════════════════════════
DADOS OPERACIONAIS DO MÊS ATUAL
═══════════════════════════════════════
- Receita: R$ ${metrics?.vendaTotal || 0}
- Leads captados: ${metrics?.totalLeads || 0}
- Reuniões marcadas: ${metrics?.reunioesMarcadas || 0}
- Reuniões comparecidas: ${metrics?.reunioesComparecidas || 0}
- Propostas enviadas: ${metrics?.propostasEnviadas || 0}
- Vendas fechadas: ${metrics?.novosClientes || 0}
- Ticket médio geral: R$ ${metrics?.ticketMedio || 0}
- Ticket médio MRR: R$ ${metrics?.ticketMedioMRR || 0}
- Ticket médio Projeto: R$ ${metrics?.ticketMedioProjeto || 0}
- Taxa no-show: ${(metrics?.taxaNoShow || 0).toFixed(1)}%
- Taxa conversão: ${(metrics?.taxaConversao || metrics?.taxaConversaoGeral || 0).toFixed(1)}%

RANKING DE VENDEDORES:
${JSON.stringify(ranking?.salesRanking?.slice(0, 8) || [], null, 2)}

RANKING PRÉ-VENDAS:
${JSON.stringify(ranking?.sdrRanking?.slice(0, 8) || [], null, 2)}

═══════════════════════════════════════
INTELIGÊNCIA HISTÓRICA
═══════════════════════════════════════
${historicalContext}

═══════════════════════════════════════
NEGÓCIOS PERDIDOS
═══════════════════════════════════════
${lostDealsContext}

═══════════════════════════════════════
ANÁLISE AGREGADA DE CONVERSAS
═══════════════════════════════════════
${conversationContext}

═══════════════════════════════════════
AMOSTRA DE CONVERSAS REAIS (para análise qualitativa)
═══════════════════════════════════════
${conversationSamples}

═══════════════════════════════════════
COMO VOCÊ DEVE RESPONDER
═══════════════════════════════════════

POSTURA:
- Você é um diretor comercial experiente analisando a operação. Fale como um executivo que cobra resultado.
- Use os dados históricos para identificar TENDÊNCIAS — a operação está melhorando ou piorando? Em quê?
- Compare meses. Identifique padrões. Seja específico com números.

QUANDO PERGUNTAREM SOBRE CONVERSAS OU QUALIDADE DO ATENDIMENTO:
- Analise as CONVERSAS REAIS acima em detalhe
- Identifique objeções que o agente não soube contornar
- Aponte oportunidades perdidas (lead demonstrou interesse mas não foi conduzido ao próximo passo)
- Avalie se o agente está qualificando corretamente, fazendo perguntas certas, criando urgência
- Sugira como reformular respostas específicas que poderiam ter sido melhores
- Identifique padrões: os leads estão saindo em qual momento? Por qual motivo?

QUANDO PERGUNTAREM SOBRE PERFORMANCE:
- Não repita números — INTERPRETE eles. "Receita caiu 20% vs mês passado e o gargalo está no no-show que subiu de 15% pra 28%"
- Compare com meses anteriores sempre
- Identifique o GARGALO principal: é captação? É qualificação? É fechamento? É no-show?
- Dê uma recomendação ACIONÁVEL baseada nos dados

QUANDO PERGUNTAREM SOBRE NEGÓCIOS PERDIDOS:
- Use os dados reais de deals perdidos
- Identifique padrões nos motivos de perda
- Sugira ajustes no processo de vendas baseado nos motivos reais

REGRAS ABSOLUTAS:
- Use SOMENTE dados acima — NUNCA invente números
- Seja direto, executivo, incisivo
- Quando não tiver dados suficientes, diga claramente
- Respostas podem ter até 6 parágrafos quando a análise exigir profundidade
- Cite números específicos e compare com histórico sempre que possível`;

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
      max_tokens: 1200,
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
async function handleLegacyMode(metrics: MetricsData, corsHeaders: Record<string, string>) {
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

    userPrompt = `Métricas do Vendedor:
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
      model: "google/gemini-3-flash-preview",
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
serve(withSentry('oraculo-comercial', async (req) => {
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

  // Resolve caller's organization via team_members
  const supabaseAdmin = createSupabaseClient(supabaseUrl, supabaseServiceKey);
  const { data: member } = await supabaseAdmin
    .from("team_members")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!member?.organization_id) {
    return unauthorizedResponse("User has no organization", corsHeaders);
  }
  const verifiedOrgId = member.organization_id;

  try {
    const body = await req.json();

    // Override organization_id with the verified one from JWT — never trust body
    body.organization_id = verifiedOrgId;
    body.user_id = userId;

    // Route to appropriate mode
    if (body.mode === "chat") {
      return await handleChatMode(body, corsHeaders);
    }
    if (body.mode === "tv_analysis") {
      return await handleTVAnalysisMode(body, corsHeaders);
    }

    // Legacy mode: expects { metrics: MetricsData }
    const metrics = body.metrics as MetricsData;
    return await handleLegacyMode(metrics, corsHeaders);
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
