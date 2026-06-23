/**
 * Tests for _shared/google-calendar-events-api.ts — meeting → Google event
 * mapping (buildGoogleEventBody) + create/update/delete fetch wrappers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  buildGoogleEventBody,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  extractMeetLink,
  type MeetingEventInput,
} from "../../supabase/functions/_shared/google-calendar-events-api";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const baseInput: MeetingEventInput = {
  title: "Reunião X",
  description: "notas",
  location: "Sala 1",
  start_at: "2026-07-01T14:00:00.000Z",
  end_at: "2026-07-01T15:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(okJson({ id: "evt_1" }));
});

describe("buildGoogleEventBody", () => {
  it("monta evento com horário (dateTime + timeZone default São Paulo)", () => {
    const body = buildGoogleEventBody(baseInput) as Record<string, unknown>;
    expect(body.summary).toBe("Reunião X");
    expect(body.description).toBe("notas");
    expect(body.location).toBe("Sala 1");
    expect(body.start).toEqual({
      dateTime: "2026-07-01T14:00:00.000Z",
      timeZone: "America/Sao_Paulo",
    });
    expect(body.end).toEqual({
      dateTime: "2026-07-01T15:00:00.000Z",
      timeZone: "America/Sao_Paulo",
    });
    expect(body.conferenceData).toBeUndefined();
    expect(body.extendedProperties).toBeUndefined();
  });

  it("respeita timezone customizado", () => {
    const body = buildGoogleEventBody({ ...baseInput, timezone: "UTC" }) as Record<
      string,
      { timeZone: string }
    >;
    expect(body.start.timeZone).toBe("UTC");
  });

  it("all_day usa date e garante fim exclusivo quando start=end", () => {
    const body = buildGoogleEventBody({
      ...baseInput,
      all_day: true,
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-01T00:00:00.000Z",
    }) as Record<string, { date: string }>;
    expect(body.start).toEqual({ date: "2026-07-01" });
    expect(body.end).toEqual({ date: "2026-07-02" }); // +1 dia (exclusivo)
  });

  it("all_day mantém fim quando já é posterior ao início", () => {
    const body = buildGoogleEventBody({
      ...baseInput,
      all_day: true,
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-07-03T00:00:00.000Z",
    }) as Record<string, { date: string }>;
    expect(body.start.date).toBe("2026-07-01");
    expect(body.end.date).toBe("2026-07-03");
  });

  it("mapeia cor hex da paleta canônica → colorId", () => {
    const body = buildGoogleEventBody({ ...baseInput, color: "#D50000" }) as Record<
      string,
      unknown
    >;
    expect(body.colorId).toBe("10");
  });

  it("omite colorId para hex fora da paleta", () => {
    const body = buildGoogleEventBody({ ...baseInput, color: "#123456" }) as Record<
      string,
      unknown
    >;
    expect(body.colorId).toBeUndefined();
  });

  it("withMeet adiciona conferenceData createRequest", () => {
    const body = buildGoogleEventBody({ ...baseInput, withMeet: true }) as Record<
      string,
      { createRequest: { conferenceSolutionKey: { type: string }; requestId: string } }
    >;
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(body.conferenceData.createRequest.requestId).toBeTruthy();
  });

  it("extendedPrivate vira extendedProperties.private", () => {
    const body = buildGoogleEventBody({
      ...baseInput,
      extendedPrivate: { system: "v8milennialsb2b", meeting_id: "m1", lead_id: "l1" },
    }) as Record<string, { private: Record<string, string> }>;
    expect(body.extendedProperties.private).toEqual({
      system: "v8milennialsb2b",
      meeting_id: "m1",
      lead_id: "l1",
    });
  });
});

describe("extractMeetLink", () => {
  it("extrai uri do entryPoint de vídeo", () => {
    const link = extractMeetLink({
      conferenceData: {
        entryPoints: [
          { entryPointType: "phone", uri: "tel:+55" },
          { entryPointType: "video", uri: "https://meet.google.com/abc" },
        ],
      },
    });
    expect(link).toBe("https://meet.google.com/abc");
  });

  it("cai pra hangoutLink quando não há entryPoints", () => {
    expect(extractMeetLink({ hangoutLink: "https://meet.google.com/xyz" })).toBe(
      "https://meet.google.com/xyz",
    );
  });

  it("retorna null sem conference nem hangout", () => {
    expect(extractMeetLink({})).toBeNull();
  });
});

describe("createGoogleEvent", () => {
  it("cria evento e retorna id + meetLink + htmlLink", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        id: "evt_42",
        htmlLink: "https://calendar.google.com/evt_42",
        conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/m" }] },
      }),
    );
    const res = await createGoogleEvent("tok", { ...baseInput, withMeet: true });
    expect(res).toEqual({
      id: "evt_42",
      meetLink: "https://meet.google.com/m",
      htmlLink: "https://calendar.google.com/evt_42",
    });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/calendars/primary/events?conferenceDataVersion=1");
    expect((opts as RequestInit).method).toBe("POST");
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer tok");
  });

  it("sem withMeet não anexa conferenceDataVersion", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ id: "evt_7" }));
    const res = await createGoogleEvent("tok", baseInput);
    expect(res.id).toBe("evt_7");
    expect(res.meetLink).toBeNull();
    expect(mockFetch.mock.calls[0][0]).not.toContain("conferenceDataVersion");
  });

  it("lança quando a API falha", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ error: "boom" }, 400));
    await expect(createGoogleEvent("tok", baseInput)).rejects.toThrow("Google create event falhou");
  });
});

describe("updateGoogleEvent", () => {
  it("faz PATCH sem regenerar Meet", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ id: "evt_1" }));
    await updateGoogleEvent("tok", "evt_1", { ...baseInput, withMeet: true });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/calendars/primary/events/evt_1");
    expect((opts as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.conferenceData).toBeUndefined(); // nunca regenera no update
  });

  it("lança quando a API falha", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ error: "x" }, 500));
    await expect(updateGoogleEvent("tok", "evt_1", baseInput)).rejects.toThrow(
      "Google update event falhou",
    );
  });
});

describe("deleteGoogleEvent", () => {
  it("apaga via DELETE", async () => {
    mockFetch.mockResolvedValueOnce(okJson({}, 204));
    await deleteGoogleEvent("tok", "evt_1");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/calendars/primary/events/evt_1");
    expect((opts as RequestInit).method).toBe("DELETE");
  });

  it("tolera 404 e 410 (já removido)", async () => {
    mockFetch.mockResolvedValueOnce(okJson({}, 410));
    await expect(deleteGoogleEvent("tok", "evt_1")).resolves.toBeUndefined();
    mockFetch.mockResolvedValueOnce(okJson({}, 404));
    await expect(deleteGoogleEvent("tok", "evt_2")).resolves.toBeUndefined();
  });

  it("lança em erro real (ex. 500)", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ error: "x" }, 500));
    await expect(deleteGoogleEvent("tok", "evt_1")).rejects.toThrow("Google delete event falhou");
  });
});
