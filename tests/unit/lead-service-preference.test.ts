/**
 * Tests for phone_ai_preferences inheritance in getOrCreateLead.
 *
 * When a new lead is created for a phone that has an existing preference
 * saying `ai_disabled=true`, the insert must carry that flag (and
 * ai_disabled_at / ai_disabled_by when possible). When no preference exists,
 * or `ai_disabled=false`, the lead is created with default.
 *
 * This proves AC-02 (primeira mensagem após toggle prévio respeita a IA off).
 */

import { describe, it, expect, vi } from "vitest";
import "../../tests/helpers/deno-mock";
import { getOrCreateLead } from "../../supabase/functions/_shared/lead-service";

type Step = { data?: unknown; error?: unknown };

/**
 * Build a scripted client that supports the path:
 *   leads: phone search → [optional email search] → insert.single()
 *   phone_ai_preferences: maybeSingle()
 *
 * Each table has a queue of Step responses. For `phone_ai_preferences`,
 * the .maybeSingle() terminal pops; for `leads`, both .then() and
 * .single() pop (order matters).
 */
function scripted(tableResponses: Record<string, Step[]>) {
  const inserted: Array<{ table: string; row: unknown }> = [];
  const queue: Record<string, Step[]> = { ...tableResponses };

  const makeChain = (table: string) => {
    let isInsert = false;
    let insertRow: unknown = null;

    const chain: any = {
      select() { return chain; },
      eq() { return chain; },
      ilike() { return chain; },
      is() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      insert(row: unknown) {
        isInsert = true;
        insertRow = row;
        inserted.push({ table, row });
        return chain;
      },
      update() { return chain; },
      single() {
        const step = (queue[table] || []).shift() ?? {
          data: isInsert ? { id: "generated", ...(insertRow as object) } : null,
          error: null,
        };
        return Promise.resolve(step);
      },
      maybeSingle() {
        const step = (queue[table] || []).shift() ?? { data: null, error: null };
        return Promise.resolve(step);
      },
      then(onFulfilled: (s: Step) => unknown) {
        const step = (queue[table] || []).shift() ?? { data: [], error: null };
        return Promise.resolve(step).then(onFulfilled);
      },
    };
    return chain;
  };

  return {
    from: (table: string) => makeChain(table),
    _inserted: inserted,
  };
}

describe("getOrCreateLead — phone_ai_preferences inheritance", () => {
  it("inherits ai_disabled=true when preference exists for phone", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const sb = scripted({
      leads: [
        // 1. phone search: no lead found
        { data: [], error: null },
        // 2. insert(...).single() → new lead
        {
          data: {
            id: "new-lead-1",
            name: "Test",
            phone: "11999999999",
            email: null,
            organization_id: "org-1",
            normalized_phone: "11999999999",
            ai_disabled: true,
          },
          error: null,
        },
      ],
      phone_ai_preferences: [
        // preference exists with ai_disabled=true
        {
          data: { ai_disabled: true, set_by: "user-xyz" },
          error: null,
        },
      ],
      pipe_whatsapp: [{ data: null, error: null }], // insert no-op OK
    });

    const result = await getOrCreateLead(sb as any, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "Test",
    });

    expect(result?.created).toBe(true);
    // The insert must have included ai_disabled=true
    const leadInsert = sb._inserted.find((i) => i.table === "leads");
    expect(leadInsert).toBeDefined();
    const row = leadInsert!.row as Record<string, unknown>;
    expect(row.ai_disabled).toBe(true);
    expect(row.ai_disabled_at).toBeDefined();
    expect(row.ai_disabled_by).toBe("user-xyz");

    consoleLogSpy.mockRestore();
  });

  it("does NOT set ai_disabled when preference ai_disabled=false", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null },
        {
          data: {
            id: "new-lead-2",
            name: "Test",
            phone: "11999999999",
            email: null,
            organization_id: "org-1",
            normalized_phone: "11999999999",
            ai_disabled: false,
          },
          error: null,
        },
      ],
      phone_ai_preferences: [
        { data: { ai_disabled: false, set_by: "user-xyz" }, error: null },
      ],
      pipe_whatsapp: [{ data: null, error: null }],
    });

    const result = await getOrCreateLead(sb as any, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "Test",
    });

    expect(result?.created).toBe(true);
    const leadInsert = sb._inserted.find((i) => i.table === "leads");
    const row = leadInsert!.row as Record<string, unknown>;
    // ai_disabled must NOT be in the insert payload (default applies)
    expect(row.ai_disabled).toBeUndefined();
    expect(row.ai_disabled_at).toBeUndefined();
    expect(row.ai_disabled_by).toBeUndefined();
  });

  it("uses default when no preference row exists", async () => {
    const sb = scripted({
      leads: [
        { data: [], error: null },
        {
          data: {
            id: "new-lead-3",
            name: "Test",
            phone: "11999999999",
            email: null,
            organization_id: "org-1",
            normalized_phone: "11999999999",
            ai_disabled: false,
          },
          error: null,
        },
      ],
      phone_ai_preferences: [
        { data: null, error: null }, // no preference
      ],
      pipe_whatsapp: [{ data: null, error: null }],
    });

    const result = await getOrCreateLead(sb as any, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "Test",
    });

    expect(result?.created).toBe(true);
    const leadInsert = sb._inserted.find((i) => i.table === "leads");
    const row = leadInsert!.row as Record<string, unknown>;
    expect(row.ai_disabled).toBeUndefined();
  });

  it("continues with default when preference lookup errors (non-fatal)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = scripted({
      leads: [
        { data: [], error: null },
        {
          data: {
            id: "new-lead-4",
            name: "Test",
            phone: "11999999999",
            email: null,
            organization_id: "org-1",
            normalized_phone: "11999999999",
            ai_disabled: false,
          },
          error: null,
        },
      ],
      phone_ai_preferences: [
        { data: null, error: { message: "rls blocked somehow" } },
      ],
      pipe_whatsapp: [{ data: null, error: null }],
    });

    const result = await getOrCreateLead(sb as any, {
      organizationId: "org-1",
      phone: "11999999999",
      name: "Test",
    });

    expect(result?.created).toBe(true);
    // Warning logged; lead created without ai_disabled flag (default)
    expect(warnSpy).toHaveBeenCalled();
    const row = sb._inserted.find((i) => i.table === "leads")!.row as Record<string, unknown>;
    expect(row.ai_disabled).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("skips preference lookup when no phone is provided (email-only lead)", async () => {
    const sb = scripted({
      leads: [
        // no phone search; starts with email search
        { data: [], error: null },
        {
          data: {
            id: "new-lead-5",
            name: "Test",
            phone: null,
            email: "x@x.com",
            organization_id: "org-1",
            normalized_phone: null,
            ai_disabled: false,
          },
          error: null,
        },
      ],
      pipe_whatsapp: [{ data: null, error: null }],
    });

    const result = await getOrCreateLead(sb as any, {
      organizationId: "org-1",
      email: "x@x.com",
      name: "Test",
    });

    expect(result?.created).toBe(true);
    // No preference query was consumed (none scripted, but code also skips for null phone)
  });
});
