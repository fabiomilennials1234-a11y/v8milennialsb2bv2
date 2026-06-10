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
import { upsertPipeEntry, getPipeEntry, updatePipeEntryById } from "../_shared/pipeline-adapter.ts";
import type { PipeSlug } from "../_shared/pipeline-adapter.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare, checkRateLimitPersistent, getClientIdentifier, checkRateLimit, rateLimitedResponse } from "../_shared/auth.ts";

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

  // Tags para identificar (aceita array ou string JSON)
  tags?: string[] | string;

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

  // Custom fields separados (Make.com envia fora de fields via toCollection)
  custom_fields?: Record<string, string>;
}

// ── Field name normalization ──
// n8n/Meta Ads sends form question text as field keys (e.g. "Email:", "Nome da Empresa").
// This map normalizes common variations to standard lead column names so data lands
// in the right place instead of creating orphan custom fields.
const STANDARD_FIELD_ALIASES: Record<string, string> = {
  // name
  "nome": "name",
  "nome completo": "name",
  "full name": "name",
  "nome_completo": "name",
  "full_name": "name",
  // phone
  "telefone": "phone",
  "celular": "phone",
  "whatsapp": "phone",
  "tel": "phone",
  "fone": "phone",
  "phone_number": "phone",
  "numero": "phone",
  "número": "phone",
  // email
  "e-mail": "email",
  "e_mail": "email",
  "email_address": "email",
  "endereço de email": "email",
  "endereco de email": "email",
  // company
  "empresa": "company",
  "nome da empresa": "company",
  "nome empresa": "company",
  "razão social": "company",
  "razao social": "company",
  "company_name": "company",
  "nome do salão/empresa": "company",
  "nome do salao/empresa": "company",
  "nome fantasia": "company",
  "organização": "company",
  "organizacao": "company",
  // notes
  "observações": "notes",
  "observacoes": "notes",
  "observação": "notes",
  "observacao": "notes",
  "notas": "notes",
  "anotações": "notes",
  "anotacoes": "notes",
  "comentários": "notes",
  "comentarios": "notes",
  // segment
  "segmento": "segment",
  "setor": "segment",
  // faturamento
  "faturamento mensal": "faturamento",
  "receita": "faturamento",
  "receita mensal": "faturamento",
  "revenue": "faturamento",
  // rating
  "nota": "rating",
  "avaliação": "rating",
  "avaliacao": "rating",
  "score": "rating",
  // urgency
  "urgência": "urgency",
  "urgencia": "urgency",
  "prioridade": "urgency",
};

const STANDARD_FIELD_NAMES = new Set([
  "name", "phone", "email", "company", "notes", "segment", "faturamento", "urgency", "rating",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
]);

function normalizeFieldKeys(fields: Record<string, string | undefined>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  const usedStandard = new Set<string>();

  // First pass: collect keys that already match standard names exactly
  for (const key of Object.keys(fields)) {
    if (STANDARD_FIELD_NAMES.has(key)) {
      usedStandard.add(key);
    }
  }

  for (const [originalKey, value] of Object.entries(fields)) {
    // Already a known standard key — keep as-is
    if (usedStandard.has(originalKey)) {
      result[originalKey] = value;
      continue;
    }

    // Normalize: lowercase, strip trailing colon/punctuation, trim
    const normalized = originalKey.toLowerCase().replace(/[:?!.]+$/, "").trim();

    // Check if normalized form IS a standard name (e.g. "Email:" → "email")
    // or if it maps via alias table (e.g. "Nome da Empresa" → "company")
    const mappedKey = STANDARD_FIELD_NAMES.has(normalized) ? normalized : STANDARD_FIELD_ALIASES[normalized];
    if (mappedKey && !usedStandard.has(mappedKey)) {
      result[mappedKey] = value;
      usedStandard.add(mappedKey);
      console.log(`[lead-webhook] Field "${originalKey}" → mapped to standard "${mappedKey}"`);
    } else {
      // Keep as custom field with original key
      result[originalKey] = value;
    }
  }

  return result;
}

serve(withSentry('lead-webhook', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verificar autenticação via header
    const webhookKey = req.headers.get("x-webhook-key");
    const expectedKey = Deno.env.get("WEBHOOK_API_KEY");
    
    if (!webhookKey || !expectedKey || !timingSafeCompare(webhookKey, expectedKey)) {
      console.error("[lead-webhook] Invalid or missing webhook key");
      return errorResponse(401, "Unauthorized", corsHeaders, { req });
    }

    // In-memory rate limit — fast first-line defense (resets on cold start)
    const clientIp = getClientIdentifier(req);
    const memRl = checkRateLimit(`lead-webhook:${clientIp}`, 60, 60_000); // 60 req/min
    if (!memRl.allowed) {
      return rateLimitedResponse(memRl.resetIn, corsHeaders);
    }

    // Parse payload
    const payload: LeadWebhookPayload = await req.json();
    console.log("[lead-webhook] Received payload for org:", payload.organization_id, "source:", payload.source);

    // Merge custom_fields into fields (Make.com sends them separately)
    if (payload.custom_fields && typeof payload.custom_fields === "object") {
      payload.fields = { ...payload.fields, ...payload.custom_fields };
    }

    // Sanitizar campos: remover whitespace/newlines de todos os valores em fields
    if (payload.fields) {
      for (const key of Object.keys(payload.fields)) {
        const val = payload.fields[key];
        if (typeof val === "string") {
          // Strip prefixo "?" espúrio que a origem (Meta Ads/n8n) às vezes injeta
          // nos valores (ex: "?Jhonny's Drinkeria", "?outro") — vazava literal pro
          // cliente nas mensagens da automação. Bug C, incidente Bertin 2026-06-03.
          const trimmed = val.trim().replace(/^\?+\s*/, "");
          payload.fields[key] = trimmed === "" ? undefined : trimmed;
        }
      }
      // Normalize field keys: map common n8n/Meta Ads variations to standard names
      // e.g. "Email:" → "email", "Nome da Empresa" → "company"
      payload.fields = normalizeFieldKeys(payload.fields);
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
    // Normalizar tags: aceita string JSON '["Ouro"]', string simples "Ouro", ou array
    if (payload.tags) {
      if (typeof payload.tags === "string") {
        const raw = payload.tags;
        try {
          const parsed = JSON.parse(raw);
          payload.tags = Array.isArray(parsed) ? parsed as string[] : [String(parsed)];
        } catch {
          payload.tags = [raw];
        }
      }
      if (Array.isArray(payload.tags)) {
        payload.tags = payload.tags.map((t) => String(t).trim()).filter(Boolean);
        const tagsValidation = validateArraySize(payload.tags, 50, "tags");
        if (!tagsValidation.valid) {
          return errorResponse(400, `Validation failed: ${tagsValidation.error}`, corsHeaders, { req });
        }
      }
    }
    if (payload.fields) {
      const customFieldKeys = Object.keys(payload.fields).filter(
        (k) => !STANDARD_FIELD_NAMES.has(k)
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

    // Persistent rate limit — authoritative check (survives cold starts)
    const persistentRl = await checkRateLimitPersistent(supabase, `lead-webhook:${clientIp}`, 60, 60);
    if (!persistentRl.allowed) {
      console.warn("[lead-webhook] Persistent rate limit hit for:", clientIp);
      return errorResponse(429, "Rate limit exceeded", corsHeaders, { req });
    }

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

    // UTM resolution: fields.utm_* (inside fields object) take precedence,
    // then top-level payload.utm_* (how n8n body fields sends them),
    // then legacy payload.campaign_name/campaign_id for campaign only.
    const utmSource = fieldsUtmSource || payload.utm_source || null;
    const utmMedium = fieldsUtmMedium || payload.utm_medium || null;
    const utmCampaign = fieldsUtmCampaign || payload.utm_campaign || payload.campaign_name || payload.campaign_id || null;
    const utmContent = fieldsUtmContent || payload.utm_content || null;
    const utmTerm = fieldsUtmTerm || payload.utm_term || null;

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

    // ── Cal.com bypass ──────────────────────────────────────────────────
    // Leads vindos do Cal.com já têm reunião agendada — pulam pipe_whatsapp
    // (qualificação) e entram direto em pipe_confirmacao/reuniao_marcada.
    // meeting_date é obrigatório (lembretes D-N dependem disso).
    if (origin === "cal") {
      const meetingDate =
        payload.place_in_pipe?.meeting_date ||
        (payload.fields?.meeting_date as string | undefined) ||
        (payload as { meeting_date?: string }).meeting_date;

      if (!meetingDate || !isValidISODate(meetingDate)) {
        return errorResponse(
          400,
          "Validation failed: origin=cal requer meeting_date ISO 8601 em place_in_pipe.meeting_date ou fields.meeting_date",
          corsHeaders,
          { req },
        );
      }

      if (payload.place_in_pipe && payload.place_in_pipe.pipe !== "confirmacao") {
        console.warn(
          `[lead-webhook] origin=cal override: caller mandou pipe="${payload.place_in_pipe.pipe}" stage="${payload.place_in_pipe.stage}", forçando confirmacao/reuniao_marcada`,
        );
      }

      payload.place_in_pipe = {
        pipe: "confirmacao",
        stage: "reuniao_marcada",
        meeting_date: meetingDate,
      };
    }

    let result: Awaited<ReturnType<typeof getOrCreateLead>>;

    // ── Meta dummy/test lead — nunca deduplica ───────────────────────────
    // A "Testing Tool" do Meta Lead Ads envia leads com email test@meta.com e
    // valores literais "<test lead: dummy data for {campo}>". Com
    // update_existing_if_match esses casam um registro de teste já existente
    // (até soft-deletado) e o atualizam silenciosamente — o envio "dá sucesso"
    // mas nada novo aparece. Dummy = sempre criar, jamais deduplicar.
    const isDummyTestLead = [email, name, phone, company, ...Object.values(customFields)]
      .some((v) => typeof v === "string" &&
        (v.trim().toLowerCase() === "test@meta.com" || /^<test lead: dummy data for\b/i.test(v.trim())));
    if (isDummyTestLead) {
      console.log("[lead-webhook] Meta dummy/test lead detectado — pulando dedup (sempre cria):", { email });
    }

    // Padrão: sempre criar novo lead. Só busca por telefone/email quando o cliente envia update_existing_if_match = true.
    // Aceita boolean true ou string "true" (n8n body fields envia como string).
    // Dummy do Meta nunca deduplica (senão atualiza um lead de teste pré-existente).
    const shouldDeduplicate = !isDummyTestLead &&
      (payload.update_existing_if_match === true || payload.update_existing_if_match === "true");
    if (shouldDeduplicate) {
      result = await getOrCreateLead(supabase, {
        organizationId,
        phone: phone || null,
        email: email || null,
        name: name || "Lead sem nome",
        origin,
      });

      if (!result) {
        console.error("[lead-webhook] Failed to get or create lead for org:", organizationId);
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
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utmTerm,
      };
      if (payload.assigned_user_id) {
        insertData.sdr_id = payload.assigned_user_id;
        insertData.closer_id = payload.assigned_user_id;
        insertData.responsible_id = payload.assigned_user_id;
        insertData.pre_sale_responsible_id = payload.assigned_user_id;
        insertData.sale_responsible_id = payload.assigned_user_id;
      }
      const { data: newLead, error: createError } = await supabase
        .from("leads")
        .insert(insertData)
        .select("id, name, phone, email, organization_id, normalized_phone")
        .single();

      if (createError) {
        console.error("[lead-webhook] Failed to create lead:", createError);
        if (createError.code === "23505") {
          return errorResponse(
            409,
            "Lead já existe com este telefone nesta organização. Envie update_existing_if_match=true (Make: 'Atualizar lead existente?' = Sim) para atualizar o lead existente.",
            corsHeaders,
            { req, details: createError.message },
          );
        }
        return errorResponse(500, "Failed to create lead", corsHeaders, { req, details: createError.message });
      }

      try {
        await upsertPipeEntry(supabase, {
          leadId: newLead.id,
          orgId: organizationId,
          slug: "whatsapp",
          stageKey: "novo",
          metadata: { sdr_id: payload.assigned_user_id ?? null },
          assignedTo: payload.assigned_user_id ?? null,
        });
      } catch (pipeError) {
        console.warn("[lead-webhook] pipeline_entries whatsapp insert failed:", pipeError);
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
    // Persistir email/phone quando o match foi pelo OUTRO identificador.
    // Ex: lead achado via phone → preserva email novo do typeform.
    // Sem isso, Calendly subsequente (sem phone) não acha pelo email e cria duplicado.
    if (email && result.source !== "email") updateData.email = email;
    if (phone && result.source !== "phone") updateData.phone = phone;
    // UTM fields: resolved earlier (fields.utm_* → payload.utm_* → campaign_name/id)
    if (utmCampaign) updateData.utm_campaign = utmCampaign;
    if (utmSource) updateData.utm_source = utmSource;
    if (utmMedium) updateData.utm_medium = utmMedium;
    if (utmContent) updateData.utm_content = utmContent;
    if (utmTerm) updateData.utm_term = utmTerm;
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
      updateData.pre_sale_responsible_id = payload.assigned_user_id;
      updateData.sale_responsible_id = payload.assigned_user_id;
    }
    if (payload.place_in_pipe?.meeting_date) {
      updateData.compromisso_date = payload.place_in_pipe.meeting_date;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from("leads")
        .update(updateData)
        .eq("id", leadId);
      if (updateError) {
        console.error("[lead-webhook] Failed to update lead fields:", updateError, "data:", JSON.stringify(updateData));
      }
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
        // Buscar tag escopada por org (evita cross-tenant leak)
        let { data: tag } = await supabase
          .from("tags")
          .select("id")
          .eq("organization_id", organizationId)
          .ilike("name", tagName)
          .maybeSingle();

        if (!tag) {
          const { data: newTag, error: tagInsertError } = await supabase
            .from("tags")
            .insert({ name: tagName, color: "#6366f1", organization_id: organizationId })
            .select()
            .single();
          if (tagInsertError) {
            console.error(`[lead-webhook] Failed to create tag "${tagName}":`, tagInsertError);
          }
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
      const autoDistributePipe = async (pipeSlug: PipeSlug) => {
        try {
          const { data: sdrId } = await supabase.rpc("get_next_pipe_sdr", {
            p_pipe_type: pipeSlug,
            p_organization_id: organizationId,
          });
          const metadataUpdate: Record<string, unknown> = {};
          if (sdrId) metadataUpdate.sdr_id = sdrId;

          let closerId: string | null = null;
          if (pipeSlug !== "whatsapp") {
            const { data: cId } = await supabase.rpc("get_next_pipe_closer", {
              p_pipe_type: pipeSlug,
              p_organization_id: organizationId,
            });
            closerId = cId;
            if (closerId) metadataUpdate.closer_id = closerId;
          }

          if (Object.keys(metadataUpdate).length > 0) {
            const entry = await getPipeEntry(supabase, leadId, organizationId, pipeSlug);
            if (entry) {
              await updatePipeEntryById(supabase, entry.id, {
                metadata: metadataUpdate,
                assignedTo: (closerId || sdrId) ?? undefined,
              });
            }
            console.log(`[lead-webhook] Auto-distributed in pipeline_entries(${pipeSlug}):`, metadataUpdate);

            // Also update lead-level responsible_id (closer takes priority over sdr)
            const responsibleId = closerId || sdrId;
            if (responsibleId) {
              const leadAssign: Record<string, unknown> = {
                responsible_id: responsibleId,
                pre_sale_responsible_id: sdrId || responsibleId,
                sale_responsible_id: closerId || responsibleId,
              };
              if (sdrId) leadAssign.sdr_id = sdrId;
              if (closerId) leadAssign.closer_id = closerId;
              await supabase.from("leads").update(leadAssign).eq("id", leadId);
            }
          }
        } catch (e) {
          console.warn(`[lead-webhook] Auto-distribute failed for pipeline_entries(${pipeSlug}):`, e);
        }
      };

      const pipeSlug = pipe as PipeSlug;
      const metadata: Record<string, unknown> = {};
      if (meeting_date) metadata.meeting_date = meeting_date;

      // Aceita stage_key exato ou nome da etapa (case-insensitive) — Make/n8n enviam rótulos como "Novo".
      let resolvedStageKey = stageVal;
      const { data: orgStages } = await supabase
        .from("pipeline_stages")
        .select("stage_key, name")
        .eq("organization_id", organizationId)
        .eq("pipeline_type", pipeSlug)
        .eq("is_active", true);
      if (orgStages && orgStages.length > 0) {
        const requested = stageVal.trim().toLowerCase();
        const match =
          orgStages.find((s) => s.stage_key.toLowerCase() === requested) ||
          orgStages.find((s) => s.name?.trim().toLowerCase() === requested);
        if (match) resolvedStageKey = match.stage_key;
      }

      const existingEntry = await getPipeEntry(supabase, leadId, organizationId, pipeSlug);
      if (existingEntry) {
        // Reingestão externa (Make/n8n/Meta Ads) move o lead para o stage pedido — lead que
        // reconverte volta a aparecer na coluna solicitada. Registra reconversão na timeline.
        const stageChanged = existingEntry.stage_key !== resolvedStageKey;
        const entryUpdates: { stageKey?: string; metadata?: Record<string, unknown> } = {};
        if (stageChanged) entryUpdates.stageKey = resolvedStageKey;
        if (Object.keys(metadata).length > 0) entryUpdates.metadata = metadata;
        if (Object.keys(entryUpdates).length > 0) {
          await updatePipeEntryById(supabase, existingEntry.id, entryUpdates);
        }
        if (stageChanged) {
          const { error: historyErr } = await supabase.from("lead_history").insert({
            lead_id: leadId,
            organization_id: organizationId,
            action: "stage_changed",
            description: `Lead reconverteu via webhook (${origin}): movido de "${existingEntry.stage_key}" para "${resolvedStageKey}" no funil ${pipeSlug}.`,
            created_by: null,
            source: "system",
            metadata: {
              pipe: pipeSlug,
              from_stage: existingEntry.stage_key,
              to_stage: resolvedStageKey,
              reconversion: true,
            },
          });
          if (historyErr) {
            console.warn("[lead-webhook] lead_history reconversion insert failed:", historyErr);
          }
          console.log(
            `[lead-webhook] Lead reconverteu em pipeline_entries(${pipeSlug}): "${existingEntry.stage_key}" → "${resolvedStageKey}".`
          );
        }
      } else {
        await upsertPipeEntry(supabase, {
          leadId,
          orgId: organizationId,
          slug: pipeSlug,
          stageKey: resolvedStageKey,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });
        await autoDistributePipe(pipeSlug);
        console.log(`[lead-webhook] Lead placed in pipeline_entries(${pipeSlug}) stage:`, resolvedStageKey);
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
            insertPayload.pre_sale_responsible_id = sdrId ?? null;
            insertPayload.sale_responsible_id = closerId ?? null;
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
              leadUpdate.pre_sale_responsible_id = sdrId ?? null;
              leadUpdate.sale_responsible_id = closerId ?? null;
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
