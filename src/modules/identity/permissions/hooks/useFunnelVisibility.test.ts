import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFunnelVisibilityLevel } from "./useFunnelVisibility";

const identity = vi.hoisted(() => ({
  value: { isAdmin: false, features: {} as Record<string, boolean>, isLoading: false },
}));
vi.mock("../../auth/hooks/useIdentity", () => ({ useIdentity: () => identity.value }));

const LEADS_ALL = {
  "leads.view_all": true,
  "leads.view_unassigned": true,
  "leads.view_subordinates": true,
};
const LEADS_OWN = {
  "leads.view_all": false,
  "leads.view_unassigned": false,
  "leads.view_subordinates": false,
};

describe("useFunnelVisibilityLevel", () => {
  beforeEach(() => {
    identity.value = { isAdmin: false, features: {}, isLoading: false };
  });

  it("membro com Leads 'todos' e a chave no default: 'all'", () => {
    identity.value.features = { ...LEADS_ALL, "pipeline.view_all": true };
    expect(renderHook(() => useFunnelVisibilityLevel()).result.current).toBe("all");
  });

  it("membro com Leads 'todos' e pipeline.view_all=false: 'own'", () => {
    identity.value.features = { ...LEADS_ALL, "pipeline.view_all": false };
    expect(renderHook(() => useFunnelVisibilityLevel()).result.current).toBe("own");
  });

  it("Leads 'só os meus' rebaixa o Funil mesmo com a chave ligada", () => {
    identity.value.features = { ...LEADS_OWN, "pipeline.view_all": true };
    expect(renderHook(() => useFunnelVisibilityLevel()).result.current).toBe("own");
  });

  it("admin/master (isAdmin) é sempre 'all' — o banco libera por org", () => {
    identity.value = { isAdmin: true, features: { ...LEADS_OWN, "pipeline.view_all": false }, isLoading: false };
    expect(renderHook(() => useFunnelVisibilityLevel()).result.current).toBe("all");
  });

  it("enquanto as permissões carregam, não esconde nada", () => {
    identity.value = { isAdmin: false, features: {}, isLoading: true };
    expect(renderHook(() => useFunnelVisibilityLevel()).result.current).toBe("all");
  });
});
