/**
 * Google Calendar — Event CRUD helpers (primary calendar).
 *
 * Funções puras de montagem de payload + wrappers de fetch para
 * /calendars/primary/events. Sem dependência do Supabase client — testáveis
 * isoladamente. Consumido pela edge function `meeting-calendar-sync`.
 *
 * NOTA: mantido FORA de google-calendar-utils.ts de propósito — aquele arquivo
 * tem gate de cobertura per-file de 100% linhas; helpers novos vivem aqui sob o
 * piso global.
 */

const CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Google Calendar colorId canônico (1–11) → hex. Inverso usado abaixo. */
const HEX_TO_GOOGLE_COLOR_ID: Record<string, string> = {
  "#7986CB": "1",
  "#33B679": "2",
  "#8E24AA": "3",
  "#E67C73": "4",
  "#F6BF26": "5",
  "#F4511E": "6",
  "#039BE5": "7",
  "#3F51B5": "8",
  "#0B8043": "9",
  "#D50000": "10",
  "#616161": "11",
};

export interface MeetingEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  start_at: string; // ISO 8601
  end_at: string; // ISO 8601
  all_day?: boolean | null;
  timezone?: string;
  color?: string | null; // hex (#RRGGBB) — best-effort → colorId
  withMeet?: boolean; // gerar Google Meet (só create)
  extendedPrivate?: Record<string, string>;
}

export interface CreatedGoogleEvent {
  id: string;
  meetLink: string | null;
  htmlLink: string | null;
}

/** Extrai o link do Meet de um evento retornado pela API. */
export function extractMeetLink(ev: Record<string, unknown>): string | null {
  const conf = ev?.conferenceData as Record<string, unknown> | undefined;
  const entryPoints = conf?.entryPoints as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find((e) => e.entryPointType === "video");
    if (video?.uri) return video.uri as string;
  }
  return (ev?.hangoutLink as string | null | undefined) ?? null;
}

/** Parte de data (YYYY-MM-DD) de um ISO, em UTC. */
function isoDatePart(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Mapeia um meeting interno → corpo de evento do Google Calendar.
 *
 * - all_day → { date } (fim exclusivo, garante end > start)
 * - timed   → { dateTime, timeZone }
 * - color (hex) → colorId quando bate na paleta canônica; senão omite
 * - withMeet → conferenceData.createRequest (hangoutsMeet)
 * - extendedPrivate → extendedProperties.private (lead_id, meeting_id, system)
 */
export function buildGoogleEventBody(input: MeetingEventInput): Record<string, unknown> {
  const tz = input.timezone ?? "America/Sao_Paulo";
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? null,
    location: input.location ?? null,
  };

  if (input.all_day) {
    const startDate = isoDatePart(input.start_at);
    let endDate = isoDatePart(input.end_at);
    // Google trata o fim de all-day como exclusivo; garante end > start.
    if (endDate <= startDate) {
      const d = new Date(`${startDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      endDate = d.toISOString().slice(0, 10);
    }
    body.start = { date: startDate };
    body.end = { date: endDate };
  } else {
    body.start = { dateTime: input.start_at, timeZone: tz };
    body.end = { dateTime: input.end_at, timeZone: tz };
  }

  const colorId = input.color
    ? HEX_TO_GOOGLE_COLOR_ID[input.color.toUpperCase()]
    : undefined;
  if (colorId) body.colorId = colorId;

  if (input.withMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  if (input.extendedPrivate && Object.keys(input.extendedPrivate).length > 0) {
    body.extendedProperties = { private: input.extendedPrivate };
  }

  return body;
}

/** Cria um evento no calendário primário. Retorna id + meet link + html link. */
export async function createGoogleEvent(
  accessToken: string,
  input: MeetingEventInput,
): Promise<CreatedGoogleEvent> {
  const body = buildGoogleEventBody(input);
  const qs = input.withMeet ? "?conferenceDataVersion=1" : "";

  const res = await fetch(`${CAL_BASE}${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Google create event falhou (${res.status}): ${await res.text()}`);
  }

  const ev = (await res.json()) as Record<string, unknown>;
  return {
    id: ev.id as string,
    meetLink: extractMeetLink(ev),
    htmlLink: (ev.htmlLink as string | null | undefined) ?? null,
  };
}

/** Atualiza um evento existente (PATCH). Nunca regenera Meet. */
export async function updateGoogleEvent(
  accessToken: string,
  eventId: string,
  input: MeetingEventInput,
): Promise<void> {
  const body = buildGoogleEventBody({ ...input, withMeet: false });

  const res = await fetch(`${CAL_BASE}/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Google update event falhou (${res.status}): ${await res.text()}`);
  }
}

/** Remove um evento. Trata 404/410 (já removido) como sucesso. */
export async function deleteGoogleEvent(
  accessToken: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(`${CAL_BASE}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google delete event falhou (${res.status}): ${await res.text()}`);
  }
}
