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
  const { organizationId, phone, email, name, pushName, origin, sdrId } = params;

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
  if (normalizedPhone) {
    const { data: leadByPhone, error: phoneError } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (phoneError && !phoneError.message?.includes("No rows")) {
      console.error("[lead-service] Error searching by phone:", phoneError);
    }

    if (leadByPhone) {
      console.log("[lead-service] Found lead by phone:", leadByPhone.id);
      return { lead: leadByPhone, created: false, source: "phone" };
    }
  }

  // 2. SEARCH BY EMAIL (fallback)
  if (normalizedEmailValue) {
    const { data: leadByEmail, error: emailError } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone")
      .eq("organization_id", organizationId)
      .ilike("email", normalizedEmailValue)
      .maybeSingle();

    if (emailError && !emailError.message?.includes("No rows")) {
      console.error("[lead-service] Error searching by email:", emailError);
    }

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
    pipe_whatsapp: "novo",
  };

  // Add sdr_id if provided
  if (sdrId) {
    insertData.sdr_id = sdrId;
  }

  const { data: newLead, error: createError } = await supabase
    .from("leads")
    .insert(insertData)
    .select("id, name, phone, email, organization_id, normalized_phone")
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
        const { data: retryLead } = await supabase
          .from("leads")
          .select("id, name, phone, email, organization_id, normalized_phone")
          .eq("organization_id", organizationId)
          .eq("normalized_phone", normalizedPhone)
          .maybeSingle();

        if (retryLead) {
          console.log(
            "[lead-service] Found lead after retry:",
            retryLead.id
          );
          return { lead: retryLead, created: false, source: "phone" };
        }
      }

      if (normalizedEmailValue) {
        const { data: retryLeadByEmail } = await supabase
          .from("leads")
          .select("id, name, phone, email, organization_id, normalized_phone")
          .eq("organization_id", organizationId)
          .ilike("email", normalizedEmailValue)
          .maybeSingle();

        if (retryLeadByEmail) {
          console.log(
            "[lead-service] Found lead by email after retry:",
            retryLeadByEmail.id
          );
          return { lead: retryLeadByEmail, created: false, source: "email" };
        }
      }
    }

    console.error("[lead-service] Error creating lead:", createError);
    return null;
  }

  console.log("[lead-service] New lead created:", newLead.id);

  // Create pipe_whatsapp entry for new leads
  try {
    await supabase.from("pipe_whatsapp").insert({
      lead_id: newLead.id,
      status: "novo",
      sdr_id: sdrId || null,
    });
  } catch (pipeError) {
    console.warn("[lead-service] Error creating pipe_whatsapp entry:", pipeError);
    // Don't fail the whole operation if pipe creation fails
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

  // Search by phone first
  if (normalizedPhone) {
    const { data: leadByPhone } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone")
      .eq("organization_id", organizationId)
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (leadByPhone) {
      return leadByPhone;
    }
  }

  // Fallback to email
  if (normalizedEmailValue) {
    const { data: leadByEmail } = await supabase
      .from("leads")
      .select("id, name, phone, email, organization_id, normalized_phone")
      .eq("organization_id", organizationId)
      .ilike("email", normalizedEmailValue)
      .maybeSingle();

    if (leadByEmail) {
      return leadByEmail;
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
