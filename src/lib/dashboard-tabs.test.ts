import { describe, it, expect } from "vitest";
import { getDashboardTabs, getDefaultTab } from "./dashboard-tabs";

describe("getDashboardTabs — visibilidade por role", () => {
  it("membro vê só 'Meus Números'", () => {
    const tabs = getDashboardTabs({ role: "member", isMaster: false });
    const visible = tabs.filter((t) => t.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("meus-numeros");
    expect(visible[0].label).toBe("Meus Números");
  });

  it("admin vê 3 tabs: Resultado, Time, Meus Números", () => {
    const tabs = getDashboardTabs({ role: "admin", isMaster: false });
    const visible = tabs.filter((t) => t.visible);
    expect(visible).toHaveLength(3);
    expect(visible.map((t) => t.id)).toEqual(["resultado", "time", "meus-numeros"]);
  });

  it("master vê 3 tabs", () => {
    const tabs = getDashboardTabs({ role: "member", isMaster: true });
    const visible = tabs.filter((t) => t.visible);
    expect(visible).toHaveLength(3);
  });

  it("role null (loading) → nenhuma tab visível (fail-closed)", () => {
    const tabs = getDashboardTabs({ role: null, isMaster: false });
    const visible = tabs.filter((t) => t.visible);
    expect(visible).toHaveLength(0);
  });
});

describe("getDefaultTab — tab padrão por role", () => {
  it("membro cai em 'Meus Números'", () => {
    expect(getDefaultTab({ role: "member", isMaster: false })).toBe("meus-numeros");
  });

  it("admin cai em 'Resultado'", () => {
    expect(getDefaultTab({ role: "admin", isMaster: false })).toBe("resultado");
  });

  it("master cai em 'Resultado'", () => {
    expect(getDefaultTab({ role: "member", isMaster: true })).toBe("resultado");
  });

  it("role null cai em 'Meus Números' (fail-closed)", () => {
    expect(getDefaultTab({ role: null, isMaster: false })).toBe("meus-numeros");
  });
});
