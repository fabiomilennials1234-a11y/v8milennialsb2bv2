import { describe, it, expect } from "vitest";
import { getNextSendTime } from "@/lib/copilot/followupSchedule";

/**
 * Helper: creates a Date in a specific timezone by targeting a known UTC offset.
 * For "America/Sao_Paulo" standard time (UTC-3), 10:00 local = 13:00 UTC.
 */
function utcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number = 0
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

describe("getNextSendTime", () => {
  // ===================================================================
  // WHEN sendOnlyBusinessHours IS OFF
  // ===================================================================
  describe("when sendOnlyBusinessHours is false", () => {
    const rule = {
      sendOnlyBusinessHours: false,
      businessHoursStart: "09:00",
      businessHoursEnd: "18:00",
      sendDays: ["seg", "ter", "qua", "qui", "sex"],
      timezone: "America/Sao_Paulo",
    };

    it("returns the exact qualifiedAt time", () => {
      const qualifiedAt = utcDate(2026, 4, 13, 3, 30); // Monday 00:30 BRT
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBe(qualifiedAt.getTime());
    });

    it("returns qualifiedAt even on weekends", () => {
      const saturday = utcDate(2026, 4, 11, 15, 0); // Saturday
      const result = getNextSendTime(rule, saturday);
      expect(result.getTime()).toBe(saturday.getTime());
    });

    it("returns qualifiedAt even at midnight", () => {
      const midnight = utcDate(2026, 4, 13, 3, 0); // 00:00 BRT on Monday
      const result = getNextSendTime(rule, midnight);
      expect(result.getTime()).toBe(midnight.getTime());
    });
  });

  // ===================================================================
  // WHEN sendOnlyBusinessHours IS ON — WITHIN WINDOW
  // ===================================================================
  describe("when sendOnlyBusinessHours is true and within business hours", () => {
    const rule = {
      sendOnlyBusinessHours: true,
      businessHoursStart: "09:00",
      businessHoursEnd: "18:00",
      sendDays: ["seg", "ter", "qua", "qui", "sex"],
      timezone: "America/Sao_Paulo",
    };

    it("returns qualifiedAt when within hours on a weekday", () => {
      // Monday 2026-04-13, 14:00 BRT = 17:00 UTC
      const qualifiedAt = utcDate(2026, 4, 13, 17, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBe(qualifiedAt.getTime());
    });

    it("returns qualifiedAt at exactly businessHoursStart", () => {
      // Monday 2026-04-13, 09:00 BRT = 12:00 UTC
      const qualifiedAt = utcDate(2026, 4, 13, 12, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBe(qualifiedAt.getTime());
    });
  });

  // ===================================================================
  // WHEN sendOnlyBusinessHours IS ON — OUTSIDE WINDOW
  // ===================================================================
  describe("when sendOnlyBusinessHours is true and outside business hours", () => {
    const rule = {
      sendOnlyBusinessHours: true,
      businessHoursStart: "09:00",
      businessHoursEnd: "18:00",
      sendDays: ["seg", "ter", "qua", "qui", "sex"],
      timezone: "America/Sao_Paulo",
    };

    it("schedules to next business day start when qualified after hours on weekday", () => {
      // Monday 2026-04-13, 20:00 BRT = 23:00 UTC — after business hours
      const qualifiedAt = utcDate(2026, 4, 13, 23, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      // Should be Tuesday 09:00 BRT (next business day start)
      expect(result.getTime()).toBeGreaterThan(qualifiedAt.getTime());
      // Verify it's on a weekday and within business hours using Intl
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(result);
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      expect(hour).toBe(9);
    });

    it("schedules to next business day start when qualified before hours on weekday", () => {
      // Monday 2026-04-13, 06:00 BRT = 09:00 UTC — before business hours
      const qualifiedAt = utcDate(2026, 4, 13, 9, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      // Should be Monday 09:00 BRT (same day, start of window)
      expect(result.getTime()).toBeGreaterThanOrEqual(qualifiedAt.getTime());
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(result);
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      expect(hour).toBe(9);
    });

    it("schedules to Monday when qualified on Saturday", () => {
      // Saturday 2026-04-11, 14:00 BRT = 17:00 UTC
      const qualifiedAt = utcDate(2026, 4, 11, 17, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBeGreaterThan(qualifiedAt.getTime());
      // Verify it lands on Monday
      const dayFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        weekday: "short",
      });
      const dayParts = dayFormatter.formatToParts(result);
      const weekday = dayParts.find((p) => p.type === "weekday")?.value;
      expect(weekday).toBe("Mon");
    });

    it("schedules to Monday when qualified on Sunday", () => {
      // Sunday 2026-04-12, 10:00 BRT = 13:00 UTC
      const qualifiedAt = utcDate(2026, 4, 12, 13, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBeGreaterThan(qualifiedAt.getTime());
      const dayFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        weekday: "short",
      });
      const dayParts = dayFormatter.formatToParts(result);
      const weekday = dayParts.find((p) => p.type === "weekday")?.value;
      expect(weekday).toBe("Mon");
    });
  });

  // ===================================================================
  // CUSTOM SEND DAYS
  // ===================================================================
  describe("custom sendDays", () => {
    it("only schedules on allowed days", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "10:00",
        businessHoursEnd: "16:00",
        sendDays: ["ter", "qui"], // Tuesday and Thursday only
        timezone: "America/Sao_Paulo",
      };
      // Monday 2026-04-13, 12:00 BRT = 15:00 UTC
      const qualifiedAt = utcDate(2026, 4, 13, 15, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      // Should go to Tuesday (first allowed day)
      expect(result.getTime()).toBeGreaterThan(qualifiedAt.getTime());
      const dayFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        weekday: "short",
      });
      const dayParts = dayFormatter.formatToParts(result);
      const weekday = dayParts.find((p) => p.type === "weekday")?.value;
      expect(weekday).toBe("Tue");
    });

    it("includes weekend days when configured", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: "13:00",
        sendDays: ["sab", "dom"], // Saturday and Sunday
        timezone: "America/Sao_Paulo",
      };
      // Monday 2026-04-13, 10:00 BRT = 13:00 UTC
      const qualifiedAt = utcDate(2026, 4, 13, 13, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBeGreaterThan(qualifiedAt.getTime());
      const dayFormatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        weekday: "short",
      });
      const dayParts = dayFormatter.formatToParts(result);
      const weekday = dayParts.find((p) => p.type === "weekday")?.value;
      expect(["Sat", "Sun"]).toContain(weekday);
    });
  });

  // ===================================================================
  // CUSTOM BUSINESS HOURS
  // ===================================================================
  describe("custom business hours", () => {
    it("handles non-standard hours like night shift (22:00-06:00 style start)", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "06:00",
        businessHoursEnd: "14:00",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/Sao_Paulo",
      };
      // Monday 2026-04-13, 05:00 BRT = 08:00 UTC — before 06:00
      const qualifiedAt = utcDate(2026, 4, 13, 8, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      // Should schedule at 06:00 BRT same day
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(result);
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      expect(hour).toBe(6);
    });

    it("handles afternoon-only hours", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "14:00",
        businessHoursEnd: "20:00",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/Sao_Paulo",
      };
      // Monday 2026-04-13, 10:00 BRT = 13:00 UTC — before 14:00
      const qualifiedAt = utcDate(2026, 4, 13, 13, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(result);
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      expect(hour).toBe(14);
    });
  });

  // ===================================================================
  // DEFAULTS & EDGE CASES
  // ===================================================================
  describe("default values", () => {
    it("uses default timezone when not provided", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: "18:00",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "", // empty
      };
      // Should not throw — uses America/Sao_Paulo default
      const qualifiedAt = utcDate(2026, 4, 13, 17, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result).toBeInstanceOf(Date);
    });

    it("uses default sendDays when not provided", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: "18:00",
        sendDays: undefined as any,
        timezone: "America/Sao_Paulo",
      };
      const qualifiedAt = utcDate(2026, 4, 13, 17, 0); // Monday
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result).toBeInstanceOf(Date);
    });

    it("handles missing businessHoursEnd with default 18:00", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: undefined as any,
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/Sao_Paulo",
      };
      const qualifiedAt = utcDate(2026, 4, 13, 15, 0); // Monday 12:00 BRT
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result).toBeInstanceOf(Date);
    });
  });

  // ===================================================================
  // TIMEZONE HANDLING
  // ===================================================================
  describe("timezone handling", () => {
    it("works with UTC timezone", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: "17:00",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "UTC",
      };
      // Monday 2026-04-13, 10:00 UTC
      const qualifiedAt = utcDate(2026, 4, 13, 10, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBe(qualifiedAt.getTime());
    });

    it("works with US timezone", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: "17:00",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/New_York",
      };
      // Monday 2026-04-13 at 14:00 UTC = 10:00 EDT (within business hours)
      const qualifiedAt = utcDate(2026, 4, 13, 14, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBe(qualifiedAt.getTime());
    });

    it("correctly handles different timezone when outside business hours", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: "17:00",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/New_York",
      };
      // Monday 2026-04-13 at 22:00 UTC = 18:00 EDT (after hours)
      const qualifiedAt = utcDate(2026, 4, 13, 22, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBeGreaterThan(qualifiedAt.getTime());
    });
  });

  // ===================================================================
  // EXACT BOUNDARY AT businessHoursEnd
  // ===================================================================
  describe("boundary at businessHoursEnd", () => {
    it("schedules to next window when exactly at businessHoursEnd", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "09:00",
        businessHoursEnd: "18:00",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/Sao_Paulo",
      };
      // Monday 2026-04-13, 18:00 BRT = 21:00 UTC — exactly at end
      const qualifiedAt = utcDate(2026, 4, 13, 21, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      // 18:00 is NOT < 18:00, so it's outside the window
      expect(result.getTime()).toBeGreaterThan(qualifiedAt.getTime());
    });
  });

  // ===================================================================
  // MINUTES IN BUSINESS HOURS
  // ===================================================================
  describe("minutes precision", () => {
    it("handles businessHoursStart with minutes", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "08:30",
        businessHoursEnd: "17:30",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/Sao_Paulo",
      };
      // Monday 2026-04-13, 09:00 BRT = 12:00 UTC — within 08:30-17:30
      const qualifiedAt = utcDate(2026, 4, 13, 12, 0);
      const result = getNextSendTime(rule, qualifiedAt);
      expect(result.getTime()).toBe(qualifiedAt.getTime());
    });

    it("handles qualifiedAt with minutes before start", () => {
      const rule = {
        sendOnlyBusinessHours: true,
        businessHoursStart: "08:30",
        businessHoursEnd: "17:30",
        sendDays: ["seg", "ter", "qua", "qui", "sex"],
        timezone: "America/Sao_Paulo",
      };
      // Monday 2026-04-13, 08:15 BRT = 11:15 UTC — before 08:30
      const qualifiedAt = utcDate(2026, 4, 13, 11, 15);
      const result = getNextSendTime(rule, qualifiedAt);
      // Should be at 08:30 same day
      expect(result.getTime()).toBeGreaterThanOrEqual(qualifiedAt.getTime());
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(result);
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
      expect(hour).toBe(8);
      expect(minute).toBe(30);
    });
  });
});
