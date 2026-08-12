/**
 * `src/modules/workflows/lib/codeNodes.ts` — as regras dos nós de código que
 * rodam no browser, antes do workflow ser salvo (SPEC §8.1).
 *
 * Cada nó tem **uma única fonte**: o campo `code`, escrito à mão. Não há anexo
 * de arquivo nem geração por IA, então não existe fonte para reconciliar — o
 * que está escrito é o que roda, aqui e no executor.
 *
 * As mensagens são conferidas CARACTERE A CARACTERE de propósito — elas são a
 * única coisa que o usuário vê quando o save é bloqueado, e um `toContain` deixa
 * passar a frase truncada.
 */

import { describe, it, expect } from "vitest";
import {
  codeNodeBytes,
  HTTPS_CODE_EXAMPLE,
  isValidOutputVariable,
  validateCodeNodes,
} from "@/modules/workflows/lib/codeNodes";
import {
  CODE_SOURCE_MAX_BYTES,
  CODE_WORKFLOW_MAX_BYTES,
  type CodeHttpsNodeData,
  type CodeJavascriptNodeData,
  type CodeJsonNodeData,
  type WorkflowNode,
  type WorkflowNodeType,
} from "@/types/workflow";

// ---- factories -------------------------------------------------------------

function jsonNode(id: string, data: Partial<CodeJsonNodeData>): WorkflowNode {
  return {
    id,
    type: "code_json",
    position: { x: 0, y: 0 },
    data: {
      type: "code_json",
      label: "Monta payload",
      code: '{"ok":true}',
      outputVariable: "payload",
      onError: "fail",
      ...data,
    } as CodeJsonNodeData,
  };
}

/**
 * O nó JavaScript é o único dos 3 cujo `code` NÃO é conferido como JSON — é ele
 * que isola as regras de tamanho (4 e 5) da regra de forma (6).
 */
function jsNode(id: string, data: Partial<CodeJavascriptNodeData>): WorkflowNode {
  return {
    id,
    type: "code_javascript",
    position: { x: 0, y: 0 },
    data: {
      type: "code_javascript",
      label: "Roda JS",
      code: "return { ok: true };",
      outputVariable: "resultado",
      onError: "fail",
      ...data,
    } as CodeJavascriptNodeData,
  };
}

/** No nó HTTPS o `code` é o JSON que descreve a requisição inteira. */
const REQUISICAO_VALIDA = JSON.stringify({
  method: "POST",
  url: "https://api.cliente.com/pedidos",
  headers: { Authorization: "Bearer {{token}}" },
  body: { lead: "{{nome}}" },
  timeoutMs: 10_000,
});

function httpsNode(id: string, data: Partial<CodeHttpsNodeData>): WorkflowNode {
  return {
    id,
    type: "code_https",
    position: { x: 0, y: 0 },
    data: {
      type: "code_https",
      label: "Manda pedido",
      code: REQUISICAO_VALIDA,
      outputVariable: "resposta",
      onError: "fail",
      ...data,
    } as CodeHttpsNodeData,
  };
}

/** Nó de outro tipo, para provar que o validador só olha os 3 de código. */
function actionNode(id: string): WorkflowNode {
  return {
    id,
    type: "action" as WorkflowNodeType,
    position: { x: 0, y: 0 },
    data: { type: "action", label: "Ação", actionType: "add_tag" } as never,
  };
}

// ---- codeNodeBytes ---------------------------------------------------------

describe("codeNodeBytes", () => {
  it("conta bytes UTF-8, não caracteres UTF-16", () => {
    expect(codeNodeBytes({ code: "abc" })).toBe(3);

    // "ação" tem 4 caracteres e 6 bytes — um teto medido em `.length` deixaria
    // passar um fonte 2× maior que o limite.
    expect("ação".length).toBe(4);
    expect(codeNodeBytes({ code: "ação" })).toBe(6);

    // Emoji: 2 unidades UTF-16, 4 bytes.
    expect("🚀".length).toBe(2);
    expect(codeNodeBytes({ code: "🚀" })).toBe(4);
  });

  it("mede o campo `code` e nada mais", () => {
    expect(codeNodeBytes({ code: '{"a":1}' })).toBe(7);
  });

  it("é zero quando não há código", () => {
    expect(codeNodeBytes({})).toBe(0);
    expect(codeNodeBytes({ code: "" })).toBe(0);
    // `definition` é jsonb livre: um `code` não-string não pode explodir o save.
    expect(codeNodeBytes({ code: 42 })).toBe(0);
  });
});

// ---- isValidOutputVariable -------------------------------------------------

describe("isValidOutputVariable", () => {
  it("aceita nome interpolável", () => {
    expect(isValidOutputVariable("payload_1")).toBe(true);
    expect(isValidOutputVariable("p")).toBe(true);
    expect(isValidOutputVariable("a".repeat(40))).toBe(true);
  });

  it("rejeita o que não daria para escrever entre chaves duplas", () => {
    expect(isValidOutputVariable("a b")).toBe(false);
    expect(isValidOutputVariable("1a")).toBe(false);
    expect(isValidOutputVariable("")).toBe(false);
    expect(isValidOutputVariable("payload.total")).toBe(false);
    expect(isValidOutputVariable("a".repeat(41))).toBe(false);
  });

  it("rejeita o prefixo _, reservado ao estado da execução", () => {
    // `_retry_counts`, `_wait_resolved`, `_last_error` etc. são lidos pelo
    // executor: gravar por cima corromperia o controle do workflow.
    expect(isValidOutputVariable("_retry_counts")).toBe(false);
    expect(isValidOutputVariable("_")).toBe(false);
  });
});

// ---- validateCodeNodes — as 7 regras --------------------------------------

describe("validateCodeNodes", () => {
  it("caminho feliz devolve []", () => {
    expect(
      validateCodeNodes([
        actionNode("a1"),
        jsonNode("cj1", { code: '{"nome":"{{nome}}"}', outputVariable: "payload" }),
        jsNode("cjs1", { outputVariable: "resultado" }),
        httpsNode("ch1", { outputVariable: "resposta" }),
      ]),
    ).toEqual([]);
  });

  it("ignora nós que não são de código", () => {
    expect(validateCodeNodes([actionNode("a1"), actionNode("a2")])).toEqual([]);
  });

  it("regra 1 — variável de saída vazia", () => {
    expect(validateCodeNodes([jsonNode("cj1", { outputVariable: "" })])).toEqual([
      "O nó «Monta payload» não tem variável de saída — o resultado seria descartado.",
    ]);
  });

  it("regra 2 — nome de variável inválido", () => {
    expect(validateCodeNodes([jsonNode("cj1", { outputVariable: "meu payload" })])).toEqual([
      "«Monta payload»: nome de variável inválido. Use letras, números e _ (sem espaços) e não comece com _.",
    ]);
  });

  it("regra 2 — o prefixo _ cai na mesma mensagem", () => {
    expect(validateCodeNodes([jsonNode("cj1", { outputVariable: "_retry_counts" })])).toEqual([
      "«Monta payload»: nome de variável inválido. Use letras, números e _ (sem espaços) e não comece com _.",
    ]);
  });

  it("regra 3 — sem código", () => {
    expect(validateCodeNodes([jsonNode("cj1", { code: "" })])).toEqual([
      "«Monta payload» está sem código.",
    ]);
  });

  it("regra 3 — só espaço em branco também é «sem código»", () => {
    expect(validateCodeNodes([httpsNode("ch1", { code: "   \n\t " })])).toEqual([
      "«Manda pedido» está sem código.",
    ]);
  });

  it("regra 3 — sem código não gera também erro de forma (a checagem para ali)", () => {
    // Um nó vazio produz UMA linha, não duas: "está sem código" + "JSON
    // malformado" seria ruído, e o autor corrige a mesma coisa nas duas.
    expect(validateCodeNodes([httpsNode("ch1", { code: "" })])).toHaveLength(1);
  });

  it("regra 4 — passa de 64 KB no nó", () => {
    // JavaScript de propósito: o `code` dele não é conferido como JSON, então
    // sobra só o erro de tamanho.
    const acima = "a".repeat(CODE_SOURCE_MAX_BYTES + 1); // 65.537 bytes ASCII
    expect(validateCodeNodes([jsNode("cjs1", { code: acima })])).toEqual([
      "«Roda JS» tem 65 KB; o limite por nó é 64 KB.",
    ]);
  });

  it("regra 5 — a soma dos nós passa de 192 KB", () => {
    // 4 × 50.000 = 200.000 bytes: cada nó cabe nos 64 KB, o conjunto não cabe
    // nos 192 KB. Isolar as duas regras importa — o erro de soma é o que o
    // autor não consegue deduzir olhando um nó de cada vez.
    const pedaco = "a".repeat(50_000);
    const nos = ["j1", "j2", "j3", "j4"].map((id, i) =>
      jsNode(id, { code: pedaco, outputVariable: `resultado_${i}` }),
    );
    expect(50_000 * 4).toBeGreaterThan(CODE_WORKFLOW_MAX_BYTES);
    expect(validateCodeNodes(nos)).toEqual([
      "Os nós de código somam 196 KB; o limite por automação é 192 KB.",
    ]);
  });

  it("regra 6 — JSON malformado", () => {
    expect(validateCodeNodes([jsonNode("cj1", { code: '{ "a": }' })])).toEqual([
      "«Monta payload»: o JSON está malformado.",
    ]);
  });

  it("regra 6 — template com variável dentro de string passa", () => {
    expect(validateCodeNodes([jsonNode("cj1", { code: '{"nome": "{{nome}}"}' })])).toEqual([]);
  });

  it("regra 6 — variável em posição de número também passa", () => {
    // `{"total": {{total}}}` não está dentro de aspas: trocar sempre por
    // `"__var__"` reprovaria o caso da linha de cima, trocar sempre por
    // `__var__` reprovaria este. O stub é sensível a aspas por isso.
    expect(validateCodeNodes([jsonNode("cj1", { code: '{"total": {{total}}}' })])).toEqual([]);
  });

  it("regra 6 — vale também para o nó HTTPS", () => {
    // O `code` do HTTPS é o JSON da requisição: malformado aqui é malformado lá.
    expect(validateCodeNodes([httpsNode("ch1", { code: '{ "url": }' })])).toEqual([
      "«Manda pedido»: o JSON está malformado.",
    ]);
  });

  it("regra 6 — JSON malformado no HTTPS não acumula o erro de url", () => {
    expect(validateCodeNodes([httpsNode("ch1", { code: '{ "url": }' })])).toHaveLength(1);
  });

  it("regra do HTTPS — sem `url` o save é bloqueado", () => {
    expect(validateCodeNodes([httpsNode("ch1", { code: '{"method":"POST"}' })])).toEqual([
      "«Manda pedido»: a requisição precisa de uma `url` começando com https://.",
    ]);
  });

  it("regra do HTTPS — `http://` é recusado, é o que dá nome ao nó", () => {
    // Em http:// o header Authorization viaja em texto claro.
    expect(
      validateCodeNodes([httpsNode("ch1", { code: '{"url":"http://api.cliente.com/pedidos"}' })]),
    ).toEqual(["«Manda pedido»: a requisição precisa de uma `url` começando com https://."]);
  });

  it("regra do HTTPS — `url` que não é string cai na mesma mensagem", () => {
    expect(validateCodeNodes([httpsNode("ch1", { code: '{"url":123}' })])).toEqual([
      "«Manda pedido»: a requisição precisa de uma `url` começando com https://.",
    ]);
  });

  it("regra do HTTPS — url que COMEÇA por variável passa no save", () => {
    // Decisão deliberada: `{{base}}/pedidos` vira `__var__/pedidos` depois do
    // stub e literalmente não começa com https://. Reprovar aqui bloquearia um
    // template legítimo, e o erro é bloqueante. Quem reimpõe o https:// é o
    // executor, que enxerga o valor real.
    expect(
      validateCodeNodes([httpsNode("ch1", { code: '{"url":"{{base_api}}/pedidos"}' })]),
    ).toEqual([]);
  });

  it("regra do HTTPS — só vale para o HTTPS; um JSON sem url passa", () => {
    expect(validateCodeNodes([jsonNode("cj1", { code: '{"method":"POST"}' })])).toEqual([]);
  });

  it("regra 7 — dois nós gravando na mesma variável", () => {
    expect(
      validateCodeNodes([
        jsonNode("cj1", { outputVariable: "payload" }),
        httpsNode("ch1", { outputVariable: "payload" }),
      ]),
    ).toEqual(["Mais de um nó grava na variável «payload» — o último vence."]);
  });

  it("usa o NODE_LABELS quando o nó está sem nome", () => {
    expect(validateCodeNodes([jsonNode("cj1", { label: "  ", outputVariable: "" })])).toEqual([
      "O nó «JSON» não tem variável de saída — o resultado seria descartado.",
    ]);
  });

  it("usa o NODE_LABELS «HTTPS» no nó sem nome", () => {
    expect(validateCodeNodes([httpsNode("ch1", { label: "", code: "" })])).toEqual([
      "«HTTPS» está sem código.",
    ]);
  });

  // O exemplo semeado é JSON válido, tem `url` em https:// e variável de saída —
  // ou seja, passa por todas as outras regras e chegaria a produção disparando
  // contra um domínio que não existe, matando a automação no primeiro lead.
  describe("exemplo semeado do nó HTTPS", () => {
    it("recusa o save enquanto o host de exemplo continuar no código", () => {
      expect(validateCodeNodes([httpsNode("ch1", { code: HTTPS_CODE_EXAMPLE })])).toEqual([
        "«Manda pedido»: troque api.exemplo.com pelo endereço real — esse é só o exemplo que vem preenchido.",
      ]);
    });

    it("recusa mesmo se o resto já foi editado", () => {
      const meioEditado = HTTPS_CODE_EXAMPLE.replace('"POST"', '"PUT"');
      expect(validateCodeNodes([httpsNode("ch1", { code: meioEditado })])).toHaveLength(1);
    });

    it("libera assim que a url vira um endereço de verdade", () => {
      const editado = HTTPS_CODE_EXAMPLE.replace("api.exemplo.com", "api.cliente.com.br");
      expect(validateCodeNodes([httpsNode("ch1", { code: editado })])).toEqual([]);
    });

    // O host de exemplo é fictício por natureza; num nó JSON ele é só texto de
    // payload e não vira requisição nenhuma.
    it("não reclama do mesmo texto dentro de um nó JSON", () => {
      expect(
        validateCodeNodes([jsonNode("cj1", { code: '{"origem":"api.exemplo.com"}' })]),
      ).toEqual([]);
    });
  });

  it("acumula erros de nós diferentes", () => {
    expect(
      validateCodeNodes([
        jsonNode("cj1", { outputVariable: "" }),
        httpsNode("ch1", { code: "" }),
      ]),
    ).toEqual([
      "O nó «Monta payload» não tem variável de saída — o resultado seria descartado.",
      "«Manda pedido» está sem código.",
    ]);
  });
});
