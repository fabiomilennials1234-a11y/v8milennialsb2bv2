/**
 * audience-gate — veto org-wide pra inbound de phone desconhecido.
 *
 * Regressao: bug Distetica 2026-05-21 — filtro is_default=true fazia gate
 * bypassar quando org nao tinha agente flagged default. Agora qualquer
 * agente ativo com attend_unknown_contacts=false bloqueia.
 */

import { describe, it, expect, vi } from "vitest";

vi.stubGlobal("Deno", {
  env: { get: () => undefined, toObject: () => ({}) },
  serve: () => {},
});

const { checkAudienceGate } = await import(
  "../../supabase/functions/agent-message/audience-gate.ts"
);

type MaybeSingleResult<T> = { data: T | null };

function makeSupabase(opts: {
  existingLead?: { id: string } | null;
  blockingAgent?: { id: string } | null;
}) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];

  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      limit: () => chain,
      maybeSingle: async (): Promise<MaybeSingleResult<unknown>> => {
        calls.push({ table, filters });
        if (table === "leads") return { data: opts.existingLead ?? null };
        if (table === "copilot_agents") return { data: opts.blockingAgent ?? null };
        return { data: null };
      },
    };
    return chain;
  };

  return {
    supabase: { from: builder } as any,
    calls,
  };
}

describe("checkAudienceGate", () => {
  it("blocks when an active agent has attend_unknown_contacts=false (not default)", async () => {
    // Regressao Distetica: agente sozinho, is_default=false, deve bloquear.
    const { supabase, calls } = makeSupabase({
      existingLead: null,
      blockingAgent: { id: "agent-1" },
    });

    const result = await checkAudienceGate(supabase, "org-1", "5511999999999");

    expect(result).toEqual({ blocked: true, agentId: "agent-1" });
    const agentCall = calls.find((c) => c.table === "copilot_agents");
    expect(agentCall?.filters).toMatchObject({
      organization_id: "org-1",
      is_active: true,
      attend_unknown_contacts: false,
    });
    expect(agentCall?.filters).not.toHaveProperty("is_default");
  });

  it("passes when no agent has attend_unknown_contacts=false", async () => {
    const { supabase } = makeSupabase({ existingLead: null, blockingAgent: null });
    const result = await checkAudienceGate(supabase, "org-1", "5511999999999");
    expect(result).toEqual({ blocked: false });
  });

  it("bypasses gate when lead with phone already exists", async () => {
    const { supabase, calls } = makeSupabase({
      existingLead: { id: "lead-1" },
      blockingAgent: { id: "agent-1" },
    });

    const result = await checkAudienceGate(supabase, "org-1", "5511999999999");

    expect(result).toEqual({ blocked: false });
    // copilot_agents query nao deve rodar quando lead ja existe
    expect(calls.find((c) => c.table === "copilot_agents")).toBeUndefined();
  });
});
