import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateLeadInput, sanitizeString } from "../_shared/validation.ts";
import { normalizePhoneForSearch } from "../_shared/lead-service.ts";

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    
    // Valid origin enum values
    const validOrigins = ["calendly", "whatsapp", "meta_ads", "remarketing", "base_clientes", "parceiro", "indicacao", "quiz", "site", "organico", "outro"];
    
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
    } = body;

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

    // If compromisso_date is filled, set origin to "calendly", otherwise normalize origin
    const origin = compromisso_date ? "calendly" : (validOrigins.includes(rawOrigin) ? rawOrigin : "outro");
    
    // Validate input
    const validation = validateLeadInput({
      name,
      email,
      phone,
      origin,
      rating,
    });

    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: "Dados inválidos", details: validation.errors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
    const normalizedPhone = normalizePhoneForSearch(phone);
    if (normalizedPhone) {
      const { data: leadByPhone, error: phoneSearchError } = await supabase
        .from("leads")
        .select("*")
        .eq("normalized_phone", normalizedPhone)
        .maybeSingle();

      if (!phoneSearchError && leadByPhone) {
        existingLead = leadByPhone;
        deduplicationMethod = "phone";
        console.log("[webhook-new-lead] Found existing lead by phone:", leadByPhone.id);
      }
    }

    // 1. Second priority: try to find by email (case-insensitive)
    if (!existingLead && normalizedEmail) {
      const { data: leads, error: searchError } = await supabase
        .from("leads")
        .select("*")
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
        updatedData.origin = "ambos"; // Mark as lead from multiple sources
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
        // Check if already in pipe_confirmacao
        const { data: existingConfirmacao } = await supabase
          .from("pipe_confirmacao")
          .select("id")
          .eq("lead_id", existingLead.id)
          .single();

        if (existingConfirmacao) {
          // Update existing pipe_confirmacao
          await supabase
            .from("pipe_confirmacao")
            .update({
              status: "reuniao_marcada",
              meeting_date: newCompromissoDate,
            })
            .eq("id", existingConfirmacao.id);
        } else {
          // Create new pipe_confirmacao entry
          await supabase
            .from("pipe_confirmacao")
            .insert({
              lead_id: existingLead.id,
              status: "reuniao_marcada",
              sdr_id: sdr_id || existingLead.sdr_id || null,
              meeting_date: newCompromissoDate,
            });
        }

        // Check if lead is in pipe_propostas with status "compromisso_marcado"
        // If so, keep in pipe_whatsapp (exception rule)
        const { data: existingProposta } = await supabase
          .from("pipe_propostas")
          .select("id, status")
          .eq("lead_id", existingLead.id)
          .eq("status", "compromisso_marcado")
          .maybeSingle();

        if (!existingProposta) {
          // Only remove from pipe_whatsapp if NOT in compromisso_marcado
          await supabase
            .from("pipe_whatsapp")
            .delete()
            .eq("lead_id", existingLead.id);
        }
      }

      // Create history entry for unification
      const deduplicationDescription =
        deduplicationMethod === "phone" ? "mesmo telefone" :
        deduplicationMethod === "email" ? "mesmo email" :
        "mesmo nome no mesmo dia";

      await supabase.from("lead_history").insert({
        lead_id: existingLead.id,
        action: "Lead unificado",
        description: `Lead duplicado detectado (${deduplicationDescription}). Dados mesclados automaticamente.`,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Lead existente atualizado (duplicado unificado)",
          lead_id: existingLead.id,
          deduplication_method: deduplicationMethod,
          pipe: newCompromissoDate ? "confirmacao" : "whatsapp"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================
    // CREATE NEW LEAD (NO DUPLICATE FOUND)
    // ============================================
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        name,
        email,
        phone,
        company,
        origin,
        segment,
        faturamento: faturamento || null,
        urgency,
        notes,
        rating: rating ? parseInt(String(rating), 10) : 0,
        sdr_id,
        compromisso_date: compromisso_date || null,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
      })
      .select()
      .single();

    if (leadError) {
      return new Response(
        JSON.stringify({ error: "Erro ao criar lead", details: leadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route lead based on whether compromisso_date is filled
    if (lead.compromisso_date) {
      // Lead has compromisso_date - create in pipe_confirmacao with reuniao_marcada
      const { error: pipeConfirmacaoError } = await supabase
        .from("pipe_confirmacao")
        .insert({
          lead_id: lead.id,
          status: "reuniao_marcada",
          sdr_id: sdr_id || null,
          meeting_date: lead.compromisso_date,
        });

      if (pipeConfirmacaoError) {
        return new Response(
          JSON.stringify({ error: "Erro ao criar entrada no pipe confirmação", details: pipeConfirmacaoError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Create history entry for confirmacao
      await supabase.from("lead_history").insert({
        lead_id: lead.id,
        action: "Lead criado via integração",
        description: `Lead ${name} adicionado automaticamente no pipe de confirmação com reunião marcada para ${lead.compromisso_date}`,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Lead criado com sucesso no pipe de confirmação",
          lead_id: lead.id,
          pipe: "confirmacao"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Lead without compromisso_date - create in pipe_whatsapp with status "novo"
    const { error: pipeError } = await supabase
      .from("pipe_whatsapp")
      .insert({
        lead_id: lead.id,
        status: "novo",
        sdr_id,
      });

    if (pipeError) {
      return new Response(
        JSON.stringify({ error: "Erro ao criar entrada no pipe", details: pipeError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create history entry
    await supabase.from("lead_history").insert({
      lead_id: lead.id,
      action: "Lead criado via integração",
      description: `Lead ${name} adicionado automaticamente via webhook`,
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Lead criado com sucesso",
        lead_id: lead.id,
        pipe: "whatsapp"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Erro interno", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
