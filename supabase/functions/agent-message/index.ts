import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getOrCreateLead, normalizePhoneForSearch } from "../_shared/lead-service.ts";
import { OpenRouterClient } from "./openrouter-client.ts";
import { AgentEngine } from "./agent-engine.ts";

/**
 * Webhook receptor de mensagens de leads
 * Twilio/WhatsApp → /agent-message
 */
Deno.serve(async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

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

  const openRouter = new OpenRouterClient(openRouterApiKey);

  try {
    // Parse webhook de Twilio ou formato genérico
    const body = await req.json();
    const { from, message, channel, organization_id, push_name } = body; // from = phone number ou user_id

    // 1. IDENTIFY TENANT
    const { lead, organizationId } = await identifyTenant(supabase, from, channel, organization_id, push_name);

    if (!lead || !organizationId) {
      return new Response(JSON.stringify({ error: "Lead not found or organization not identified" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1.5. CHECK IF AI IS DISABLED FOR THIS LEAD
    if (lead.ai_disabled === true) {
      console.log('[agent-message] AI disabled for lead:', lead.id);
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: "AI disabled for this lead",
        lead_id: lead.id
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. INITIALIZE AGENT ENGINE
    const engine = new AgentEngine(supabase, openRouter, organizationId);

    // 2.5 TYPING INDICATOR — item #10 — fire-and-forget, não bloqueia
    sendTypingIndicator(supabase, from, organizationId)
      .catch(e => console.warn('[agent-message] Typing indicator failed (non-fatal):', e));

    // 3. PROCESS MESSAGE (toda lógica está aqui)
    const response = await engine.processMessage(lead.id, message);

    // 3.5 Item #8: LLM-as-a-judge — avaliar qualidade da resposta (fire-and-forget)
    if (response.message && (response as any)._eval_meta) {
      const evalMeta = (response as any)._eval_meta;
      evaluateConversation({
        organizationId,
        leadId: lead.id,
        userMessage: message,
        agentResponse: response.message,
        conversationId: evalMeta.conversationId,
        agentId: evalMeta.agentId,
        turnCount: evalMeta.turnCount,
        systemPromptExcerpt: evalMeta.systemPromptExcerpt,
      }).catch(e => console.warn('[agent-message] Evaluation failed (non-fatal):', e));
    }

    // 4. RETURN RESPONSE (strip internal _eval_meta before sending)
    const { _eval_meta: _unused, ...publicResponse } = response as any;
    return new Response(JSON.stringify(publicResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('[agent-message] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error",
      details: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

/**
 * Item #10: Typing indicator — envia presença "composing" via Evolution API
 * antes do AgentEngine processar a mensagem, para o lead ver que está digitando.
 */
async function sendTypingIndicator(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  organizationId: string
): Promise<void> {
  const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
  if (!evolutionUrl || !evolutionKey) return;

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (!instance?.instance_name) return;

  let formattedPhone = String(phone).replace(/\D/g, "");
  if (!formattedPhone.startsWith("55")) formattedPhone = "55" + formattedPhone;

  await fetch(
    `${evolutionUrl}/chat/sendPresence/${instance.instance_name}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evolutionKey },
      body: JSON.stringify({ number: formattedPhone, delay: 500, presence: "composing" }),
    }
  ).catch(() => {}); // best-effort
}

/**
 * Identifica tenant baseado no phone/session
 * Usa o serviço centralizado lead-service para busca/criação de leads
 */
async function identifyTenant(
  supabase: ReturnType<typeof createClient>,
  from: string,
  channel: string,
  providedOrgId?: string,
  pushName?: string
): Promise<{ lead: any; organizationId: string } | { lead: null; organizationId: null }> {
  const normalizedPhone = normalizePhoneForSearch(from);

  console.log('[agent-message] identifyTenant:', {
    from,
    normalizedPhone,
    providedOrgId,
    pushName
  });

  // Se organization_id foi fornecido, usar serviço centralizado
  if (providedOrgId) {
    const result = await getOrCreateLead(supabase, {
      organizationId: providedOrgId,
      phone: from,
      pushName,
      origin: 'whatsapp',
    });

    if (result) {
      console.log('[agent-message] Lead resolved:', {
        leadId: result.lead.id,
        leadName: result.lead.name,
        created: result.created,
        source: result.source
      });
      return { lead: result.lead, organizationId: result.lead.organization_id };
    }

    console.error('[agent-message] Failed to get or create lead');
    return { lead: null, organizationId: null };
  }

  // Sem organization_id - buscar em todas organizações (fluxo legado)
  // NOTA: Este caso deveria ser raro e idealmente eliminado
  if (normalizedPhone) {
    const { data: lead } = await supabase
      .from('leads')
      .select('*, organization_id')
      .eq('normalized_phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead?.organization_id) {
      console.log('[agent-message] Lead found without org_id:', { leadId: lead.id });
      return { lead, organizationId: lead.organization_id };
    }
  }

  console.log('[agent-message] No organization_id provided and no lead found');
  return { lead: null, organizationId: null };
}

/**
 * Item #8: LLM-as-a-judge — chama a edge function de avaliação em background.
 * Fire-and-forget: nunca bloqueia a resposta ao lead.
 */
async function evaluateConversation(params: {
  organizationId: string;
  leadId: string;
  userMessage: string;
  agentResponse: string;
  conversationId: string;
  agentId: string;
  turnCount: number;
  systemPromptExcerpt: string;
}): Promise<void> {
  // Apenas avaliar a cada 3 turnos para reduzir custo de API
  if (params.turnCount % 3 !== 0) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;

  await fetch(
    `${supabaseUrl}/functions/v1/evaluate-agent-conversation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(params),
    }
  );
}
