/**
 * TDD: Copilot Follow-up — Situation Resolver.
 *
 * Pure function — no DB, no mocks. Decides which canonical Follow-up Situation
 * (CONTEXT.md) applies to a Lead's state and whether its delay has elapsed.
 * Replaces the trigger-blind get_followup_eligible_leads filter.
 *
 * Import target: supabase/functions/_shared/copilot/followup-situations.ts
 */

import { describe, it, expect } from "vitest";
import "../helpers/deno-mock";

import {
  resolveSituation,
  type SituationLeadState,
  type EnabledSituation,
} from "../../supabase/functions/_shared/copilot/followup-situations.ts";

const NOW = new Date("2026-06-08T12:00:00Z");

// proposal_no_reply enabled with a 24h delay — the Org's tuned catalog entry.
const PROPOSAL_ENABLED: EnabledSituation[] = [
  { situationId: "proposal_no_reply", delayHours: 24, delayMinutes: 0 },
];

describe("resolveSituation — proposal_no_reply", () => {
  // RED→GREEN 1 (tracer)
  it("is eligible when proposal is enviada, our message was last, and delay elapsed", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-07T08:00:00Z", // ~28h ago
      lastInboundAt: "2026-06-06T10:00:00Z",  // lead older than our last msg
    };

    const result = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.situationId).toBe("proposal_no_reply");
    }
  });

  // RED→GREEN 2 — lead already replied after our proposal: not our move
  it("is NOT eligible when the lead replied after our last message", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-07T08:00:00Z",
      lastInboundAt: "2026-06-07T10:00:00Z", // lead replied AFTER us
    };

    const result = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW });

    expect(result.eligible).toBe(false);
  });

  // RED→GREEN 3 — proposal closed (vendido): the situation is resolved
  it("is NOT eligible when the proposal reached vendido", () => {
    const lead: SituationLeadState = {
      propostasStage: "vendido",
      lastOutboundAt: "2026-06-07T08:00:00Z",
      lastInboundAt: null,
    };

    const result = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW });

    expect(result.eligible).toBe(false);
  });

  // RED→GREEN 4 — delay not yet elapsed
  it("is NOT eligible before the configured delay elapses", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-08T06:00:00Z", // 6h ago, delay is 24h
      lastInboundAt: null,
    };

    const result = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW });

    expect(result.eligible).toBe(false);
  });

  // RED→GREEN 5 — situation disabled by the Org: never fires, even on a match
  it("is NOT eligible when proposal_no_reply is not enabled", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-07T08:00:00Z",
      lastInboundAt: null,
    };

    const result = resolveSituation({ enabled: [], lead, now: NOW });

    expect(result.eligible).toBe(false);
  });
});
