import { describe, it, expect } from "vitest";
import { findNodeConfigIssues } from "@/contracts/workflows/node-requirements";

describe("Publicação de pergunta com botões", () => {
  it("rejeita imagem por URL pública ou referência fora do contrato privado", () => {
    const node = { id: "question", type: "question_buttons", data: { text: "Escolha", buttons: [{ id: "a", label: "Vendas" }], timeoutHours: 24, image: { bucket: "media", path: "https://example.test/image.png", mimeType: "image/png", sizeBytes: 30 } } };
    expect(findNodeConfigIssues([node], []).map(issue => issue.missing)).toContain("imagem privada válida");
  });
  it("não permite separadores do provedor em identidades ou rótulos", () => {
    const node = { id: "question", type: "question_buttons", data: { text: "Escolha", buttons: [{ id: "a:b", label: "Comprar|https://site.test" }], timeoutHours: 24 } };
    expect(findNodeConfigIssues([node], []).map(issue => issue.missing)).toContain("botões sem separadores reservados");
  });
  it("rejeita pergunta vazia, IDs/rótulos repetidos e prazo inválido", () => {
    const node = { id: "question", type: "question_buttons", data: { text: "  ", buttons: [{ id: "same", label: "Ajuda" }, { id: "same", label: "Ajuda" }], timeoutHours: Infinity } };
    const missing = findNodeConfigIssues([node], []).map(issue => issue.missing);
    expect(missing).toContain("mensagem");
    expect(missing).toContain("identidades únicas dos botões");
    expect(missing).toContain("rótulos únicos dos botões");
    expect(missing).toContain("prazo de resposta positivo e finito");
    expect(findNodeConfigIssues([{ ...node, data: { ...node.data, buttons: [null] } }], [])).toEqual(expect.arrayContaining([expect.objectContaining({ missing: "botões com identidade e rótulo" })]));
  });
  it("exige destino válido para cada saída e aceita encerramento explícito", () => {
    const nodes = [{ id: "question", type: "question_buttons", data: { text: "Como ajudar?", buttons: [{ id: "sales", label: "Vendas" }], timeoutHours: 24 } }, { id: "end", type: "end", data: {} }];
    expect(findNodeConfigIssues(nodes, []).map(issue => issue.missing)).toEqual([
      "destino da saída Vendas", "destino da saída Outra resposta", "destino da saída Sem resposta", "destino da saída Falha no envio",
    ]);
    const edges = ["button:sales", "other_response", "timeout", "send_failure"].map(sourceHandle => ({ source: "question", target: "end", sourceHandle }));
    expect(findNodeConfigIssues(nodes, edges)).toEqual([]);
    expect(findNodeConfigIssues(nodes, edges.map(edge => ({ ...edge, target: "deleted" })))).toHaveLength(4);
  });
  it("rejeita duas conexões na mesma saída mesmo quando uma aponta para node removido", () => {
    const nodes = [{ id: "question", type: "question_buttons", data: { text: "Escolha", buttons: [{ id: "a", label: "A" }], timeoutHours: 24 } }, { id: "end", type: "end", data: {} }];
    const edges = ["button:a", "other_response", "timeout", "send_failure"].map(sourceHandle => ({ source: "question", target: "end", sourceHandle }));
    edges.push({ source: "question", sourceHandle: "button:a", target: "deleted" });
    expect(findNodeConfigIssues(nodes, edges).map(issue => issue.missing)).toEqual(["destino da saída A"]);
  });

});
