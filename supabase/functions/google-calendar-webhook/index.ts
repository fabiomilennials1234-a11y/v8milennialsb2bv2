/**
 * google-calendar-webhook
 *
 * Endpoint público que recebe push notifications do Google Calendar.
 * Quando um evento é criado/modificado/deletado no Google Calendar de um usuário,
 * o Google notifica este endpoint, que:
 *
 * 1. Identifica o usuário pelo X-Goog-Channel-ID
 * 2. Busca o evento alterado na Google Calendar API
 * 3. Atualiza o cache (google_calendar_events_cache)
 * 4. Se o evento tiver lead_id nos extendedProperties, atualiza compromisso_date no lead
 * 5. Renova o watch channel se próximo do vencimento
 *
 * Google envia headers:
 *   X-Goog-Channel-ID     → nosso channel_id (UUID que registramos)
 *   X-Goog-Resource-State → "sync" | "exists" (modified) | "not_exists" (deleted)
 *   X-Goog-Resource-ID    → resource_id do Google
 *   X-Goog-Channel-Expiration → timestamp de expiração do canal
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getValidAccessToken,
  logCalendarOp,
  registerWatchChannel,
} from "../_shared/google-calendar-utils.ts";
import { logRuntime } from "../_shared/logger.ts";
import { withSentry } from '../_shared/sentry.ts';
import { getPipeEntry, upsertPipeEntry, updatePipeEntryById } from "../_shared/pipeline-adapter.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(withSentry('google-calendar-webhook', async (req) => {
  // Google usa POST para notificações
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const channelId     = req.headers.get("X-Goog-Channel-ID");
    const resourceState = req.headers.get("X-Goog-Resource-State");
    const resourceId    = req.headers.get("X-Goog-Resource-ID");
    const expirationMs  = req.headers.get("X-Goog-Channel-Expiration");

    // Responde 200 imediatamente (Google exige resposta rápida)
    // O processamento continua assincronamente
    processNotification({
      channelId,
      resourceState,
      resourceId,
      expirationMs,
    }).then(() => {
      logRuntime({
        module: "calendar",
        action: "sync",
        status: "success",
        triggeredBy: "system",
        payloadSnapshot: { channelId, resourceState },
      });
    }).catch((err) => {
      console.error("[google-calendar-webhook] Erro no processamento:", err);
      logRuntime({
        module: "calendar",
        action: "sync",
        status: "error",
        errorMessage: String(err),
        triggeredBy: "system",
        payloadSnapshot: { channelId, resourceState },
      });
    });

    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("[google-calendar-webhook] Erro:", err);

    await logRuntime({
      module: "calendar",
      action: "sync",
      status: "error",
      errorMessage: String(err),
      triggeredBy: "system",
    });

    return new Response(null, { status: 200 }); // Sempre 200 para o Google
  }
}));

// ─── Processamento assíncrono ─────────────────────────────────────────────────

async function processNotification(params: {
  channelId: string | null;
  resourceState: string | null;
  resourceId: string | null;
  expirationMs: string | null;
}): Promise<void> {
  const { channelId, resourceState, expirationMs } = params;

  if (!channelId) return;

  // "sync" é apenas uma confirmação de registro — não há evento para processar
  if (resourceState === "sync") {
    console.log("[google-calendar-webhook] Canal registrado:", channelId);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Busca o canal e o usuário associado
  const { data: channel } = await supabase
    .from("google_calendar_watch_channels")
    .select("user_id, organization_id")
    .eq("channel_id", channelId)
    .eq("is_active", true)
    .maybeSingle();

  if (!channel) {
    console.warn("[google-calendar-webhook] Canal não encontrado:", channelId);
    return;
  }

  const { user_id: userId, organization_id: orgId } = channel;

  // Obtém access token válido
  const tokenData = await getValidAccessToken(userId, supabase);
  if (!tokenData) {
    console.warn("[google-calendar-webhook] Sem token para usuário:", userId);
    return;
  }

  // Busca eventos modificados recentemente (últimos 5 minutos)
  const timeMin = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const eventsRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `updatedMin=${encodeURIComponent(timeMin)}&singleEvents=true&maxResults=50`,
    { headers: { Authorization: `Bearer ${tokenData.accessToken}` } }
  );

  if (!eventsRes.ok) {
    console.error("[google-calendar-webhook] Erro ao buscar eventos:", await eventsRes.text());
    return;
  }

  const data = await eventsRes.json();
  const events = (data.items as Array<Record<string, unknown>>) ?? [];

  for (const event of events) {
    await processEvent(supabase, userId, orgId, event);
  }

  // Verifica se o canal está próximo do vencimento (menos de 2 dias)
  if (expirationMs) {
    const expirationTs = parseInt(expirationMs.replace(/[^0-9]/g, ""));
    const twoDaysMs    = 2 * 24 * 60 * 60 * 1000;

    if (expirationTs - Date.now() < twoDaysMs) {
      console.log("[google-calendar-webhook] Renovando canal próximo do vencimento:", channelId);
      await registerWatchChannel(userId, orgId, tokenData.accessToken, supabase);
    }
  }
}

// ─── Processa um evento individual ───────────────────────────────────────────

async function processEvent(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  orgId: string,
  event: Record<string, unknown>
): Promise<void> {
  const eventId     = event.id as string;
  const eventStatus = (event.status as string) ?? "confirmed";

  // Extrai meet link
  const meetLink =
    (event.conferenceData as Record<string, unknown> | undefined)?.entryPoints
      ? ((
          (event.conferenceData as Record<string, unknown>)
            .entryPoints as Array<Record<string, unknown>>
        ).find((ep) => ep.entryPointType === "video")?.uri as string | undefined) ?? null
      : (event.hangoutLink as string | null | undefined) ?? null;

  // Upsert no cache
  const startDateTime =
    (event.start as Record<string, string>)?.dateTime ??
    (event.start as Record<string, string>)?.date;
  const endDateTime =
    (event.end as Record<string, string>)?.dateTime ??
    (event.end as Record<string, string>)?.date ?? null;

  if (!startDateTime) return;

  await supabase.from("google_calendar_events_cache").upsert(
    {
      id:                  eventId,
      user_id:             userId,
      organization_id:     orgId,
      google_calendar_id:  "primary",
      title:               event.summary ?? null,
      description:         event.description ?? null,
      location:            event.location ?? null,
      start_at:            startDateTime,
      end_at:              endDateTime,
      all_day:             !(event.start as Record<string, string>)?.dateTime,
      meet_link:           meetLink,
      attendees:           event.attendees ?? [],
      google_event_status: eventStatus,
      origin:              "google",
      synced_at:           new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  // Verifica se o evento tem lead vinculado (via extendedProperties)
  const privateProps =
    (event.extendedProperties as Record<string, Record<string, string>> | undefined)
      ?.private ?? {};

  const leadId = privateProps.lead_id;
  if (!leadId) return;

  // Atualiza lead_id no cache
  await supabase
    .from("google_calendar_events_cache")
    .update({ lead_id: leadId })
    .eq("id", eventId);

  // Se o evento foi cancelado/deletado, limpa o compromisso_date do lead
  if (eventStatus === "cancelled") {
    await supabase
      .from("leads")
      .update({ compromisso_date: null })
      .eq("id", leadId);

    await logCalendarOp(supabase, {
      userId,
      operation: "sync",
      status: "success",
      googleEventId: eventId,
      localReferenceId: leadId,
      localReferenceType: "lead",
      initiatedBy: "system",
      responsePayload: { action: "cleared_compromisso_date", lead_id: leadId },
    });
    return;
  }

  // Atualiza compromisso_date no lead com a data do evento
  const { error: updateError } = await supabase
    .from("leads")
    .update({ compromisso_date: startDateTime })
    .eq("id", leadId);

  if (updateError) {
    console.error("[google-calendar-webhook] Erro ao atualizar lead:", updateError);
    return;
  }

  // Atualiza meet_link no pipeline_entries (confirmacao) se houver
  if (meetLink) {
    const existing = await getPipeEntry(supabase, leadId, orgId, "confirmacao");
    if (existing) {
      await updatePipeEntryById(supabase, existing.id, {
        metadata: { meet_link: meetLink },
      });
    } else {
      await upsertPipeEntry(supabase, {
        leadId,
        orgId,
        slug: "confirmacao",
        stageKey: "reuniao_marcada",
        metadata: { meet_link: meetLink },
      });
    }
  }

  await logCalendarOp(supabase, {
    userId,
    operation: "sync",
    status: "success",
    googleEventId: eventId,
    localReferenceId: leadId,
    localReferenceType: "lead",
    initiatedBy: "system",
    responsePayload: {
      action: "updated_compromisso_date",
      lead_id: leadId,
      new_date: startDateTime,
      meet_link: meetLink,
    },
  });
}
