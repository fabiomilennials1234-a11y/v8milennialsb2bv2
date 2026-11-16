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
 *    — SÓ se o lead pertence à org do canal. O lead_id vem do evento, e o evento
 *    é escrito por quem é dono da agenda: sem esse filtro, qualquer usuário com
 *    Google conectado alteraria leads de outra org criando eventos na própria.
 * 5. Renova o watch channel se próximo do vencimento — só o canal ATIVO, pela
 *    expiration do banco, com compare-and-swap (ver replace_google_watch_channel)
 *
 * Google envia headers:
 *   X-Goog-Channel-ID     → nosso channel_id (UUID que registramos)
 *   X-Goog-Resource-State → "sync" | "exists" (modified) | "not_exists" (deleted)
 *   X-Goog-Resource-ID    → resource_id do Google
 *   X-Goog-Channel-Expiration → timestamp de expiração do canal
 *   X-Goog-Channel-Token  → token que registramos no events/watch; comparado
 *                           com channel_token_hash (NULL = canal legado, aceito
 *                           até a renovação)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getValidAccessToken,
  isWatchChannelTokenValid,
  logCalendarOp,
  registerWatchChannel,
  watchChannelNeedsRenewal,
} from "../_shared/google-calendar-utils.ts";
import { logRuntime } from "../_shared/logger.ts";
import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { isFeatureFlagEnabled } from "../_shared/feature-flags.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getPipeEntry, upsertPipeEntry, updatePipeEntryById } from "../_shared/pipeline-adapter.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(withErrorBoundary('google-calendar-webhook', async (req) => {
  // Google usa POST para notificações
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: withSecurityHeaders({}) });
  }

  try {
    const channelId     = req.headers.get("X-Goog-Channel-ID");
    const resourceState = req.headers.get("X-Goog-Resource-State");
    const channelToken  = req.headers.get("X-Goog-Channel-Token");

    // Responde 200 imediatamente (Google exige resposta rápida)
    // O processamento continua assincronamente
    processNotification({
      channelId,
      resourceState,
      channelToken,
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

    return new Response(null, { status: 200, headers: withSecurityHeaders({}) });
  } catch (err) {
    console.error("[google-calendar-webhook] Erro:", err);

    await logRuntime({
      module: "calendar",
      action: "sync",
      status: "error",
      errorMessage: String(err),
      triggeredBy: "system",
    });

    return new Response(null, { status: 200, headers: withSecurityHeaders({}) }); // Sempre 200 para o Google
  }
}));

// ─── Processamento assíncrono ─────────────────────────────────────────────────

async function processNotification(params: {
  channelId: string | null;
  resourceState: string | null;
  channelToken: string | null;
}): Promise<void> {
  const { channelId, resourceState, channelToken } = params;

  if (!channelId) return;

  // "sync" é apenas uma confirmação de registro — não há evento para processar
  if (resourceState === "sync") {
    console.log("[google-calendar-webhook] Canal registrado:", channelId);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Busca o canal e o usuário associado. Canal inativo/desconhecido para AQUI:
  // nada de token nem Google — esse SELECT (channel_id é único) é todo o custo.
  const { data: channel } = await supabase
    .from("google_calendar_watch_channels")
    .select("user_id, organization_id, expiration, channel_token_hash")
    .eq("channel_id", channelId)
    .eq("is_active", true)
    .maybeSingle();

  if (!channel) {
    console.warn("[google-calendar-webhook] Canal não encontrado:", channelId);
    return;
  }

  // Token divergente/ausente num canal que tem hash: notificação forjada (o
  // channel_id sozinho não autentica). Para aqui, antes de token e Google.
  if (!(await isWatchChannelTokenValid(channelToken, channel.channel_token_hash))) {
    console.warn("[google-calendar-webhook] Token do canal inválido:", channelId);
    return;
  }

  const { user_id: userId, organization_id: orgId, expiration } = channel;

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

  // Renova se o canal ATIVO está a menos de 2 dias de expirar (expiration do
  // banco, não do header). channelId vai como expected: compare-and-swap no
  // banco garante que N notificações concorrentes do mesmo canal produzem 1
  // canal novo; os perdedores param o próprio canal no Google.
  if (watchChannelNeedsRenewal(expiration)) {
    console.log("[google-calendar-webhook] Renovando canal próximo do vencimento:", channelId);
    await registerWatchChannel(userId, orgId, tokenData.accessToken, supabase, channelId);
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
    // O id de evento do Google se repete entre participantes (inclusive de
    // orgs diferentes): a chave é (user_id, id), nunca id sozinho.
    { onConflict: "user_id,id" }
  );

  // Verifica se o evento tem lead vinculado (via extendedProperties)
  const privateProps =
    (event.extendedProperties as Record<string, Record<string, string>> | undefined)
      ?.private ?? {};

  const claimedLeadId = privateProps.lead_id;
  if (!claimedLeadId) return;

  // O lead_id é dado do evento — controlado por quem é dono da agenda. Só vale
  // se o lead existe NA ORG DO CANAL; caso contrário nada de lead é tocado
  // (nem o vínculo no cache, nem compromisso_date, nem pipeline).
  const leadId = await resolveLeadInOrg(supabase, claimedLeadId, orgId);
  if (!leadId) {
    console.warn("[google-calendar-webhook] lead_id fora da org do canal, ignorado:", {
      eventId,
      orgId,
    });
    await logCalendarOp(supabase, {
      userId,
      operation: "sync",
      status: "failed",
      googleEventId: eventId,
      initiatedBy: "system",
      errorMessage: "lead_id do evento não pertence à organização do canal",
    });
    return;
  }

  // Atualiza lead_id no cache (só a linha deste usuário)
  await supabase
    .from("google_calendar_events_cache")
    .update({ lead_id: leadId })
    .eq("user_id", userId)
    .eq("id", eventId);

  // Se o evento foi cancelado/deletado, limpa o compromisso_date do lead
  if (eventStatus === "cancelled") {
    await supabase
      .from("leads")
      .update({ compromisso_date: null })
      .eq("id", leadId)
      .eq("organization_id", orgId);

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
    .eq("id", leadId)
    .eq("organization_id", orgId);

  if (updateError) {
    console.error("[google-calendar-webhook] Erro ao atualizar lead:", updateError);
    return;
  }

  // Atualiza meet_link na entry de reunião. Merge ON (ADR-0004): whatsapp:agendado.
  if (meetLink) {
    const useMergedFunnel = await isFeatureFlagEnabled(supabase, orgId, "merged_opportunity_funnel");
    const mSlug: "whatsapp" | "confirmacao" = useMergedFunnel ? "whatsapp" : "confirmacao";
    const mStage = useMergedFunnel ? "agendado" : "reuniao_marcada";

    const existing = await getPipeEntry(supabase, leadId, orgId, mSlug);
    if (existing) {
      await updatePipeEntryById(supabase, existing.id, {
        metadata: { meet_link: meetLink },
      });
    } else {
      await upsertPipeEntry(supabase, {
        leadId,
        orgId,
        slug: mSlug,
        stageKey: mStage,
        metadata: useMergedFunnel
          ? { meet_link: meetLink, confirmation_status: "pendente", is_confirmed: false }
          : { meet_link: meetLink },
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

// ─── Lead da org do canal ────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Devolve o id do lead se ele existe em `orgId`; null caso contrário (lead de
 * outra org, inexistente, ou lead_id malformado — que nem chega ao banco).
 */
async function resolveLeadInOrg(
  supabase: ReturnType<typeof createClient>,
  leadId: string,
  orgId: string,
): Promise<string | null> {
  if (typeof leadId !== "string" || !UUID_RE.test(leadId)) return null;
  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[google-calendar-webhook] Erro ao validar lead:", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}
