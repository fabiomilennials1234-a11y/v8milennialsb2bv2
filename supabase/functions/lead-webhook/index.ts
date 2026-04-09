/**
 * Webhook Genérico para Receber Leads
 *
 * Recebe leads de qualquer fonte (Meta Ads, Google Ads, Landing Pages, etc.)
 * e dispara o fluxo de outbound se houver agente configurado.
 */

import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateLead } from "../_shared/lead-service.ts";
import { enqueueWebhookDeliveries } from "../_shared/webhook-utils.ts";
import { getCampaignLeadAssignment, getCampaignCloserAssignment } from "../_shared/campaign-distribution.ts";
import { logRuntime } from "../_shared/logger.ts";
import { isValidUUID, isValidISODate, validateArraySize, validateReferencedId } from "../_shared/validation.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-key",
};

// Destino opcional: colocar o lead em um pipe (funil) em uma etapa específica
interface PlaceInPipe {
  pipe: "whatsapp" | "confirmacao" | "propostas";
  stage: string; // ex: "novo", "abordado", "reuniao_marcada", "marcar_compromisso"
  meeting_date?: string; // ISO 8601 — salva no pipe (meeting_date) e no lead (compromisso_date)
}

// Destino opcional: colocar o lead em uma campanha em uma etapa específica
interface PlaceInCampaign {
  campaign_id: string; // UUID da campanha
  stage_id: string;    // UUID do campanha_stages
  notes?: string;     // Observações do lead nesta campanha (card na campanha)
}

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
  
  // Padrão: sempre cria um novo lead. Se true, busca por telefone/email e atualiza o lead existente (evita duplicar).
  update_existing_if_match?: boolean;
  
  // Destino opcional: colocar o lead direto em um pipe e/ou campanha (ex: n8n, campanha de ads)
  place_in_pipe?: PlaceInPipe;
  place_in_campaign?: PlaceInCampaign;

  // Atribuição opcional (ex.: round robin do n8n) — team_member_id para SDR/Closer
  assigned_user_id?: string;
}

serve(withSentry('lead-webhook', async (req) => {
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
      return errorResponse(401, "Unauthorized", corsHeaders, { req });
    }

    // Parse payload
    const payload: LeadWebhookPayload = await req.json();
    console.log("[lead-webhook] Received payload:", JSON.stringify(payload, null, 2));

    // Sanitizar campos: remover whitespace/newlines de todos os valores em fields
    if (payload.fields) {
      for (const key of Object.keys(payload.fields)) {
        const val = payload.fields[key];
        if (typeof val === "string") {
          const trimmed = val.trim();
          payload.fields[key] = trimmed === "" ? undefined : trimmed;
        }
      }
    }

    // Validação básica
    if (!payload.fields || (!payload.fields.phone && !payload.fields.email)) {
      return errorResponse(400, "Lead must have phone or email", corsHeaders, { req });
    }

    // ── Input validation ──
    if (payload.organization_id && !isValidUUID(payload.organization_id)) {
      return errorResponse(400, "Validation failed: organization_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.assigned_user_id && !isValidUUID(payload.assigned_user_id)) {
      return errorResponse(400, "Validation failed: assigned_user_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.place_in_campaign?.campaign_id && !isValidUUID(payload.place_in_campaign.campaign_id)) {
      return errorResponse(400, "Validation failed: place_in_campaign.campaign_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.place_in_campaign?.stage_id && !isValidUUID(payload.place_in_campaign.stage_id)) {
      return errorResponse(400, "Validation failed: place_in_campaign.stage_id não é um UUID válido", corsHeaders, { req });
    }
    if (payload.tags && Array.isArray(payload.tags)) {
      const tagsValidation = validateArraySize(payload.tags, 50, "tags");
      if (!tagsValidation.valid) {
        return errorResponse(400, `Validation failed: ${tagsValidation.error}`, corsHeaders, { req });
      }
    }
    if (payload.fields) {
      const customFieldKeys = Object.keys(payload.fields).filter(
        (k) => !["name", "phone", "email", "company", "notes", "segment", "faturamento", "urgency", "rating", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(k)
      );
      if (customFieldKeys.length > 100) {
        return errorResponse(400, "Validation failed: custom_fields excede o limite de 100 campos", corsHeaders, { req });
      }
    }
    if (payload.place_in_pipe?.meeting_date && !isValidISODate(payload.place_in_pipe.meeting_date)) {
      return errorResponse(400, "Validation failed: meeting_date não é uma data ISO 8601 válida", corsHeaders, { req });
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
        return errorResponse(400, "No organization found", corsHeaders, { req });
      }
      organizationId = org.id;
    }

    // Referenced ID validation (warning only — don't block)
    if (payload.assigned_user_id && organizationId) {
      const refCheck = await validateReferencedId(supabase, "team_members", payload.assigned_user_id, organizationId);
      if (!refCheck.exists) {
        console.warn(`[lead-webhook] assigned_user_id not found in team_members for org ${organizationId}: ${refCheck.error}`);
      }
    }

    // Usar serviço centralizado para buscar ou criar lead
    const {
      name,
      phone,
      email,
      company,
      notes: fieldsNotes,
      segment,
      faturamento,
      urgency,
      rating,
      utm_source: fieldsUtmSource,
      utm_medium: fieldsUtmMedium,
      utm_campaign: fieldsUtmCampaign,
      utm_content: fieldsUtmContent,
      utm_term: fieldsUtmTerm,
      ...customFields
    } = payload.fields;

    // Mapear origem (valores do enum lead_origin)
    const originMap: Record<string, string> = {
      "meta_ads": "meta_ads",
      "facebook": "meta_ads",
      "instagram": "instagram",
      "tiktok": "tiktok",
      "google_ads": "google_ads",
      "landing_page": "landing_page",
      "site": "site",
      "remarketing": "remarketing",
      "indicacao": "indicacao",
      "indicação": "indicacao",
      "referral": "indicacao",
      "evento": "evento",
      "event": "evento",
      "prospeccao_ativa": "prospeccao_ativa",
      "prospeccao": "prospeccao_ativa",
      "outbound": "prospeccao_ativa",
      "whatsapp": "whatsapp",
      "calendly": "cal",
      "cal": "cal",
      "cal.com": "cal",
    };
    const origin = originMap[payload.source.toLowerCase()] || "outro";

    let result: Awaited<ReturnType<typeof getOrCreateLead>>;

    // Padrão: sempre criar novo lead. Só busca por telefone/email quando o cliente envia update_existing_if_match = true.
    // Aceita boolean true ou string "true" (n8n body fields envia como string).
    const shouldDeduplicate = payload.update_existing_if_match === true || payload.update_existing_if_match === "true";
    if (shouldDeduplicate) {
      result = await getOrCreateLead(supabase, {
        organizationId,
        phone: phone || null,
        email: email || null,
        name: name || "Lead sem nome",
        origin,
      });

      if (!result) {
        console.error("[lead-webhook] Failed to get or create lead for org:", organizationId, "phone:", phone, "email:", email);
        return errorResponse(500, "Failed to get or create lead", corsHeaders, {
          req,
          details: {
            hint: "Check Supabase Edge Function logs for [lead-service] errors. Common causes: missing database columns (run pending migrations), duplicate leads, or DB constraint violations.",
            context: { organization_id: organizationId, phone: phone || null, email: email || null },
          },
        });
      }
      console.log("[lead-webhook] update_existing_if_match: lead resolved:", result.lead.id, "created:", result.created);
    } else {
      // Sempre criar novo lead (padrão do sistema)
      const leadName = name || "Lead sem nome";
      const insertData: Record<string, unknown> = {
        name: leadName,
        phone: phone || null,
        email: email || null,
        origin,
        organization_id: organizationId,
        pipe_whatsapp: "novo",
        utm_source: fieldsUtmSource || null,
        utm_medium: fieldsUtmMedium || null,
        utm_campaign: fieldsUtmCampaign || payload.campaign_name || payload.campaign_id || null,
        utm_content: fieldsUtmContent || null,
        utm_term: fieldsUtmTerm || null,
      };
      if (payload.assigned_user_id) {
        insertData.sdr_id = payload.assigned_user_id;
        insertData.closer_id = payload.assigned_user_id;
        insertData.responsible_id = payload.assigned_user_id;
      }
      const { data: newLead, error: createError } = await supabase
        .from("leads")
        .insert(insertData)
        .select("id, name, phone, email, organization_id, normalized_phone")
        .single();

      if (createError) {
        console.error("[lead-webhook] Failed to create lead:", createError);
        return errorResponse(500, "Failed to create lead", corsHeaders, { req, details: createError.message });
      }

      try {
        await supabase.from("pipe_whatsapp").insert({
          lead_id: newLead.id,
          status: "novo",
          sdr_id: payload.assigned_user_id ?? null,
          organization_id: organizationId,
        });
      } catch (pipeError) {
        console.warn("[lead-webhook] pipe_whatsapp insert failed:", pipeError);
      }

      result = { lead: newLead, created: true, source: "created" };
      console.log("[lead-webhook] New lead created:", newLead.id);
    }

    const leadId = result.lead.id;
    const isNewLead = result.created;

    console.log("[lead-webhook] Lead resolved:", {
      leadId,
      isNewLead,
      source: result.source
    });

    // Atualizar lead (novo ou existente) com dados do payload
    const updateData: Record<string, unknown> = {};
    if (name) updateData.name = name;
    if (company !== undefined) updateData.company = company || null;
    // UTM fields: fields.utm_* take precedence, fall back to campaign_name/campaign_id
    if (fieldsUtmCampaign || payload.campaign_name || payload.campaign_id) {
      updateData.utm_campaign = fieldsUtmCampaign || payload.campaign_name || payload.campaign_id;
    }
    if (fieldsUtmSource) updateData.utm_source = fieldsUtmSource;
    if (fieldsUtmMedium) updateData.utm_medium = fieldsUtmMedium;
    if (fieldsUtmContent) updateData.utm_content = fieldsUtmContent;
    if (fieldsUtmTerm) updateData.utm_term = fieldsUtmTerm;
    if (fieldsNotes !== undefined && fieldsNotes !== "") {
      updateData.notes = fieldsNotes;
    } else if (isNewLead) {
      updateData.notes = `Fonte: ${payload.source}`;
    }
    if (segment !== undefined) updateData.segment = segment || null;
    if (faturamento !== undefined) updateData.faturamento = faturamento || null;
    if (urgency !== undefined) updateData.urgency = urgency || null;
    if (rating !== undefined && rating !== "") {
      const r = Number(rating);
      if (!Number.isNaN(r) && r >= 0 && r <= 10) updateData.rating = r;
    }
    if (payload.assigned_user_id) {
      updateData.sdr_id = payload.assigned_user_id;
      updateData.closer_id = payload.assigned_user_id;
      updateData.responsible_id = payload.assigned_user_id;
    }
    if (payload.place_in_pipe?.meeting_date) {
      updateData.compromisso_date = payload.place_in_pipe.meeting_date;
    }

    if (Object.keys(updateData).length > 0) {
      await supabase
        .from("leads")
        .update(updateData)
        .eq("id", leadId);
    }

    // Salvar campos personalizados (novo e existente)
    // Se o campo não existe na org, cria automaticamente + salva valor
    const customFieldResults: Record<string, string> = {};
    if (Object.keys(customFields).length > 0) {
      console.log("[lead-webhook] Processing custom fields:", Object.keys(customFields));
      for (const [fieldName, fieldValue] of Object.entries(customFields)) {
        if (fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== "") {
          console.log(`[lead-webhook] Custom field "${fieldName}" = "${fieldValue}"`);

          // Buscar campo existente
          const { data: existingField, error: findErr } = await supabase
            .from("lead_custom_fields")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("field_name", fieldName)
            .maybeSingle();

          if (findErr) {
            console.error(`[lead-webhook] Error finding custom field "${fieldName}":`, findErr);
          }

          let customFieldId = existingField?.id;

          // Se não existe, criar automaticamente
          if (!customFieldId) {
            const { data: newField, error: createErr } = await supabase
              .from("lead_custom_fields")
              .insert({
                organization_id: organizationId,
                field_name: fieldName,
                field_type: "text",
              })
              .select("id")
              .single();

            if (createErr) {
              console.error(`[lead-webhook] Error creating custom field "${fieldName}":`, createErr);
              // Tentar buscar novamente (pode ter sido criado por race condition)
              const { data: retryField } = await supabase
                .from("lead_custom_fields")
                .select("id")
                .eq("organization_id", organizationId)
                .eq("field_name", fieldName)
                .maybeSingle();
              customFieldId = retryField?.id;
            } else {
              customFieldId = newField?.id;
              console.log(`[lead-webhook] Custom field "${fieldName}" created:`, customFieldId);
            }
          }

          // Salvar valor
          if (customFieldId) {
            const { error: upsertErr } = await supabase
              .from("lead_custom_field_values")
              .upsert({
                lead_id: leadId,
                field_id: customFieldId,
                value: String(fieldValue),
              }, {
                onConflict: "lead_id,field_id",
              });

            if (upsertErr) {
              console.error(`[lead-webhook] Error saving custom field value "${fieldName}":`, upsertErr);
              customFieldResults[fieldName] = `value_error: ${upsertErr.message}`;
            } else {
              console.log(`[lead-webhook] Custom field "${fieldName}" saved for lead ${leadId}`);
              customFieldResults[fieldName] = "saved";
            }
          } else {
            console.error(`[lead-webhook] Could not resolve custom field "${fieldName}" — skipping value`);
            customFieldResults[fieldName] = "error: field_not_resolved";
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

    // Colocar lead em um pipe (funil) em etapa específica (ex: n8n, campanha de ads)
    if (payload.place_in_pipe?.pipe && payload.place_in_pipe?.stage) {
      const { pipe, stage, meeting_date } = payload.place_in_pipe;
      const stageVal = stage as string;

      // Helper: auto-distribuir SDR/Closer após inserir novo registro no pipe
      const autoDistributePipe = async (pipeTable: string, pipeTypeName: string) => {
        try {
          const { data: sdrId } = await supabase.rpc("get_next_pipe_sdr", {
            p_pipe_type: pipeTypeName,
            p_organization_id: organizationId,
          });
          const pipeUpdate: Record<string, unknown> = {};
          if (sdrId) pipeUpdate.sdr_id = sdrId;

          let closerId: string | null = null;
          if (pipeTypeName !== "whatsapp") {
            const { data: cId } = await supabase.rpc("get_next_pipe_closer", {
              p_pipe_type: pipeTypeName,
              p_organization_id: organizationId,
            });
            closerId = cId;
            if (closerId) pipeUpdate.closer_id = closerId;
          }

          if (Object.keys(pipeUpdate).length > 0) {
            await supabase.from(pipeTable).update(pipeUpdate)
              .eq("lead_id", leadId)
              .eq("organization_id", organizationId);
            console.log(`[lead-webhook] Auto-distributed in ${pipeTable}:`, pipeUpdate);

            // Also update lead-level responsible_id (closer takes priority over sdr)
            const responsibleId = closerId || sdrId;
            if (responsibleId) {
              const leadAssign: Record<string, unknown> = { responsible_id: responsibleId };
              if (sdrId) leadAssign.sdr_id = sdrId;
              if (closerId) leadAssign.closer_id = closerId;
              await supabase.from("leads").update(leadAssign).eq("id", leadId);
            }
          }
        } catch (e) {
          console.warn(`[lead-webhook] Auto-distribute failed for ${pipeTable}:`, e);
        }
      };

      if (pipe === "whatsapp") {
        const { data: existing } = await supabase
          .from("pipe_whatsapp")
          .select("id")
          .eq("lead_id", leadId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (existing) {
          await supabase.from("pipe_whatsapp").update({ status: stageVal }).eq("id", existing.id);
        } else {
          await supabase.from("pipe_whatsapp").insert({
            lead_id: leadId,
            organization_id: organizationId,
            status: stageVal,
          });
          await autoDistributePipe("pipe_whatsapp", "whatsapp");
        }
        console.log("[lead-webhook] Lead placed in pipe_whatsapp stage:", stageVal);
      } else if (pipe === "confirmacao") {
        const { data: existing } = await supabase
          .from("pipe_confirmacao")
          .select("id")
          .eq("lead_id", leadId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (existing) {
          const updatePayload: Record<string, unknown> = { status: stageVal };
          if (meeting_date) updatePayload.meeting_date = meeting_date;
          await supabase.from("pipe_confirmacao").update(updatePayload).eq("id", existing.id);
        } else {
          const insertPayload: Record<string, unknown> = {
            lead_id: leadId,
            organization_id: organizationId,
            status: stageVal,
          };
          if (meeting_date) insertPayload.meeting_date = meeting_date;
          await supabase.from("pipe_confirmacao").insert(insertPayload);
          await autoDistributePipe("pipe_confirmacao", "confirmacao");
        }
        console.log("[lead-webhook] Lead placed in pipe_confirmacao stage:", stageVal);
      } else if (pipe === "propostas") {
        const { data: existing } = await supabase
          .from("pipe_propostas")
          .select("id")
          .eq("lead_id", leadId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (existing) {
          const updatePayload: Record<string, unknown> = { status: stageVal };
          if (meeting_date) updatePayload.meeting_date = meeting_date;
          await supabase.from("pipe_propostas").update(updatePayload).eq("id", existing.id);
        } else {
          const insertPayload: Record<string, unknown> = {
            lead_id: leadId,
            organization_id: organizationId,
            status: stageVal,
          };
          if (meeting_date) insertPayload.meeting_date = meeting_date;
          await supabase.from("pipe_propostas").insert(insertPayload);
          await autoDistributePipe("pipe_propostas", "propostas");
        }
        console.log("[lead-webhook] Lead placed in pipe_propostas stage:", stageVal);
      }
    }

    // Colocar lead em uma campanha em etapa específica (ex: campanha de ads)
    let placedInCampaign: boolean | undefined;
    let placeInCampaignError: string | undefined;
    if (payload.place_in_campaign?.campaign_id && payload.place_in_campaign?.stage_id) {
      const { campaign_id, stage_id, notes } = payload.place_in_campaign;
      const { data: campaign } = await supabase
        .from("campanhas")
        .select("id")
        .eq("id", campaign_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!campaign) {
        placeInCampaignError = "Campaign not found or not in org";
        console.warn("[lead-webhook]", placeInCampaignError, campaign_id);
      } else {
        const { data: stage } = await supabase
          .from("campanha_stages")
          .select("id")
          .eq("id", stage_id)
          .eq("campanha_id", campaign_id)
          .maybeSingle();
        if (!stage) {
          placeInCampaignError = "Stage not found or not in campaign";
          console.warn("[lead-webhook]", placeInCampaignError, stage_id);
        } else {
          const { data: existing } = await supabase
            .from("campanha_leads")
            .select("id")
            .eq("lead_id", leadId)
            .eq("campanha_id", campaign_id)
            .maybeSingle();
          if (existing) {
            const updatePayload: { stage_id: string; notes?: string } = { stage_id };
            if (notes !== undefined) updatePayload.notes = notes;
            const { error: updateErr } = await supabase
              .from("campanha_leads")
              .update(updatePayload)
              .eq("id", existing.id);
            if (updateErr) {
              placeInCampaignError = updateErr.message;
              console.warn("[lead-webhook] campanha_leads update failed:", updateErr);
            } else {
              placedInCampaign = true;
              console.log("[lead-webhook] Lead placed in campaign:", campaign_id, "stage:", stage_id);
            }
          } else {
            const sdrId = payload.assigned_user_id ?? await getCampaignLeadAssignment(supabase, campaign_id);
            const closerId = await getCampaignCloserAssignment(supabase, campaign_id);
            if (!sdrId) {
              console.warn("[lead-webhook] No SDR assigned for campaign (distribution returned null). Check lead_distribution_mode and campanha_members:", campaign_id);
            }
            const responsibleId = closerId || sdrId;
            const insertPayload: Record<string, unknown> = {
              campanha_id: campaign_id,
              lead_id: leadId,
              stage_id,
            };
            if (notes !== undefined) insertPayload.notes = notes;
            if (sdrId) insertPayload.sdr_id = sdrId;
            if (closerId) insertPayload.closer_id = closerId;
            if (responsibleId) insertPayload.responsible_id = responsibleId;
            const { error: insertErr } = await supabase
              .from("campanha_leads")
              .insert(insertPayload);
            if (insertErr) {
              placeInCampaignError = insertErr.message;
              console.warn("[lead-webhook] campanha_leads insert failed:", insertErr);
            } else {
              placedInCampaign = true;
              console.log("[lead-webhook] Lead placed in campaign:", campaign_id, "stage:", stage_id);
              const leadUpdate: Record<string, unknown> = {};
              if (sdrId) leadUpdate.sdr_id = sdrId;
              if (closerId) leadUpdate.closer_id = closerId;
              if (responsibleId) leadUpdate.responsible_id = responsibleId;
              if (Object.keys(leadUpdate).length > 0) {
                const { error: leadUpdateErr } = await supabase
                  .from("leads")
                  .update(leadUpdate)
                  .eq("id", leadId);
                if (leadUpdateErr) {
                  console.warn("[lead-webhook] leads assignment update failed:", leadUpdateErr);
                } else {
                  console.log("[lead-webhook] Lead assigned responsible:", responsibleId, "SDR:", sdrId, "Closer:", closerId);
                }
              }
            }
          }
        }
      }
      if (placedInCampaign === undefined && !placeInCampaignError) placeInCampaignError = "Placement failed";
      if (placedInCampaign !== true) placedInCampaign = false;
    }

    // ── Build response first, then fire-and-forget non-critical work ──
    const responseBody: Record<string, unknown> = {
      success: true,
      lead_id: leadId,
      is_new: isNewLead,
      message: isNewLead ? "Lead criado com sucesso" : "Lead encontrado e atualizado",
    };
    if (Object.keys(customFieldResults).length > 0) {
      responseBody.custom_fields = customFieldResults;
    }
    if (payload.place_in_pipe) responseBody.place_in_pipe = payload.place_in_pipe;
    if (payload.place_in_campaign) {
      responseBody.place_in_campaign = payload.place_in_campaign;
      responseBody.placed_in_campaign = placedInCampaign === true;
      if (placeInCampaignError) responseBody.place_in_campaign_error = placeInCampaignError;
    }

    // Fire-and-forget: enqueue webhooks, outbound trigger, and log runtime.
    // These are non-critical — we don't block the HTTP response waiting for them.
    const backgroundTasks: Promise<void>[] = [];

    // Enfileira webhooks outbound (lead.created ou lead.updated)
    backgroundTasks.push(
      enqueueWebhookDeliveries(supabase, organizationId, isNewLead ? "lead.created" : "lead.updated", {
        event: isNewLead ? "lead.created" : "lead.updated",
        timestamp: new Date().toISOString(),
        data: {
          id: leadId,
          name: result.lead.name,
          email: result.lead.email ?? undefined,
          phone: result.lead.phone ?? undefined,
          organization_id: organizationId,
        },
      }).catch((e) => console.warn("[lead-webhook] Failed to enqueue webhooks:", e)),
    );

    // Se é novo lead, verificar se existe agente outbound para disparar
    if (isNewLead) {
      backgroundTasks.push(
        fetch(`${supabaseUrl}/functions/v1/outbound-trigger`, {
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
        })
          .then(() => console.log("[lead-webhook] Triggered outbound check for lead:", leadId))
          .catch((e) => console.warn("[lead-webhook] Failed to trigger outbound:", e)),
      );
    }

    backgroundTasks.push(
      logRuntime({
        organizationId: organizationId,
        module: "lead",
        action: "webhook_ingest",
        status: "success",
        entityType: "lead",
        entityId: leadId,
        payloadSnapshot: { source: payload.source, is_new: isNewLead },
      }).catch((e) => console.warn("[lead-webhook] logRuntime failed:", e)),
    );

    // Run background tasks without blocking response
    Promise.allSettled(backgroundTasks).catch(() => {});

    return successResponse(responseBody, corsHeaders, { req });

  } catch (error) {
    console.error("[lead-webhook] Error:", error);
    await logRuntime({
      module: "lead",
      action: "webhook_ingest",
      status: "error",
      errorMessage: String(error),
    });
    return errorResponse(500, "Internal server error", corsHeaders, { req, details: String(error) });
  }
}));
