/**
 * Unit tests — atribuição do ator real em runtime_logs (ADR-0021 §7, S6 #1142).
 *
 * Cobre a fiação em `_shared/logger.ts`: uma escrita de Gestor de Portfólio é
 * marcada com `actor_type: 'gestor'` + `gestor_id` (o gestores.id REAL), e um
 * log normal NÃO referencia essas colunas — o insert mantém a mesma forma, para
 * não cair no drop silencioso enquanto a migration 20270211000003 não rodou.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";

// Captura a última linha passada a runtime_logs.insert(...).
const captured = vi.hoisted(() => ({ lastInsert: null as Record<string, unknown> | null }));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        captured.lastInsert = Array.isArray(row) ? row[0] : row;
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

import { logRuntime, flushRuntimeLogs } from "../../supabase/functions/_shared/logger";
import { gestorRuntimeActor } from "../../supabase/functions/_shared/gestor-auth";

beforeEach(() => {
  captured.lastInsert = null;
});

describe("logRuntime — atribuição de ator (ADR-0021 §7)", () => {
  it("log de gestor grava actor_type='gestor' + gestor_id + triggered_by real", async () => {
    await logRuntime({
      ...gestorRuntimeActor("11111111-1111-4111-8111-111111111111", "gestor-abc"),
      organizationId: "org-A",
      module: "carteira",
      action: "carteira_bulk_message",
      status: "success",
    });
    await flushRuntimeLogs();

    expect(captured.lastInsert).toMatchObject({
      actor_type: "gestor",
      gestor_id: "gestor-abc",
      triggered_by: "11111111-1111-4111-8111-111111111111",
      organization_id: "org-A",
    });
  });

  it("log normal NÃO referencia colunas de atribuição de gestor (zero regressão pré-apply)", async () => {
    await logRuntime({
      organizationId: "org-A",
      module: "pipe_dispatch",
      action: "dispatch",
      status: "success",
      triggeredBy: "22222222-2222-4222-8222-222222222222",
    });
    await flushRuntimeLogs();

    expect(captured.lastInsert).not.toHaveProperty("actor_type");
    expect(captured.lastInsert).not.toHaveProperty("gestor_id");
    expect(captured.lastInsert).toMatchObject({ triggered_by: "22222222-2222-4222-8222-222222222222" });
  });

  it("actorType sem gestorId grava actor_type mas omite gestor_id", async () => {
    await logRuntime({
      actorType: "master",
      organizationId: "org-A",
      module: "permission",
      action: "master_action",
      status: "success",
    });
    await flushRuntimeLogs();

    expect(captured.lastInsert).toMatchObject({ actor_type: "master" });
    expect(captured.lastInsert).not.toHaveProperty("gestor_id");
  });
});

describe("gestorRuntimeActor — helper puro", () => {
  it("mapeia ator real: triggeredBy = user.id, gestorId = gestores.id, actorType = gestor", () => {
    expect(gestorRuntimeActor("u-1", "g-1")).toEqual({
      actorType: "gestor",
      gestorId: "g-1",
      triggeredBy: "u-1",
    });
  });
});

describe("logRuntime — triggered_by não-UUID", () => {
  // Incidente 18/11/2026: triggeredBy "system" → 22P02 no cast para uuid →
  // PostgREST 400 → o lote inteiro (até 100 linhas) perdido. 46 mil por dia.
  it.each(["system", "user", "workflow", "master-virtual-6f5ef0f3-abb3-4a26-add8-a1f080df6df5"])(
    "rótulo %s vira triggered_by null e sobrevive no payload",
    async (label) => {
      await logRuntime({
        module: "calendar",
        action: "sync",
        status: "error",
        triggeredBy: label,
        payloadSnapshot: { channelId: "ch-1" },
      });
      await flushRuntimeLogs();

      expect(captured.lastInsert).toMatchObject({
        triggered_by: null,
        payload_snapshot: { channelId: "ch-1", triggered_by_label: label },
      });
    },
  );

  it("uuid real passa intacto e não ganha rótulo", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    await logRuntime({ module: "calendar", action: "sync", status: "error", triggeredBy: id });
    await flushRuntimeLogs();

    expect(captured.lastInsert).toMatchObject({ triggered_by: id, payload_snapshot: null });
  });
});
