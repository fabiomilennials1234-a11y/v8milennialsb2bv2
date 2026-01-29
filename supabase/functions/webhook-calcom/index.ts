import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { 
  validateCalcomWebhook, 
  checkRateLimit, 
  getClientIdentifier,
  unauthorizedResponse,
  rateLimitedResponse 
} from "../_shared/auth.ts";

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

  // SECURITY: Rate limiting
  const clientId = getClientIdentifier(req);
  const rateLimit = checkRateLimit(`calcom:${clientId}`, 50, 60000); // 50 requests per minute
  if (!rateLimit.allowed) {
    console.warn("[Webhook Cal.com] Rate limit exceeded for:", clientId);
    return rateLimitedResponse(rateLimit.resetIn, corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Read body as text first for signature verification
    const bodyText = await req.text();
    
    // SECURITY: Validate Cal.com webhook signature
    const authResult = validateCalcomWebhook(req, bodyText);
    if (!authResult.valid) {
      console.warn("[Webhook Cal.com] Authentication failed:", authResult.error);
      return unauthorizedResponse(authResult.error || "Unauthorized", corsHeaders);
    }
    
    const body = JSON.parse(bodyText);
    
    // SECURITY: Don't log full payload - may contain PII
    console.log("Cal.com webhook received:", {
      triggerEvent: body.triggerEvent || body.trigger,
      hasPayload: !!body.payload,
    });

    // Cal.com sends the event type as triggerEvent or trigger
    const eventType = body.triggerEvent || body.trigger;
    
    // Only process BOOKING_CREATED events (new meeting scheduled)
    if (eventType !== "BOOKING_CREATED") {
      console.log("Ignoring event type:", eventType);
      return new Response(
        JSON.stringify({ success: true, message: "Event ignored" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = body.payload;
    
    if (!payload) {
      return new Response(
        JSON.stringify({ error: "Payload não encontrado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract data from Cal.com payload
    const attendees = payload.attendees || [];
    const firstAttendee = attendees[0] || {};
    const responses = payload.responses || {};
    
    // Get email and name from attendees or responses
    const email = firstAttendee.email || responses.email;
    const name = firstAttendee.name || responses.name || payload.title;
    const startTime = payload.startTime;
    
    // Extract phone from responses if available
    const phone = responses.phone || responses.telefone || responses.celular || responses.whatsapp || null;

    // ============================================
    // EXTRACT ORGANIZER INFO FOR CLOSER MATCHING
    // ============================================
    const organizer = payload.organizer || {};
    const organizerEmail = normalizeEmail(organizer.email);
    const organizerName = organizer.name;
    
    console.log("Organizer data:", { organizerEmail, organizerName });

    // Find the team member (Closer) by organizer email
    let closerId: string | null = null;
    
    if (organizerEmail) {
      const { data: teamMember, error: teamMemberError } = await supabase
        .from("team_members")
        .select("id, name, role")
        .eq("email", organizerEmail)
        .eq("is_active", true)
        .maybeSingle();
      
      if (teamMember) {
        closerId = teamMember.id;
        console.log(`Found Closer by email: ${teamMember.name} (${teamMember.id})`);
      } else if (teamMemberError) {
        console.log("Error finding team member by email:", teamMemberError.message);
      } else {
        console.log(`No team member found with email: ${organizerEmail}`);
      }
    }

    console.log("Extracted data:", { email, name, startTime, phone, closerId });

    if (!email) {
      console.log("No email found in webhook payload");
      return new Response(
        JSON.stringify({ error: "Email não encontrado no payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper function to get or create a tag
    // SECURITY: Filter by organization_id
    async function getOrCreateTag(tagName: string, tagColor: string): Promise<string> {
      // Check if tag exists for this organization
      const { data: existingTag } = await supabase
        .from("tags")
        .select("id")
        .eq("name", tagName)
        .eq("organization_id", targetOrganizationId) // SECURITY: Filter by organization
        .single();

      if (existingTag) {
        return existingTag.id;
      }

      // Create the tag for this organization
      const { data: newTag, error } = await supabase
        .from("tags")
        .insert({ 
          name: tagName, 
          color: tagColor,
          organization_id: targetOrganizationId // SECURITY: Set organization
        })
        .select("id")
        .single();

      if (error) {
        console.error(`Error creating tag ${tagName}:`, error);
        throw error;
      }

      return newTag.id;
    }

    // Helper function to add tag to lead
    async function addTagToLead(leadId: string, tagId: string): Promise<void> {
      // Check if lead already has this tag
      const { data: existingLeadTag } = await supabase
        .from("lead_tags")
        .select("id")
        .eq("lead_id", leadId)
        .eq("tag_id", tagId)
        .single();

      if (existingLeadTag) {
        console.log("Lead already has this tag");
        return;
      }

      const { error } = await supabase
        .from("lead_tags")
        .insert({ lead_id: leadId, tag_id: tagId });

      if (error) {
        console.error("Error adding tag to lead:", error);
        throw error;
      }
    }

    // Normalize email for case-insensitive comparison
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeName(name);

    // ============================================
    // DEDUPLICATION LOGIC
    // ============================================
    let existingLead = null;
    let deduplicationMethod = null;

    // SECURITY: Get default organization for webhook leads
    // In production, this should come from webhook configuration
    const { data: defaultOrg } = await supabase
      .from("organizations")
      .select("id")
      .eq("subscription_status", "active")
      .limit(1)
      .single();
    
    const targetOrganizationId = defaultOrg?.id;
    
    if (!targetOrganizationId) {
      console.error("[Webhook Cal.com] No active organization found");
      return new Response(
        JSON.stringify({ error: "No organization configured for webhooks" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. First, try to find by email (case-insensitive)
    // SECURITY: Filter by organization_id
    if (normalizedEmail) {
      console.log("Searching for existing lead by email (case-insensitive):", normalizedEmail);
      
      const { data: leads, error: searchError } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", targetOrganizationId) // SECURITY: Filter by organization
        .order("created_at", { ascending: false });

      if (!searchError && leads) {
        // Find lead with matching email (case-insensitive)
        existingLead = leads.find(lead => normalizeEmail(lead.email) === normalizedEmail);
        if (existingLead) {
          deduplicationMethod = "email";
          console.log("Found existing lead by email:", existingLead.id);
        }
      }
    }

    // 2. If no email match, try to find by name + same day
    // SECURITY: Filter by organization_id
    if (!existingLead && normalizedName) {
      const today = new Date();
      const { start, end } = getDayBoundaries(today);
      
      console.log("Searching for existing lead by name + same day:", normalizedName, "between", start, "and", end);
      
      const { data: todayLeads, error: searchError } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", targetOrganizationId) // SECURITY: Filter by organization
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false });

      if (!searchError && todayLeads) {
        // Find lead with matching name (case-insensitive, normalized spaces)
        existingLead = todayLeads.find(lead => normalizeName(lead.name) === normalizedName);
        if (existingLead) {
          deduplicationMethod = "name_same_day";
          console.log("Found existing lead by name + same day:", existingLead.id);
        }
      }
    }

    // Get or create necessary tags
    const quizTagId = await getOrCreateTag("Quiz", "#22C55E");
    const calTagId = await getOrCreateTag("Cal", "#3B82F6");
    const reuniaoMarcadaTagId = await getOrCreateTag("Reunião Marcada", "#F59E0B");

    if (existingLead) {
      // SCENARIO 1: Lead with this email already exists (Quiz + Cal = Ambos)
      console.log("Found existing lead:", existingLead.id);

      // IMPORTANT: Preserve existing compromisso_date if it exists
      const existingCompromissoDate = existingLead.compromisso_date;
      const shouldUpdateDate = !existingCompromissoDate;
      
      // Build update object - include closer_id if found
      const updateData: Record<string, any> = {
        origin: "ambos", // Lead veio do Quiz e agora agendou via Cal
      };
      
      // Assign closer if found and lead doesn't have one already
      if (closerId && !existingLead.closer_id) {
        updateData.closer_id = closerId;
        console.log("Assigning closer to existing lead:", closerId);
      }
      
      if (shouldUpdateDate) {
        // Only update compromisso_date if lead doesn't have one
        updateData.compromisso_date = startTime;
        updateData.notes = existingLead.notes 
          ? `${existingLead.notes}\n\n[Cal.com] Reunião agendada: ${startTime}${organizerName ? ` (Organizador: ${organizerName})` : ''}`
          : `[Cal.com] Reunião agendada: ${startTime}${organizerName ? ` (Organizador: ${organizerName})` : ''}`;
      } else {
        // Lead already has a meeting scheduled, just log it
        updateData.notes = existingLead.notes 
          ? `${existingLead.notes}\n\n[Cal.com] Nova reunião tentada: ${startTime} - mantida data original: ${existingCompromissoDate}${organizerName ? ` (Organizador: ${organizerName})` : ''}`
          : `[Cal.com] Nova reunião tentada: ${startTime} - mantida data original: ${existingCompromissoDate}${organizerName ? ` (Organizador: ${organizerName})` : ''}`;
      }

      // Update the existing lead
      const { error: updateError } = await supabase
        .from("leads")
        .update(updateData)
        .eq("id", existingLead.id);

      if (updateError) {
        console.error("Error updating lead:", updateError);
        return new Response(
          JSON.stringify({ error: "Erro ao atualizar lead", details: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Ensure Quiz tag is present
      await addTagToLead(existingLead.id, quizTagId);

      // Add "Reunião Marcada" tag
      await addTagToLead(existingLead.id, reuniaoMarcadaTagId);

      // Use effective date - existing or new
      const effectiveMeetingDate = existingCompromissoDate || startTime;

      // Create or update pipe_confirmacao entry - with closer_id
      const { data: existingConfirmacao } = await supabase
        .from("pipe_confirmacao")
        .select("id, meeting_date, closer_id")
        .eq("lead_id", existingLead.id)
        .maybeSingle();

      if (existingConfirmacao) {
        // Update pipe_confirmacao with closer if found and not already set
        const confirmacaoUpdate: Record<string, any> = {};
        
        if (!existingConfirmacao.meeting_date) {
          confirmacaoUpdate.status = "reuniao_marcada";
          confirmacaoUpdate.meeting_date = effectiveMeetingDate;
        }
        
        // Assign closer to pipe_confirmacao if found and not already set
        if (closerId && !existingConfirmacao.closer_id) {
          confirmacaoUpdate.closer_id = closerId;
          console.log("Assigning closer to existing pipe_confirmacao:", closerId);
        }
        
        if (Object.keys(confirmacaoUpdate).length > 0) {
          await supabase
            .from("pipe_confirmacao")
            .update(confirmacaoUpdate)
            .eq("id", existingConfirmacao.id);
        }
      } else {
        // Create new pipe_confirmacao with closer_id
        const confirmacaoInsert: Record<string, any> = {
          lead_id: existingLead.id,
          status: "reuniao_marcada",
          meeting_date: effectiveMeetingDate,
        };
        
        if (closerId) {
          confirmacaoInsert.closer_id = closerId;
          console.log("Creating pipe_confirmacao with closer:", closerId);
        }
        
        await supabase
          .from("pipe_confirmacao")
          .insert(confirmacaoInsert);
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
        const { error: deleteWhatsappError } = await supabase
          .from("pipe_whatsapp")
          .delete()
          .eq("lead_id", existingLead.id);

        if (deleteWhatsappError) {
          console.log("Note: No pipe_whatsapp entry found or error removing:", deleteWhatsappError.message);
        } else {
          console.log("Removed lead from pipe_whatsapp (qualificação)");
        }
      } else {
        console.log("Lead kept in pipe_whatsapp (has compromisso_marcado in propostas)");
      }

      // Create history entry with closer info
      await supabase.from("lead_history").insert({
        lead_id: existingLead.id,
        action: "Reunião agendada via Cal.com",
        description: `Lead unificado - reunião agendada para ${startTime}${closerId ? ` - Closer atribuído automaticamente` : ''}${organizerName ? ` (Organizador: ${organizerName})` : ''}`,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Lead existente atualizado com dados do Cal.com",
          lead_id: existingLead.id,
          closer_id: closerId,
          scenario: "unified",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else {
      // SCENARIO 2: No lead with this email exists - create new lead with Cal origin
      console.log("No existing lead found, creating new lead from Cal.com");
      
      // Build insert object with closer_id if found
      // SECURITY: Always set organization_id
      const leadInsert: Record<string, any> = {
        name: name || `Agendamento Cal - ${email.split("@")[0]}`,
        email,
        phone,
        origin: "cal", // Lead veio direto do Cal.com, sem passar pelo Quiz
        compromisso_date: startTime,
        notes: `[Cal.com] Lead criado a partir de agendamento direto${organizerName ? ` (Organizador: ${organizerName})` : ''}`,
        organization_id: targetOrganizationId, // SECURITY: Set organization
      };
      
      if (closerId) {
        leadInsert.closer_id = closerId;
        console.log("Creating new lead with closer:", closerId);
      }
      
      const { data: newLead, error: createError } = await supabase
        .from("leads")
        .insert(leadInsert)
        .select()
        .single();

      if (createError) {
        console.error("Error creating lead:", createError);
        return new Response(
          JSON.stringify({ error: "Erro ao criar lead", details: createError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Add "Cal" tag to new lead
      await addTagToLead(newLead.id, calTagId);

      // Create pipe_confirmacao entry with closer_id
      const confirmacaoInsert: Record<string, any> = {
        lead_id: newLead.id,
        status: "reuniao_marcada",
        meeting_date: startTime,
      };
      
      if (closerId) {
        confirmacaoInsert.closer_id = closerId;
        console.log("Creating pipe_confirmacao for new lead with closer:", closerId);
      }
      
      await supabase
        .from("pipe_confirmacao")
        .insert(confirmacaoInsert);

      // Create history entry with closer info
      await supabase.from("lead_history").insert({
        lead_id: newLead.id,
        action: "Lead criado via Cal.com",
        description: `Novo lead criado a partir de agendamento Cal.com - reunião para ${startTime}${closerId ? ` - Closer atribuído automaticamente` : ''}${organizerName ? ` (Organizador: ${organizerName})` : ''}`,
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Novo lead criado via Cal.com",
          lead_id: newLead.id,
          closer_id: closerId,
          scenario: "new_cal_lead",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("Cal.com webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Erro interno", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
