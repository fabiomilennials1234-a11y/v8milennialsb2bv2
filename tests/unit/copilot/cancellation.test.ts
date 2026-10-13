/* eslint-disable @typescript-eslint/no-explicit-any -- dublê estrutural do cliente Supabase */
/**
 * RC-cancel: testa isCopilotCanceled — gate compartilhado pra parar envios
 * em-flight quando user desativa copilot mid-flight.
 *
 * Cobre:
 * - Source phone_ai_preferences (fonte de verdade)
 * - Source leads (fallback)
 * - Default false quando nada match
 * - Fail-open em erro DB
 * - Phone normalization
 */

import { describe, it, expect, vi } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";
import { isCopilotCanceled, reactivateSystemDisabledContact } from "../../../supabase/functions/_shared/copilot/cancellation.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
// Canonical format = normalizePhoneForSearch output: 11 dígitos, SEM prefixo 55.
const NORMALIZED = "11987654321";

describe("isCopilotCanceled", () => {
  it("phone_ai_preferences ai_disabled=true → canceled=true", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true },
    ]);

    const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
    expect(r.canceled).toBe(true);
    expect(r.ai_disabled).toBe(true);
    expect(r.source).toBe("phone_ai_preferences");
  });

  it("phone_ai_preferences ai_disabled=false → canceled=false", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: false },
    ]);

    const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
    expect(r.canceled).toBe(false);
    expect(r.source).toBe("phone_ai_preferences");
  });

  it("sem preference → fallback leads.ai_disabled=true", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("phone_ai_preferences", []);
    mockTable("leads", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, created_at: "2026-04-26T00:00:00Z" },
    ]);

    const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
    expect(r.canceled).toBe(true);
    expect(r.source).toBe("leads");
  });

  it("sem preference + sem lead → default false", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("phone_ai_preferences", []);
    mockTable("leads", []);

    const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
    expect(r.canceled).toBe(false);
    expect(r.source).toBe("default");
  });

  it("phone vazio → default false (sem chamada DB)", async () => {
    const { sb } = createMockSupabase();
    const r = await isCopilotCanceled(sb, ORG, "");
    expect(r.canceled).toBe(false);
    expect(r.source).toBe("default");
  });

  it("organizationId vazio → default false", async () => {
    const { sb } = createMockSupabase();
    const r = await isCopilotCanceled(sb, "", "+5511987654321");
    expect(r.canceled).toBe(false);
    expect(r.source).toBe("default");
  });

  it("phone inválido (não normaliza) → default false", async () => {
    const { sb } = createMockSupabase();
    const r = await isCopilotCanceled(sb, ORG, "abc");
    expect(r.canceled).toBe(false);
    expect(r.source).toBe("default");
  });

  it("human_paused_until no futuro → canceled=true, source=human_pause", async () => {
    const { sb, mockTable } = createMockSupabase();
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: false, human_paused_until: future },
    ]);

    const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
    expect(r.canceled).toBe(true);
    expect(r.source).toBe("human_pause");
  });

  it("human_paused_until no passado → canceled=false", async () => {
    const { sb, mockTable } = createMockSupabase();
    const past = new Date(Date.now() - 60_000).toISOString();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: false, human_paused_until: past },
    ]);

    const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
    expect(r.canceled).toBe(false);
    expect(r.source).toBe("phone_ai_preferences");
  });

  it("ai_disabled=true tem prioridade sobre human pause", async () => {
    const { sb, mockTable } = createMockSupabase();
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, human_paused_until: future },
    ]);

    const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
    expect(r.canceled).toBe(true);
    expect(r.ai_disabled).toBe(true);
    expect(r.source).toBe("phone_ai_preferences");
  });

  it("phone_ai_preferences vence leads (fonte de verdade)", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: false },
    ]);
    mockTable("leads", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, created_at: "2026-04-26T00:00:00Z" },
    ]);

    const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
    expect(r.canceled).toBe(false);
    expect(r.source).toBe("phone_ai_preferences");
  });

  // systemDisabled: distingue bulk do sistema (reativável no inbound) de
  // desligamento manual / pausa humana (segue bloqueando).
  describe("systemDisabled", () => {
    it("pref ai_disabled=true com set_by NULL → systemDisabled=true (bulk sistema)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("phone_ai_preferences", [
        { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, set_by: null },
      ]);
      const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
      expect(r.canceled).toBe(true);
      expect(r.systemDisabled).toBe(true);
    });

    it("H2: pref ai_disabled=true, set_by NULL e motivo 'handoff' → systemDisabled=false (transferência é pegajosa)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("phone_ai_preferences", [
        { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, set_by: null, disabled_reason: "handoff" },
      ]);
      const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
      expect(r.canceled).toBe(true);
      expect(r.source).toBe("phone_ai_preferences");
      expect(r.systemDisabled).toBe(false);
    });

    it("controle bulk: set_by NULL e motivo NULL explícito → systemDisabled=true", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("phone_ai_preferences", [
        { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, set_by: null, disabled_reason: null },
      ]);
      const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
      expect(r.systemDisabled).toBe(true);
    });

    it("pref ai_disabled=true com set_by preenchido → systemDisabled=false (manual)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("phone_ai_preferences", [
        { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, set_by: "user-123" },
      ]);
      const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
      expect(r.canceled).toBe(true);
      expect(r.systemDisabled).toBe(false);
    });

    it("fallback leads ai_disabled=true sem ai_disabled_at → systemDisabled=true (bulk)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("phone_ai_preferences", []);
      mockTable("leads", [
        { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, ai_disabled_at: null, created_at: "2026-04-26T00:00:00Z" },
      ]);
      const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
      expect(r.canceled).toBe(true);
      expect(r.systemDisabled).toBe(true);
    });

    it("fallback leads ai_disabled=true COM ai_disabled_at → systemDisabled=false (manual)", async () => {
      const { sb, mockTable } = createMockSupabase();
      mockTable("phone_ai_preferences", []);
      mockTable("leads", [
        { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, ai_disabled_at: "2026-05-01T00:00:00Z", created_at: "2026-04-26T00:00:00Z" },
      ]);
      const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
      expect(r.canceled).toBe(true);
      expect(r.systemDisabled).toBe(false);
    });

    it("pausa humana → systemDisabled=false (não reativa)", async () => {
      const { sb, mockTable } = createMockSupabase();
      const future = new Date(Date.now() + 30 * 60_000).toISOString();
      mockTable("phone_ai_preferences", [
        { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: false, human_paused_until: future },
      ]);
      const r = await isCopilotCanceled(sb, ORG, "+55 11 98765-4321");
      expect(r.source).toBe("human_pause");
      expect(r.systemDisabled).toBe(false);
    });
  });

  it("disabledAt = phone_ai_preferences.set_at; humanPauseActive sinalizado mesmo com ai_disabled", async () => {
    const { sb, mockTable } = createMockSupabase();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, set_at: "2026-10-13T12:00:00Z", human_paused_until: future },
    ]);
    const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
    expect(r.disabledAt).toBe("2026-10-13T12:00:00Z");
    expect(r.humanPauseActive).toBe(true);
  });

  it("disabledAt no fallback leads = leads.ai_disabled_at", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("phone_ai_preferences", []);
    mockTable("leads", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, ai_disabled_at: "2026-10-13T12:00:00Z", created_at: "2026-04-26T00:00:00Z" },
    ]);
    const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
    expect(r.source).toBe("leads");
    expect(r.disabledAt).toBe("2026-10-13T12:00:00Z");
  });
});

/**
 * Coluna `disabled_reason` ausente (edge publicada antes da migration
 * 20271120000000 ou depois do rollback): o select com a coluna falha. O gate
 * NÃO pode cair no fallback de leads (perderia a pausa humana) nem religar.
 */
function prefClientMissingReasonColumn(row: Record<string, unknown> | null) {
  const selects: string[] = [];
  const updates: Array<{ table: string; vals: unknown; isFilters: Array<[string, unknown]> }> = [];
  const from = (table: string) => {
    let cols = "";
    let upd: { vals: unknown; isFilters: Array<[string, unknown]> } | null = null;
    const chain: any = {
      select: (c: string) => { cols = c; selects.push(`${table}:${c}`); return chain; },
      update: (vals: unknown) => { upd = { vals, isFilters: [] }; return chain; },
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      is: (f: string, v: unknown) => { upd?.isFilters.push([f, v]); return chain; },
      maybeSingle: () => chain,
      then: (resolve: (v: unknown) => void) => {
        if (upd) {
          updates.push({ table, ...upd });
          const missing = upd.isFilters.some(([f]) => f === "disabled_reason");
          return resolve({ data: null, error: missing ? { code: "42703", message: "column disabled_reason does not exist" } : null });
        }
        if (table === "phone_ai_preferences" && cols.includes("disabled_reason")) {
          return resolve({ data: null, error: { code: "42703", message: "column phone_ai_preferences.disabled_reason does not exist" } });
        }
        if (table === "phone_ai_preferences") return resolve({ data: row, error: null });
        return resolve({ data: { ai_disabled: false, ai_disabled_at: null }, error: null });
      },
    };
    return chain;
  };
  return { sb: { from } as any, selects, updates };
}

describe("isCopilotCanceled — coluna disabled_reason ausente (fail-safe)", () => {
  it("bulk (set_by NULL) segue cancelado mas NÃO religável; não cai no fallback leads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sb, selects } = prefClientMissingReasonColumn({ ai_disabled: true, set_by: null, set_at: "2026-05-28T00:00:00Z", human_paused_until: null });
    const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
    expect(r.canceled).toBe(true);
    expect(r.source).toBe("phone_ai_preferences");
    expect(r.systemDisabled).toBe(false);
    expect(selects.some((s) => s.startsWith("leads:"))).toBe(false);
  });

  it("pausa humana continua valendo pela releitura legada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const future = new Date(Date.now() + 60_000).toISOString();
    const { sb } = prefClientMissingReasonColumn({ ai_disabled: false, set_by: null, set_at: "2026-05-28T00:00:00Z", human_paused_until: future });
    const r = await isCopilotCanceled(sb, ORG, "+5511987654321");
    expect(r.source).toBe("human_pause");
    expect(r.canceled).toBe(true);
  });
});

describe("reactivateSystemDisabledContact — guarda de motivo", () => {
  it("handoff (motivo 'handoff') NÃO é religado; bulk (motivo NULL) é", async () => {
    const { sb, mockTable, getUpdated } = createMockSupabase();
    mockTable("phone_ai_preferences", [
      { organization_id: ORG, normalized_phone: NORMALIZED, ai_disabled: true, set_by: null, disabled_reason: "handoff" },
      { organization_id: ORG, normalized_phone: "11911112222", ai_disabled: true, set_by: null, disabled_reason: null },
    ]);
    mockTable("leads", []);
    await reactivateSystemDisabledContact(sb, ORG, "+5511987654321", null);
    expect(getUpdated("phone_ai_preferences")).toHaveLength(0);
    await reactivateSystemDisabledContact(sb, ORG, "+5511911112222", null);
    expect(getUpdated("phone_ai_preferences")).toHaveLength(1);
  });

  it("guard filtra set_by IS NULL E disabled_reason IS NULL no UPDATE", async () => {
    const { sb, updates } = prefClientMissingReasonColumn(null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await reactivateSystemDisabledContact(sb, ORG, "+5511987654321", null);
    const prefUpd = updates.find((u) => u.table === "phone_ai_preferences");
    expect(prefUpd?.isFilters).toEqual([["set_by", null], ["disabled_reason", null]]);
  });
});
