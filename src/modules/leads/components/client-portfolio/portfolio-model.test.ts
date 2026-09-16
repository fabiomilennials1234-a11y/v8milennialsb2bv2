import { describe, expect, it } from "vitest";
import { calcularCicloDeRecompra } from "../../lib/reorder-cycle";
import {
  cycleDate,
  filterPortfolio,
  portfolioDate,
  reorderLabel,
  reorderStatus,
  type PortfolioClient,
} from "./portfolio-model";
const now = Date.parse("2026-09-16T12:00:00Z");
const cycle = calcularCicloDeRecompra(["2026-07-17", "2026-08-14"], now);
describe("Carteira em Leads", () => {
  it("separa atraso de faixa e preserva negócio aberto", () => {
    expect(cycle.mediaDias).toBe(28);
    expect(reorderStatus(cycle)).toBe("late");
    expect(reorderLabel(cycle)).toBe("5 dias em atraso");
    expect(portfolioDate(cycleDate(cycle.diasRestantes, now))).toBe("11 set");
  });
  it("não inventa previsão com nenhuma ou uma compra", () => {
    expect(reorderStatus()).toBe("unknown");
    expect(reorderLabel(calcularCicloDeRecompra(["2026-09-10"], now))).toBe(
      "Aguardando segunda compra",
    );
    expect(cycleDate(null, now)).toBeNull();
  });
  it("prevê hoje e distingue janela de sete dias", () => {
    expect(reorderLabel({ ...cycle, diasRestantes: 0 })).toBe(
      "Previsto para hoje",
    );
    expect(reorderStatus({ ...cycle, diasRestantes: 7 })).toBe("soon");
    expect(reorderStatus({ ...cycle, diasRestantes: 8 })).toBe("on-time");
  });
  it("filtra valor e momento independentemente sem inventar Bronze", () => {
    const clients = [
      { id: "1", cycle, metrics: { segment: "ouro" } },
      { id: "2", cycle },
      {
        id: "3",
        cycle: { ...cycle, diasRestantes: 10 },
        metrics: { segment: "ouro" },
      },
    ] as PortfolioClient[];
    expect(filterPortfolio(clients, "ouro", "late").map((c) => c.id)).toEqual([
      "1",
    ]);
    expect(filterPortfolio(clients, "none", "all").map((c) => c.id)).toEqual([
      "2",
    ]);
    expect(filterPortfolio(clients, "bronze", "all")).toEqual([]);
  });
});
