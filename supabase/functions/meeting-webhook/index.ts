/**
 * Meeting Webhook — Public API for creating meetings programmatically
 *
 * Auth: API key (Bearer tq_live_xxxx) from api_keys table.
 * Required scope: meeting:write
 * Multi-tenancy: organization_id comes from the API key, never from body.
 *
 * Idempotency: if external_ref is provided, returns existing meeting instead of duplicating.
 *
 * Callers: n8n, cal.com, Zapier, Make, or any external system.
 */

import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { getCorsHeaders } from '../_shared/cors.ts';
import { withSecurityHeaders } from '../_shared/security-headers.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { logRuntime } from '../_shared/logger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MeetingWebhookPayload {
  title: string;
  start_at: string;
  end_at: string;
  lead_id?: string;
  lead_phone?: string;
  assigned_to?: string;
  event_type?: 'meeting' | 'call' | 'follow_up' | 'task' | 'other';
  location?: string;
  description?: string;
  external_ref?: string;
  meet_link?: string;
  notes?: string;
  participants?: string[];
}

interface ApiKeyRow {
  id: string;
  organization_id: string;
  scopes: string[];
  rate_limit_per_minute: number;
  created_by: string | null;
}

// ---------------------------------------------------------------------------
// Validation helpers (inline, no shared module per brief)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUUID(v: string): boolean {
  return UUID_RE.test(v);
}

function isISODatetime(v: string): boolean {
  const d = new Date(v);
  return !isNaN(d.getTime());
}

const VALID_EVENT_TYPES = ['meeting', 'call', 'follow_up', 'task', 'other'] as const;

function validatePayload(body: unknown): { ok: true; data: MeetingWebhookPayload } | { ok: false; errors: string[] } {
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Request body must be a JSON object'] };
  }

  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  // Required fields
  if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0) {
    errors.push('title is required and must be a non-empty string');
  } else if (b.title.length > 500) {
    errors.push('title must be at most 500 characters');
  }

  if (!b.start_at || typeof b.start_at !== 'string') {
    errors.push('start_at is required (ISO 8601 datetime)');
  } else if (!isISODatetime(b.start_at)) {
    errors.push('start_at is not a valid ISO 8601 datetime');
  }

  if (!b.end_at || typeof b.end_at !== 'string') {
    errors.push('end_at is required (ISO 8601 datetime)');
  } else if (!isISODatetime(b.end_at)) {
    errors.push('end_at is not a valid ISO 8601 datetime');
  }

  // start_at < end_at
  if (typeof b.start_at === 'string' && typeof b.end_at === 'string' && isISODatetime(b.start_at) && isISODatetime(b.end_at)) {
    if (new Date(b.start_at) >= new Date(b.end_at)) {
      errors.push('start_at must be before end_at');
    }
  }

  // Optional UUID fields
  if (b.lead_id !== undefined && b.lead_id !== null) {
    if (typeof b.lead_id !== 'string' || !isUUID(b.lead_id)) {
      errors.push('lead_id must be a valid UUID');
    }
  }

  if (b.assigned_to !== undefined && b.assigned_to !== null) {
    if (typeof b.assigned_to !== 'string' || !isUUID(b.assigned_to)) {
      errors.push('assigned_to must be a valid UUID (team_member_id)');
    }
  }

  // Optional string fields
  if (b.lead_phone !== undefined && b.lead_phone !== null && typeof b.lead_phone !== 'string') {
    errors.push('lead_phone must be a string');
  }

  if (b.event_type !== undefined && b.event_type !== null) {
    if (typeof b.event_type !== 'string' || !VALID_EVENT_TYPES.includes(b.event_type as typeof VALID_EVENT_TYPES[number])) {
      errors.push(`event_type must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
    }
  }

  if (b.location !== undefined && b.location !== null && typeof b.location !== 'string') {
    errors.push('location must be a string');
  }
  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') {
    errors.push('description must be a string');
  }
  if (b.external_ref !== undefined && b.external_ref !== null && typeof b.external_ref !== 'string') {
    errors.push('external_ref must be a string');
  }
  if (b.meet_link !== undefined && b.meet_link !== null && typeof b.meet_link !== 'string') {
    errors.push('meet_link must be a string');
  }
  if (b.notes !== undefined && b.notes !== null && typeof b.notes !== 'string') {
    errors.push('notes must be a string');
  }

  // Participants: array of UUIDs
  if (b.participants !== undefined && b.participants !== null) {
    if (!Array.isArray(b.participants)) {
      errors.push('participants must be an array of team_member_id UUIDs');
    } else if (b.participants.length > 50) {
      errors.push('participants must have at most 50 entries');
    } else {
      for (let i = 0; i < b.participants.length; i++) {
        if (typeof b.participants[i] !== 'string' || !isUUID(b.participants[i])) {
          errors.push(`participants[${i}] is not a valid UUID`);
          break; // report first bad one
        }
      }
    }
  }

  // String length caps for optional text fields
  const textLimits: [string, number][] = [
    ['location', 1000],
    ['description', 5000],
    ['external_ref', 500],
    ['meet_link', 2000],
    ['notes', 5000],
  ];
  for (const [field, max] of textLimits) {
    if (typeof b[field] === 'string' && (b[field] as string).length > max) {
      errors.push(`${field} must be at most ${max} characters`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      title: (b.title as string).trim(),
      start_at: b.start_at as string,
      end_at: b.end_at as string,
      lead_id: b.lead_id as string | undefined,
      lead_phone: b.lead_phone ? (b.lead_phone as string).trim() : undefined,
      assigned_to: b.assigned_to as string | undefined,
      event_type: (b.event_type as MeetingWebhookPayload['event_type']) ?? undefined,
      location: b.location ? (b.location as string).trim() : undefined,
      description: b.description ? (b.description as string).trim() : undefined,
      external_ref: b.external_ref ? (b.external_ref as string).trim() : undefined,
      meet_link: b.meet_link ? (b.meet_link as string).trim() : undefined,
      notes: b.notes ? (b.notes as string).trim() : undefined,
      participants: b.participants as string[] | undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// API Key authentication (inline per brief)
// ---------------------------------------------------------------------------

async function authenticateApiKey(
  authHeader: string | null,
  supabase: ReturnType<typeof createClient>,
): Promise<
  | { ok: true; key: ApiKeyRow }
  | { ok: false; status: number; error: string }
> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing or malformed Authorization header. Expected: Bearer tq_live_xxxx' };
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey || rawKey.length < 12) {
    return { ok: false, status: 401, error: 'Invalid API key format' };
  }

  // SECURITY: never log the full key, only the prefix
  const keyPrefix = rawKey.slice(0, 12);

  // SHA-256 hash of the raw key
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Lookup key
  const { data: apiKey, error: queryErr } = await supabase
    .from('api_keys')
    .select('id, organization_id, scopes, rate_limit_per_minute, created_by')
    .eq('key_prefix', keyPrefix)
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .is('revoked_at', null)
    .single();

  if (queryErr || !apiKey) {
    console.warn(`[meeting-webhook] API key auth failed for prefix ${keyPrefix}`);
    return { ok: false, status: 401, error: 'Invalid or revoked API key' };
  }

  // Check expiration
  if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date()) {
    console.warn(`[meeting-webhook] Expired API key: prefix=${keyPrefix}`);
    return { ok: false, status: 401, error: 'API key has expired' };
  }

  return { ok: true, key: apiKey as ApiKeyRow };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(withErrorBoundary('meeting-webhook', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get('origin')));

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // POST only
  if (req.method !== 'POST') {
    return errorResponse(405, 'Method not allowed. Use POST.', corsHeaders, { req });
  }

  // Supabase client (service_role — bypasses RLS)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Authenticate API key ──
  const authResult = await authenticateApiKey(req.headers.get('authorization'), supabase);
  if (!authResult.ok) {
    return errorResponse(authResult.status, authResult.error, corsHeaders, { req });
  }

  const apiKey = authResult.key;
  const organizationId = apiKey.organization_id;

  // ── Check scope ──
  if (!apiKey.scopes.includes('meeting:write')) {
    console.warn(`[meeting-webhook] API key ${apiKey.id} lacks meeting:write scope`);
    return errorResponse(403, 'API key does not have the required scope: meeting:write', corsHeaders, { req });
  }

  // ── Update last_used_at (fire-and-forget) ──
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)
    .then(() => {})
    .catch((e: unknown) => console.warn('[meeting-webhook] Failed to update last_used_at:', e));

  try {
    // ── Parse and validate body ──
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body', corsHeaders, { req });
    }

    const validation = validatePayload(rawBody);
    if (!validation.ok) {
      return errorResponse(400, 'Validation failed', corsHeaders, { req, details: validation.errors });
    }

    const payload = validation.data;

    // ── Idempotency: check external_ref ──
    if (payload.external_ref) {
      const { data: existing } = await supabase
        .from('meetings')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('external_ref', payload.external_ref)
        .maybeSingle();

      if (existing) {
        console.log(`[meeting-webhook] Idempotent hit: external_ref=${payload.external_ref}, meeting=${existing.id}`);
        return new Response(
          JSON.stringify({ success: true, meeting: existing, idempotent: true }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
    }

    // ── Resolve lead_id from lead_phone if needed ──
    let resolvedLeadId = payload.lead_id ?? null;

    if (!resolvedLeadId && payload.lead_phone) {
      // Normalize phone: strip non-digits
      const normalizedPhone = payload.lead_phone.replace(/\D/g, '');
      if (normalizedPhone.length >= 10) {
        const { data: matchedLead } = await supabase
          .from('leads')
          .select('id')
          .eq('organization_id', organizationId)
          .or(`phone.eq.${payload.lead_phone},normalized_phone.eq.${normalizedPhone}`)
          .limit(1)
          .maybeSingle();

        if (matchedLead) {
          resolvedLeadId = matchedLead.id;
          console.log(`[meeting-webhook] Resolved lead by phone: ${resolvedLeadId}`);
        } else {
          console.warn(`[meeting-webhook] No lead found for phone in org ${organizationId}`);
        }
      }
    }

    // ── Resolve deal_id a partir do lead (S6) ──
    //
    // O webhook não tem funil nem pessoa na frente da tela. A regra é a mais
    // conservadora possível: só vincula quando NÃO HÁ escolha a fazer — o lead
    // tem exatamente UMA entrada de funil cujo negócio está com desfecho aberto.
    //
    // Havendo duas ou mais (9,0% dos leads com entrada aberta em prod,
    // 2.990 de 33.381 — medido em 2026-09-03), grava NULL. Escolher por conta
    // própria — a primeira, a mais recente, a de maior valor — é exatamente o
    // que faz a reunião aparecer no card errado, e ninguém percebe porque a
    // reunião existe e parece certa.
    //
    // NULL não é falha: a reunião nasce igual, só não é projetada em card
    // nenhum. Nunca deixar a resolução do negócio derrubar a criação.
    let resolvedDealId: string | null = null;

    if (resolvedLeadId) {
      const { data: entradasAbertas, error: entradasErr } = await supabase
        .from('pipeline_entries')
        .select('deal_id, deals!inner(id, outcome, deleted_at)')
        .eq('organization_id', organizationId)
        .eq('lead_id', resolvedLeadId)
        .not('deal_id', 'is', null)
        .eq('deals.outcome', 'open')
        .is('deals.deleted_at', null)
        // 2 basta para saber que há mais de uma — não se paga um count exato
        // para responder "é ambíguo?".
        .limit(2);

      if (entradasErr) {
        console.warn('[meeting-webhook] Falha ao resolver deal_id:', entradasErr.message);
      } else if (entradasAbertas?.length === 1) {
        resolvedDealId = entradasAbertas[0].deal_id as string;
        console.log(`[meeting-webhook] Negócio resolvido pelo lead: ${resolvedDealId}`);
      } else if ((entradasAbertas?.length ?? 0) > 1) {
        console.log(
          `[meeting-webhook] Lead ${resolvedLeadId} tem mais de um negócio aberto — reunião criada sem vínculo.`,
        );
      }
    }

    // ── Resolve assigned_to (created_by team_member fallback) ──
    let resolvedAssignedTo = payload.assigned_to ?? null;

    if (!resolvedAssignedTo && apiKey.created_by) {
      // Find team_member_id for the user who created this API key
      const { data: tm } = await supabase
        .from('team_members')
        .select('id')
        .eq('user_id', apiKey.created_by)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (tm) {
        resolvedAssignedTo = tm.id;
        console.log(`[meeting-webhook] Assigned to key creator's team_member: ${resolvedAssignedTo}`);
      }
    }

    // ── Validate assigned_to exists in org ──
    if (resolvedAssignedTo) {
      const { data: tmCheck } = await supabase
        .from('team_members')
        .select('id')
        .eq('id', resolvedAssignedTo)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (!tmCheck) {
        return errorResponse(400, `assigned_to team member not found in this organization`, corsHeaders, { req });
      }
    }

    // created_by is required by the meetings table — must be a valid team_member_id
    if (!resolvedAssignedTo) {
      return errorResponse(400, 'Could not resolve a team member for created_by. Provide assigned_to or ensure the API key creator is a team member in this organization.', corsHeaders, { req });
    }

    // ── Insert meeting ──
    const meetingData: Record<string, unknown> = {
      organization_id: organizationId,
      title: payload.title,
      start_at: payload.start_at,
      end_at: payload.end_at,
      event_type: payload.event_type ?? 'meeting',
      created_by: resolvedAssignedTo,
      lead_id: resolvedLeadId,
      deal_id: resolvedDealId,
    };

    if (payload.location) meetingData.location = payload.location;
    if (payload.description) meetingData.description = payload.description;
    if (payload.external_ref) meetingData.external_ref = payload.external_ref;
    if (payload.meet_link) meetingData.meet_link = payload.meet_link;
    if (payload.notes) meetingData.notes = payload.notes;

    const { data: meeting, error: insertErr } = await supabase
      .from('meetings')
      .insert(meetingData)
      .select('*')
      .single();

    if (insertErr) {
      console.error('[meeting-webhook] Failed to insert meeting:', insertErr);

      // Handle unique constraint violation on external_ref (race condition)
      if (insertErr.code === '23505' && payload.external_ref) {
        const { data: existing } = await supabase
          .from('meetings')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('external_ref', payload.external_ref)
          .maybeSingle();

        if (existing) {
          return new Response(
            JSON.stringify({ success: true, meeting: existing, idempotent: true }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
          );
        }
      }

      return errorResponse(500, 'Failed to create meeting', corsHeaders, { req, details: insertErr.message });
    }

    // ── Insert participants ──
    let participantsCreated = 0;

    if (payload.participants && payload.participants.length > 0) {
      const participantRows = payload.participants.map((tmId) => ({
        meeting_id: meeting.id,
        team_member_id: tmId,
        status: 'pending',
      }));

      const { data: insertedParticipants, error: pErr } = await supabase
        .from('meeting_participants')
        .insert(participantRows)
        .select('id');

      if (pErr) {
        console.warn('[meeting-webhook] Partial failure inserting participants:', pErr.message);
        // Non-blocking: meeting was created, participants are best-effort
      } else {
        participantsCreated = insertedParticipants?.length ?? 0;
      }
    }

    // Also add assigned_to as a participant with 'accepted' status (if not already in participants)
    if (resolvedAssignedTo && (!payload.participants || !payload.participants.includes(resolvedAssignedTo))) {
      await supabase
        .from('meeting_participants')
        .upsert(
          {
            meeting_id: meeting.id,
            team_member_id: resolvedAssignedTo,
            status: 'accepted',
          },
          { onConflict: 'meeting_id,team_member_id' },
        )
        .then(() => { participantsCreated++; })
        .catch((e: unknown) => console.warn('[meeting-webhook] Failed to add creator as participant:', e));
    }

    // ── Runtime log (fire-and-forget) ──
    logRuntime({
      organizationId,
      module: 'meeting',
      action: 'webhook_create',
      status: 'success',
      entityType: 'meeting',
      entityId: meeting.id,
      payloadSnapshot: {
        title: payload.title,
        event_type: payload.event_type ?? 'meeting',
        external_ref: payload.external_ref ?? null,
        lead_id: resolvedLeadId,
        deal_id: resolvedDealId,
        participants_count: participantsCreated,
      },
    }).catch((e: unknown) => console.warn('[meeting-webhook] logRuntime failed:', e));

    console.log(`[meeting-webhook] Meeting created: ${meeting.id} for org ${organizationId}`);

    return new Response(
      JSON.stringify({
        success: true,
        meeting,
        participants_created: participantsCreated,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[meeting-webhook] Unhandled error:', error);

    await logRuntime({
      organizationId,
      module: 'meeting',
      action: 'webhook_create',
      status: 'error',
      errorMessage: String(error),
    }).catch(() => {});

    return errorResponse(500, 'Internal server error', corsHeaders, { req });
  }
}));
