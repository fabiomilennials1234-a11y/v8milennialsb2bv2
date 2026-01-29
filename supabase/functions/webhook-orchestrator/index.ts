import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateLeadInput, sanitizeString } from "../_shared/validation.ts";
import { enqueueWebhookDeliveries } from "../_shared/webhook-utils.ts";

// Helper functions (reutilizadas do webhook-new-lead)
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

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

// Validação de autenticação
async function validateAuth(
  supabase: any,
  apiKey: string | null,
  tenantId: string | null
): Promise<{ valid: boolean; error?: string }> {
  // Se não tem API key, retorna erro
  if (!apiKey) {
    return { valid: false, error: "API key não fornecida" };
  }

  // Valida API key (pode ser expandido para verificar em uma tabela de API keys)
  const validApiKey = Deno.env.get("WEBHOOK_API_KEY") || "default-api-key";
  if (apiKey !== validApiKey) {
    return { valid: false, error: "API key inválida" };
  }

  // Valida subscription se tenant_id fornecido
  if (tenantId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("subscription_status, subscription_expires_at")
      .eq("id", tenantId)
      .single();

    if (!org) {
      return { valid: false, error: "Organização não encontrada" };
    }

    const now = new Date();
    const expiresAt = org.subscription_expires_at ? new Date(org.subscription_expires_at) : null;
    const isValid = org.subscription_status === "active" ||
      (org.subscription_status === "trial" && (!expiresAt || expiresAt > now));

    if (!isValid) {
      return { valid: false, error: `Subscription inválida: ${org.subscription_status}` };
    }
  }

  return { valid: true };
}

// Handler para process_lead (reutiliza lógica do webhook-new-lead)
async function handleProcessLead(supabase: any, data: any, tenantId: string | null) {
  const validOrigins = ["calendly", "whatsapp", "meta_ads", "remarketing", "base_clientes", "parceiro", "indicacao", "quiz", "site", "organico", "outro"];
  
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
    compromisso_date,
    utm_source: rawUtmSource,
    utm_medium: rawUtmMedium,
    utm_campaign: rawUtmCampaign,
    utm_term: rawUtmTerm,
    utm_content: rawUtmContent,
  } = data;

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

  const origin = compromisso_date ? "calendly" : (validOrigins.includes(rawOrigin) ? rawOrigin : "outro");
  
  // Validate input
  const validation = validateLeadInput({ name, email, phone, origin, rating });
  if (!validation.valid) {
    return { success: false, error: "Dados inválidos", details: validation.errors };
  }
  
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);

  // Deduplication logic
  let existingLead = null;
  let deduplicationMethod = null;

  if (normalizedEmail) {
    const { data: leads } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (leads) {
      existingLead = leads.find((lead: any) => normalizeEmail(lead.email) === normalizedEmail);
      if (existingLead) deduplicationMethod = "email";
    }
  }

  if (!existingLead && normalizedName) {
    const today = new Date();
    const { start, end } = getDayBoundaries(today);
    const { data: todayLeads } = await supabase
      .from("leads")
      .select("*")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    if (todayLeads) {
      existingLead = todayLeads.find((lead: any) => normalizeName(lead.name) === normalizedName);
      if (existingLead) deduplicationMethod = "name_same_day";
    }
  }

  // Handle existing lead (unification)
  if (existingLead) {
    const updatedData: Record<string, any> = {};
    if (phone && !existingLead.phone) updatedData.phone = phone;
    if (company && !existingLead.company) updatedData.company = company;
    if (segment && !existingLead.segment) updatedData.segment = segment;
    if (faturamento && !existingLead.faturamento) updatedData.faturamento = faturamento;
    if (urgency && !existingLead.urgency) updatedData.urgency = urgency;
    if (sdr_id && !existingLead.sdr_id) updatedData.sdr_id = sdr_id;
    if (deduplicationMethod === "name_same_day" && normalizedEmail && !existingLead.email) {
      updatedData.email = email;
    }
    if (utm_source && !existingLead.utm_source) updatedData.utm_source = utm_source;
    if (utm_medium && !existingLead.utm_medium) updatedData.utm_medium = utm_medium;
    if (utm_campaign && !existingLead.utm_campaign) updatedData.utm_campaign = utm_campaign;
    if (utm_term && !existingLead.utm_term) updatedData.utm_term = utm_term;
    if (utm_content && !existingLead.utm_content) updatedData.utm_content = utm_content;
    if (rating && parseInt(String(rating), 10) > (existingLead.rating || 0)) {
      updatedData.rating = parseInt(String(rating), 10);
    }
    if (notes) {
      updatedData.notes = existingLead.notes ? `${existingLead.notes}\n\n[Unificado] ${notes}` : notes;
    }

    const newCompromissoDate = compromisso_date || null;
    if (newCompromissoDate && !existingLead.compromisso_date) {
      updatedData.compromisso_date = newCompromissoDate;
      updatedData.origin = "ambos";
    } else if (existingLead.compromisso_date && newCompromissoDate && existingLead.compromisso_date !== newCompromissoDate) {
      updatedData.notes = (updatedData.notes || existingLead.notes || '') + 
        `\n\n[Conflito de data] Nova data recebida: ${newCompromissoDate} - mantida data original: ${existingLead.compromisso_date}`;
    }

    if (Object.keys(updatedData).length > 0) {
      await supabase.from("leads").update(updatedData).eq("id", existingLead.id);
    }

    const effectiveCompromissoDate = existingLead.compromisso_date || newCompromissoDate;
    if (effectiveCompromissoDate) {
      const { data: existingConfirmacao } = await supabase
        .from("pipe_confirmacao")
        .select("id")
        .eq("lead_id", existingLead.id)
        .single();
      if (existingConfirmacao) {
        await supabase.from("pipe_confirmacao").update({
          status: "reuniao_marcada",
          meeting_date: newCompromissoDate,
        }).eq("id", existingConfirmacao.id);
      } else {
        await supabase.from("pipe_confirmacao").insert({
          lead_id: existingLead.id,
          status: "reuniao_marcada",
          sdr_id: sdr_id || existingLead.sdr_id || null,
          meeting_date: newCompromissoDate,
        });
      }
      const { data: existingProposta } = await supabase
        .from("pipe_propostas")
        .select("id, status")
        .eq("lead_id", existingLead.id)
        .eq("status", "compromisso_marcado")
        .maybeSingle();
      if (!existingProposta) {
        await supabase.from("pipe_whatsapp").delete().eq("lead_id", existingLead.id);
      }
    }

    await supabase.from("lead_history").insert({
      lead_id: existingLead.id,
      action: "Lead unificado",
      description: `Lead duplicado detectado (${deduplicationMethod === "email" ? "mesmo email" : "mesmo nome no mesmo dia"}). Dados mesclados automaticamente.`,
    });

    if (tenantId) {
      const payload = {
        event: "lead.updated",
        timestamp: new Date().toISOString(),
        data: {
          id: existingLead.id,
          name: existingLead.name,
          email: existingLead.email ?? undefined,
          phone: existingLead.phone ?? undefined,
          company: existingLead.company ?? undefined,
          organization_id: tenantId,
          origin: existingLead.origin,
        },
      };
      try {
        await enqueueWebhookDeliveries(supabase, tenantId, "lead.updated", payload);
      } catch (_e) {
        // não bloquear
      }
    }

    return {
      success: true,
      message: "Lead existente atualizado (duplicado unificado)",
      lead_id: existingLead.id,
      deduplication_method: deduplicationMethod,
      pipe: newCompromissoDate ? "confirmacao" : "whatsapp"
    };
  }

  // Create new lead
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      name, email, phone, company, origin, segment,
      faturamento: faturamento || null, urgency, notes,
      rating: rating ? parseInt(String(rating), 10) : 0, sdr_id,
      compromisso_date: compromisso_date || null,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      organization_id: tenantId,
    })
    .select()
    .single();

  if (leadError) {
    return { success: false, error: "Erro ao criar lead", details: leadError.message };
  }

  if (tenantId) {
    const payload = {
      event: "lead.created",
      timestamp: new Date().toISOString(),
      data: {
        id: lead.id,
        name: lead.name,
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
        company: lead.company ?? undefined,
        organization_id: tenantId,
        origin: lead.origin,
      },
    };
    try {
      await enqueueWebhookDeliveries(supabase, tenantId, "lead.created", payload);
    } catch (_e) {
      // não bloquear
    }
  }

  if (lead.compromisso_date) {
    await supabase.from("pipe_confirmacao").insert({
      lead_id: lead.id,
      status: "reuniao_marcada",
      sdr_id: sdr_id || null,
      meeting_date: lead.compromisso_date,
    });
    await supabase.from("lead_history").insert({
      lead_id: lead.id,
      action: "Lead criado via integração",
      description: `Lead ${name} adicionado automaticamente no pipe de confirmação com reunião marcada para ${lead.compromisso_date}`,
    });
    return {
      success: true,
      message: "Lead criado com sucesso no pipe de confirmação",
      lead_id: lead.id,
      pipe: "confirmacao"
    };
  }

  await supabase.from("pipe_whatsapp").insert({
    lead_id: lead.id,
    status: "novo",
    sdr_id,
  });
  await supabase.from("lead_history").insert({
    lead_id: lead.id,
    action: "Lead criado via integração",
    description: `Lead ${name} adicionado automaticamente via webhook`,
  });

  return {
    success: true,
    message: "Lead criado com sucesso",
    lead_id: lead.id,
    pipe: "whatsapp"
  };
}

// Handler para SCHEDULE_MEETING (chamado pelo Agent Engine)
async function handleScheduleMeeting(supabase: any, data: any, tenantId: string | null) {
  const { lead_id, preferred_date, preferred_time } = data;
  
  if (!lead_id || !preferred_date) {
    return { success: false, error: "lead_id e preferred_date são obrigatórios" };
  }

  // Atualizar lead com compromisso_date
  const { error: updateError } = await supabase
    .from("leads")
    .update({ compromisso_date: preferred_date })
    .eq("id", lead_id);

  if (updateError) {
    return { success: false, error: "Erro ao atualizar lead", details: updateError.message };
  }

  // Criar/atualizar pipe_confirmacao
  const { data: existingConfirmacao } = await supabase
    .from("pipe_confirmacao")
    .select("id")
    .eq("lead_id", lead_id)
    .maybeSingle();

  if (existingConfirmacao) {
    await supabase.from("pipe_confirmacao").update({
      status: "reuniao_marcada",
      meeting_date: preferred_date,
    }).eq("id", existingConfirmacao.id);
  } else {
    await supabase.from("pipe_confirmacao").insert({
      lead_id,
      status: "reuniao_marcada",
      meeting_date: preferred_date,
    });
  }

  return {
    success: true,
    message: "Reunião agendada com sucesso",
    meeting_date: preferred_date,
  };
}

// Handler para CREATE_LEAD (básico)
async function handleCreateLead(supabase: any, data: any, tenantId: string | null) {
  const { name, email, phone, company } = data;
  
  if (!name || !tenantId) {
    return { success: false, error: "name e tenant_id são obrigatórios" };
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      name,
      email,
      phone,
      company,
      origin: "web",
      organization_id: tenantId,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: "Erro ao criar lead", details: error.message };
  }

  return {
    success: true,
    message: "Lead criado com sucesso",
    lead_id: lead.id
  };
}

// Handler para UPDATE_CRM (placeholder - precisa integração externa)
async function handleUpdateCrm(supabase: any, data: any, tenantId: string | null) {
  // Esta ação deve ser executada pelo n8n, não diretamente aqui
  // Este handler apenas valida e retorna que precisa ser executado externamente
  return {
    success: true,
    message: "Ação UPDATE_CRM deve ser executada via n8n",
    requires_n8n: true,
  };
}

// Handler para TRANSFER_HUMAN
async function handleTransferHuman(supabase: any, data: any, tenantId: string | null) {
  const { lead_id, reason } = data;
  
  if (!lead_id) {
    return { success: false, error: "lead_id é obrigatório" };
  }

  // Atualizar conversation state para WAITING_HUMAN
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("lead_id", lead_id)
    .maybeSingle();

  if (conversation) {
    await supabase.from("conversations").update({
      state: "WAITING_HUMAN",
    }).eq("id", conversation.id);
  }

  return {
    success: true,
    message: "Conversa transferida para atendimento humano",
    reason: reason || "Transferência solicitada pelo agente",
  };
}

// Roteador principal
async function routeAction(
  action: string,
  supabase: any,
  data: any,
  tenantId: string | null
): Promise<any> {
  switch (action) {
    case "process_lead":
      return await handleProcessLead(supabase, data, tenantId);
    case "SCHEDULE_MEETING":
      return await handleScheduleMeeting(supabase, data, tenantId);
    case "CREATE_LEAD":
      return await handleCreateLead(supabase, data, tenantId);
    case "UPDATE_CRM":
      return await handleUpdateCrm(supabase, data, tenantId);
    case "TRANSFER_HUMAN":
      return await handleTransferHuman(supabase, data, tenantId);
    default:
      return { success: false, error: `Ação não suportada: ${action}` };
  }
}

// Main handler
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
    const { action, data, tenant_id, api_key } = body;

    // Validação básica
    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: "Campo 'action' é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validação de autenticação
    const apiKey = api_key || req.headers.get("X-API-Key");
    const tenantId = tenant_id || body.tenant_id;
    
    const authResult = await validateAuth(supabase, apiKey, tenantId);
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({ success: false, error: authResult.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Roteia para handler apropriado
    const result = await routeAction(action, supabase, data || body, tenantId);

    const status = result.success ? 200 : 400;
    return new Response(
      JSON.stringify(result),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: "Erro interno", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
