import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

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
  message_count: number;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

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
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Buscar a conversa do lead
    let conversationQuery = supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', lead_id);
    
    if (conversation_id) {
      conversationQuery = conversationQuery.eq('id', conversation_id);
    }

    const { data: conversation, error: convError } = await conversationQuery.maybeSingle();

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

    // Se não houver mensagens, retornar erro
    if (messages.length === 0) {
      return new Response(JSON.stringify({ 
        error: "No messages found for this lead",
        lead_id,
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
      .map(m => `${m.role === 'user' ? 'Lead' : 'Bot'}: ${m.content}`)
      .join('\n');

    const systemPrompt = `Você é um analista de conversas de vendas. Analise a conversa abaixo entre um lead e um agente de vendas (bot).

Retorne APENAS um JSON válido (sem markdown, sem explicações) com a seguinte estrutura:
{
  "summary": "Resumo da conversa em 2-3 frases",
  "key_points": ["ponto 1", "ponto 2", "ponto 3"],
  "sentiment": "positive" | "neutral" | "negative",
  "lead_temperature": "cold" | "warm" | "hot",
  "objections": ["objeção 1", "objeção 2"],
  "questions_asked": ["pergunta 1", "pergunta 2"],
  "next_action": "Próxima ação sugerida"
}

Regras:
- sentiment: positive se o lead demonstra interesse, negative se demonstra desinteresse/frustração, neutral caso contrário
- lead_temperature: hot se está próximo de fechar, warm se demonstra interesse ativo, cold se está apenas explorando
- Extraia objeções levantadas pelo lead (preço alto, timing ruim, etc)
- Extraia perguntas feitas pelo lead
- Sugira a próxima ação baseada no estado da conversa

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
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversa:\n\n${conversationText}` }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${error}`);
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

    return new Response(JSON.stringify(savedSummary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('[summarize-conversation] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
