/**
 * greeting-orchestrator — UMA fonte vence por janela.
 *
 * Origem: investigação Bertin 2026-05-08/09. Phone 5515935004596 recebeu
 * 3× a mesma mensagem "fora de horário" simultânea (copilot + 2 disparos
 * manuais). Sem orquestração compartilhada, múltiplos triggers paralelos
 * causam triplicação.
 *
 * Solução: reserva atômica em `greeting_dispatches` com unique
 * `(org_id, lead_id, window_id)`. Quem vence dispara, outros recebem skip.
 */

import { describe, it, expect } from "vitest";
import { resolveGreetingDispatch } from "../../supabase/functions/_shared/greeting-orchestrator.ts";

/**
 * In-memory fake of `greeting_dispatches` table. Respects the unique
 * partial constraint `(org_id, lead_id, window_id)`. Justifies inline
 * fake (vs `createMockSupabase`): helper doesn't enforce unique
 * constraints, which is the entire point of this test.
 */
type DispatchRow = {
  id: string;
  org_id: string;
  lead_id: string;
  phone: string;
  window_id: string;
  source: string;
  greeting_type: string;
  dispatched_at: string;
};

function createFakeSupabase() {
  const rows: DispatchRow[] = [];
  // Helper `createMockSupabase` doesn't enforce unique constraints, which is
  // the SUT here. Inline fake with constraint check is intentional.
  const client = {
    from(table: string) {
      if (table !== "greeting_dispatches") throw new Error(`unexpected table: ${table}`);
      return {
        insert(row: Omit<DispatchRow, "id" | "dispatched_at"> & Partial<Pick<DispatchRow, "id" | "dispatched_at">>) {
          const conflict = rows.find(
            (r) => r.org_id === row.org_id && r.lead_id === row.lead_id && r.window_id === row.window_id,
          );
          if (conflict) {
            return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
          }
          const inserted: DispatchRow = {
            id: row.id ?? crypto.randomUUID(),
            dispatched_at: row.dispatched_at ?? new Date().toISOString(),
            ...row,
          } as DispatchRow;
          rows.push(inserted);
          return { select: () => ({ maybeSingle: async () => ({ data: inserted, error: null }) }) };
        },
      };
    },
  };
  return { client, rows };
}

describe("resolveGreetingDispatch — first caller wins", () => {
  it("first call for (org, lead, window) returns dispatch", async () => {
    const { client } = createFakeSupabase();
    const result = await resolveGreetingDispatch({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      orgId: "org-1",
      agentId: "agent-1",
      leadId: "lead-1",
      phone: "+5515935004596",
      windowId: "out_of_hours_2026-W21-day",
      preferredSource: "copilot",
      greetingType: "out_of_hours",
    });
    expect(result.kind).toBe("dispatch");
    if (result.kind === "dispatch") {
      expect(result.source).toBe("copilot");
      expect(result.greetingType).toBe("out_of_hours");
    }
  });

  it("second call for same (org, lead, window) returns skip", async () => {
    const { client } = createFakeSupabase();
    const args = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      orgId: "org-1",
      agentId: "agent-1",
      leadId: "lead-1",
      phone: "+5515935004596",
      windowId: "out_of_hours_2026-W21-day",
      preferredSource: "copilot" as const,
      greetingType: "out_of_hours",
    };

    const first = await resolveGreetingDispatch(args);
    expect(first.kind).toBe("dispatch");

    // Simulates the 2nd/3rd parallel caller (workflow racing with copilot).
    const second = await resolveGreetingDispatch({ ...args, preferredSource: "workflow" });
    expect(second.kind).toBe("skip");
    if (second.kind === "skip") {
      expect(second.reason).toBe("already_dispatched_in_window");
    }
  });

  it("same lead in a different window dispatches again", async () => {
    const { client } = createFakeSupabase();
    const base = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      orgId: "org-1",
      agentId: "agent-1",
      leadId: "lead-1",
      phone: "+5515935004596",
      preferredSource: "copilot" as const,
      greetingType: "out_of_hours",
    };
    const day1 = await resolveGreetingDispatch({ ...base, windowId: "out_of_hours_2026-W21-day-21" });
    const day2 = await resolveGreetingDispatch({ ...base, windowId: "out_of_hours_2026-W21-day-22" });
    expect(day1.kind).toBe("dispatch");
    expect(day2.kind).toBe("dispatch");
  });

  it("different orgs are independent (tenant isolation)", async () => {
    const { client } = createFakeSupabase();
    const base = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      agentId: "agent-1",
      leadId: "lead-1",
      phone: "+5515935004596",
      windowId: "out_of_hours_2026-W21-day",
      preferredSource: "copilot" as const,
      greetingType: "out_of_hours",
    };
    const a = await resolveGreetingDispatch({ ...base, orgId: "org-A" });
    const b = await resolveGreetingDispatch({ ...base, orgId: "org-B" });
    expect(a.kind).toBe("dispatch");
    expect(b.kind).toBe("dispatch");
  });
});
