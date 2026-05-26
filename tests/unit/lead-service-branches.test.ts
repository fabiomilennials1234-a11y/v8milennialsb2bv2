/**
 * Branch coverage for lead-service.ts — complements lead-service.test.ts
 * by exercising error paths and side-effect branches:
 * - Search errors (phone + email logged)
 * - isShadow=true path (no pipe_whatsapp insert)
 * - sdrId branch (sdr_id + responsible_id set)
 * - Race condition retry on 23505 (both phone + email)
 * - Non-duplicate create error returns null
 * - pipe_whatsapp insert throw swallowed
 * - associateMessagesToLead (normalized vs raw phone, error path)
 * - promoveShadowLead (not shadow, update error, each pipe type, catch)
 */

import { describe, it, expect, vi } from "vitest";
import "../../tests/helpers/deno-mock";
import {
  getOrCreateLead,
  associateMessagesToLead,
  promoveShadowLead,
} from "../../supabase/functions/_shared/lead-service";

// ─── Helper: build a scripted supabase client ────────────────────────────
//
// `plan` maps call signatures to responses. Each "step" is one terminal
// (then/single/limit) so error paths can be injected per-query.

type Step = { data?: unknown; error?: unknown };

function scripted(tableResponses: Record<string, Step[]>) {
  const inserted: Array<{ table: string; row: unknown }> = [];
  const updates: Array<{ table: string; payload: unknown }> = [];
  const queue: Record<string, Step[]> = { ...tableResponses };
  const pipeInsertShouldThrow = { current: false };

  const sb: any = {
    from(table: string) {
      let isInsert = false;
      let insertRow: unknown = null;
      let isUpdate = false;
      let updatePayload: unknown = null;

      const chain: any = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        ilike() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        insert(row: unknown) {
          if (pipeInsertShouldThrow.current && table === "pipe_whatsapp") {
            throw new Error("pipe insert throw");
          }
          isInsert = true;
          insertRow = row;
          inserted.push({ table, row });
          return chain;
        },
        update(payload: unknown) {
          isUpdate = true;
          updatePayload = payload;
          updates.push({ table, payload });
          return chain;
        },
        single() {
          const step = (queue[table] || []).shift() ?? {
            data: isInsert ? { id: "generated-id", ...(insertRow as object) } : null,
            error: null,
          };
          return Promise.resolve(step);
        },
        maybeSingle() {
          const step = (queue[table] || []).shift() ?? {
            data: null,
            error: null,
          };
          return Promise.resolve(step);
        },
        then(onFulfilled: (s: Step) => unknown) {
          const step = (queue[table] || []).shift() ?? {
            data: [],
            error: null,
          };
          if (isUpdate) {
            // update returns { error } envelope after eq().eq().is() chain
            return Promise.resolve(step).then(onFulfilled);
          }
          return Promise.resolve(step).then(onFulfilled);
        },
      };
      return chain;
    },
    _pipeInsertShouldThrow: pipeInsertShouldThrow,
    _inserted: inserted,
    _updates: updates,
  };
  return sb;
}

// ─── getOrCreateLead — search error logs + isShadow + sdrId ──────────────

describe("getOrCreateLead — branches", () => {
  it("logs phone search error but continues to email", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = scripted({
      leads: [
        // Phone search errors
        { data: null, error: { message: "boom phone" } },
        // Email search errors too, then insert succeeds
        { data: null, error: { message: "boom email" } },
        // Insert via single() — next step
        {
          data: {
            id: "new-1",
            name: "X",
            phone: "1",
            email: null,
            organization_id: "org-1",
            normalized_phone: "5511",
            ai_disabled: false,
          },
          error: null,
        },
      ],
    });
    const result = await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
      email: "x@x",
      name: "X",
    });
    expect(result?.created).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("creates shadow lead without pipe_whatsapp entry", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null }, // phone miss
        {
          data: {
            id: "shadow-1",
            name: "Shadow",
            phone: "1",
            email: null,
            organization_id: "org-1",
            normalized_phone: "5511",
            ai_disabled: false,
          },
          error: null,
        },
      ],
    });
    const result = await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "Shadow",
      isShadow: true,
    });
    expect(result?.created).toBe(true);
    // No pipe_whatsapp insert since isShadow=true
    const pipeInserts = sb._inserted.filter((i: { table: string }) => i.table === "pipe_whatsapp");
    expect(pipeInserts).toHaveLength(0);
  });

  it("sets sdr_id and responsible_id from sdrId param", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null }, // phone miss
        {
          data: {
            id: "new-2",
            name: "N",
            phone: "1",
            email: null,
            organization_id: "org-1",
            normalized_phone: "5511",
            ai_disabled: false,
          },
          error: null,
        },
      ],
    });
    await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "N",
      sdrId: "tm-sdr",
    });
    const leadInsert = sb._inserted.find((i: { table: string }) => i.table === "leads");
    expect((leadInsert?.row as any).sdr_id).toBe("tm-sdr");
    expect((leadInsert?.row as any).responsible_id).toBe("tm-sdr");
  });

  it("uses pushName when name not provided", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null },
        {
          data: {
            id: "x",
            name: "From Push",
            phone: null,
            email: null,
            organization_id: "org-1",
            normalized_phone: "5511",
            ai_disabled: false,
          },
          error: null,
        },
      ],
    });
    await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
      pushName: "From Push",
    });
    const leadInsert = sb._inserted.find((i: { table: string }) => i.table === "leads");
    expect((leadInsert?.row as any).name).toBe("From Push");
  });

  it("falls back to 'WhatsApp <last4>' lead name when no name/pushName", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null },
        {
          data: { id: "x", name: "WhatsApp 9999", organization_id: "org-1" },
          error: null,
        },
      ],
    });
    await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
    });
    const leadInsert = sb._inserted.find((i: { table: string }) => i.table === "leads");
    expect((leadInsert?.row as any).name).toMatch(/^WhatsApp \d{4}$/);
  });

  it("swallows pipe_whatsapp insert errors", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null },
        {
          data: {
            id: "new-3",
            name: "N",
            phone: "1",
            email: null,
            organization_id: "org-1",
            normalized_phone: "5511",
            ai_disabled: false,
          },
          error: null,
        },
      ],
    });
    sb._pipeInsertShouldThrow.current = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "N",
    });
    expect(result?.created).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ─── getOrCreateLead — race condition retry ──────────────────────────────

describe("getOrCreateLead — race condition retry", () => {
  it("recovers after duplicate error via phone retry", async () => {
    const existing = {
      id: "existing-1",
      name: "X",
      phone: "1",
      email: null,
      organization_id: "org-1",
      normalized_phone: "11999999999",
      ai_disabled: false,
    };
    const sb = scripted({
      leads: [
        { data: [], error: null }, // initial phone miss
        // Insert fails with 23505
        { data: null, error: { code: "23505", message: "duplicate key value" } },
        // Retry phone search finds the racing row
        { data: [existing], error: null },
      ],
    });
    const result = await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "X",
    });
    expect(result?.created).toBe(false);
    expect(result?.source).toBe("phone");
  });

  it("recovers after duplicate error via email retry", async () => {
    const existing = {
      id: "existing-email",
      name: "E",
      phone: null,
      email: "e@x.com",
      organization_id: "org-1",
      normalized_phone: null,
      ai_disabled: false,
    };
    const sb = scripted({
      leads: [
        { data: [], error: null }, // email-only, phone skipped
        // Insert fails with duplicate message (no code)
        { data: null, error: { message: "duplicate entry 42" } },
        // Retry email finds
        { data: [existing], error: null },
      ],
    });
    const result = await getOrCreateLead(sb, {
      organizationId: "org-1",
      email: "e@x.com",
      name: "E",
    });
    expect(result?.created).toBe(false);
    expect(result?.source).toBe("email");
  });

  it("returns null when create fails with non-duplicate error", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null },
        { data: null, error: { code: "23514", message: "check constraint" } },
      ],
    });
    const result = await getOrCreateLead(sb, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "X",
    });
    expect(result).toBeNull();
  });
});

// ─── associateMessagesToLead ─────────────────────────────────────────────

describe("associateMessagesToLead", () => {
  it("updates via normalized_phone when phone normalizes", async () => {
    const sb = scripted({
      whatsapp_messages: [{ data: null, error: null }],
    });
    await associateMessagesToLead(sb, "org-1", "11999999999", "lead-1");
    const update = sb._updates.find((u: { table: string }) => u.table === "whatsapp_messages");
    expect((update?.payload as any).lead_id).toBe("lead-1");
  });

  it("falls back to raw phone when normalization returns null", async () => {
    const sb = scripted({
      whatsapp_messages: [{ data: null, error: null }],
    });
    await associateMessagesToLead(sb, "org-1", "abc", "lead-1");
    expect(sb._updates).toHaveLength(1);
  });

  it("logs on update error", async () => {
    const sb = scripted({
      whatsapp_messages: [{ data: null, error: { message: "update failed" } }],
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await associateMessagesToLead(sb, "org-1", "11999999999", "lead-1");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─── promoveShadowLead ────────────────────────────────────────────────────

describe("promoveShadowLead", () => {
  it("returns false when lead is not shadow", async () => {
    const sb = scripted({
      leads: [{ data: { id: "l1", is_shadow: false }, error: null }],
    });
    const result = await promoveShadowLead(sb, "l1", "org-1", { stage: "novo" });
    expect(result).toBe(false);
  });

  it("returns false when lead not found", async () => {
    const sb = scripted({
      leads: [{ data: null, error: null }],
    });
    const result = await promoveShadowLead(sb, "l1", "org-1", { stage: "novo" });
    expect(result).toBe(false);
  });

  it("returns false on update error", async () => {
    const sb = scripted({
      leads: [
        { data: { id: "l1", is_shadow: true }, error: null }, // lead fetch (single)
        { data: null, error: { message: "update failed" } },  // update via then
      ],
    });
    const result = await promoveShadowLead(sb, "l1", "org-1", { stage: "novo" });
    expect(result).toBe(false);
  });

  // Note: pipe_whatsapp/pipe_confirmacao/pipe_propostas viraram views sobre pipeline_entries.
  // promoveShadowLead agora chama upsertPipeEntry → INSERT em pipeline_entries.
  // Cada teste mocka: pipelines (resolvePipelineId), pipeline_entries.maybeSingle (getPipeEntry → null),
  // pipeline_entries insert .select().single() (retorna id).

  it("promotes to whatsapp pipe by default", async () => {
    const sb = scripted({
      leads: [
        { data: { id: "l1", is_shadow: true }, error: null },
        { data: null, error: null }, // update success
      ],
      pipelines: [{ data: { id: "pl-wa" }, error: null }],
      pipeline_entries: [
        { data: null, error: null },          // getPipeEntry.maybeSingle → no existing
        { data: { id: "pe-1" }, error: null }, // insert .select().single() → success
      ],
    });
    const result = await promoveShadowLead(
      sb,
      "l1",
      "org-1",
      { stage: "novo_lead" },
      "tm-sdr",
    );
    expect(result).toBe(true);
    const pipeInsert = sb._inserted.find((i: { table: string }) => i.table === "pipeline_entries");
    expect(pipeInsert).toBeTruthy();
    expect((pipeInsert?.row as any).pipeline_id).toBe("pl-wa");
    expect((pipeInsert?.row as any).stage_key).toBe("novo_lead");
    expect((pipeInsert?.row as any).assigned_to).toBe("tm-sdr");
    expect((pipeInsert?.row as any).metadata?.sdr_id).toBe("tm-sdr");
  });

  it("promotes to confirmacao pipe when pipe='confirmacao'", async () => {
    const sb = scripted({
      leads: [
        { data: { id: "l1", is_shadow: true }, error: null },
        { data: null, error: null },
      ],
      pipelines: [{ data: { id: "pl-cf" }, error: null }],
      pipeline_entries: [
        { data: null, error: null },
        { data: { id: "pe-2" }, error: null },
      ],
    });
    const result = await promoveShadowLead(sb, "l1", "org-1", {
      pipe: "confirmacao",
      stage: "reuniao_marcada",
    });
    expect(result).toBe(true);
    const pipeInsert = sb._inserted.find((i: { table: string }) => i.table === "pipeline_entries");
    expect(pipeInsert).toBeTruthy();
    expect((pipeInsert?.row as any).pipeline_id).toBe("pl-cf");
    expect((pipeInsert?.row as any).stage_key).toBe("reuniao_marcada");
  });

  it("promotes to propostas pipe when pipe='propostas'", async () => {
    const sb = scripted({
      leads: [
        { data: { id: "l1", is_shadow: true }, error: null },
        { data: null, error: null },
      ],
      pipelines: [{ data: { id: "pl-pp" }, error: null }],
      pipeline_entries: [
        { data: null, error: null },
        { data: { id: "pe-3" }, error: null },
      ],
    });
    const result = await promoveShadowLead(sb, "l1", "org-1", {
      pipe: "propostas",
      stage: "proposta_enviada",
    });
    expect(result).toBe(true);
    const pipeInsert = sb._inserted.find((i: { table: string }) => i.table === "pipeline_entries");
    expect(pipeInsert).toBeTruthy();
    expect((pipeInsert?.row as any).pipeline_id).toBe("pl-pp");
    expect((pipeInsert?.row as any).stage_key).toBe("proposta_enviada");
  });

  it("catches thrown errors and returns false", async () => {
    const sb = {
      from: () => {
        throw new Error("db down");
      },
    } as any;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await promoveShadowLead(sb, "l1", "org-1", { stage: "novo" });
    expect(result).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
