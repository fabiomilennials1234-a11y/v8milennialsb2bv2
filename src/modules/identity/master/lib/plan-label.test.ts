import { describe, expect, it } from "vitest";
import { planLabel, type PlanCatalogEntry } from "./plan-label";

const catalog = new Map<string, PlanCatalogEntry>([
  ["torque-v8", { name: "torque-v8", display_name: "Torque Copilot" }],
  ["torque-2.0", { name: "torque-2.0", display_name: "Torque Automation" }],
  ["legado", { name: "legado", display_name: "  " }],
]);

describe("planLabel", () => {
  it("troca a chave pelo nome comercial", () => {
    expect(planLabel("torque-v8", catalog)).toBe("Torque Copilot");
    expect(planLabel("torque-2.0", catalog)).toBe("Torque Automation");
  });

  it("sem plano", () => {
    expect(planLabel(null, catalog)).toBe("Sem plano");
    expect(planLabel("", catalog)).toBe("Sem plano");
  });

  it("chave fora do catálogo, nome em branco ou catálogo carregando: mostra a chave", () => {
    expect(planLabel("enterprise-x", catalog)).toBe("enterprise-x");
    expect(planLabel("legado", catalog)).toBe("legado");
    expect(planLabel("torque-v8", undefined)).toBe("torque-v8");
  });
});
