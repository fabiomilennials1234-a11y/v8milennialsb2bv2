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
        captured.lastInsert = row;
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

import { logRuntime } from "../../supabase/functions/_shared/logger";
import { gestorRuntimeActor } from "../../supabase/functions/_shared/gestor-auth";

beforeEach(() => {
  captured.lastInsert = null;
});

describe("logRuntime — atribuição de ator (ADR-0021 §7)", () => {
  it("log de gestor grava actor_type='gestor' + gestor_id + triggered_by real", async () => {
    await logRuntime({
      ...gestorRuntimeActor("user-real-123", "gestor-abc"),
      organizationId: "org-A",
      module: "carteira",
      action: "carteira_bulk_message",
      status: "success",
    });

    expect(captured.lastInsert).toMatchObject({
      actor_type: "gestor",
      gestor_id: "gestor-abc",
      triggered_by: "user-real-123",
      organization_id: "org-A",
    });
  });

  it("log normal NÃO referencia colunas de atribuição de gestor (zero regressão pré-apply)", async () => {
    await logRuntime({
      organizationId: "org-A",
      module: "pipe_dispatch",
      action: "dispatch",
      status: "success",
      triggeredBy: "member-1",
    });

    expect(captured.lastInsert).not.toHaveProperty("actor_type");
    expect(captured.lastInsert).not.toHaveProperty("gestor_id");
    expect(captured.lastInsert).toMatchObject({ triggered_by: "member-1" });
  });

  it("actorType sem gestorId grava actor_type mas omite gestor_id", async () => {
    await logRuntime({
      actorType: "master",
      organizationId: "org-A",
      module: "permission",
      action: "master_action",
      status: "success",
    });

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
