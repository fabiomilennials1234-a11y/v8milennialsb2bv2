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

// proposal_no_reply enabled with a 24h delay + the Org's own stage mapping.
// Stage keys are per-Organization (Milennials renamed theirs), so the trigger
// stage is config, never a hardcoded canonical key.
const PROPOSAL_ENABLED: EnabledSituation[] = [
  { situationId: "proposal_no_reply", delayHours: 24, delayMinutes: 0, triggerStageKeys: ["enviada"] },
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

  // RED→GREEN 3 — stage left the trigger set (e.g. won/lost): situation resolved
  it("is NOT eligible when the stage is no longer in the trigger set", () => {
    const lead: SituationLeadState = {
      propostasStage: "vendido", // not in triggerStageKeys → situation no longer holds
      lastOutboundAt: "2026-06-07T08:00:00Z",
      lastInboundAt: null,
    };

    const result = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW });

    expect(result.eligible).toBe(false);
  });

  // RED→GREEN — per-org stage mapping: a custom stage_key fires (not hardcoded)
  it("fires on the Org's own custom stage_key, not a canonical one", () => {
    const milennials: EnabledSituation[] = [
      { situationId: "proposal_no_reply", delayHours: 24, delayMinutes: 0, triggerStageKeys: ["r2_fechamento", "prioridade"] },
    ];
    const lead: SituationLeadState = {
      propostasStage: "r2_fechamento", // Milennials' stage, no 'enviada' exists
      lastOutboundAt: "2026-06-07T08:00:00Z",
      lastInboundAt: null,
    };

    const result = resolveSituation({ enabled: milennials, lead, now: NOW });

    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.situationId).toBe("proposal_no_reply");
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

  // RED→GREEN 6 — ignoreDelay: once a cadence is running, the Stepper owns
  // timing; the resolver only confirms the situation still structurally holds.
  it("is eligible with ignoreDelay even before the initial delay elapses", () => {
    const lead: SituationLeadState = {
      propostasStage: "enviada",
      lastOutboundAt: "2026-06-08T11:30:00Z", // 30min ago, delay is 24h
      lastInboundAt: null,
    };

    const eager = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW });
    expect(eager.eligible).toBe(false); // initial-delay gate still active

    const running = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW, ignoreDelay: true });
    expect(running.eligible).toBe(true); // structural match, timing deferred to Stepper
  });

  // RED→GREEN 7 — ignoreDelay must NOT bypass the structural guards
  it("is NOT eligible with ignoreDelay when the situation no longer holds", () => {
    const lead: SituationLeadState = {
      propostasStage: "vendido", // situation resolved
      lastOutboundAt: "2026-06-07T08:00:00Z",
      lastInboundAt: null,
    };

    const result = resolveSituation({ enabled: PROPOSAL_ENABLED, lead, now: NOW, ignoreDelay: true });
    expect(result.eligible).toBe(false);
  });
});

describe("resolveSituation — Oportunidades situations", () => {
  const en = (situationId: string, keys: string[], h = 24): EnabledSituation[] =>
    [{ situationId: situationId as EnabledSituation["situationId"], delayHours: h, delayMinutes: 0, triggerStageKeys: keys }];

  it("new_lead_no_reply fires for an approached Lead who never replied", () => {
    const lead: SituationLeadState = {
      pipeWhatsappStage: "novo",
      lastOutboundAt: "2026-06-06T08:00:00Z",
      lastInboundAt: null, // never replied
    };
    const r = resolveSituation({ enabled: en("new_lead_no_reply", ["novo"]), lead, now: NOW });
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.situationId).toBe("new_lead_no_reply");
  });

  it("new_lead_no_reply does NOT fire once the Lead has ever replied", () => {
    const lead: SituationLeadState = {
      pipeWhatsappStage: "novo",
      lastOutboundAt: "2026-06-06T08:00:00Z",
      lastInboundAt: "2026-06-05T08:00:00Z", // replied at some point
    };
    const r = resolveSituation({ enabled: en("new_lead_no_reply", ["novo"]), lead, now: NOW });
    expect(r.eligible).toBe(false);
  });

  it("cold_reengage fires for a Lead parked in a nurture stage, our msg last", () => {
    const lead: SituationLeadState = {
      pipeWhatsappStage: "nutricao_infinita",
      lastOutboundAt: "2026-06-01T08:00:00Z",
      lastInboundAt: "2026-05-20T08:00:00Z",
    };
    const r = resolveSituation({ enabled: en("cold_reengage", ["nutricao_infinita", "em_andamento"]), lead, now: NOW });
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.situationId).toBe("cold_reengage");
  });

  it("cold_reengage does NOT fire for a lead who never replied (that is new_lead)", () => {
    const lead: SituationLeadState = {
      pipeWhatsappStage: "em_andamento",
      lastOutboundAt: "2026-06-01T08:00:00Z",
      lastInboundAt: null, // never engaged → belongs to new_lead, not cold_reengage
    };
    const r = resolveSituation({ enabled: en("cold_reengage", ["em_andamento"]), lead, now: NOW });
    expect(r.eligible).toBe(false);
  });

  it("no_show_rebook fires from the no-show stage regardless of who messaged last", () => {
    const lead: SituationLeadState = {
      pipeWhatsappStage: "nao_compareceu",
      stageChangedAt: "2026-06-06T08:00:00Z",
      lastInboundAt: "2026-06-07T09:00:00Z", // lead messaged last — still proactive
    };
    const r = resolveSituation({ enabled: en("no_show_rebook", ["nao_compareceu"]), lead, now: NOW });
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.situationId).toBe("no_show_rebook");
  });

  it("meeting_reminder fires inside the window before the meeting, not after", () => {
    const enabled = en("meeting_reminder", ["agendado"], 24); // 24h before
    const before: SituationLeadState = { pipeWhatsappStage: "agendado", meetingDate: "2026-06-08T20:00:00Z" }; // 8h away
    const after: SituationLeadState = { pipeWhatsappStage: "agendado", meetingDate: "2026-06-08T06:00:00Z" }; // already passed

    expect(resolveSituation({ enabled, lead: before, now: NOW }).eligible).toBe(true);
    expect(resolveSituation({ enabled, lead: after, now: NOW }).eligible).toBe(false);
  });

  it("meeting_reminder does NOT fire while the meeting is further than the window", () => {
    const enabled = en("meeting_reminder", ["agendado"], 24);
    const farAway: SituationLeadState = { pipeWhatsappStage: "agendado", meetingDate: "2026-06-12T12:00:00Z" }; // 4 days
    expect(resolveSituation({ enabled, lead: farAway, now: NOW }).eligible).toBe(false);
  });

  it("dormant_winback fires by carteira segment + days since last order", () => {
    const enabled = en("dormant_winback", ["dormindo", "resgate"], 720); // 30 days
    const lead: SituationLeadState = { carteiraSegment: "dormindo", lastOrderAt: "2026-04-01T08:00:00Z" }; // >30d
    const r = resolveSituation({ enabled, lead, now: NOW });
    expect(r.eligible).toBe(true);
    if (r.eligible) expect(r.situationId).toBe("dormant_winback");
  });
});
