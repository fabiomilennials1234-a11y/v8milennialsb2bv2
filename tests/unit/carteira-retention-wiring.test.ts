// @vitest-environment node
/**
 * Unit tests for retention gate logic — shouldFireRetentionTrigger.
 *
 * Pure function, no DB deps. Validates that copilot retention config
 * (auto_approach, strategic_alert_only, max_frequency_days) correctly
 * gates the recompra_atrasada trigger in calculate-portfolio-health.
 */

import { describe, it, expect } from "vitest";
import {
  shouldFireRetentionTrigger,
  type RetentionAgent,
} from "../../supabase/functions/_shared/retention-gate.ts";

const NOW = new Date("2026-05-18T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("shouldFireRetentionTrigger", () => {
  // ─── Cycle 1: No retention agent → fallback fire ────────────────────────
  describe("no retention agent (fallback)", () => {
    it("returns fire=true when no retention agent exists", () => {
      const result = shouldFireRetentionTrigger({
        retentionAgent: null,
        alertSeverity: "warning",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("no_retention_agent");
    });
  });

  // ─── Cycle 2: auto_approach=false → suppress ───────────────────────────
  describe("auto_approach disabled", () => {
    it("returns fire=false when auto_approach is false", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: false },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("auto_approach_disabled");
    });
  });

  // ─── Cycle 3: auto_approach=true → fire ────────────────────────────────
  describe("auto_approach enabled", () => {
    it("returns fire=true when auto_approach is true", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "warning",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });
  });

  // ─── Cycle 4: strategic_alert_only + low severity → suppress ───────────
  describe("strategic_alert_only with low severity", () => {
    it("returns fire=false when strategic_alert_only=true and severity=low", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, strategic_alert_only: true },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "low",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("strategic_alert_only");
    });

    it("returns fire=false when strategic_alert_only=true and severity=medium", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, strategic_alert_only: true },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "medium",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("strategic_alert_only");
    });

    it("returns fire=false for warning severity too", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, strategic_alert_only: true },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "warning",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("strategic_alert_only");
    });

    it("returns fire=false for info severity", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, strategic_alert_only: true },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "info",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("strategic_alert_only");
    });
  });

  // ─── Cycle 5: strategic_alert_only + high/critical → fire ──────────────
  describe("strategic_alert_only with high/critical severity", () => {
    it("returns fire=true when severity=high", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, strategic_alert_only: true },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "high",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });

    it("returns fire=true when severity=critical", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, strategic_alert_only: true },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });
  });

  // ─── Cycle 6: max_frequency_days → within window → suppress ────────────
  describe("max_frequency_days within window", () => {
    it("returns fire=false when last dispatch was 3 days ago and max_frequency=7", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, max_frequency_days: 7 },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: daysAgo(3),
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("frequency_limit");
    });

    it("returns fire=false at exact boundary (6.9 days for max 7)", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, max_frequency_days: 7 },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: new Date(NOW.getTime() - 6.9 * 24 * 60 * 60 * 1000),
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("frequency_limit");
    });
  });

  // ─── Cycle 7: max_frequency_days → outside window → fire ───────────────
  describe("max_frequency_days outside window", () => {
    it("returns fire=true when last dispatch was 10 days ago and max_frequency=7", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, max_frequency_days: 7 },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: daysAgo(10),
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });

    it("returns fire=true when no previous dispatch exists", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, max_frequency_days: 7 },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: null,
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("handles undefined retention_config fields gracefully", () => {
      const agent: RetentionAgent = {
        retention_config: {},
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "warning",
        lastDispatchAt: null,
        now: NOW,
      });
      // auto_approach undefined (not explicitly false) → pass
      // strategic_alert_only undefined → pass
      // max_frequency_days undefined → pass
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });

    it("auto_approach=false takes precedence over everything", () => {
      const agent: RetentionAgent = {
        retention_config: {
          auto_approach: false,
          strategic_alert_only: false,
          max_frequency_days: 0,
        },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: daysAgo(100),
        now: NOW,
      });
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("auto_approach_disabled");
    });

    it("max_frequency_days=0 is treated as no limit", () => {
      const agent: RetentionAgent = {
        retention_config: { auto_approach: true, max_frequency_days: 0 },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "warning",
        lastDispatchAt: daysAgo(1),
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });

    it("all gates combined: auto_approach=true, strategic_alert_only=true, severity=critical, within frequency", () => {
      const agent: RetentionAgent = {
        retention_config: {
          auto_approach: true,
          strategic_alert_only: true,
          max_frequency_days: 14,
        },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "critical",
        lastDispatchAt: daysAgo(3),
        now: NOW,
      });
      // severity passes, but frequency blocks
      expect(result.fire).toBe(false);
      expect(result.reason).toBe("frequency_limit");
    });

    it("all gates pass: auto_approach=true, strategic_alert_only=true, severity=high, outside frequency", () => {
      const agent: RetentionAgent = {
        retention_config: {
          auto_approach: true,
          strategic_alert_only: true,
          max_frequency_days: 7,
        },
      };
      const result = shouldFireRetentionTrigger({
        retentionAgent: agent,
        alertSeverity: "high",
        lastDispatchAt: daysAgo(10),
        now: NOW,
      });
      expect(result.fire).toBe(true);
      expect(result.reason).toBe("retention_checks_passed");
    });
  });
});
