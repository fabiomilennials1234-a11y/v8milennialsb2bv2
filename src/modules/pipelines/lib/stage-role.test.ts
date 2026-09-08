import { describe, expect, it } from "vitest";
import { STAGE_ROLES, STAGE_ROLES_ATRIBUIVEIS, papelAtribuivel } from "./stage-role";
import { classifyStageRole } from "./stage-role-classifier";

describe("etapas não decidem ganho/perda", () => {
  it("preserva a leitura do legado sem permitir atribuição nova", () => {
    expect(STAGE_ROLES).toEqual(expect.arrayContaining(["won", "lost"]));
    expect(STAGE_ROLES_ATRIBUIVEIS).toEqual(["open", "meeting_booked", "meeting_held"]);
  });
  it.each(["Venda fechada", "Perdido", "Recompra"])("nome %s não pré-preenche dinheiro", (name) => {
    expect(papelAtribuivel(classifyStageRole({ name })?.role)).toBe("open");
  });
  it("preserva os eventos de reunião", () => {
    expect(papelAtribuivel(classifyStageRole({ name: "Reunião marcada" })?.role)).toBe("meeting_booked");
    expect(papelAtribuivel(classifyStageRole({ name: "Compareceu" })?.role)).toBe("meeting_held");
  });
});
