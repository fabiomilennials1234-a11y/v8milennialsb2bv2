import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { validateApiKey } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { isValidUUID, isValidISODate } from "../_shared/validation.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import { isFeatureFlagEnabled } from "../_shared/feature-flags.ts";
import { upsertPipeEntry } from "../_shared/pipeline-adapter.ts";
import { isDealManualOnly } from "../_shared/deal-policy.ts";

Deno.serve(withErrorBoundary('webhook-confirmacao', async (req) => {
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
    // SEGURANÇA (incidente 2026-06-01): janela de graça permitia criação anônima de leads.
    const authResult = await validateApiKey(supabase, req);
    if (!authResult.valid) {
      return errorResponse(401, authResult.error || "API key required", corsHeaders, { req });
    }
    const organization_id = authResult.organizationId;
    if (!organization_id) {
      return errorResponse(401, "organização não resolvida a partir da API key", corsHeaders, { req });
    }

    const body = await req.json();
    
    // Valid origin enum values
    const validOrigins = ["whatsapp", "meta_ads", "instagram", "tiktok", "google_ads", "site", "landing_page", "remarketing", "indicacao", "evento", "prospeccao_ativa", "cal", "outro"];
    
    // Expected fields from n8n
    const {
      name,
      email,
      phone,
      company,
      origin: rawOrigin,
      segment,
      faturamento,
      urgency,
      notes,
      rating,
      sdr_id,
      closer_id,
      meeting_date,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
    } = body;

    // Normalize origin - if invalid, default to "outro"
    const origin = validOrigins.includes(rawOrigin) ? rawOrigin : "outro";
    
    console.log("Received confirmacao lead data:", { name, email, phone, origin, meeting_date });

    // ── Input validation ──
    if (sdr_id && !isValidUUID(sdr_id)) {
      return errorResponse(400, "Validation failed: sdr_id não é um UUID válido", corsHeaders, { req });
    }
    if (closer_id && !isValidUUID(closer_id)) {
      return errorResponse(400, "Validation failed: closer_id não é um UUID válido", corsHeaders, { req });
    }
    if (meeting_date && !isValidISODate(meeting_date)) {
      return errorResponse(400, "Validation failed: meeting_date não é uma data ISO 8601 válida", corsHeaders, { req });
    }

    if (!name) {
      return errorResponse(400, "Nome é obrigatório", corsHeaders, { req });
    }

    // Merge Agendamentos→Oportunidades (ADR-0004): orgs com a flag ON recebem o
    // lead no funil whatsapp em `agendado` (não no confirmacao legacy).
    const useMergedFunnel = await isFeatureFlagEnabled(supabase, organization_id, "merged_opportunity_funnel");

    // ADR-0023 decisão 3 — este webhook cria lead E card pela RPC
    // `create_lead_with_pipe`, que roda dentro do banco e não passa pelo gate do
    // `pipeline-adapter`. Com a flag ON, `p_pipe_type = null` (o mesmo caminho
    // que o merge de funis já usa) e o `upsertPipeEntry` do ramo merged é
    // pulado. A reunião continua sendo registrada; o que não nasce é o Negócio.
    //
    // ⚠️ Estes são DOIS sistemas de flag homônimos: `isFeatureFlagEnabled` lê a
    // cascata organization_features → tabela feature_flags;
    // `isDealManualOnly` lê a coluna jsonb organizations.feature_flags. Ver
    // `_shared/deal-policy.ts`.
    const dealManualOnly = await isDealManualOnly(supabase, organization_id);
    if (dealManualOnly) {
      console.log(
        `[webhook-confirmacao] deal_manual_only ON em org=${organization_id}: lead criado SEM card de funil.`,
      );
    }

    // 1+2. Atomic lead + pipe creation via RPC. Com o merge ON, cria só o lead
    // (p_pipe_type null) e a entry de whatsapp:agendado é feita logo abaixo via
    // upsertPipeEntry (preserva meeting_date no metadata — o branch whatsapp do
    // RPC não grava meeting_date).
    const { data: result, error: rpcError } = await supabase.rpc('create_lead_with_pipe', {
      p_name: name,
      p_organization_id: organization_id,
      p_email: email || null,
      p_phone: phone || null,
      p_company: company || null,
      p_origin: origin,
      p_segment: segment || null,
      p_faturamento: faturamento || null,
      p_urgency: urgency || null,
      p_notes: notes || null,
      p_rating: rating ? parseInt(String(rating), 10) : 0,
      p_sdr_id: sdr_id || null,
      p_closer_id: closer_id || null,
      p_responsible_id: closer_id || sdr_id || null,
      p_pre_sale_responsible_id: sdr_id || null,
      p_sale_responsible_id: closer_id || null,
      p_meeting_date: meeting_date || null,
      p_utm_source: utm_source || null,
      p_utm_medium: utm_medium || null,
      p_utm_campaign: utm_campaign || null,
      p_utm_term: utm_term || null,
      p_utm_content: utm_content || null,
      p_pipe_type: (useMergedFunnel || dealManualOnly) ? null : 'confirmacao',
      p_pipe_status: (useMergedFunnel || dealManualOnly) ? null : 'reuniao_marcada',
      p_pipe_meeting_date: meeting_date || null,
      p_pipe_responsible_id: closer_id || sdr_id || null,
    });

    if (rpcError) {
      console.error("Error creating lead + pipe:", rpcError);
      return errorResponse(500, "Erro ao criar lead", corsHeaders, { req, details: rpcError.message });
    }

    const leadId = result.lead_id;

    // Merge ON: cria a entry no funil de Oportunidades (whatsapp:agendado) com a
    // data da reunião no metadata + confirmação pendente.
    if (useMergedFunnel && !dealManualOnly) {
      await upsertPipeEntry(supabase, {
        leadId,
        orgId: organization_id,
        slug: "whatsapp",
        stageKey: "agendado",
        metadata: { meeting_date: meeting_date || null, confirmation_status: "pendente", is_confirmed: false },
        assignedTo: closer_id || sdr_id || null,
      });
    }

    // 3. Create history entry
    await supabase.from("lead_history").insert({
      lead_id: leadId,
      action: "Lead criado via integração (Confirmação)",
      description: `Lead ${name} adicionado automaticamente em ${useMergedFunnel ? "Oportunidades (Agendado)" : "Agendamentos"}${meeting_date ? ` com reunião em ${meeting_date}` : ""}`,
    });

    await logRuntime({
      module: "lead",
      action: "confirmacao_ingest",
      status: "success",
      entityType: "lead",
      entityId: leadId,
      payloadSnapshot: { name, origin, meeting_date },
    });

    return successResponse({
      message: "Lead criado com sucesso no pipe de confirmação",
      lead_id: leadId,
    }, corsHeaders, { req });

  } catch (error) {
    console.error("Webhook confirmacao error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await logRuntime({
      module: "lead",
      action: "confirmacao_ingest",
      status: "error",
      errorMessage,
    });
    return errorResponse(500, "Erro interno", corsHeaders, { req, details: errorMessage });
  }
}));
