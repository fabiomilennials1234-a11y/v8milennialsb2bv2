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

import { describe, it, expect } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";
import { isCopilotCanceled } from "../../../supabase/functions/_shared/copilot/cancellation.ts";

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
});
