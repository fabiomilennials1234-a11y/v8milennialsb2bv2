/**
 * Unit tests — Gestor de Portfólio no server-side (ADR-0021 §6, S3 #1139).
 *
 * Cobre o módulo compartilhado `_shared/gestor-auth.ts` e o reconhecimento do
 * Gestor nos choke points `permission_engine.ts` (canUserPerformAction /
 * canUserAccessFeature). Mock do client Supabase via createMockSupabase.
 */

import { describe, it, expect, vi } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

// Mock logger (evita side effects de logRuntime/logDenied)
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

setDenoEnv("SUPABASE_URL", "https://test.supabase.co");
setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

import {
  getActiveGestorForOrg,
  gestorRuntimeActor,
  isActiveGestorForOrg,
  isGestorDeniedFeature,
  GESTOR_DENIED_ACTIONS,
} from "../../supabase/functions/_shared/gestor-auth";
import {
  canUserPerformAction,
  canUserAccessFeature,
} from "../../supabase/functions/_shared/permission_engine";

// Helpers ────────────────────────────────────────────────
function seedGestor(
  mockTable: (t: string, r: unknown[]) => void,
  opts: { userId: string; gestorId: string; boundOrgs: string[]; active?: boolean },
) {
  mockTable("gestores", [
    { id: opts.gestorId, user_id: opts.userId, is_active: opts.active ?? true },
  ]);
  mockTable(
    "gestor_organizations",
    opts.boundOrgs.map((orgId, i) => ({
      id: `bind-${i}`,
      gestor_id: opts.gestorId,
      organization_id: orgId,
    })),
  );
}

// ─── Carve-out helpers (pure) ────────────────────────────

describe("gestor carve-outs — pure helpers", () => {
  it("GESTOR_DENIED_ACTIONS contém manage_team (roster) e não send_message", () => {
    expect(GESTOR_DENIED_ACTIONS.has("manage_team")).toBe(true);
    expect(GESTOR_DENIED_ACTIONS.has("send_message")).toBe(false);
    expect(GESTOR_DENIED_ACTIONS.has("move_pipe_record")).toBe(false);
  });

  it("isGestorDeniedFeature nega roster/billing e libera operacional", () => {
    expect(isGestorDeniedFeature("team.view")).toBe(true);
    expect(isGestorDeniedFeature("team.create_member")).toBe(true);
    expect(isGestorDeniedFeature("team.manage_permissions")).toBe(true);
    expect(isGestorDeniedFeature("billing.plan")).toBe(true);
    expect(isGestorDeniedFeature("leads.view_all")).toBe(false);
    expect(isGestorDeniedFeature("workflows.edit")).toBe(false);
    expect(isGestorDeniedFeature("whatsapp.send_messages")).toBe(false);
  });
});

// ─── isActiveGestorForOrg ────────────────────────────────

describe("isActiveGestorForOrg", () => {
  it("true quando gestor ativo vinculado à org", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    expect(await isActiveGestorForOrg(sb, "u-g", "org-A")).toBe(true);
  });

  it("false quando gestor ativo mas NÃO vinculado à org", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    expect(await isActiveGestorForOrg(sb, "u-g", "org-B")).toBe(false);
  });

  it("false quando gestor inativo", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"], active: false });
    expect(await isActiveGestorForOrg(sb, "u-g", "org-A")).toBe(false);
  });

  it("false quando usuário não é gestor", async () => {
    const { sb } = createMockSupabase();
    expect(await isActiveGestorForOrg(sb, "u-normal", "org-A")).toBe(false);
  });

  it("false para argumentos vazios (fail-closed)", async () => {
    const { sb } = createMockSupabase();
    expect(await isActiveGestorForOrg(sb, "", "org-A")).toBe(false);
    expect(await isActiveGestorForOrg(sb, "u-g", "")).toBe(false);
  });

  it("fail-closed: erro/throw do client nega (não abre acesso)", async () => {
    const throwingClient = {
      from: () => {
        throw new Error("db down");
      },
    };
    expect(await isActiveGestorForOrg(throwingClient, "u-g", "org-A")).toBe(false);
  });
});

// ─── getActiveGestorForOrg (atribuição — ADR-0021 §7) ────

describe("getActiveGestorForOrg", () => {
  it("retorna o gestores.id REAL quando gestor ativo vinculado à org", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g-real-1", boundOrgs: ["org-A"] });
    expect(await getActiveGestorForOrg(sb, "u-g", "org-A")).toEqual({ gestorId: "g-real-1" });
  });

  it("null quando gestor ativo mas NÃO vinculado à org (fail-closed)", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g-real-1", boundOrgs: ["org-A"] });
    expect(await getActiveGestorForOrg(sb, "u-g", "org-B")).toBeNull();
  });

  it("null quando gestor inativo", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"], active: false });
    expect(await getActiveGestorForOrg(sb, "u-g", "org-A")).toBeNull();
  });

  it("null para não-gestor e para argumentos vazios", async () => {
    const { sb } = createMockSupabase();
    expect(await getActiveGestorForOrg(sb, "u-normal", "org-A")).toBeNull();
    expect(await getActiveGestorForOrg(sb, "", "org-A")).toBeNull();
    expect(await getActiveGestorForOrg(sb, "u-g", "")).toBeNull();
  });

  it("nunca devolve o virtual member como id — só o gestores.id real", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g-real-1", boundOrgs: ["org-A"] });
    const ctx = await getActiveGestorForOrg(sb, "u-g", "org-A");
    expect(ctx?.gestorId).toBe("g-real-1");
    expect(ctx?.gestorId).not.toContain("virtual");
  });
});

describe("gestorRuntimeActor — helper puro", () => {
  it("atribui ao ator real (triggeredBy=user.id, gestorId=gestores.id)", () => {
    expect(gestorRuntimeActor("u-1", "g-1")).toEqual({
      actorType: "gestor",
      gestorId: "g-1",
      triggeredBy: "u-1",
    });
  });
});

// ─── canUserPerformAction — gestor branch ────────────────

describe("canUserPerformAction — Gestor de Portfólio", () => {
  it("gestor vinculado é autorizado em ação operacional (send_message)", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    const r = await canUserPerformAction({
      supabase: sb, userId: "u-g", organizationId: "org-A", action: "send_message",
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("gestor_scoped_master");
  });

  it("gestor vinculado é autorizado em move_pipe_record", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    const r = await canUserPerformAction({
      supabase: sb, userId: "u-g", organizationId: "org-A", action: "move_pipe_record",
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("gestor_scoped_master");
  });

  it("gestor NÃO-vinculado à org é negado", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    const r = await canUserPerformAction({
      supabase: sb, userId: "u-g", organizationId: "org-B", action: "send_message",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("não pertence");
  });

  it("gestor é NEGADO em carve-out de roster (manage_team)", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    const r = await canUserPerformAction({
      supabase: sb, userId: "u-g", organizationId: "org-A", action: "manage_team",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("restrita");
  });
});

// ─── canUserAccessFeature — gestor branch ────────────────

describe("canUserAccessFeature — Gestor de Portfólio", () => {
  it("gestor vinculado acessa feature operacional", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    expect(await canUserAccessFeature(sb, "u-g", "org-A", "workflows.edit")).toBe(true);
  });

  it("gestor vinculado é NEGADO em feature de roster (team.*)", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    expect(await canUserAccessFeature(sb, "u-g", "org-A", "team.create_member")).toBe(false);
  });

  it("gestor NÃO-vinculado é negado", async () => {
    const { sb, mockTable } = createMockSupabase();
    seedGestor(mockTable, { userId: "u-g", gestorId: "g1", boundOrgs: ["org-A"] });
    expect(await canUserAccessFeature(sb, "u-g", "org-B", "workflows.edit")).toBe(false);
  });
});
