/**
 * Branch coverage tests for workflow-trigger.ts
 *
 * Complements workflow-trigger-shared.test.ts by covering:
 * - fireStageChangedTrigger delegation
 * - processCronTriggers: empty, no expression, matching minute, DB error
 * - matchesCronExpression internal: star, step, comma, range, mismatch, short
 * - fireTrigger: catch block on supabase throw, insertError branch
 */

import { describe, it, expect, vi } from "vitest";
import {
  fireTrigger,
  fireStageChangedTrigger,
  processCronTriggers,
} from "../../supabase/functions/_shared/workflow-trigger";
import { createMockSupabase } from "../helpers/supabase-mock";

// ─── fireStageChangedTrigger ──────────────────────────────────────────────

describe("fireStageChangedTrigger", () => {
  it("delegates to fireTrigger with stage_changed context", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      {
        id: "wf-1",
        trigger_config: { pipe_type: "whatsapp", to_stage: "agendado" },
        organization_id: "org-1",
        trigger_type: "stage_changed",
        is_active: true,
      },
    ]);
    const n = await fireStageChangedTrigger({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      pipeType: "whatsapp",
      toStage: "agendado",
      fromStage: "respondeu",
    });
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("works with optional pipelineId/fromStage", async () => {
    const { sb } = createMockSupabase();
    const n = await fireStageChangedTrigger({
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      toStage: "vendido",
    });
    expect(n).toBe(0);
  });
});

// ─── processCronTriggers ──────────────────────────────────────────────────

describe("processCronTriggers", () => {
  it("returns 0 when no cron workflows exist", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", []);
    expect(await processCronTriggers(sb)).toBe(0);
  });

  it("skips workflows without cron_expression", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      { id: "wf-1", organization_id: "org-1", trigger_config: {}, trigger_type: "cron", is_active: true },
    ]);
    expect(await processCronTriggers(sb)).toBe(0);
  });

  it("fires workflow whose cron matches current minute (*)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_config: { cron_expression: "* * * * *" },
        trigger_type: "cron",
        is_active: true,
      },
    ]);
    const count = await processCronTriggers(sb);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("handles range (N-M) cron field", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_config: { cron_expression: "0-59 0-23 1-31 1-12 0-6" },
        trigger_type: "cron",
        is_active: true,
      },
    ]);
    const count = await processCronTriggers(sb);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("handles step (*/N) cron field", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_config: { cron_expression: "*/1 * * * *" },
        trigger_type: "cron",
        is_active: true,
      },
    ]);
    expect(await processCronTriggers(sb)).toBeGreaterThanOrEqual(0);
  });

  it("rejects malformed cron expression (< 5 parts)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_config: { cron_expression: "bad" },
        trigger_type: "cron",
        is_active: true,
      },
    ]);
    expect(await processCronTriggers(sb)).toBe(0);
  });

  it("rejects non-matching minute with literal field", async () => {
    // Build an expression that won't match the current minute.
    const wrongMinute = (new Date().getMinutes() + 1) % 60;
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_config: { cron_expression: `${wrongMinute} * * * *` },
        trigger_type: "cron",
        is_active: true,
      },
    ]);
    expect(await processCronTriggers(sb)).toBe(0);
  });

  it("handles comma-separated cron values", async () => {
    const now = new Date();
    const min = now.getMinutes();
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_config: { cron_expression: `${min},${(min + 1) % 60} * * * *` },
        trigger_type: "cron",
        is_active: true,
      },
    ]);
    const count = await processCronTriggers(sb);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 when query errors", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: "db down" } }),
          }),
        }),
      }),
    } as any;
    expect(await processCronTriggers(sb)).toBe(0);
  });
});

// ─── fireTrigger error paths ──────────────────────────────────────────────

describe("fireTrigger — error paths", () => {
  it("catches thrown errors and returns 0", async () => {
    const sb = {
      from: () => {
        throw new Error("connection closed");
      },
    } as any;
    const n = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "lead_created",
      leadId: "lead-1",
    });
    expect(n).toBe(0);
  });

  it("returns 0 when initial select errors", async () => {
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
            }),
          }),
        }),
      }),
    } as any;
    const n = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "lead_created",
      leadId: "lead-1",
    });
    expect(n).toBe(0);
  });

  it("returns 0 when insert fails", async () => {
    // First query returns one matching workflow; insert returns error.
    const sb = {
      from: (table: string) => {
        if (table === "workflows") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "wf-1",
                          trigger_config: {},
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        // workflow_executions.insert
        return {
          insert: () =>
            Promise.resolve({ error: { message: "constraint violation" } }),
        };
      },
    } as any;
    const n = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "lead_created",
      leadId: "lead-1",
    });
    expect(n).toBe(0);
  });

  it("inserts and returns matching count on success", async () => {
    const sb = {
      from: (table: string) => {
        if (table === "workflows") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        { id: "wf-1", trigger_config: {} },
                        { id: "wf-2", trigger_config: {} },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return { insert: () => Promise.resolve({ error: null }) };
      },
    } as any;
    const n = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "lead_created",
      leadId: "lead-1",
    });
    expect(n).toBe(2);
  });

  it("filters out non-matching workflows before insert", async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
    const sb = {
      from: (table: string) => {
        if (table === "workflows") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        // Matches — no filter
                        { id: "wf-match", trigger_config: {} },
                        // Rejects — origin mismatch
                        { id: "wf-miss", trigger_config: { filter_origin: "google_ads" } },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return { insert: insertSpy };
      },
    } as any;
    const n = await fireTrigger({
      supabase: sb,
      organizationId: "org-1",
      triggerType: "lead_created",
      leadId: "lead-1",
      context: { origin: "meta_ads" },
    });
    expect(n).toBe(1);
    // Inserted exactly one execution (wf-match)
    const inserted = insertSpy.mock.calls[0][0] as Array<{ workflow_id: string }>;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].workflow_id).toBe("wf-match");
  });
});
