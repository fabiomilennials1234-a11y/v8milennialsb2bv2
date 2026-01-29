import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

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

    if (!name) {
      return new Response(
        JSON.stringify({ error: "Nome é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Create the lead
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
        closer_id,
        meeting_date: meeting_date || null,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
      })
      .select()
      .single();

    if (leadError) {
      console.error("Error creating lead:", leadError);
      return new Response(
        JSON.stringify({ error: "Erro ao criar lead", details: leadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Create entry in pipe_confirmacao with status "reuniao_marcada"
    const { error: pipeError } = await supabase
      .from("pipe_confirmacao")
      .insert({
        lead_id: lead.id,
        status: "reuniao_marcada",
        sdr_id: sdr_id || null,
        closer_id: closer_id || null,
        meeting_date: meeting_date || null,
        notes: notes || null,
      });

    if (pipeError) {
      console.error("Error creating pipe_confirmacao:", pipeError);
      return new Response(
        JSON.stringify({ error: "Erro ao criar entrada no pipe", details: pipeError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Create history entry
    await supabase.from("lead_history").insert({
      lead_id: lead.id,
      action: "Lead criado via integração (Confirmação)",
      description: `Lead ${name} adicionado automaticamente no pipe de confirmação${meeting_date ? ` com reunião em ${meeting_date}` : ""}`,
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Lead criado com sucesso no pipe de confirmação",
        lead_id: lead.id 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Webhook confirmacao error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Erro interno", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
