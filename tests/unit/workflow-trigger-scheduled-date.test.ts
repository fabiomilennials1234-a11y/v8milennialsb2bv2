/**
 * Tests for the scheduled_date trigger ("Antes de uma data") — issue #896.
 *
 * Planner (`planScheduledDateDispatches`) is a pure function: deterministic given
 * (now, workflows, leadMeetings, firedLog). Shell (`processScheduledDateTriggers`)
 * does I/O and is covered with createMockSupabase.
 */

import { describe, it, expect } from "vitest";
import {
  planScheduledDateDispatches,
  processScheduledDateTriggers,
  scheduledItemKey,
  type ScheduledDateWorkflow,
  type LeadMeeting,
  type ScheduledFiredLogEntry,
} from "../../supabase/functions/_shared/workflow-trigger";
import { createMockSupabase } from "../helpers/supabase-mock";

// Fixtures — tz UTC so "X dias antes às HH:MM" is deterministic without DST math.
function wf(overrides: Partial<ScheduledDateWorkflow> = {}): ScheduledDateWorkflow {
  return {
    id: "wf-1",
    organization_id: "org-1",
    pipeline_id: "pipe-1",
    stages: [],
    filter_origin: null,
    timezone: "UTC",
    dispatches: [{ anchor: "antes_da_reuniao", value: 7, unit: "days", send_time: "09:00" }],
    ...overrides,
  };
}

function meeting(overrides: Partial<LeadMeeting> = {}): LeadMeeting {
  return {
    organization_id: "org-1",
    lead_id: "lead-1",
    pipeline_id: "pipe-1",
    stage_key: "agendado",
    meeting_date: "2026-07-10T15:00:00Z",
    origin: null,
    ...overrides,
  };
}

describe("planScheduledDateDispatches — antes_da_reuniao (dias)", () => {
  it("fires when now >= meeting_date − offset (at send_time, org tz)", () => {
    // 7 days before 2026-07-10T15:00Z → 2026-07-03, às 09:00 UTC → 2026-07-03T09:00Z
    const now = new Date("2026-07-03T09:00:00Z");
    const out = planScheduledDateDispatches(now, [wf()], [meeting()], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      workflow_id: "wf-1",
      organization_id: "org-1",
      lead_id: "lead-1",
      meeting_date: "2026-07-10T15:00:00Z",
      item_key: "item-0",
    });
  });

  it("does not fire before the send_time instant", () => {
    const now = new Date("2026-07-03T08:59:00Z");
    expect(planScheduledDateDispatches(now, [wf()], [meeting()], [])).toHaveLength(0);
  });

  it("skips when antecedência does not fit (missed window)", () => {
    // Meeting only 2 days out but configured for 7 days before → window already passed.
    const now = new Date("2026-07-03T09:00:00Z");
    const lm = meeting({ meeting_date: "2026-07-05T15:00:00Z" });
    expect(planScheduledDateDispatches(now, [wf()], [lm], [])).toHaveLength(0);
  });

  it("never fires for a meeting already in the past", () => {
    const now = new Date("2026-07-03T09:00:00Z");
    const lm = meeting({ meeting_date: "2026-07-01T10:00:00Z" });
    expect(planScheduledDateDispatches(now, [wf()], [lm], [])).toHaveLength(0);
  });

  it("normalizes hours unit (seconds offset), no send_time", () => {
    const w = wf({ dispatches: [{ anchor: "antes_da_reuniao", value: 2, unit: "hours" }] });
    // 2h before 15:00Z = 13:00Z
    expect(planScheduledDateDispatches(new Date("2026-07-10T13:00:00Z"), [w], [meeting()], [])).toHaveLength(1);
    expect(planScheduledDateDispatches(new Date("2026-07-10T12:00:00Z"), [w], [meeting()], [])).toHaveLength(0);
  });
});

describe("planScheduledDateDispatches — offset zero (no dia da reunião)", () => {
  // value=0 days + send_time → fireAt no dia da reunião no send_time. offsetMs=0, então
  // sem o piso (SCHEDULED_GRACE_FLOOR_SECONDS) a grace seria 0 e o cron de 1min nunca
  // acertaria. Meeting 2026-07-10T15:00Z, send_time 08:00 → fireAt 2026-07-10T08:00Z.
  const dayOf = wf({
    dispatches: [{ anchor: "antes_da_reuniao", value: 0, unit: "days", send_time: "08:00" }],
  });

  it("fires at send_time on the meeting day (grace floor)", () => {
    const out = planScheduledDateDispatches(new Date("2026-07-10T08:00:00Z"), [dayOf], [meeting()], []);
    expect(out).toHaveLength(1);
    expect(out[0].item_key).toBe("item-0");
  });

  it("fires when the cron tick lands within the grace floor (fireAt + 60s)", () => {
    const out = planScheduledDateDispatches(new Date("2026-07-10T08:01:00Z"), [dayOf], [meeting()], []);
    expect(out).toHaveLength(1);
  });

  it("does not fire before send_time", () => {
    expect(planScheduledDateDispatches(new Date("2026-07-10T07:59:00Z"), [dayOf], [meeting()], [])).toHaveLength(0);
  });

  it("still skips a genuinely missed window beyond the floor (fireAt + 5min)", () => {
    expect(planScheduledDateDispatches(new Date("2026-07-10T08:05:00Z"), [dayOf], [meeting()], [])).toHaveLength(0);
  });
});

describe("planScheduledDateDispatches — dedup & re-arme", () => {
  it("does not re-fire an item already in the log", () => {
    const now = new Date("2026-07-03T09:00:00Z");
    const log: ScheduledFiredLogEntry[] = [
      { workflow_id: "wf-1", lead_id: "lead-1", meeting_date: "2026-07-10T15:00:00Z", item_key: "item-0" },
    ];
    expect(planScheduledDateDispatches(now, [wf()], [meeting()], log)).toHaveLength(0);
  });

  it("re-arms when the meeting_date changes (remarcação)", () => {
    // Old meeting fired; lead remarcou para 2026-07-17. now = 7 dias antes da nova data.
    const now = new Date("2026-07-10T09:00:00Z");
    const log: ScheduledFiredLogEntry[] = [
      { workflow_id: "wf-1", lead_id: "lead-1", meeting_date: "2026-07-10T15:00:00Z", item_key: "item-0" },
    ];
    const lm = meeting({ meeting_date: "2026-07-17T15:00:00Z" });
    const out = planScheduledDateDispatches(now, [wf()], [lm], log);
    expect(out).toHaveLength(1);
    expect(out[0].meeting_date).toBe("2026-07-17T15:00:00Z");
  });

  it("editing the offset does not re-fire an already-logged item (stable item_key)", () => {
    // item-0 já disparou para esta reunião quando era 7 dias; usuário muda p/ 3 dias.
    const now = new Date("2026-07-07T09:00:00Z"); // 3 dias antes de 2026-07-10
    const w = wf({ dispatches: [{ anchor: "antes_da_reuniao", value: 3, unit: "days", send_time: "09:00" }] });
    const log: ScheduledFiredLogEntry[] = [
      { workflow_id: "wf-1", lead_id: "lead-1", meeting_date: "2026-07-10T15:00:00Z", item_key: "item-0" },
    ];
    expect(planScheduledDateDispatches(now, [w], [meeting()], log)).toHaveLength(0);
  });
});

describe("planScheduledDateDispatches — múltiplos itens", () => {
  it("each item fires independently with its own item_key", () => {
    const w = wf({
      dispatches: [
        { anchor: "antes_da_reuniao", value: 7, unit: "days", send_time: "09:00" }, // item-0
        { anchor: "antes_da_reuniao", value: 1, unit: "days", send_time: "09:00" }, // item-1
      ],
    });
    // now = 1 dia antes (2026-07-09T09:00Z). item-0 (7d) já passou a janela; item-1 dispara.
    const out = planScheduledDateDispatches(new Date("2026-07-09T09:00:00Z"), [w], [meeting()], []);
    expect(out).toHaveLength(1);
    expect(out[0].item_key).toBe(scheduledItemKey(1));
  });
});

describe("planScheduledDateDispatches — audiência", () => {
  it("ignores leads in a different pipeline", () => {
    const now = new Date("2026-07-03T09:00:00Z");
    const lm = meeting({ pipeline_id: "pipe-OTHER" });
    expect(planScheduledDateDispatches(now, [wf()], [lm], [])).toHaveLength(0);
  });

  it("respects stage filter when stages are set", () => {
    const now = new Date("2026-07-03T09:00:00Z");
    const w = wf({ stages: ["agendado"] });
    expect(planScheduledDateDispatches(now, [w], [meeting({ stage_key: "novo" })], [])).toHaveLength(0);
    expect(planScheduledDateDispatches(now, [w], [meeting({ stage_key: "agendado" })], [])).toHaveLength(1);
  });

  it("respects optional origin filter", () => {
    const now = new Date("2026-07-03T09:00:00Z");
    const w = wf({ filter_origin: "meta_ads" });
    expect(planScheduledDateDispatches(now, [w], [meeting({ origin: "site" })], [])).toHaveLength(0);
    expect(planScheduledDateDispatches(now, [w], [meeting({ origin: "meta_ads" })], [])).toHaveLength(1);
  });

  it("ignores a lead without meeting_date", () => {
    const now = new Date("2026-07-03T09:00:00Z");
    const lm = meeting({ meeting_date: "" });
    expect(planScheduledDateDispatches(now, [wf()], [lm], [])).toHaveLength(0);
  });
});

describe("planScheduledDateDispatches — ao_marcar (Fatia 2 — ainda não dispara)", () => {
  it("does not fire ao_marcar in this slice", () => {
    const now = new Date("2026-07-03T09:00:00Z");
    const w = wf({ dispatches: [{ anchor: "ao_marcar" }] });
    expect(planScheduledDateDispatches(now, [w], [meeting()], [])).toHaveLength(0);
  });
});

describe("processScheduledDateTriggers — shell I/O", () => {
  it("inserts execution + ledger for a due dispatch and dedups via the log", async () => {
    const now = Date.now();
    const meetingDate = new Date(now + 40 * 60_000).toISOString(); // 40 min no futuro
    const { sb, mockTable, getInserted } = createMockSupabase();

    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_type: "scheduled_date",
        is_active: true,
        trigger_config: {
          pipeline_id: "pipe-1", // já resolvido — evita lookup em `pipelines`
          stages: [],
          // 1h antes → fireAt = meeting − 1h = agora − 20min (dentro do grace de 30min)
          dispatches: [{ anchor: "antes_da_reuniao", value: 1, unit: "hours" }],
        },
      },
    ]);
    mockTable("pipeline_entries", [
      {
        organization_id: "org-1",
        lead_id: "lead-1",
        pipeline_id: "pipe-1",
        stage_key: "agendado",
        metadata: { meeting_date: meetingDate },
      },
    ]);
    mockTable("scheduled_date_dispatch_log", []);

    const count = await processScheduledDateTriggers(sb);
    expect(count).toBe(1);

    const execs = getInserted("workflow_executions");
    expect(execs).toHaveLength(1);
    expect(execs[0]).toMatchObject({
      workflow_id: "wf-1",
      organization_id: "org-1",
      lead_id: "lead-1",
      status: "running",
    });
    expect((execs[0].context as Record<string, unknown>).trigger_type).toBe("scheduled_date");
    expect((execs[0].context as Record<string, unknown>).item_key).toBe("item-0");

    const log = getInserted("scheduled_date_dispatch_log");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ workflow_id: "wf-1", lead_id: "lead-1", item_key: "item-0" });
  });

  it("does not re-fire when the ledger already has the dispatch", async () => {
    const now = Date.now();
    const meetingDate = new Date(now + 40 * 60_000).toISOString();
    const { sb, mockTable, getInserted } = createMockSupabase();

    mockTable("workflows", [
      {
        id: "wf-1",
        organization_id: "org-1",
        trigger_type: "scheduled_date",
        is_active: true,
        trigger_config: {
          pipeline_id: "pipe-1",
          stages: [],
          dispatches: [{ anchor: "antes_da_reuniao", value: 1, unit: "hours" }],
        },
      },
    ]);
    mockTable("pipeline_entries", [
      {
        organization_id: "org-1",
        lead_id: "lead-1",
        pipeline_id: "pipe-1",
        stage_key: "agendado",
        metadata: { meeting_date: meetingDate },
      },
    ]);
    mockTable("scheduled_date_dispatch_log", [
      { workflow_id: "wf-1", lead_id: "lead-1", meeting_date: meetingDate, item_key: "item-0" },
    ]);

    const count = await processScheduledDateTriggers(sb);
    expect(count).toBe(0);
    expect(getInserted("workflow_executions")).toHaveLength(0);
  });

  it("returns 0 when there are no scheduled_date workflows", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("workflows", []);
    expect(await processScheduledDateTriggers(sb)).toBe(0);
  });
});
