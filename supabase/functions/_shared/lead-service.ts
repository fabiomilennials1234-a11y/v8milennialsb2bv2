/**
 * Lead Service - Centralized lead creation and lookup
 *
 * This service provides a single source of truth for lead operations,
 * ensuring consistent phone normalization and deduplication across all sources.
 *
 * IMPORTANT: All webhooks and integrations should use getOrCreateLead()
 * instead of directly inserting into the leads table.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Result from getOrCreateLead operation
 */
export interface GetOrCreateLeadResult {
  lead: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    organization_id: string;
    normalized_phone: string | null;
  };
  created: boolean;
  source: "phone" | "email" | "created";
}

/**
 * Parameters for getOrCreateLead
 */
export interface GetOrCreateLeadParams {
  organizationId: string;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  pushName?: string | null;
  origin?: string;
  sdrId?: string | null;
  /** Se true, cria shadow lead (invisível nos pipes até ser promovido) */
  isShadow?: boolean;
}

/**
 * Normalizes Brazilian phone number for search.
 * This function mirrors the SQL function normalize_brazilian_phone()
 * to ensure consistent normalization between TypeScript and PostgreSQL.
 *
 * Examples:
 *   +55 11 98765-4321  -> 11987654321
 *   5511987654321      -> 11987654321
 *   11987654321        -> 11987654321
 *   11 98765-4321      -> 11987654321
 *   1198765432         -> 11987654321 (adds 9 for 10-digit mobile)
 */
export function normalizePhoneForSearch(phone: string | null | undefined): string | null {
  if (!phone || phone.trim() === "") {
    return null;
  }

  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, "");

  if (cleaned === "") {
    return null;
  }

  // Remove international prefix +55 or 55 if present (12+ digits)
  if (cleaned.length >= 12 && cleaned.startsWith("55")) {
    cleaned = cleaned.slice(2);
  }

  // Add 9 for 10-digit mobile numbers (DDD + 8 digits)
  // Brazilian mobiles: DDD(2) + 9(1) + number(8) = 11 digits
  if (cleaned.length === 10) {
    cleaned = cleaned.slice(0, 2) + "9" + cleaned.slice(2);
  }

  return cleaned;
}

/**
 * Normalizes email for search (lowercase, trim)
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email || email.trim() === "") {
    return null;
  }
  return email.toLowerCase().trim();
}

/**
 * Centralized function to get or create a lead.
 * ALL sources of lead creation should use this function.
 *
 * Priority:
 * 1. Search by normalized_phone (exact match on normalized field)
 * 2. Search by email (case-insensitive)
 * 3. Create new lead if not found
 *
 * Race condition handling:
 * - If a duplicate error occurs during creation (another process created the lead),
 *   the function will retry the search and return the existing lead.
 *
 * @param supabase - Supabase client instance
 * @param params - Lead parameters
 * @returns GetOrCreateLeadResult or null on error
 */
export async function getOrCreateLead(
  supabase: SupabaseClient,
  params: GetOrCreateLeadParams
): Promise<GetOrCreateLeadResult | null> {
  const { organizationId, phone, email, name, pushName, origin, sdrId, isShadow } = params;

  // Validate required fields
  if (!organizationId) {
    console.error("[lead-service] organizationId is required");
    return null;
  }

  if (!phone && !email) {
    console.error("[lead-service] phone or email is required");
    return null;
  }

  const normalizedPhone = normalizePhoneForSearch(phone);
  const normalizedEmailValue = normalizeEmail(email);

  console.log("[lead-service] getOrCreateLead:", {
    organizationId,
    phone,
    normalizedPhone,
    email: normalizedEmailValue,
    name,
    pushName,
  });

  // 1. SEARCH BY NORMALIZED PHONE (priority)
  // Uses limit(1) to handle duplicate leads gracefully (returns most recent)
  if (normalizedPhone) {
    const { data: phoneResults, error: phoneError } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone, ai_disabled")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalizedPhone)
      .order("created_at", { ascending: false })
      .limit(1);

    if (phoneError) {
      console.error("[lead-service] Error searching by phone:", phoneError);
    }

    const leadByPhone = phoneResults?.[0] ?? null;
    if (leadByPhone) {
      console.log("[lead-service] Found lead by phone:", leadByPhone.id);
      return { lead: leadByPhone, created: false, source: "phone" };
    }
  }

  // 2. SEARCH BY EMAIL (fallback)
  // Uses limit(1) to handle duplicate leads gracefully (returns most recent)
  if (normalizedEmailValue) {
    const { data: emailResults, error: emailError } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone, ai_disabled")
      .eq("organization_id", organizationId)
      .ilike("email", normalizedEmailValue)
      .order("created_at", { ascending: false })
      .limit(1);

    if (emailError) {
      console.error("[lead-service] Error searching by email:", emailError);
    }

    const leadByEmail = emailResults?.[0] ?? null;
    if (leadByEmail) {
      console.log("[lead-service] Found lead by email:", leadByEmail.id);
      return { lead: leadByEmail, created: false, source: "email" };
    }
  }

  // 3. CREATE NEW LEAD
  const leadName =
    name ||
    pushName ||
    (normalizedPhone
      ? `WhatsApp ${normalizedPhone.slice(-4)}`
      : `Lead ${Date.now()}`);

  console.log("[lead-service] Creating new lead:", {
    name: leadName,
    phone,
    normalizedPhone,
    email: normalizedEmailValue,
    origin: origin || "whatsapp",
  });

  const insertData: Record<string, unknown> = {
    name: leadName,
    phone: phone || null, // Save original phone format
    // normalized_phone will be auto-filled by trigger
    email: email || null,
    origin: origin || "whatsapp",
    organization_id: organizationId,
  };

  // Only include is_shadow when explicitly true (column defaults to false)
  if (isShadow) {
    insertData.is_shadow = true;
  }

  // Shadow leads não entram em nenhum pipe até serem promovidos
  if (!isShadow) {
    insertData.pipe_whatsapp = "novo";
  }

  // Add sdr_id and responsible_id if provided
  if (sdrId) {
    insertData.sdr_id = sdrId;
    insertData.responsible_id = sdrId;
  }

  const { data: newLead, error: createError } = await supabase
    .from("leads")
    .insert(insertData)
    .select("id, name, phone, email, organization_id, normalized_phone, ai_disabled")
    .single();

  if (createError) {
    // Handle race condition: duplicate detected
    if (
      createError.message?.includes("duplicate") ||
      createError.code === "23505"
    ) {
      console.warn(
        "[lead-service] Duplicate detected during creation, retrying search..."
      );

      // Retry search - the lead was created by another process
      if (normalizedPhone) {
        const { data: retryResults } = await supabase
          .from("leads")
          .select("id, name, phone, email, organization_id, normalized_phone, ai_disabled")
          .eq("organization_id", organizationId)
          .eq("normalized_phone", normalizedPhone)
          .order("created_at", { ascending: false })
          .limit(1);

        if (retryResults?.[0]) {
          console.log(
            "[lead-service] Found lead after retry:",
            retryResults[0].id
          );
          return { lead: retryResults[0], created: false, source: "phone" };
        }
      }

      if (normalizedEmailValue) {
        const { data: retryEmailResults } = await supabase
          .from("leads")
          .select("id, name, phone, email, organization_id, normalized_phone, ai_disabled")
          .eq("organization_id", organizationId)
          .ilike("email", normalizedEmailValue)
          .order("created_at", { ascending: false })
          .limit(1);

        if (retryEmailResults?.[0]) {
          console.log(
            "[lead-service] Found lead by email after retry:",
            retryEmailResults[0].id
          );
          return { lead: retryEmailResults[0], created: false, source: "email" };
        }
      }
    }

    console.error("[lead-service] Error creating lead:", createError);
    console.error("[lead-service] Insert data was:", JSON.stringify(insertData));
    return null;
  }

  console.log("[lead-service] New lead created:", newLead.id);

  // Create pipe_whatsapp entry for new leads (organization_id required for RLS visibility)
  // Shadow leads não entram em pipe até serem promovidos
  if (!isShadow) {
    try {
      await supabase.from("pipe_whatsapp").insert({
        lead_id: newLead.id,
        status: "novo",
        sdr_id: sdrId || null,
        organization_id: organizationId,
      });
    } catch (pipeError) {
      console.warn("[lead-service] Error creating pipe_whatsapp entry:", pipeError);
      // Don't fail the whole operation if pipe creation fails
    }
  } else {
    console.log("[lead-service] Shadow lead created, skipping pipe_whatsapp entry");
  }

  return { lead: newLead, created: true, source: "created" };
}

/**
 * Search for an existing lead by phone or email.
 * Does NOT create a new lead if not found.
 *
 * @param supabase - Supabase client instance
 * @param organizationId - Organization ID
 * @param phone - Phone number to search
 * @param email - Email to search (fallback)
 * @returns Lead object or null if not found
 */
export async function findLeadByPhoneOrEmail(
  supabase: SupabaseClient,
  organizationId: string,
  phone?: string | null,
  email?: string | null
): Promise<GetOrCreateLeadResult["lead"] | null> {
  const normalizedPhone = normalizePhoneForSearch(phone);
  const normalizedEmailValue = normalizeEmail(email);

  // Search by phone first (limit(1) handles duplicates gracefully)
  if (normalizedPhone) {
    const { data: phoneResults } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone, ai_disabled")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalizedPhone)
      .order("created_at", { ascending: false })
      .limit(1);

    if (phoneResults?.[0]) {
      return phoneResults[0];
    }
  }

  // Fallback to email (limit(1) handles duplicates gracefully)
  if (normalizedEmailValue) {
    const { data: emailResults } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone, ai_disabled")
      .eq("organization_id", organizationId)
      .ilike("email", normalizedEmailValue)
      .order("created_at", { ascending: false })
      .limit(1);

    if (emailResults?.[0]) {
      return emailResults[0];
    }
  }

  return null;
}

/**
 * Associate WhatsApp messages with a lead.
 * Updates all messages with the given phone number that don't have a lead_id.
 */
export async function associateMessagesToLead(
  supabase: SupabaseClient,
  organizationId: string,
  phoneNumber: string,
  leadId: string
): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_messages")
    .update({ lead_id: leadId })
    .eq("organization_id", organizationId)
    .eq("phone_number", phoneNumber)
    .is("lead_id", null);

  if (error) {
    console.error("[lead-service] Error associating messages to lead:", error);
  } else {
    console.log("[lead-service] Messages associated to lead:", leadId);
  }
}

/**
 * Promove um shadow lead para lead real.
 * Remove a flag is_shadow e insere no pipe correto.
 *
 * @param supabase - Supabase client instance
 * @param leadId - ID do shadow lead
 * @param organizationId - Organization ID
 * @param destination - Pipe e stage de destino
 * @param sdrId - SDR responsável (opcional)
 */
export async function promoveShadowLead(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  destination: { pipe?: string | null; stage: string },
  sdrId?: string | null
): Promise<boolean> {
  try {
    // 1. Verificar se é realmente shadow
    const { data: lead } = await supabase
      .from("leads")
      .select("id, is_shadow")
      .eq("id", leadId)
      .single();

    if (!lead || !lead.is_shadow) {
      console.log("[lead-service] Lead is not shadow, skipping promotion:", leadId);
      return false;
    }

    // 2. Remover flag shadow
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        is_shadow: false,
        origin: "whatsapp", // Atualiza de 'shadow_copilot' para 'whatsapp'
      })
      .eq("id", leadId);

    if (updateError) {
      console.error("[lead-service] Error promoting shadow lead:", updateError);
      return false;
    }

    // 3. Inserir no pipe correto
    const pipeType = destination.pipe || "whatsapp";

    if (pipeType === "confirmacao") {
      await supabase.from("pipe_confirmacao").insert({
        lead_id: leadId,
        organization_id: organizationId,
        status: destination.stage,
      });
    } else if (pipeType === "propostas") {
      await supabase.from("pipe_propostas").insert({
        lead_id: leadId,
        organization_id: organizationId,
        status: destination.stage,
      });
    } else {
      await supabase.from("pipe_whatsapp").insert({
        lead_id: leadId,
        organization_id: organizationId,
        status: destination.stage,
        sdr_id: sdrId || null,
      });
    }

    console.log("[lead-service] Shadow lead promoted:", {
      leadId,
      pipe: pipeType,
      stage: destination.stage,
    });

    return true;
  } catch (error) {
    console.error("[lead-service] Error promoting shadow lead:", error);
    return false;
  }
}
