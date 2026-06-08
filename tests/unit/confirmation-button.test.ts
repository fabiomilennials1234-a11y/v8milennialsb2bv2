import { describe, it, expect } from "vitest";
import { resolveConfirmButton } from "@/modules/pipelines/lib/confirmation-button";

const TZ = "America/Sao_Paulo";

describe("resolveConfirmButton", () => {
  it("shows 'Pré-confirmar' (neutral) before the meeting day when pending", () => {
    const btn = resolveConfirmButton({
      meetingDate: "2026-06-12T14:00:00-03:00", // Friday
      confirmationStatus: "pendente",
      now: new Date("2026-06-10T09:00:00-03:00"), // Wednesday
      orgTz: TZ,
    });

    expect(btn).toEqual({
      action: "pre_confirmar",
      label: "Pré-confirmar",
      tone: "neutral",
      disabled: false,
    });
  });

  it("shows 'Definir data' when there is no meeting date", () => {
    const btn = resolveConfirmButton({
      meetingDate: null,
      confirmationStatus: "pendente",
      now: new Date("2026-06-10T09:00:00-03:00"),
      orgTz: TZ,
    });
    expect(btn).toEqual({ action: "definir_data", label: "Definir data", tone: "amber", disabled: false });
  });

  it("flips to 'Confirmar' (green) on the meeting calendar-day in the org timezone", () => {
    const btn = resolveConfirmButton({
      meetingDate: "2026-06-12T16:00:00-03:00", // Friday 16:00
      confirmationStatus: "pendente",
      now: new Date("2026-06-12T08:00:00-03:00"), // same Friday, morning
      orgTz: TZ,
    });
    expect(btn).toEqual({ action: "confirmar", label: "Confirmar", tone: "green", disabled: false });
  });

  it("flips to 'Confirmar' even when already pre-confirmed on the day", () => {
    const btn = resolveConfirmButton({
      meetingDate: "2026-06-12T16:00:00-03:00",
      confirmationStatus: "pre_confirmado",
      now: new Date("2026-06-12T08:00:00-03:00"),
      orgTz: TZ,
    });
    expect(btn.action).toBe("confirmar");
    expect(btn.label).toBe("Confirmar");
  });

  it("shows 'Confirmado' (green, disabled) once confirmed — even on the day", () => {
    const btn = resolveConfirmButton({
      meetingDate: "2026-06-12T16:00:00-03:00",
      confirmationStatus: "confirmado",
      now: new Date("2026-06-12T08:00:00-03:00"),
      orgTz: TZ,
    });
    expect(btn).toEqual({ action: "none", label: "Confirmado", tone: "green", disabled: true });
  });

  it("shows 'Pré-confirmado' (amber) before the day once pre-confirmed", () => {
    const btn = resolveConfirmButton({
      meetingDate: "2026-06-12T16:00:00-03:00",
      confirmationStatus: "pre_confirmado",
      now: new Date("2026-06-10T08:00:00-03:00"),
      orgTz: TZ,
    });
    expect(btn).toEqual({ action: "pre_confirmar", label: "Pré-confirmado", tone: "amber", disabled: false });
  });

  it("uses the org timezone, not UTC, for the calendar-day boundary", () => {
    // Instant is June 12 02:00 UTC = June 11 23:00 in São Paulo (-03) → still the day before.
    const btn = resolveConfirmButton({
      meetingDate: "2026-06-12T16:00:00-03:00",
      confirmationStatus: "pendente",
      now: new Date("2026-06-12T02:00:00Z"),
      orgTz: TZ,
    });
    expect(btn.action).toBe("pre_confirmar"); // not yet the meeting day in org tz
  });
});
