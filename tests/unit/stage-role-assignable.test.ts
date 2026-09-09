// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planAssignableStageRoles } from "../../supabase/functions/_shared/metrics/stage-role-classifier";
describe("classificador ativo — nenhuma escrita financeira na etapa", () => {
  const stage = (id: string, name: string, flags = {}) => ({ id, name, pipelineType: null, stageKey: `custom-${id}`, ...flags });
  it("ignora nomes de ganho/perda e flags terminais, preservando reuniões", () => {
    const plan = planAssignableStageRoles([
      stage("venda", "Venda fechada"), stage("perda", "Perdido"), stage("flag", "Contato", { isFinalPositive: true }),
      stage("agendada", "Reunião marcada"), stage("feita", "Compareceu"),
    ]);
    expect(plan.items.map((item) => item.role)).toEqual(["meeting_booked", "meeting_held"]);
    expect(plan.items.every((item) => item.action === "auto_apply")).toBe(true);
  });
  it("também recusa ganho/perda sugeridos pela IA", () => {
    expect(planAssignableStageRoles([stage("x", "Interessante")], { x: "won" }).items).toEqual([]);
    expect(planAssignableStageRoles([stage("x", "Interessante")], { x: "lost" }).items).toEqual([]);
  });
});
