import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getOrCreateLead, normalizePhoneForSearch } from "../_shared/lead-service.ts";
import { OpenRouterClient } from "./openrouter-client.ts";
import { AgentEngine } from "./agent-engine.ts";

/**
 * Webhook receptor de mensagens de leads
 * Twilio/WhatsApp → /agent-message
 */
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

    // 3. PROCESS MESSAGE (toda lógica está aqui)
    const response = await engine.processMessage(lead.id, message);

    // 4. RETURN RESPONSE
    return new Response(JSON.stringify(response), {
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
