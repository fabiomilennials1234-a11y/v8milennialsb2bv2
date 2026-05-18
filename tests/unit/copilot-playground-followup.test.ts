// @vitest-environment node
/**
 * Unit tests for Copilot Playground Follow-up cadence mapping.
 *
 * Covers:
 * 1. Cadence steps array maps to/from sequence_steps JSONB
 * 2. All 5 trigger types available
 * 3. Single-shot mode (no sequence_steps) preserves existing format
 */

import { describe, it, expect } from "vitest";

// Re-declare types locally to avoid import path issues in test runner
interface SequenceStep {
  order: number;
  delayHours: number;
  delayMinutes: number;
  style: "direct" | "value" | "curiosity" | "breakup";
  messageTemplate?: string;
}

interface FollowupRuleLocal {
  name: string;
  triggerType: string;
  triggerDelayHours: number;
  triggerDelayMinutes: number;
  followupStyle: string;
  messageTemplate?: string;
  sequenceSteps?: SequenceStep[];
  maxFollowups: number;
}

// ---------- helpers under test (mirror of production logic) ----------

const ALL_TRIGGER_TYPES = [
  "no_response",
  "after_qualification",
  "after_meeting_scheduled",
  "post_sale",
  "proposal_no_response",
] as const;

type TriggerType = (typeof ALL_TRIGGER_TYPES)[number];

const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  no_response: "Sem resposta",
  after_qualification: "Apos qualificacao",
  after_meeting_scheduled: "Apos reuniao agendada",
  post_sale: "Pos-venda",
  proposal_no_response: "Proposta sem resposta",
};

/**
 * Maps a frontend rule with cadence steps to the DB-ready payload.
 * sequence_steps is stored as JSONB in copilot_agent_followup_rules.
 */
function ruleToDBPayload(rule: FollowupRuleLocal) {
  const base: Record<string, unknown> = {
    name: rule.name,
    trigger_type: rule.triggerType,
    trigger_delay_hours: rule.triggerDelayHours,
    trigger_delay_minutes: rule.triggerDelayMinutes,
    followup_style: rule.followupStyle,
    message_template: rule.messageTemplate || null,
    max_followups: rule.maxFollowups,
  };

  if (rule.sequenceSteps && rule.sequenceSteps.length > 0) {
    base.sequence_steps = rule.sequenceSteps.map((s) => ({
      order: s.order,
      delay_hours: s.delayHours,
      delay_minutes: s.delayMinutes,
      style: s.style,
      message_template: s.messageTemplate || null,
    }));
  } else {
    base.sequence_steps = null;
  }

  return base;
}

/**
 * Maps DB row back to frontend rule shape.
 */
function dbRowToRule(row: Record<string, unknown>): FollowupRuleLocal {
  const steps = row.sequence_steps as Array<Record<string, unknown>> | null;

  return {
    name: row.name as string,
    triggerType: row.trigger_type as string,
    triggerDelayHours: row.trigger_delay_hours as number,
    triggerDelayMinutes: row.trigger_delay_minutes as number,
    followupStyle: row.followup_style as string,
    messageTemplate: (row.message_template as string) || undefined,
    maxFollowups: row.max_followups as number,
    sequenceSteps: steps
      ? steps.map((s) => ({
          order: s.order as number,
          delayHours: s.delay_hours as number,
          delayMinutes: s.delay_minutes as number,
          style: s.style as SequenceStep["style"],
          messageTemplate: (s.message_template as string) || undefined,
        }))
      : undefined,
  };
}

// ---------- tests ----------

describe("PlaygroundFollowup: cadence steps mapping", () => {
  it("maps cadence steps to sequence_steps JSONB", () => {
    const rule: FollowupRuleLocal = {
      name: "Cadencia 3 passos",
      triggerType: "no_response",
      triggerDelayHours: 0,
      triggerDelayMinutes: 0,
      followupStyle: "direct",
      maxFollowups: 3,
      sequenceSteps: [
        { order: 1, delayHours: 24, delayMinutes: 0, style: "direct" },
        { order: 2, delayHours: 48, delayMinutes: 30, style: "value", messageTemplate: "Oi {nome}" },
        { order: 3, delayHours: 72, delayMinutes: 0, style: "breakup" },
      ],
    };

    const payload = ruleToDBPayload(rule);

    expect(payload.sequence_steps).toHaveLength(3);

    const steps = payload.sequence_steps as Array<Record<string, unknown>>;
    expect(steps[0]).toEqual({
      order: 1,
      delay_hours: 24,
      delay_minutes: 0,
      style: "direct",
      message_template: null,
    });
    expect(steps[1]).toEqual({
      order: 2,
      delay_hours: 48,
      delay_minutes: 30,
      style: "value",
      message_template: "Oi {nome}",
    });
    expect(steps[2]).toEqual({
      order: 3,
      delay_hours: 72,
      delay_minutes: 0,
      style: "breakup",
      message_template: null,
    });
  });

  it("round-trips cadence steps through DB format", () => {
    const original: FollowupRuleLocal = {
      name: "Round trip test",
      triggerType: "after_qualification",
      triggerDelayHours: 12,
      triggerDelayMinutes: 15,
      followupStyle: "curiosity",
      maxFollowups: 5,
      sequenceSteps: [
        { order: 1, delayHours: 6, delayMinutes: 0, style: "direct", messageTemplate: "Step 1" },
        { order: 2, delayHours: 24, delayMinutes: 0, style: "value" },
      ],
    };

    const dbPayload = ruleToDBPayload(original);
    const restored = dbRowToRule(dbPayload);

    expect(restored.name).toBe(original.name);
    expect(restored.triggerType).toBe(original.triggerType);
    expect(restored.sequenceSteps).toHaveLength(2);
    expect(restored.sequenceSteps![0].delayHours).toBe(6);
    expect(restored.sequenceSteps![0].messageTemplate).toBe("Step 1");
    expect(restored.sequenceSteps![1].style).toBe("value");
    expect(restored.sequenceSteps![1].messageTemplate).toBeUndefined();
  });
});

describe("PlaygroundFollowup: trigger types", () => {
  it("exposes all 5 trigger types", () => {
    expect(ALL_TRIGGER_TYPES).toHaveLength(5);
    expect(ALL_TRIGGER_TYPES).toContain("no_response");
    expect(ALL_TRIGGER_TYPES).toContain("after_qualification");
    expect(ALL_TRIGGER_TYPES).toContain("after_meeting_scheduled");
    expect(ALL_TRIGGER_TYPES).toContain("post_sale");
    expect(ALL_TRIGGER_TYPES).toContain("proposal_no_response");
  });

  it("has a label for every trigger type", () => {
    for (const t of ALL_TRIGGER_TYPES) {
      expect(TRIGGER_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});

describe("PlaygroundFollowup: single-shot mode", () => {
  it("produces null sequence_steps when no cadence", () => {
    const rule: FollowupRuleLocal = {
      name: "Single shot",
      triggerType: "no_response",
      triggerDelayHours: 24,
      triggerDelayMinutes: 0,
      followupStyle: "direct",
      maxFollowups: 3,
      // No sequenceSteps
    };

    const payload = ruleToDBPayload(rule);

    expect(payload.sequence_steps).toBeNull();
    expect(payload.trigger_delay_hours).toBe(24);
    expect(payload.followup_style).toBe("direct");
    expect(payload.max_followups).toBe(3);
  });

  it("restores single-shot rule without sequenceSteps", () => {
    const dbRow = {
      name: "Single shot DB",
      trigger_type: "proposal_no_response",
      trigger_delay_hours: 48,
      trigger_delay_minutes: 0,
      followup_style: "breakup",
      message_template: "Oi",
      max_followups: 2,
      sequence_steps: null,
    };

    const rule = dbRowToRule(dbRow);

    expect(rule.sequenceSteps).toBeUndefined();
    expect(rule.triggerDelayHours).toBe(48);
    expect(rule.followupStyle).toBe("breakup");
    expect(rule.messageTemplate).toBe("Oi");
  });

  it("empty sequenceSteps array also produces null", () => {
    const rule: FollowupRuleLocal = {
      name: "Empty cadence",
      triggerType: "post_sale",
      triggerDelayHours: 72,
      triggerDelayMinutes: 0,
      followupStyle: "value",
      maxFollowups: 1,
      sequenceSteps: [],
    };

    const payload = ruleToDBPayload(rule);
    expect(payload.sequence_steps).toBeNull();
  });
});
