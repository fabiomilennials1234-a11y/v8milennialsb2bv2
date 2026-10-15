/**
 * convertLegacyMenuNode — conversão EXPLÍCITA do nó legado
 * `action` + `send_whatsapp_menu` em `question_buttons`.
 *
 * Função pura: o editor chama, tira snapshot antes (desfazer) e mostra o toast.
 */
import { describe, it, expect } from "vitest";
import type { ActionNodeData, QuestionButtonsNodeData, WorkflowEdge, WorkflowNode } from "@/types/workflow";
import { findNodeConfigIssues } from "@/contracts/workflows/node-requirements";
import { MAX_QUESTION_BUTTONS, convertLegacyMenuNode, normalizeMenuChoiceLabels } from "./convertLegacyMenuNode";

function legacyMenu(extra: Partial<ActionNodeData> = {}, id = "action-7"): WorkflowNode {
  return {
    id,
    type: "action",
    position: { x: 120, y: 340 },
    data: { type: "action", actionType: "send_whatsapp_menu", label: "Menu inicial", ...extra } as ActionNodeData,
  };
}

const edge = (id: string, source: string, target: string, sourceHandle?: string | null): WorkflowEdge =>
  ({ id, source, target, ...(sourceHandle !== undefined ? { sourceHandle } : {}) });

describe("convertLegacyMenuNode", () => {
  it("converte menu de 2 opções preservando texto, rótulos e posição", () => {
    const node = legacyMenu({ menuText: "Qual setor?", menuChoices: ["Vendas|vendas", "Suporte|suporte"] });
    const { node: out, droppedChoices } = convertLegacyMenuNode(node, []);
    const data = out.data as QuestionButtonsNodeData;
    expect(out.id).toBe("action-7");
    expect(out.type).toBe("question_buttons");
    expect(out.position).toEqual({ x: 120, y: 340 });
    expect(data.type).toBe("question_buttons");
    expect(data.label).toBe("Menu inicial");
    expect(data.text).toBe("Qual setor?");
    expect(data.buttons.map(button => button.label)).toEqual(["Vendas", "Suporte"]);
    expect(data.timeoutHours).toBe(24);
    expect(droppedChoices).toEqual([]);
    // Nada do nó legado vaza para o novo tipo.
    expect(data).not.toHaveProperty("actionType");
    expect(data).not.toHaveProperty("menuChoices");
  });

  it("converte menu de 3 opções sem cortar", () => {
    const node = legacyMenu({ menuText: "Escolha", menuChoices: ["A", "B", "C"] });
    const { node: out, droppedChoices } = convertLegacyMenuNode(node, []);
    expect((out.data as QuestionButtonsNodeData).buttons.map(button => button.label)).toEqual(["A", "B", "C"]);
    expect(droppedChoices).toEqual([]);
  });

  it("mais de 3 opções: corta em 3 e devolve as cortadas", () => {
    const node = legacyMenu({ menuText: "Escolha", menuChoices: ["A|1", "B|2", "C|3", "D|4", "E|5"] });
    const { node: out, droppedChoices } = convertLegacyMenuNode(node, []);
    expect((out.data as QuestionButtonsNodeData).buttons).toHaveLength(MAX_QUESTION_BUTTONS);
    expect((out.data as QuestionButtonsNodeData).buttons.map(button => button.label)).toEqual(["A", "B", "C"]);
    expect(droppedChoices).toEqual(["D", "E"]);
  });

  it("ignora opções vazias e rótulos repetidos (o editor exige rótulos únicos)", () => {
    const node = legacyMenu({ menuText: "x", menuChoices: ["  ", "Sim|1", "sim|2", "|só id", "Não"] });
    const { node: out } = convertLegacyMenuNode(node, []);
    expect((out.data as QuestionButtonsNodeData).buttons.map(button => button.label)).toEqual(["Sim", "Não"]);
  });

  it("menuText vazio cai em messageTemplate", () => {
    const node = legacyMenu({ menuText: "", messageTemplate: "Olá {nome}", menuChoices: ["A"] });
    expect((convertLegacyMenuNode(node, []).node.data as QuestionButtonsNodeData).text).toBe("Olá {nome}");
  });

  it("sem texto nem opções: texto vazio e um botão inicial para o usuário preencher", () => {
    const { node: out, droppedChoices } = convertLegacyMenuNode(legacyMenu(), []);
    const data = out.data as QuestionButtonsNodeData;
    expect(data.text).toBe("");
    expect(data.buttons.map(button => button.label)).toEqual(["Opção 1"]);
    expect(droppedChoices).toEqual([]);
  });

  it("ids dos botões são únicos, novos e aceitos pelo contrato do editor", () => {
    const node = legacyMenu({ menuText: "Escolha", menuChoices: ["A|dup", "B|dup", "C|dup"] });
    const first = (convertLegacyMenuNode(node, []).node.data as QuestionButtonsNodeData).buttons.map(button => button.id);
    const second = (convertLegacyMenuNode(node, []).node.data as QuestionButtonsNodeData).buttons.map(button => button.id);
    expect(new Set(first).size).toBe(3);
    expect(first).not.toContain("dup");
    expect(first.some(id => second.includes(id))).toBe(false);
    const issues = findNodeConfigIssues([convertLegacyMenuNode(node, []).node], [])
      .filter(issue => !issue.missing.startsWith("destino da saída"));
    expect(issues).toEqual([]);
  });

  it("instância: whatsappInstanceId vira instanceId; vazio vira undefined (instância da conversa)", () => {
    expect((convertLegacyMenuNode(legacyMenu({ whatsappInstanceId: "inst-1", menuChoices: ["A"] }), []).node.data as QuestionButtonsNodeData).instanceId).toBe("inst-1");
    const empty = convertLegacyMenuNode(legacyMenu({ whatsappInstanceId: "", menuChoices: ["A"] }), []).node.data as QuestionButtonsNodeData;
    expect(empty.instanceId).toBeUndefined();
    expect(empty).not.toHaveProperty("instanceId");
  });

  it("instância null (pendente após importação) segue pendente", () => {
    const node = legacyMenu({ whatsappInstanceId: null as unknown as string, menuChoices: ["A"] });
    expect((convertLegacyMenuNode(node, []).node.data as QuestionButtonsNodeData).instanceId).toBeNull();
  });

  it("remove as arestas de saída sem handle e devolve quais; mantém entradas e arestas alheias", () => {
    const edges = [
      edge("in", "trigger-1", "action-7"),
      edge("out-plain", "action-7", "action-8"),
      edge("out-null", "action-7", "action-9", null),
      edge("other", "action-8", "action-9"),
    ];
    const result = convertLegacyMenuNode(legacyMenu({ menuChoices: ["A"] }), edges);
    expect(result.droppedEdgeIds).toEqual(["out-plain", "out-null"]);
    expect(result.edges.map(item => item.id)).toEqual(["in", "other"]);
    // Entrada intacta (mesma referência — nada a reescrever).
    expect(result.edges[0]).toBe(edges[0]);
  });

  it("sem arestas de saída: droppedEdgeIds vazio", () => {
    const result = convertLegacyMenuNode(legacyMenu({ menuChoices: ["A"] }), [edge("in", "trigger-1", "action-7")]);
    expect(result.droppedEdgeIds).toEqual([]);
    expect(result.edges).toHaveLength(1);
  });

  it("não muta o nó nem as arestas de entrada", () => {
    const node = legacyMenu({ menuText: "x", menuChoices: ["A", "B", "C", "D"] });
    const edges = [edge("out", "action-7", "action-8")];
    const nodeCopy = structuredClone(node);
    const edgesCopy = structuredClone(edges);
    convertLegacyMenuNode(node, edges);
    expect(node).toEqual(nodeCopy);
    expect(edges).toEqual(edgesCopy);
  });

  it("serve também à troca de tipo vinda do seletor (envio de texto vira pergunta)", () => {
    const node = legacyMenu({ actionType: "send_whatsapp", messageTemplate: "Oi" });
    const { node: out } = convertLegacyMenuNode(node, []);
    expect(out.type).toBe("question_buttons");
    expect((out.data as QuestionButtonsNodeData).text).toBe("Oi");
  });

  it("recusa nó que não é action", () => {
    const node = { id: "q", type: "question_buttons", position: { x: 0, y: 0 },
      data: { type: "question_buttons", text: "x", buttons: [], timeoutHours: 24 } } as WorkflowNode;
    expect(() => convertLegacyMenuNode(node, [])).toThrow();
  });
});

describe("normalizeMenuChoiceLabels", () => {
  it("repetido sem diferenciar maiúsculas não conta para o limite: [A, a, B, C] mantém A, B, C", () => {
    expect(normalizeMenuChoiceLabels(["A", "a", "B", "C"])).toEqual({
      labels: ["A", "B", "C"],
      kept: ["A", "B", "C"],
      dropped: [],
    });
  });

  it("é a mesma regra que a conversão aplica", () => {
    const choices = ["A|1", "a|2", " ", "B", "C", "D|4"];
    const { kept, dropped } = normalizeMenuChoiceLabels(choices);
    const out = convertLegacyMenuNode(legacyMenu({ menuText: "x", menuChoices: choices }), []);
    expect((out.node.data as QuestionButtonsNodeData).buttons.map(button => button.label)).toEqual(kept);
    expect(out.droppedChoices).toEqual(dropped);
    expect(dropped).toEqual(["D"]);
  });

  it("entrada que não é lista vira vazio", () => {
    expect(normalizeMenuChoiceLabels(undefined)).toEqual({ labels: [], kept: [], dropped: [] });
    expect(normalizeMenuChoiceLabels("A,B")).toEqual({ labels: [], kept: [], dropped: [] });
  });
});
