import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from '../_shared/logger.ts';
import { trackEvent } from '../_shared/track.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getOrCreateLead, normalizePhoneForSearch } from "../_shared/lead-service.ts";
import { OpenRouterClient } from "./openrouter-client.ts";
import { AgentEngine } from "./agent-engine.ts";
import { fireTrigger } from "../_shared/workflow-trigger.ts";

/**
 * Webhook receptor de mensagens de leads
 * Twilio/WhatsApp → /agent-message
 */
Deno.serve(withSentry('agent-message', async (req) => {
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
    const { from, message, channel, organization_id, push_name, incoming_message_type } = body; // from = phone number ou user_id

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

    // HUMAN TAKEOVER removed — copilot always responds unless
    // ai_disabled=true or conversation state=WAITING_HUMAN.
    // Human agents can disable AI via the toggle in the chat UI.

    // 1.7. FIRE lead_replied workflow trigger (fire-and-forget)
    fireTrigger({
      supabase,
      organizationId,
      triggerType: "lead_replied",
      leadId: lead.id,
      context: { trigger: "lead_replied", channel, message },
    }).catch(() => {});

    // 2. INITIALIZE AGENT ENGINE
    const engine = new AgentEngine(supabase, openRouter, organizationId);

    // 2.5 TYPING INDICATOR — item #10 — fire-and-forget, não bloqueia
    sendTypingIndicator(supabase, from, organizationId)
      .catch(e => console.warn('[agent-message] Typing indicator failed (non-fatal):', e));

    // 3. PROCESS MESSAGE (toda lógica está aqui)
    const response = await engine.processMessage(lead.id, message, incoming_message_type);

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

    // 4. TRACK USAGE EVENT (fire-and-forget)
    trackEvent({
      organizationId,
      eventType: "message_sent",
      entityType: "lead",
      entityId: lead.id,
      metadata: { channel, action: response.action, hasMessage: !!response.message },
    }).catch(() => {});

    // 5. LOG SUCCESS
    await logRuntime({
      organizationId,
      module: 'copilot',
      action: response.action || 'process_message',
      status: 'success',
      entityType: 'lead',
      entityId: lead.id,
      payloadSnapshot: { channel, action: response.action, hasMessage: !!response.message },
    });

    // 5. RETURN RESPONSE (strip internal _eval_meta before sending)
    const { _eval_meta: _unused, ...publicResponse } = response as any;
    return new Response(JSON.stringify(publicResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('[agent-message] Error:', error);
    await logRuntime({
      module: 'copilot',
      action: 'process_message',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}));

/**
 * Item #10: Typing indicator — envia presença "composing" via Evolution API
 * antes do AgentEngine processar a mensagem, para o lead ver que está digitando.
 */
async function sendTypingIndicator(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  organizationId: string
): Promise<void> {
  try {
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("organization_id", organizationId)
      .in("status", ["open", "connected"])
      .limit(1)
      .maybeSingle();

    if (!instance) return;

    const { getWhatsAppProvider } = await import(
      "../_shared/whatsapp-client.ts"
    );
    const { normalizeBrazilianPhone } = await import(
      "../_shared/whatsapp-dispatch.ts"
    );

    const normalizedPhone = normalizeBrazilianPhone(phone);
    if (!normalizedPhone) return;

    const provider = await getWhatsAppProvider(instance, supabase);
    await provider.setPresence(normalizedPhone, "composing");
  } catch {
    // best-effort — typing indicator is non-critical
  }
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
      // Buscar ai_disabled do lead (não vem do getOrCreateLead)
      const { data: leadExtra } = await supabase
        .from('leads')
        .select('ai_disabled')
        .eq('id', result.lead.id)
        .maybeSingle();

      const lead = { ...result.lead, ai_disabled: leadExtra?.ai_disabled ?? false };

      console.log('[agent-message] Lead resolved:', {
        leadId: lead.id,
        leadName: lead.name,
        created: result.created,
        source: result.source,
        ai_disabled: lead.ai_disabled,
      });
      return { lead, organizationId: lead.organization_id };
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
