/**
 * workflow-trigger-dedup — chave de dedup determinística por (trigger_type,
 * payload, window bucket).
 *
 * Origem: investigação Bertin 2026-05-22. Workflow `c60fd533` (Disparo 1
 * Qualific.) rodou 142x para 78 leads únicos — alguns leads dispararam até
 * 7x. Sem janela de dedup, stage_changed em sequência reexecuta workflow.
 *
 * Dedup key = `${trigger_type}:${hash(payload)}:${window_bucket}`. Adicionada
 * em `workflow_executions.trigger_dedup_key` com partial unique
 * `(workflow_id, lead_id, trigger_dedup_key)`. Caller (workflow-trigger.ts)
 * computa key e insere — ON CONFLICT DO NOTHING vira noop quando duplicado.
 */

import { describe, it, expect } from "vitest";
import { computeTriggerDedupKey } from "../../supabase/functions/_shared/workflow-trigger-dedup.ts";

const T0 = new Date("2026-05-22T10:00:00Z");

describe("computeTriggerDedupKey — deterministic for same (type, payload, window)", () => {
  it("same payload in same window → same key", async () => {
    const a = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { from_stage: "novo", to_stage: "abordado" },
      now: T0,
      windowSeconds: 60,
    });
    const b = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { from_stage: "novo", to_stage: "abordado" },
      now: new Date(T0.getTime() + 5_000),
      windowSeconds: 60,
    });
    expect(a).toBe(b);
  });

  it("different payload → different key (allows distinct stage transitions)", async () => {
    const a = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { from_stage: "novo", to_stage: "abordado" },
      now: T0,
      windowSeconds: 60,
    });
    const b = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { from_stage: "abordado", to_stage: "respondeu" },
      now: T0,
      windowSeconds: 60,
    });
    expect(a).not.toBe(b);
  });

  it("after window expires → new key (lead can retrigger past window)", async () => {
    const a = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { from_stage: "novo", to_stage: "abordado" },
      now: T0,
      windowSeconds: 60,
    });
    const b = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { from_stage: "novo", to_stage: "abordado" },
      now: new Date(T0.getTime() + 120_000), // +2min, past 60s window
      windowSeconds: 60,
    });
    expect(a).not.toBe(b);
  });

  it("payload key order does not affect key (stable stringify)", async () => {
    const a = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { from_stage: "novo", to_stage: "abordado" },
      now: T0,
      windowSeconds: 60,
    });
    const b = await computeTriggerDedupKey({
      triggerType: "stage_changed",
      payload: { to_stage: "abordado", from_stage: "novo" },
      now: T0,
      windowSeconds: 60,
    });
    expect(a).toBe(b);
  });
});
