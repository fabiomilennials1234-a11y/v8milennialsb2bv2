import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { validateApiKey } from "../_shared/auth.ts";
import { validateLeadInput, sanitizeString, isValidUUID, isValidISODate, validateReferencedId } from "../_shared/validation.ts";
import { normalizePhoneForSearch } from "../_shared/lead-service.ts";
import { logRuntime } from "../_shared/logger.ts";
import { fireTrigger } from "../_shared/workflow-trigger.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import { upsertPipeEntry, getPipeEntry, deletePipeEntry, updatePipeEntryById, resolveActiveStageKey } from "../_shared/pipeline-adapter.ts";
import { resolveLeadDestination, resolveMeetingDestination } from "../_shared/pipeline-destination.ts";

// Helper function to normalize email (lowercase, trim)
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

// Helper function to normalize name for comparison
function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

// Helper function to get start and end of day for a given date
function getDayBoundaries(date: Date): { start: string; end: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

Deno.serve(withErrorBoundary('webhook-new-lead', async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- API Key Authentication (obrigatória — fail-closed) ---
    // SEGURANÇA (incidente 2026-06-01): a antiga "janela de graça" deixava passar
    // requisições SEM API key e resolvia a org a partir do body do chamador, permitindo
    // injeção anônima de leads cross-tenant + disparo de automações. Agora: sem chave válida = 401.
    const authResult = await validateApiKey(supabase, req);
    if (authResult.subscriptionBlocked) {
      return errorResponse(402, authResult.error || "Assinatura suspensa", corsHeaders, { req });
    }
    if (!authResult.valid) {
      return errorResponse(401, authResult.error || "API key required", corsHeaders, { req });
    }

    const body = await req.json();
    
    // Valid origin enum values
    const validOrigins = ["whatsapp", "meta_ads", "instagram", "tiktok", "google_ads", "site", "landing_page", "remarketing", "indicacao", "evento", "prospeccao_ativa", "cal", "outro"];
    
    // Expected fields from n8n
    const {
      name: rawName,
      email: rawEmail,
      phone: rawPhone,
      company: rawCompany,
      origin: rawOrigin,
      segment: rawSegment,
      faturamento: rawFaturamento,
      urgency: rawUrgency,
      notes: rawNotes,
      rating,
      sdr_id,
      meeting_date,
      compromisso_date,
      utm_source: rawUtmSource,
      utm_medium: rawUtmMedium,
      utm_campaign: rawUtmCampaign,
      utm_term: rawUtmTerm,
      utm_content: rawUtmContent,
      organization_id: rawOrganizationId,
    } = body;

    // organization_id vem EXCLUSIVAMENTE da API key autenticada (anti cross-tenant).
    // NUNCA confiar em organization_id do body, nem cair na "primeira org ativa".
    const organization_id: string | undefined = authResult.organizationId;
    if (!organization_id) {
      return errorResponse(401, "organização não resolvida a partir da API key", corsHeaders, { req });
    }
    // Se o body mandar organization_id divergente da chave, rejeita (evita confusão/abuso).
    if (rawOrganizationId && rawOrganizationId !== organization_id) {
      return errorResponse(403, "organization_id do body diverge da API key", corsHeaders, { req });
    }

    // ── Input validation ──
    if (rawOrganizationId && !isValidUUID(rawOrganizationId)) {
      return errorResponse(400, "Validation failed: organization_id não é um UUID válido", corsHeaders, { req });
    }
    if (sdr_id && !isValidUUID(sdr_id)) {
      return errorResponse(400, "Validation failed: sdr_id não é um UUID válido", corsHeaders, { req });
    }
    if (compromisso_date && !isValidISODate(compromisso_date)) {
      return errorResponse(400, "Validation failed: compromisso_date não é uma data ISO 8601 válida", corsHeaders, { req });
    }
    if (sdr_id && organization_id) {
      const refCheck = await validateReferencedId(supabase, "team_members", sdr_id, organization_id);
      if (!refCheck.exists) {
        console.warn(`[webhook-new-lead] sdr_id not found in team_members for org ${organization_id}: ${refCheck.error}`);
      }
    }

    // Sanitize inputs
    const name = sanitizeString(rawName, 200) || "";
    const email = sanitizeString(rawEmail, 255);
    const phone = sanitizeString(rawPhone, 50);
    const company = sanitizeString(rawCompany, 200);
    const segment = sanitizeString(rawSegment, 100);
    const faturamento = sanitizeString(rawFaturamento, 100);
    const urgency = sanitizeString(rawUrgency, 50);
    const notes = sanitizeString(rawNotes, 5000);
    const utm_source = sanitizeString(rawUtmSource, 100);
    const utm_medium = sanitizeString(rawUtmMedium, 100);
    const utm_campaign = sanitizeString(rawUtmCampaign, 100);
    const utm_term = sanitizeString(rawUtmTerm, 100);
    const utm_content = sanitizeString(rawUtmContent, 100);

    // If compromisso_date is filled, set origin to "cal", otherwise normalize origin
    const origin = compromisso_date ? "cal" : (validOrigins.includes(rawOrigin) ? rawOrigin : "outro");
    
    // Validate input
    const validation = validateLeadInput({
      name,
      email,
      phone,
      origin,
      rating,
    });

    if (!validation.valid) {
      return errorResponse(400, "Dados inválidos", corsHeaders, { req, details: validation.errors });
    }
    
    // Normalize email for comparison (case-insensitive)
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeName(name);

    // ============================================
    // DEDUPLICATION LOGIC
    // ============================================
    let existingLead = null;
    let deduplicationMethod = null;

    // 0. FIRST PRIORITY: Try to find by normalized phone
    // Uses limit(1) instead of maybeSingle() to handle duplicate leads gracefully
    const normalizedPhone = normalizePhoneForSearch(phone);
    if (normalizedPhone) {
      const { data: phoneResults, error: phoneSearchError } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("normalized_phone", normalizedPhone)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!phoneSearchError && phoneResults?.[0]) {
        existingLead = phoneResults[0];
        deduplicationMethod = "phone";
        console.log("[webhook-new-lead] Found existing lead by phone:", existingLead.id);
      }
    }

    // 1. Second priority: try to find by email (case-insensitive)
    if (!existingLead && normalizedEmail) {
      const { data: leads, error: searchError } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", organization_id)
        .order("created_at", { ascending: false });

      if (!searchError && leads) {
        // Find lead with matching email (case-insensitive)
        existingLead = leads.find(lead => normalizeEmail(lead.email) === normalizedEmail);
        if (existingLead) {
          deduplicationMethod = "email";
        }
      }
    }

    // 2. If no email match, try to find by name + same day
    if (!existingLead && normalizedName) {
      const today = new Date();
      const { start, end } = getDayBoundaries(today);
      
      const { data: todayLeads, error: searchError } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", organization_id)
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false });

      if (!searchError && todayLeads) {
        // Find lead with matching name (case-insensitive, normalized spaces)
        existingLead = todayLeads.find(lead => normalizeName(lead.name) === normalizedName);
        if (existingLead) {
          deduplicationMethod = "name_same_day";
        }
      }
    }

    // ============================================
    // HANDLE EXISTING LEAD (UNIFICATION)
    // ============================================
    if (existingLead) {

      // Merge data: update only if new value exists and old value is empty/null
      const updatedData: Record<string, any> = {};
      
      if (phone && !existingLead.phone) updatedData.phone = phone;
      if (company && !existingLead.company) updatedData.company = company;
      if (segment && !existingLead.segment) updatedData.segment = segment;
      if (faturamento && !existingLead.faturamento) updatedData.faturamento = faturamento;
      if (urgency && !existingLead.urgency) updatedData.urgency = urgency;
      if (sdr_id && !existingLead.sdr_id) updatedData.sdr_id = sdr_id;
      if (sdr_id && !existingLead.responsible_id) updatedData.responsible_id = sdr_id;
      if (sdr_id && !existingLead.pre_sale_responsible_id) updatedData.pre_sale_responsible_id = sdr_id;
      
      // Always update email if we found by name and new email is provided
      if (deduplicationMethod === "name_same_day" && normalizedEmail && !existingLead.email) {
        updatedData.email = email;
      }

      // Merge UTM params (keep existing, add new if missing)
      if (utm_source && !existingLead.utm_source) updatedData.utm_source = utm_source;
      if (utm_medium && !existingLead.utm_medium) updatedData.utm_medium = utm_medium;
      if (utm_campaign && !existingLead.utm_campaign) updatedData.utm_campaign = utm_campaign;
      if (utm_term && !existingLead.utm_term) updatedData.utm_term = utm_term;
      if (utm_content && !existingLead.utm_content) updatedData.utm_content = utm_content;

      // Update rating if new rating is higher
      if (rating && parseInt(String(rating), 10) > (existingLead.rating || 0)) {
        updatedData.rating = parseInt(String(rating), 10);
      }

      // Append notes
      if (notes) {
        updatedData.notes = existingLead.notes 
          ? `${existingLead.notes}\n\n[Unificado] ${notes}`
          : notes;
      }

      // Handle compromisso_date - ALWAYS preserve existing, or use new if none exists
      const newCompromissoDate = compromisso_date || null;
      const finalCompromissoDate = existingLead.compromisso_date || newCompromissoDate;
      
      if (newCompromissoDate && !existingLead.compromisso_date) {
        // Only update if existing lead has no compromisso_date
        updatedData.compromisso_date = newCompromissoDate;
        updatedData.origin = "cal"; // Lead now has compromisso_date from calendar source
      } else if (existingLead.compromisso_date && newCompromissoDate && existingLead.compromisso_date !== newCompromissoDate) {
        // If both have dates, keep existing and log the conflict
        updatedData.notes = (updatedData.notes || existingLead.notes || '') + 
          `\n\n[Conflito de data] Nova data recebida: ${newCompromissoDate} - mantida data original: ${existingLead.compromisso_date}`;
      }
      // If existingLead.compromisso_date exists and no new date, nothing changes (preserves existing)

      // Apply updates if any
      if (Object.keys(updatedData).length > 0) {
        const { error: updateError } = await supabase
          .from("leads")
          .update(updatedData)
          .eq("id", existingLead.id);

        if (updateError) {
          // Error logged to Supabase logs automatically
        }
      }

      // Handle pipe routing for unified lead
      // Use existing compromisso_date if available, otherwise use new one
      const effectiveCompromissoDate = existingLead.compromisso_date || newCompromissoDate;
      
      if (effectiveCompromissoDate) {
        const orgId = existingLead.organization_id || organization_id;

        // SCRUM-641: destino preferido segue confirmacao/reuniao_marcada (org
        // antiga: idêntico); org sem esse funil → funil padrão ancorado pelo
        // papel meeting_booked; sem padrão → sem card (log no helper).
        const meetDest = await resolveMeetingDestination(supabase, orgId, {
          ref: "confirmacao",
          stageKey: "reuniao_marcada",
        });

        if (meetDest) {
          const existingConfirmacao = await getPipeEntry(supabase, existingLead.id, orgId, meetDest.ref);

          if (existingConfirmacao) {
            await updatePipeEntryById(supabase, existingConfirmacao.id, {
              stageKey: meetDest.stageKey,
              metadata: { meeting_date: newCompromissoDate },
            });
          } else {
            await upsertPipeEntry(supabase, {
              leadId: existingLead.id,
              orgId,
              slug: meetDest.ref,
              stageKey: meetDest.stageKey,
              metadata: {
                sdr_id: sdr_id || existingLead.sdr_id || null,
                meeting_date: newCompromissoDate,
              },
              assignedTo: sdr_id || existingLead.sdr_id || null,
            });
          }
        }

        // Check if lead is in pipeline_entries(propostas) with stage "compromisso_marcado"
        // If so, keep in pipeline_entries(whatsapp) (exception rule)
        // SCRUM-641: só remove quando a reunião NÃO caiu no fallback — o funil
        // padrão pode ser o próprio whatsapp da org.
        const existingProposta = await getPipeEntry(supabase, existingLead.id, orgId, "propostas");

        if (!meetDest?.usedDefaultPipeline
            && (!existingProposta || existingProposta.stage_key !== "compromisso_marcado")) {
          // Only remove from pipeline_entries(whatsapp) if NOT in compromisso_marcado
          await deletePipeEntry(supabase, existingLead.id, orgId, "whatsapp");
        }
      }

      // Create history entry for unification
      const deduplicationDescription =
        deduplicationMethod === "phone" ? "mesmo telefone" :
        deduplicationMethod === "email" ? "mesmo email" :
        "mesmo nome no mesmo dia";

      await supabase.from("lead_history").insert({
        lead_id: existingLead.id,
        action: "lead_created",
        description: `Sistema: Lead duplicado detectado (${deduplicationDescription}). Dados mesclados automaticamente.`,
        created_by: null,
      });

      await logRuntime({
        module: "lead",
        action: "webhook_create",
        status: "success",
        entityType: "lead",
        entityId: existingLead.id,
        payloadSnapshot: { deduplicationMethod, pipe: newCompromissoDate ? "confirmacao" : "whatsapp" },
      });

      return successResponse({
        message: "Lead existente atualizado (duplicado unificado)",
        lead_id: existingLead.id,
        deduplication_method: deduplicationMethod,
        pipe: newCompromissoDate ? "confirmacao" : "whatsapp",
      }, corsHeaders, { req });
    }

    // ============================================
    // CREATE NEW LEAD (NO DUPLICATE FOUND)
    // Atomic lead + pipe creation via RPC (single transaction)
    //
    // SCRUM-641: destinos preferidos seguem os históricos ('whatsapp' para
    // lead comum, 'confirmacao' para reunião) — org antiga com o trio se
    // comporta byte a byte como antes, inclusive a atomicidade do RPC. Org
    // SEM o funil preferido (org nova pós-funil-único) cai no funil PADRÃO:
    // reunião ancora na etapa de papel meeting_booked; lead comum na 1ª etapa
    // ativa. Nesse fallback o RPC cria só o lead (p_pipe_type null — o IF do
    // RPC só conhece o trio) e o card nasce via adapter logo depois — mesmo
    // playbook do lead-webhook (lead primeiro, card depois).
    const dest = compromisso_date
      ? await resolveMeetingDestination(supabase, organization_id, { ref: 'confirmacao', stageKey: 'reuniao_marcada' })
      : await resolveLeadDestination(supabase, organization_id, { ref: 'whatsapp' });

    // Caminho histórico (trio existe): o RPC posiciona atomicamente.
    const rpcPipeType = dest && !dest.usedDefaultPipeline ? (compromisso_date ? 'confirmacao' : 'whatsapp') : null;
    const rpcPipeStatus = rpcPipeType ? dest!.stageKey : null;
    const pipeLabel = dest?.ref ?? null;

    const { data: result, error: rpcError } = await supabase.rpc('create_lead_with_pipe', {
      p_name: name,
      p_email: email || null,
      p_phone: phone || null,
      p_company: company || null,
      p_origin: origin,
      p_organization_id: organization_id,
      p_segment: segment || null,
      p_faturamento: faturamento || null,
      p_urgency: urgency || null,
      p_notes: notes || null,
      p_rating: rating ? parseInt(String(rating), 10) : 0,
      p_sdr_id: sdr_id || null,
      p_responsible_id: sdr_id || null,
      p_pre_sale_responsible_id: sdr_id || null,
      p_compromisso_date: compromisso_date || null,
      p_utm_source: utm_source || null,
      p_utm_medium: utm_medium || null,
      p_utm_campaign: utm_campaign || null,
      p_utm_term: utm_term || null,
      p_utm_content: utm_content || null,
      p_pipe_type: rpcPipeType,
      p_pipe_status: rpcPipeStatus,
      p_pipe_meeting_date: compromisso_date || null,
    });

    if (rpcError) {
      return errorResponse(500, "Erro ao criar lead", corsHeaders, { req, details: rpcError.message });
    }

    const leadId = result.lead_id;

    // Fallback SCRUM-641: destino fora do trio (funil padrão) — o card nasce
    // aqui, via adapter. dest null = org sem funil padrão: lead SEM card, log.
    if (dest && dest.usedDefaultPipeline) {
      await upsertPipeEntry(supabase, {
        leadId,
        orgId: organization_id,
        slug: dest.ref,
        stageKey: dest.stageKey,
        metadata: compromisso_date
          ? { sdr_id: sdr_id || null, meeting_date: compromisso_date }
          : { sdr_id: sdr_id || null },
        assignedTo: sdr_id || null,
      });
    } else if (!dest) {
      console.warn(`[webhook-new-lead] lead ${leadId} criado SEM card: org ${organization_id} sem funil de destino (nem trio, nem funil padrão).`);
    }

    if (compromisso_date) {
      // Create history entry for reunião
      await supabase.from("lead_history").insert({
        lead_id: leadId,
        action: "lead_created",
        description: `Sistema: Lead ${name} adicionado automaticamente com reunião marcada para ${compromisso_date}`,
        created_by: null,
      });

      await logRuntime({
        module: "lead",
        action: "webhook_create",
        status: "success",
        entityType: "lead",
        entityId: leadId,
        payloadSnapshot: { pipe: pipeLabel },
      });

      return successResponse({
        message: "Lead criado com sucesso com reunião marcada",
        lead_id: leadId,
        pipe: pipeLabel,
      }, corsHeaders, { req });
    }

    // WhatsApp pipe path
    // Create history entry
    await supabase.from("lead_history").insert({
      lead_id: leadId,
      action: "lead_created",
      description: `Sistema: Lead ${name} adicionado automaticamente via webhook`,
      created_by: null,
    });

    await logRuntime({
      module: "lead",
      action: "webhook_create",
      status: "success",
      entityType: "lead",
      entityId: leadId,
      payloadSnapshot: { pipe: pipeLabel },
    });

    // Fire webhook_received workflow trigger (fire-and-forget)
    fireTrigger({
      supabase,
      organizationId: organization_id,
      triggerType: "webhook_received",
      leadId: leadId,
      context: { trigger: "webhook_received", webhook_key: "new_lead", origin: origin || "webhook" },
    }).catch(() => {});

    return successResponse({
      message: "Lead criado com sucesso",
      lead_id: leadId,
      pipe: pipeLabel,
    }, corsHeaders, { req });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await logRuntime({
      module: "lead",
      action: "webhook_create",
      status: "error",
      errorMessage,
    });
    return errorResponse(500, "Erro interno", corsHeaders, { req, details: errorMessage });
  }
}));
