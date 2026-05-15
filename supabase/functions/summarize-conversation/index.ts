import { withSentry } from '../_shared/sentry.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { validateOrganizationAccess, unauthorizedResponse } from "../_shared/auth.ts";

/**
 * Edge Function: summarize-conversation
 * 
 * Gera um resumo da conversa com um lead usando IA.
 * O resumo é armazenado na tabela conversation_summaries para visualização interna.
 */

interface SummarizeRequest {
  lead_id: string;
  conversation_id?: string;
  force_regenerate?: boolean;
}

interface ConversationSummary {
  summary: string;
  key_points: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  lead_temperature: 'cold' | 'warm' | 'hot';
  objections: string[];
  questions_asked: string[];
  next_action: string;
  coaching_tips: string[];
  message_count: number;
}

Deno.serve(withSentry('summarize-conversation', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Auth: validate JWT and resolve caller's org ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorizedResponse("Missing Authorization header", corsHeaders);
  }
  const jwt = authHeader.slice(7);
  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return unauthorizedResponse("Invalid token", corsHeaders);
  }
  const userId = userData.user.id;

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterApiKey) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const body: SummarizeRequest = await req.json();
    const { lead_id, conversation_id, force_regenerate } = body;

    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log('[summarize-conversation] Processing:', { lead_id, conversation_id, force_regenerate });

    // 1. Buscar o lead e sua organização
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, name, organization_id')
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: "Lead não encontrado." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Auth: verify caller belongs to lead's organization ──
    const hasAccess = await validateOrganizationAccess(supabase, userId, lead.organization_id);
    if (!hasAccess) {
      return unauthorizedResponse("User does not belong to lead's organization", corsHeaders);
    }

    // 2. Buscar a conversa do lead (mais recente)
    let conversationQuery = supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', lead_id);

    if (conversation_id) {
      conversationQuery = conversationQuery.eq('id', conversation_id);
    }

    const { data: conversation, error: convError } = await conversationQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (convError) {
      console.error('[summarize-conversation] Error fetching conversation:', convError);
    }

    // Se não houver conversa, verificar se há mensagens no whatsapp_messages
    let messages: Array<{ role: string; content: string; created_at: string }> = [];

    if (conversation) {
      // Buscar mensagens da tabela conversation_messages
      const { data: convMessages } = await supabase
        .from('conversation_messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });

      if (convMessages && convMessages.length > 0) {
        messages = convMessages;
      }
    }

    // Também buscar mensagens do WhatsApp como fallback ou complemento
    const { data: whatsappMessages } = await supabase
      .from('whatsapp_messages')
      .select('direction, content, created_at')
      .eq('lead_id', lead_id)
      .order('created_at', { ascending: true });

    if (whatsappMessages && whatsappMessages.length > 0) {
      const formattedWhatsapp = whatsappMessages.map(m => ({
        role: m.direction === 'incoming' ? 'user' : 'assistant',
        content: m.content || '',
        created_at: m.created_at,
      }));

      // Se não tinha mensagens de conversation_messages, usar as do WhatsApp
      if (messages.length === 0) {
        messages = formattedWhatsapp;
      }
    }

    // Se não houver mensagens, retornar erro amigável
    if (messages.length === 0) {
      return new Response(JSON.stringify({
        error: "Nenhuma mensagem encontrada para este lead. Inicie uma conversa antes de gerar o resumo.",
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log('[summarize-conversation] Found messages:', messages.length);

    // 3. Verificar se já existe um resumo recente (menos de 1 hora)
    if (!force_regenerate) {
      const { data: existingSummary } = await supabase
        .from('conversation_summaries')
        .select('*')
        .eq('lead_id', lead_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSummary) {
        const summaryAge = Date.now() - new Date(existingSummary.created_at).getTime();
        const oneHour = 60 * 60 * 1000;

        // Se o resumo tem menos de 1 hora e o número de mensagens não mudou muito, retornar existente
        if (summaryAge < oneHour && existingSummary.message_count >= messages.length - 2) {
          console.log('[summarize-conversation] Returning cached summary');
          return new Response(JSON.stringify(existingSummary), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
    }

    // 4. Preparar prompt para a IA
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'Lead' : 'Vendedor'}: ${m.content}`)
      .join('\n');

    const systemPrompt = `Você é um especialista comercial sênior com mais de 15 anos de experiência em prospecção B2B, fechamento de vendas consultivas e quebra de objeções. Você domina metodologias como SPIN Selling, Challenger Sale e BANT. Sua missão é analisar conversas de vendas e fornecer coaching prático para o vendedor melhorar.

Analise a conversa abaixo entre um lead e um vendedor/agente. Retorne APENAS um JSON válido (sem markdown, sem explicações) com a seguinte estrutura:

{
  "summary": "Resumo da conversa em 2-3 frases, com tom de coaching comercial — destaque o que foi bem feito e onde o vendedor pode melhorar",
  "key_points": ["ponto 1", "ponto 2", "ponto 3"],
  "sentiment": "positive" | "neutral" | "negative",
  "lead_temperature": "cold" | "warm" | "hot",
  "objections": ["objeção identificada com sugestão de como quebrá-la"],
  "questions_asked": ["pergunta do lead"],
  "next_action": "Próxima ação concreta e específica que o vendedor deve tomar, com sugestão de abordagem",
  "coaching_tips": ["dica prática 1 de como o vendedor pode melhorar nesta conversa", "dica prática 2"]
}

Regras:
- summary: Seja direto e prático. Foque no que importa para fechar a venda. Aponte erros de abordagem se houver (ex: falar demais, não fazer perguntas abertas, não qualificar o lead).
- sentiment: positive se demonstra interesse real de compra, negative se há frustração/desinteresse, neutral caso contrário.
- lead_temperature: hot se deu sinais claros de compra (pediu preço, perguntou próximos passos, demonstrou urgência), warm se há interesse mas faltam sinais de compra, cold se está apenas explorando ou não engajou.
- objections: Extraia cada objeção e adicione entre parênteses uma sugestão prática de como quebrá-la. Ex: "Preço alto (mostrar ROI em 3 meses, comparar com custo de não ter a solução)".
- questions_asked: Extraia as perguntas do lead — elas revelam o que mais importa pra ele.
- next_action: Seja específico. Não diga "fazer follow-up". Diga "Enviar comparativo de preços destacando ROI e agendar call para quinta-feira".
- coaching_tips: Dê 2-3 dicas práticas e acionáveis sobre o que o vendedor pode melhorar. Foque em: qualificação, perguntas abertas, escuta ativa, timing de follow-up, técnicas de fechamento, e quebra de objeções.

IMPORTANTE: Retorne APENAS o JSON, nada mais.`;

    // 5. Chamar OpenRouter para gerar resumo
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterApiKey}`,
        'HTTP-Referer': Deno.env.get('OPENROUTER_REFERER_URL') || 'https://v8millennials.com',
        'X-Title': 'V8 Millennials CRM - Summarizer',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversa:\n\n${conversationText}` }
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[summarize-conversation] OpenRouter error:', response.status, errorBody);
      throw new Error("Falha ao gerar resumo com IA. Tente novamente em alguns instantes.");
    }

    const aiResponse = await response.json();
    const aiContent = aiResponse.choices?.[0]?.message?.content;

    if (!aiContent) {
      throw new Error('No content in AI response');
    }

    console.log('[summarize-conversation] AI response:', aiContent);

    // 6. Parse do JSON retornado pela IA
    let summaryData: ConversationSummary;
    try {
      // Remover possíveis backticks de markdown
      const cleanContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      summaryData = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('[summarize-conversation] Error parsing AI response:', parseError);
      // Fallback: criar resumo básico
      summaryData = {
        summary: "Conversa com o lead em andamento.",
        key_points: ["Conversa em progresso"],
        sentiment: "neutral",
        lead_temperature: "warm",
        objections: [],
        questions_asked: [],
        next_action: "Continuar qualificação",
        coaching_tips: [],
        message_count: messages.length,
      };
    }

    // Garantir que message_count está correto
    summaryData.message_count = messages.length;

    // 7. Salvar resumo no banco
    const { data: savedSummary, error: saveError } = await supabase
      .from('conversation_summaries')
      .upsert({
        lead_id: lead_id,
        conversation_id: conversation?.id || null,
        organization_id: lead.organization_id,
        summary: summaryData.summary,
        key_points: summaryData.key_points,
        sentiment: summaryData.sentiment,
        lead_temperature: summaryData.lead_temperature,
        objections: summaryData.objections,
        questions_asked: summaryData.questions_asked,
        next_action: summaryData.next_action,
        coaching_tips: summaryData.coaching_tips || [],
        message_count: summaryData.message_count,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'lead_id',
      })
      .select()
      .single();

    if (saveError) {
      console.error('[summarize-conversation] Error saving summary:', saveError);
      // Retornar o resumo mesmo se não conseguiu salvar
      return new Response(JSON.stringify({
        ...summaryData,
        lead_id,
        saved: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log('[summarize-conversation] Summary saved:', savedSummary?.id);

    await logRuntime({
      organizationId: lead.organization_id,
      module: "copilot",
      action: "summarize",
      status: "success",
      entityType: "lead",
      entityId: lead_id,
      payloadSnapshot: { messageCount: messages.length, sentiment: summaryData.sentiment, leadTemperature: summaryData.lead_temperature },
    });

    return new Response(JSON.stringify(savedSummary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('[summarize-conversation] Error:', error);
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await logRuntime({
      module: "copilot",
      action: "summarize",
      status: "error",
      errorMessage,
    });
    return new Response(JSON.stringify({
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}));
