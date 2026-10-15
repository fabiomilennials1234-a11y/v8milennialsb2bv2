/**
 * LegacyMenuCard — cartão do nó legado `send_whatsapp_menu`.
 *
 * Prende a concordância com `convertLegacyMenuNode`: o que o cartão risca e o
 * aviso de corte têm que ser exatamente o que a conversão descarta.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ActionNodeData, QuestionButtonsNodeData, WorkflowNode } from "@/types/workflow";
import { convertLegacyMenuNode } from "@/modules/workflows/lib/convertLegacyMenuNode";
import { LegacyMenuCard } from "../sidebar-panels/LegacyMenuCard";

function legacyData(menuChoices: string[]): ActionNodeData {
  return { type: "action", actionType: "send_whatsapp_menu", label: "Menu", menuText: "Escolha", menuChoices } as ActionNodeData;
}

function renderCard(menuChoices: string[]) {
  render(<LegacyMenuCard data={legacyData(menuChoices)} />);
  const items = within(screen.getByRole("list", { name: "Opções do menu" })).getAllByRole("listitem");
  return {
    shown: items.map(item => item.textContent),
    struck: items.filter(item => item.className.includes("line-through")).map(item => item.textContent),
    warns: screen.queryByText(/só as 3 primeiras/) !== null,
  };
}

function convert(menuChoices: string[]) {
  const node: WorkflowNode = { id: "a1", type: "action", position: { x: 0, y: 0 }, data: legacyData(menuChoices) };
  const out = convertLegacyMenuNode(node, []);
  return { kept: (out.node.data as QuestionButtonsNodeData).buttons.map(button => button.label), dropped: out.droppedChoices };
}

describe("LegacyMenuCard", () => {
  it("[A, a, B, C]: não risca nada nem avisa corte, igual à conversão (que mantém A, B, C)", () => {
    const choices = ["A", "a", "B", "C"];
    const card = renderCard(choices);
    const conversion = convert(choices);
    expect(conversion).toEqual({ kept: ["A", "B", "C"], dropped: [] });
    expect(card.shown).toEqual(conversion.kept);
    expect(card.struck).toEqual(conversion.dropped);
    expect(card.warns).toBe(false);
  });

  it("acima do limite: risca e avisa exatamente o que a conversão descarta", () => {
    const choices = ["A|1", "a|2", "B", "C", "D|4"];
    const card = renderCard(choices);
    const conversion = convert(choices);
    expect(conversion.dropped).toEqual(["D"]);
    expect(card.struck).toEqual(conversion.dropped);
    expect(card.shown).toEqual([...conversion.kept, ...conversion.dropped]);
    expect(card.warns).toBe(true);
  });
});
