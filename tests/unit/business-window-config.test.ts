import { expect, it } from "vitest";
import { findNodeConfigIssues } from "../../src/contracts/workflows/node-requirements";
const w = { id: "window", name: "Comercial", days: ["mon"], start: "08:00", end: "18:00", action: "pass" };
const node = (windows = [w]) => ({ id: "bw", type: "wait_business_window", data: { label: "Janela", windows } });

it("aceita configuração válida e legado", () => {
  expect(findNodeConfigIssues([node()])).toEqual([]);
  expect(findNodeConfigIssues([{ id: "old", type: "wait_business_window", data: {} }])).toEqual([]);
});
it.each([{ days: [] }, { start: "25:00" }, { end: "" }, { action: "route:" }])("recusa ativação de janela inválida %j", patch => {
  expect(findNodeConfigIssues([node([{ ...w, ...patch }])])).not.toHaveLength(0);
});
it("recusa fuso inválido", () => {
  expect(findNodeConfigIssues([{ ...node(), data: { ...node().data, timezone: "bad/zone" } }])[0].missing).toContain("fuso");
});
it("aceita horário noturno e janela de 24 horas", () => {
  expect(findNodeConfigIssues([node([{ ...w, start: "22:00", end: "06:00" }])])).toEqual([]);
  expect(findNodeConfigIssues([node([{ ...w, start: "08:00", end: "08:00" }])])).toEqual([]);
});
it("exige conectar a saída nomeada ao destino existente", () => {
  const routed = node([{ ...w, action: "route:morning" }]);
  expect(findNodeConfigIssues([routed], [])[0].missing).toContain("conectar");
  expect(findNodeConfigIssues([routed, { id: "end", type: "end", data: {} }], [{ source: "bw", target: "end", sourceHandle: "morning" }])).toEqual([]);
});
it("detecta uma conexão antiga quando a saída foi removida", () => {
  expect(findNodeConfigIssues([node()], [{ source: "bw", target: "end", sourceHandle: "old" }])[0].missing).toContain("reconectar");
});
it("impede repetir o desenho que interrompe os ramos da Pesco", () => {
  const nodes = [{ id: "trigger", type: "trigger", data: {} }, node(), { ...node(), id: "other" }];
  expect(findNodeConfigIssues(nodes, [{ source: "trigger", target: "bw" }, { source: "trigger", target: "other" }])[0].nodeId).toBe("trigger");
});
it("não bloqueia janelas escolhidas por saídas distintas de condição", () => {
  const nodes = [{ id: "condition", type: "condition", data: {} }, node(), { ...node(), id: "other" }];
  expect(findNodeConfigIssues(nodes, [{ source: "condition", target: "bw", sourceHandle: "yes" }, { source: "condition", target: "other", sourceHandle: "no" }])).toEqual([]);
});
