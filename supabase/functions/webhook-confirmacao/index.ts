import { withSentry } from '../_shared/sentry.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateApiKey } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { isValidUUID, isValidISODate } from "../_shared/validation.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";

Deno.serve(withSentry('webhook-confirmacao', async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- API Key Authentication (90-day grace period) ---
    const authResult = await validateApiKey(supabase, req);
    if (!authResult.valid) {
      const graceEnd = new Date("2026-07-09T00:00:00Z");
      if (new Date() > graceEnd) {
        return errorResponse(401, authResult.error || "API key required", corsHeaders, { req });
      }
      console.warn(`[DEPRECATION] Unauthenticated request to webhook-confirmacao. Auth required after 2026-07-09.`);
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

    // 1+2. Atomic lead + pipe_confirmacao creation via RPC (single transaction)
    const { data: result, error: rpcError } = await supabase.rpc('create_lead_with_pipe', {
      p_name: name,
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
      p_meeting_date: meeting_date || null,
      p_utm_source: utm_source || null,
      p_utm_medium: utm_medium || null,
      p_utm_campaign: utm_campaign || null,
      p_utm_term: utm_term || null,
      p_utm_content: utm_content || null,
      p_pipe_type: 'confirmacao',
      p_pipe_status: 'reuniao_marcada',
      p_pipe_meeting_date: meeting_date || null,
      p_pipe_responsible_id: closer_id || sdr_id || null,
    });

    if (rpcError) {
      console.error("Error creating lead + pipe_confirmacao:", rpcError);
      return errorResponse(500, "Erro ao criar lead", corsHeaders, { req, details: rpcError.message });
    }

    const leadId = result.lead_id;

    // 3. Create history entry
    await supabase.from("lead_history").insert({
      lead_id: leadId,
      action: "Lead criado via integração (Confirmação)",
      description: `Lead ${name} adicionado automaticamente no pipe de confirmação${meeting_date ? ` com reunião em ${meeting_date}` : ""}`,
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
