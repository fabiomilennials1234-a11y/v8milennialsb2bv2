/**
 * meeting-calendar-sync
 *
 * Sincroniza eventos da tabela `meetings` (agenda interna do Torque) → Google
 * Calendar do criador. Disparada pelo trigger `trg_meetings_google_sync` via
 * pg_net (INSERT/UPDATE/DELETE), NUNCA pela UI diretamente.
 *
 * Auth: x-cron-secret (CRON_SECRET). NÃO usa JWT de usuário — roda em contexto
 * de sistema com service role.
 *
 * Fluxo:
 *   insert → cria evento no Google + grava google_event_id/meet_link no meeting
 *   update → se já tem google_event_id, edita; senão cria (passou a ser syncável)
 *   delete → se tinha google_event_id, apaga no Google (linha já não existe)
 *
 * Calendário-alvo: o do `created_by` (team_member) → team_members.user_id →
 * google_calendar_tokens. Se não houver token ativo, o meeting fica só interno
 * (no-op, sem erro).
 *
 * Anti-loop: o write-back de google_event_id/meet_link NÃO re-dispara o Google
 * porque o trigger só reage a mudança de colunas relevantes (title/start/end/...).
 */

import { withSentry } from "../_shared/sentry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { getValidAccessToken, logCalendarOp } from "../_shared/google-calendar-utils.ts";
import {
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  type MeetingEventInput,
} from "../_shared/google-calendar-events-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

interface SyncPayload {
  meeting_id: string;
  op: "insert" | "update" | "delete";
  google_event_id?: string | null;
  created_by?: string | null; // team_member id (fallback p/ resolver user_id)
  user_id?: string | null; // auth user id (resolvido pelo trigger)
}

// deno-lint-ignore no-explicit-any
type Supa = ReturnType<typeof createClient>;

/** team_member id → auth user id (dono do calendário). */
async function resolveUserId(supabase: Supa, teamMemberId: string | null): Promise<string | null> {
  if (!teamMemberId) return null;
  const { data } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("id", teamMemberId)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

Deno.serve(withSentry("meeting-calendar-sync", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── Auth: x-cron-secret ────────────────────────────────────────────────────
  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: SyncPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Payload inválido" }, 400);
  }

  const { meeting_id, op } = payload;
  if (!meeting_id || !op) {
    return json({ error: "meeting_id e op são obrigatórios" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // ── DELETE: a linha já não existe; usa dados do payload ───────────────────
    if (op === "delete") {
      const geid = payload.google_event_id;
      if (!geid) return json({ skipped: "meeting sem google_event_id" });

      const userId = payload.user_id ?? (await resolveUserId(supabase, payload.created_by ?? null));
      if (!userId) return json({ skipped: "sem user_id" });

      const token = await getValidAccessToken(userId, supabase);
      if (!token) return json({ skipped: "criador sem Google conectado" });

      await deleteGoogleEvent(token.accessToken, geid);
      await logCalendarOp(supabase, {
        userId,
        operation: "delete_event",
        status: "success",
        googleEventId: geid,
        localReferenceId: meeting_id,
        localReferenceType: "meeting",
        initiatedBy: "system",
      });
      return json({ success: true, op });
    }

    // ── INSERT / UPDATE: lê o meeting ─────────────────────────────────────────
    const { data: meeting } = await supabase
      .from("meetings")
      .select(
        "id, organization_id, created_by, title, description, location, start_at, end_at, all_day, color, lead_id, meet_link, google_event_id",
      )
      .eq("id", meeting_id)
      .maybeSingle();

    if (!meeting) return json({ skipped: "meeting não encontrado" });

    const userId = payload.user_id ?? (await resolveUserId(supabase, meeting.created_by as string));
    if (!userId) return json({ skipped: "created_by sem user_id" });

    const token = await getValidAccessToken(userId, supabase);
    if (!token) return json({ skipped: "criador sem Google conectado" });

    const extendedPrivate: Record<string, string> = {
      system: "v8milennialsb2b",
      meeting_id: meeting.id as string,
    };
    if (meeting.lead_id) extendedPrivate.lead_id = meeting.lead_id as string;

    const eventInput: MeetingEventInput = {
      title: meeting.title as string,
      description: meeting.description as string | null,
      location: meeting.location as string | null,
      start_at: meeting.start_at as string,
      end_at: meeting.end_at as string,
      all_day: meeting.all_day as boolean | null,
      timezone: "America/Sao_Paulo",
      color: meeting.color as string | null,
      extendedPrivate,
    };

    // UPDATE com evento já existente → PATCH no Google
    if (op === "update" && meeting.google_event_id) {
      await updateGoogleEvent(token.accessToken, meeting.google_event_id as string, eventInput);
      await logCalendarOp(supabase, {
        userId,
        operation: "update_event",
        status: "success",
        googleEventId: meeting.google_event_id as string,
        localReferenceId: meeting.id as string,
        localReferenceType: "meeting",
        initiatedBy: "system",
      });
      return json({ success: true, op, google_event_id: meeting.google_event_id });
    }

    // INSERT (ou UPDATE sem evento ainda) → cria no Google
    const withMeet = !meeting.meet_link; // gera Meet só se o usuário não pôs link próprio
    const created = await createGoogleEvent(token.accessToken, { ...eventInput, withMeet });

    // Write-back. NÃO re-dispara o Google (trigger ignora estas colunas).
    const writeBack: Record<string, unknown> = { google_event_id: created.id };
    if (created.meetLink && !meeting.meet_link) writeBack.meet_link = created.meetLink;
    await supabase.from("meetings").update(writeBack).eq("id", meeting.id);

    await logCalendarOp(supabase, {
      userId,
      operation: "create_event",
      status: "success",
      googleEventId: created.id,
      localReferenceId: meeting.id as string,
      localReferenceType: "meeting",
      initiatedBy: "system",
    });
    return json({ success: true, op, google_event_id: created.id });
  } catch (err) {
    console.error("[meeting-calendar-sync]", err);
    await logRuntime({
      module: "calendar",
      action: "meeting_sync",
      status: "error",
      errorMessage: String(err),
      triggeredBy: "system",
    });
    // 200 de propósito: pg_net é fire-and-forget; falha fica logada, sem retry-storm.
    return json({ error: String(err) }, 200);
  }
}));
