/**
 * Webhook Genérico para Receber Leads
 *
 * Recebe leads de qualquer fonte (Meta Ads, Google Ads, Landing Pages, etc.)
 * e dispara o fluxo de outbound se houver agente configurado.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateLead } from "../_shared/lead-service.ts";
import { enqueueWebhookDeliveries } from "../_shared/webhook-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-key",
};

interface LeadWebhookPayload {
  // Identificação da fonte
  source: string; // "meta_ads", "google_ads", "landing_page", etc.
  campaign_id?: string;
  campaign_name?: string;
  
  // Tags para identificar
  tags?: string[];
  
  // Dados do lead
  fields: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    // Campos personalizados
    [key: string]: string | undefined;
  };
  
  // Organização (identificada por API key ou passada diretamente)
  organization_id?: string;
}

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verificar autenticação via header
    const webhookKey = req.headers.get("x-webhook-key");
    const expectedKey = Deno.env.get("WEBHOOK_API_KEY");
    
    if (!webhookKey || webhookKey !== expectedKey) {
      console.error("[lead-webhook] Invalid or missing webhook key");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse payload
    const payload: LeadWebhookPayload = await req.json();
    console.log("[lead-webhook] Received payload:", JSON.stringify(payload, null, 2));

    // Validação básica
    if (!payload.fields || (!payload.fields.phone && !payload.fields.email)) {
      return new Response(
        JSON.stringify({ error: "Lead must have phone or email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Criar cliente Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determinar organization_id
    let organizationId = payload.organization_id;
    
    if (!organizationId) {
      // Buscar organização padrão (primeira ativa)
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .limit(1)
        .single();
      
      if (!org) {
        return new Response(
          JSON.stringify({ error: "No organization found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      organizationId = org.id;
    }

    // Usar serviço centralizado para buscar ou criar lead
    const { name, phone, email, company, ...customFields } = payload.fields;

    // Mapear origem
    const originMap: Record<string, string> = {
      "meta_ads": "meta_ads",
      "facebook": "meta_ads",
      "instagram": "meta_ads",
      "google_ads": "outro",
      "landing_page": "outro",
      "whatsapp": "whatsapp",
      "calendly": "calendly",
    };
    const origin = originMap[payload.source.toLowerCase()] || "outro";

    const result = await getOrCreateLead(supabase, {
      organizationId,
      phone: phone || null,
      email: email || null,
      name: name || "Lead sem nome",
      origin,
    });

    if (!result) {
      console.error("[lead-webhook] Failed to get or create lead");
      return new Response(
        JSON.stringify({ error: "Failed to get or create lead" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const leadId = result.lead.id;
    const isNewLead = result.created;

    console.log("[lead-webhook] Lead resolved:", {
      leadId,
      isNewLead,
      source: result.source
    });

    // Se é novo lead, atualizar campos adicionais
    if (isNewLead) {
      // Atualizar campos que não são cobertos pelo getOrCreateLead
      const updateData: Record<string, unknown> = {};
      if (company) updateData.company = company;
      if (payload.campaign_name || payload.campaign_id) {
        updateData.utm_campaign = payload.campaign_name || payload.campaign_id;
      }
      updateData.notes = `Fonte: ${payload.source}`;

      if (Object.keys(updateData).length > 0) {
        await supabase
          .from("leads")
          .update(updateData)
          .eq("id", leadId);
      }

      // Salvar campos personalizados
      if (Object.keys(customFields).length > 0) {
        for (const [fieldName, fieldValue] of Object.entries(customFields)) {
          if (fieldValue) {
            // Buscar ou criar campo personalizado
            let { data: customField } = await supabase
              .from("lead_custom_fields")
              .select("id")
              .eq("organization_id", organizationId)
              .eq("field_name", fieldName)
              .maybeSingle();

            if (!customField) {
              // Criar campo personalizado
              const { data: newField } = await supabase
                .from("lead_custom_fields")
                .insert({
                  organization_id: organizationId,
                  field_name: fieldName,
                  field_type: "text",
                })
                .select()
                .single();
              customField = newField;
            }

            if (customField) {
              // Salvar valor
              await supabase
                .from("lead_custom_field_values")
                .upsert({
                  lead_id: leadId,
                  field_id: customField.id,
                  value: fieldValue,
                }, {
                  onConflict: "lead_id,field_id",
                });
            }
          }
        }
      }
    }

    // Adicionar tags ao lead
    if (payload.tags && payload.tags.length > 0) {
      for (const tagName of payload.tags) {
        // Buscar ou criar tag
        let { data: tag } = await supabase
          .from("tags")
          .select("id")
          .eq("name", tagName)
          .maybeSingle();

        if (!tag) {
          const { data: newTag } = await supabase
            .from("tags")
            .insert({ name: tagName, color: "#6366f1" })
            .select()
            .single();
          tag = newTag;
        }

        if (tag) {
          // Vincular tag ao lead (ignorar se já existir)
          await supabase
            .from("lead_tags")
            .upsert({
              lead_id: leadId,
              tag_id: tag.id,
            }, {
              onConflict: "lead_id,tag_id",
              ignoreDuplicates: true,
            });
        }
      }
    }

    // Enfileira webhooks outbound (lead.created ou lead.updated)
    const webhookPayload = {
      event: isNewLead ? "lead.created" : "lead.updated",
      timestamp: new Date().toISOString(),
      data: {
        id: leadId,
        name: result.lead.name,
        email: result.lead.email ?? undefined,
        phone: result.lead.phone ?? undefined,
        company: result.lead.company ?? undefined,
        organization_id: organizationId,
        origin: result.lead.origin,
      },
    };
    try {
      await enqueueWebhookDeliveries(supabase, organizationId, webhookPayload.event, webhookPayload);
    } catch (e) {
      console.warn("[lead-webhook] Failed to enqueue webhooks:", e);
    }

    // Se é novo lead, verificar se existe agente outbound para disparar
    if (isNewLead) {
      // Chamar edge function de outbound-trigger
      const triggerUrl = `${supabaseUrl}/functions/v1/outbound-trigger`;
      
      try {
        await fetch(triggerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            lead_id: leadId,
            organization_id: organizationId,
            source: payload.source,
            tags: payload.tags || [],
          }),
        });
        console.log("[lead-webhook] Triggered outbound check for lead:", leadId);
      } catch (triggerError) {
        // Não bloquear se o trigger falhar
        console.warn("[lead-webhook] Failed to trigger outbound:", triggerError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        lead_id: leadId,
        is_new: isNewLead,
        message: isNewLead ? "Lead created successfully" : "Lead already exists",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[lead-webhook] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
