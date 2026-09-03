/**
 * google-calendar-events
 *
 * CRUD de eventos do Google Calendar com suporte a:
 * - Listagem de eventos próprios + calendários compartilhados
 * - Criação de eventos com Google Meet (conferenceData)
 * - Atualização e exclusão
 * - Salvamento automático em google_calendar_events_cache
 * - Persistência de meet_link em pipe_confirmacao quando houver lead_id
 *
 * Métodos:
 *   GET    ?start=ISO&end=ISO[&include_shared=true]  → lista eventos
 *   POST   body: CreateEventPayload                  → cria evento
 *   PATCH  body: UpdateEventPayload                  → atualiza evento
 *   DELETE ?event_id=xxx&calendar_owner_id=xxx       → remove evento
 *
 * Requer: Authorization: Bearer <supabase_jwt>
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import {
  getValidAccessToken,
  logCalendarOp,
} from "../_shared/google-calendar-utils.ts";
import { logRuntime } from "../_shared/logger.ts";
import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { getPipeEntry, upsertPipeEntry, updatePipeEntryById } from "../_shared/pipeline-adapter.ts";
import { resolveMeetingDestination } from "../_shared/pipeline-destination.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY         =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateEventPayload {
  title: string;
  description?: string;
  location?: string;
  start_at: string;             // ISO 8601
  end_at: string;               // ISO 8601
  timezone?: string;            // Ex: "America/Sao_Paulo"
  attendees?: string[];         // Emails dos convidados
  lead_id?: string;             // UUID do lead para vincular
  pipe_confirmacao_id?: string; // UUID do pipe_confirmacao para salvar meet_link
  calendar_owner_id?: string;   // user_id do dono do calendário (para criar no calendário de outro)
  color_id?: string;            // Google Calendar colorId ("1"–"11", vazio = padrão)
  with_meet?: boolean;          // Gerar link do Google Meet (default: true)
  pipe_slug?: string;           // Funil destino do meet_link: id (uuid) ou slug de QUALQUER funil da org (default "confirmacao"; merge ADR-0004 usa "whatsapp")
  pipe_stage_key?: string;      // Stage destino caso a entry não exista (default "reuniao_marcada"; merge usa "agendado")
}

interface UpdateEventPayload {
  event_id: string;
  calendar_owner_id?: string;
  title?: string;
  description?: string;
  location?: string;
  start_at?: string;
  end_at?: string;
  timezone?: string;
  attendees?: string[];
}

// ─── Helpers Google Calendar API ─────────────────────────────────────────────

async function googleCalendarRequest(
  method: string,
  path: string,
  accessToken: string,
  body?: unknown
): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Salva evento no cache ────────────────────────────────────────────────────

async function upsertEventCache(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
  event: Record<string, unknown>,
  origin: "google" | "calcom" | "system" = "system"
): Promise<void> {
  const meetLink =
    (event.conferenceData as Record<string, unknown> | undefined)?.entryPoints
      ? ((
          (event.conferenceData as Record<string, unknown>)
            .entryPoints as Array<Record<string, unknown>>
        ).find((ep) => ep.entryPointType === "video")?.uri as string | undefined) ?? null
      : (event.hangoutLink as string | null | undefined) ?? null;

  await supabase.from("google_calendar_events_cache").upsert(
    {
      id:                 event.id,
      user_id:            userId,
      organization_id:    orgId,
      google_calendar_id: "primary",
      title:              event.summary ?? null,
      description:        event.description ?? null,
      location:           event.location ?? null,
      start_at:           (event.start as Record<string, string>)?.dateTime ??
                          (event.start as Record<string, string>)?.date,
      end_at:             (event.end as Record<string, string>)?.dateTime ??
                          (event.end as Record<string, string>)?.date ?? null,
      all_day:            !(event.start as Record<string, string>)?.dateTime,
      meet_link:          meetLink,
      attendees:          event.attendees ?? [],
      google_event_status: event.status ?? "confirmed",
      origin,
      synced_at:          new Date().toISOString(),
    },
    { onConflict: "id" }
  );
}

// ─── Atualiza meet_link no pipeline_entries (confirmacao) ─────────────────────

async function saveMeetLinkToPipe(
  supabase: SupabaseClient,
  pipeConfirmacaoId: string,
  meetLink: string | null,
  leadId?: string,
  orgId?: string,
  pipeSlug: string = "confirmacao",
  pipeStageKey: string = "reuniao_marcada",
): Promise<void> {
  if (!meetLink) return;
  // If we have leadId + orgId, use the pipeline adapter (preferred path)
  if (leadId && orgId) {
    // SCRUM-624: o cast para a união de 3 literais morreu (ADR-0034 D1) — o
    // adapter resolve id (uuid) ou slug de QUALQUER funil da org. `pipe_slug`
    // já era a config de destino desta porta; agora aceita funil custom.
    const existing = await getPipeEntry(supabase, leadId, orgId, pipeSlug);
    if (existing) {
      // Only update metadata, preserve current stage
      await updatePipeEntryById(supabase, existing.id, {
        metadata: { meet_link: meetLink },
      });
    } else {
      await upsertPipeEntry(supabase, {
        leadId,
        orgId,
        slug: pipeSlug,
        stageKey: pipeStageKey,
        metadata: { meet_link: meetLink },
      });
    }
    return;
  }
  // Fallback: update by entry ID directly
  if (pipeConfirmacaoId) {
    await updatePipeEntryById(supabase, pipeConfirmacaoId, {
      metadata: { meet_link: meetLink },
    });
  }
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function authenticateUser(
  req: Request,
  supabase: SupabaseClient
): Promise<{ userId: string; orgId: string } | null> {
  const jwt = req.headers
    .get("Authorization")
    ?.replace(/^Bearer\s+/i, "")
    ?.trim();
  if (!jwt) return null;

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await anonClient.auth.getUser(jwt);
  if (error || !user?.id) return null;

  const { data: member } = await supabase
    .from("team_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  return { userId: user.id, orgId: member?.organization_id ?? "" };
}

// ─── Verificação de permissão de compartilhamento ────────────────────────────

async function canAccessCalendar(
  supabase: SupabaseClient,
  requesterId: string,
  ownerId: string,
  requireCreatePermission = false
): Promise<boolean> {
  if (requesterId === ownerId) return true;

  const { data } = await supabase
    .from("google_calendar_sharing")
    .select("can_create_events")
    .eq("owner_id", ownerId)
    .eq("viewer_id", requesterId)
    .maybeSingle();

  if (!data) return false;
  if (requireCreatePermission && !data.can_create_events) return false;
  return true;
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(withErrorBoundary('google-calendar-events', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const auth = await authenticateUser(req, supabase);
    if (!auth) {
      return json({ error: "Unauthorized", message: "JWT inválido ou ausente" }, 401);
    }
    const { userId, orgId } = auth;

    // ── GET: listar eventos ─────────────────────────────────────────────────
    if (req.method === "GET") {
      const url           = new URL(req.url);
      const start         = url.searchParams.get("start") ?? new Date().toISOString();
      const end           = url.searchParams.get("end") ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const includeShared = url.searchParams.get("include_shared") !== "false";

      // Usuários cujos calendários temos acesso
      const ownerIds: string[] = [userId];

      if (includeShared) {
        const { data: shares } = await supabase
          .from("google_calendar_sharing")
          .select("owner_id")
          .eq("viewer_id", userId);
        if (shares) ownerIds.push(...shares.map((s) => s.owner_id));
      }

      const allEvents: unknown[] = [];

      for (const ownerId of ownerIds) {
        const tokenData = await getValidAccessToken(ownerId, supabase);
        if (!tokenData) continue;

        const googleRes = await googleCalendarRequest(
          "GET",
          `/calendars/primary/events?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime&maxResults=250`,
          tokenData.accessToken
        );

        if (!googleRes.ok) continue;

        const data = await googleRes.json();
        const events = (data.items as unknown[]) ?? [];

        // Atualiza cache para cada evento
        for (const event of events) {
          await upsertEventCache(
            supabase,
            ownerId,
            orgId,
            event as Record<string, unknown>,
            "google"
          );
        }

        allEvents.push(
          ...events.map((e) => ({
            ...(e as Record<string, unknown>),
            calendar_owner_id: ownerId,
            is_own: ownerId === userId,
          }))
        );
      }

      await logRuntime({
        organizationId: orgId,
        module: "calendar",
        action: "manage_events",
        status: "success",
        triggeredBy: "user",
        payloadSnapshot: { method: "GET", eventCount: allEvents.length },
      });

      return json({ events: allEvents, count: allEvents.length });
    }

    // ── POST: criar evento ──────────────────────────────────────────────────
    if (req.method === "POST") {
      const payload: CreateEventPayload = await req.json();
      const targetOwnerId = payload.calendar_owner_id ?? userId;

      // Verifica permissão (criar em calendário de outro usuário)
      if (
        targetOwnerId !== userId &&
        !(await canAccessCalendar(supabase, userId, targetOwnerId, true))
      ) {
        return json({ error: "Forbidden", message: "Sem permissão para criar eventos neste calendário" }, 403);
      }

      const tokenData = await getValidAccessToken(targetOwnerId, supabase);
      if (!tokenData) {
        return json({ error: "Not Connected", message: "Usuário não tem Google Calendar conectado" }, 400);
      }

      const timezone  = payload.timezone ?? "America/Sao_Paulo";
      const requestId = crypto.randomUUID();
      const createMeet = payload.with_meet !== false; // default true

      const googleEvent: Record<string, unknown> = {
        summary:     payload.title,
        description: payload.description ?? null,
        location:    payload.location ?? null,
        start: { dateTime: payload.start_at, timeZone: timezone },
        end:   { dateTime: payload.end_at,   timeZone: timezone },
        attendees: (payload.attendees ?? []).map((email) => ({ email })),
        // Cor do evento (Google Calendar colorId 1–11)
        ...(payload.color_id ? { colorId: payload.color_id } : {}),
        // Gera link do Google Meet (opcional)
        ...(createMeet
          ? {
              conferenceData: {
                createRequest: {
                  requestId,
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                },
              },
            }
          : {}),
        // Vincula ao lead via extended properties para uso no webhook
        ...(payload.lead_id
          ? { extendedProperties: { private: { lead_id: payload.lead_id, system: "v8milennialsb2b" } } }
          : {}),
      };

      const googleRes = await googleCalendarRequest(
        "POST",
        `/calendars/primary/events${createMeet ? "?conferenceDataVersion=1" : ""}`,
        tokenData.accessToken,
        googleEvent
      );

      if (!googleRes.ok) {
        const err = await googleRes.json();
        await logCalendarOp(supabase, {
          userId,
          operation: "create_event",
          status: "failed",
          errorMessage: JSON.stringify(err),
          requestPayload: payload as unknown as Record<string, unknown>,
          initiatedBy: "user",
        });
        return json({ error: "Google API Error", message: JSON.stringify(err) }, 502);
      }

      const createdEvent = await googleRes.json();

      // Extrai meet link
      const meetLink =
        createdEvent.conferenceData?.entryPoints?.find(
          (ep: Record<string, string>) => ep.entryPointType === "video"
        )?.uri ??
        createdEvent.hangoutLink ??
        null;

      // Salva no cache
      await upsertEventCache(
        supabase,
        targetOwnerId,
        orgId,
        createdEvent,
        "system"
      );

      // Atualiza meet_link no lead no cache
      if (payload.lead_id) {
        await supabase
          .from("google_calendar_events_cache")
          .update({ lead_id: payload.lead_id })
          .eq("id", createdEvent.id);
      }

      // Salva meet_link no pipeline_entries.
      // SCRUM-641: `pipe_slug` explícito no payload é a config da porta e vale
      // como veio. SEM config, o preferido segue 'confirmacao'/'reuniao_marcada'
      // (org antiga: idêntico); org sem esse funil → funil PADRÃO ancorado pela
      // etapa de papel meeting_booked; sem funil padrão → sem card (log no helper).
      if (meetLink && (payload.pipe_confirmacao_id || payload.lead_id)) {
        let destRef = payload.pipe_slug ?? null;
        let destStage = payload.pipe_stage_key ?? "reuniao_marcada";
        if (!destRef && orgId) {
          const dest = await resolveMeetingDestination(supabase, orgId, {
            ref: "confirmacao",
            stageKey: payload.pipe_stage_key ?? "reuniao_marcada",
          });
          destRef = dest?.ref ?? null;
          destStage = dest?.stageKey ?? destStage;
        }
        if (destRef || payload.pipe_confirmacao_id) {
          await saveMeetLinkToPipe(
            supabase,
            payload.pipe_confirmacao_id ?? "",
            meetLink,
            destRef ? payload.lead_id : undefined,
            orgId,
            destRef ?? "confirmacao",
            destStage,
          );
        }
      }

      await logCalendarOp(supabase, {
        userId,
        operation: "create_event",
        status: "success",
        googleEventId: createdEvent.id,
        localReferenceId: payload.lead_id,
        localReferenceType: payload.lead_id ? "lead" : undefined,
        requestPayload: payload as unknown as Record<string, unknown>,
        responsePayload: { id: createdEvent.id, meet_link: meetLink },
        initiatedBy: "user",
      });

      await logRuntime({
        organizationId: orgId,
        module: "calendar",
        action: "manage_events",
        status: "success",
        triggeredBy: "user",
        payloadSnapshot: { method: "POST", eventId: createdEvent.id, meetLink },
        entityType: "event",
        entityId: createdEvent.id,
      });

      return json({
        success: true,
        event: createdEvent,
        meet_link: meetLink,
        event_id: createdEvent.id,
      });
    }

    // ── PATCH: atualizar evento ─────────────────────────────────────────────
    if (req.method === "PATCH") {
      const payload: UpdateEventPayload = await req.json();
      const targetOwnerId = payload.calendar_owner_id ?? userId;

      if (
        targetOwnerId !== userId &&
        !(await canAccessCalendar(supabase, userId, targetOwnerId, true))
      ) {
        return json({ error: "Forbidden", message: "Sem permissão para editar eventos neste calendário" }, 403);
      }

      const tokenData = await getValidAccessToken(targetOwnerId, supabase);
      if (!tokenData) {
        return json({ error: "Not Connected", message: "Usuário não tem Google Calendar conectado" }, 400);
      }

      const patch: Record<string, unknown> = {};
      if (payload.title)       patch.summary     = payload.title;
      if (payload.description !== undefined) patch.description = payload.description;
      if (payload.location !== undefined)    patch.location    = payload.location;
      if (payload.start_at)    patch.start = { dateTime: payload.start_at, timeZone: payload.timezone ?? "America/Sao_Paulo" };
      if (payload.end_at)      patch.end   = { dateTime: payload.end_at,   timeZone: payload.timezone ?? "America/Sao_Paulo" };
      if (payload.attendees)   patch.attendees = payload.attendees.map((email) => ({ email }));

      const googleRes = await googleCalendarRequest(
        "PATCH",
        `/calendars/primary/events/${encodeURIComponent(payload.event_id)}`,
        tokenData.accessToken,
        patch
      );

      if (!googleRes.ok) {
        const err = await googleRes.json();
        return json({ error: "Google API Error", message: JSON.stringify(err) }, 502);
      }

      const updatedEvent = await googleRes.json();
      await upsertEventCache(supabase, targetOwnerId, orgId, updatedEvent, "system");

      await logCalendarOp(supabase, {
        userId,
        operation: "update_event",
        status: "success",
        googleEventId: payload.event_id,
        initiatedBy: "user",
      });

      await logRuntime({
        organizationId: orgId,
        module: "calendar",
        action: "manage_events",
        status: "success",
        triggeredBy: "user",
        payloadSnapshot: { method: "PATCH", eventId: payload.event_id },
        entityType: "event",
        entityId: payload.event_id,
      });

      return json({ success: true, event: updatedEvent });
    }

    // ── DELETE: remover evento ──────────────────────────────────────────────
    if (req.method === "DELETE") {
      const url           = new URL(req.url);
      const eventId       = url.searchParams.get("event_id");
      const targetOwnerId = url.searchParams.get("calendar_owner_id") ?? userId;

      if (!eventId) {
        return json({ error: "Bad Request", message: "event_id é obrigatório" }, 400);
      }

      if (
        targetOwnerId !== userId &&
        !(await canAccessCalendar(supabase, userId, targetOwnerId, true))
      ) {
        return json({ error: "Forbidden", message: "Sem permissão para deletar eventos neste calendário" }, 403);
      }

      const tokenData = await getValidAccessToken(targetOwnerId, supabase);
      if (!tokenData) {
        return json({ error: "Not Connected", message: "Usuário não tem Google Calendar conectado" }, 400);
      }

      const googleRes = await googleCalendarRequest(
        "DELETE",
        `/calendars/primary/events/${encodeURIComponent(eventId)}`,
        tokenData.accessToken
      );

      if (!googleRes.ok && googleRes.status !== 410) {
        const err = await googleRes.text();
        return json({ error: "Google API Error", message: err }, 502);
      }

      // Remove do cache
      await supabase
        .from("google_calendar_events_cache")
        .update({ google_event_status: "cancelled" })
        .eq("id", eventId);

      await logCalendarOp(supabase, {
        userId,
        operation: "delete_event",
        status: "success",
        googleEventId: eventId,
        initiatedBy: "user",
      });

      await logRuntime({
        organizationId: orgId,
        module: "calendar",
        action: "manage_events",
        status: "success",
        triggeredBy: "user",
        payloadSnapshot: { method: "DELETE", eventId },
        entityType: "event",
        entityId: eventId,
      });

      return json({ success: true });
    }

    return json({ error: "Method Not Allowed" }, 405);
  } catch (err) {
    console.error("[google-calendar-events]", err);

    await logRuntime({
      module: "calendar",
      action: "manage_events",
      status: "error",
      errorMessage: String(err),
      triggeredBy: "system",
    });

    return json({ error: "Erro interno", message: String(err) }, 500);
  }
}));
