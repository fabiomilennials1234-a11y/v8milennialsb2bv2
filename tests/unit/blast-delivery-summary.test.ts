/**
 * O resumo do Disparo — contagem por estado e os DOIS custos (#1724).
 *
 * POR QUE ISTO É UM MÓDULO PURO, E NÃO UMA SOMA NO SQL
 * ---------------------------------------------------
 * Foi planejado como RPC. O frontend deste repo deploya sozinho no merge para a
 * main, e a migration é botão do humano — entre um e outro a RPC não existiria e
 * o painel diria "0 enviados", que é a mesma mentira que este ticket recusa para
 * o custo. Um fallback consertaria e poria a regra de dinheiro em dois caminhos.
 *
 * POR QUE INTEIROS, E NÃO FLOAT
 * -----------------------------
 * `estimated_cost`/`actual_cost` são `numeric(12,4)` — quatro casas, porque o
 * utility custa R$ 0,0350 e duas casas dariam 14% de erro por mensagem (#1721).
 * O PostgREST devolve numeric como STRING justamente para não perder precisão, e
 * somar em `Number` a jogaria fora no primeiro passo. A soma acontece em
 * décimos de milésimo inteiros.
 */
import { describe, expect, it } from "vitest";

import {
  processados,
  resumirDestinatarios,
  saiuDaFila,
  somarEmDecimosDeMilesimo,
} from "../../src/modules/campaigns/lib/blast-delivery-summary";

const linha = (
  status: string,
  estimated: string | null = null,
  actual: string | null = null,
) => ({ status, estimated_cost: estimated, actual_cost: actual });

describe("somarEmDecimosDeMilesimo", () => {
  it("soma sem passar por float — 0,0350 dez vezes é exatamente 0,3500", () => {
    // Em float, `0.035 * 10` dá 0.34999999999999997. Aqui o valor é exato
    // porque a soma é inteira: 350 × 10 = 3500.
    expect(somarEmDecimosDeMilesimo(Array(10).fill("0.0350"))).toBe(3500);
  });

  it("nenhum valor conhecido devolve null, NUNCA zero", () => {
    // Zero afirma "custou nada". Null diz "não sei quanto custou", que é a
    // verdade enquanto ninguém carimba preço (a tabela versionada é #1725).
    expect(somarEmDecimosDeMilesimo([])).toBeNull();
    expect(somarEmDecimosDeMilesimo([null, null])).toBeNull();
  });

  it("um valor conhecido no meio de nulos vale — o total é parcial, não ausente", () => {
    expect(somarEmDecimosDeMilesimo([null, "0.3217", null])).toBe(3217);
  });

  it("aceita number além de string, sem perder a quarta casa", () => {
    expect(somarEmDecimosDeMilesimo([0.0350])).toBe(350);
  });

  it("valor ilegível não derruba a soma nem entra nela", () => {
    expect(somarEmDecimosDeMilesimo(["", "abc", "0.3217"])).toBe(3217);
  });
});

describe("resumirDestinatarios", () => {
  it("conta os SEIS estados, sem balde de desconhecido", () => {
    const r = resumirDestinatarios([
      linha("pending"),
      linha("sent"),
      linha("sent"),
      linha("delivered"),
      linha("failed"),
      linha("skipped"),
      linha("unconfirmed"),
    ]);

    expect(r).toMatchObject({
      total: 7,
      pending: 1,
      sent: 2,
      delivered: 1,
      failed: 1,
      skipped: 1,
      unconfirmed: 1,
    });
  });

  it("status desconhecido NÃO vira `pending` — ele aparece como desconhecido", () => {
    // O `else p.pending += 1` de `useBlastPlans.ts:170` era um balde: no dia em
    // que `delivered` fosse gravado, ele apareceria na tela como "Aguardando", e
    // ninguém saberia por quê. Um estado que o código não conhece tem de ser
    // contável, não escondido.
    const r = resumirDestinatarios([linha("pending"), linha("coisa_nova")]);
    expect(r.pending).toBe(1);
    expect(r.desconhecidos).toBe(1);
  });

  it("realizado é só o que foi ENTREGUE — é assim que a Meta cobra", () => {
    const r = resumirDestinatarios([
      linha("delivered", "0.3217", "0.3217"),
      linha("sent", "0.3217"),
      linha("failed", "0.3217"),
      linha("unconfirmed", "0.3217"),
    ]);

    expect(r.custoRealizado).toBe(3217);
    // Previsto é o que SAIU — as quatro. A diferença entre os dois números é
    // exatamente o que não foi entregue, e é o ponto de mostrá-los separados.
    expect(r.custoPrevisto).toBe(4 * 3217);
  });

  it("`pending` e `skipped` não entram no previsto — não saíram", () => {
    const r = resumirDestinatarios([
      linha("pending", "0.3217"),
      linha("skipped", "0.3217"),
    ]);
    expect(r.custoPrevisto).toBeNull();
    expect(r.custoRealizado).toBeNull();
  });

  it("sem preço carimbado, os dois custos são desconhecidos e não zero", () => {
    // O estado de HOJE: ninguém escreve estimated_cost (#1725 é quem vai).
    const r = resumirDestinatarios([linha("delivered"), linha("sent")]);
    expect(r.custoPrevisto).toBeNull();
    expect(r.custoRealizado).toBeNull();
    expect(r.delivered).toBe(1);
  });

  it("lista vazia é total zero com custos desconhecidos", () => {
    const r = resumirDestinatarios([]);
    expect(r.total).toBe(0);
    expect(r.custoPrevisto).toBeNull();
  });
});

describe("as derivações que as telas compartilham", () => {
  const resumo = () =>
    resumirDestinatarios([
      linha("sent"),
      linha("delivered", "0.3217", "0.3217"),
      linha("unconfirmed", "0.3217"),
      linha("failed", "0.3217"),
      linha("skipped"),
      linha("pending"),
    ]);

  it("processado inclui entregue e não confirmada — senão a barra anda PARA TRÁS", () => {
    // Os dois são destinos de `sent`. Quando o callback confirma, a linha sai de
    // `sent`; se a conta não os incluísse, cada entrega DIMINUIRIA o progresso.
    expect(processados(resumo())).toBe(5); // tudo menos `pending`
  });

  it("`enviados` NÃO soma as falhas — a tela mostra as duas na mesma linha", () => {
    // "12 enviados · 3 falhas" com 12 já contendo as 3 conta a mesma pessoa duas
    // vezes. Regra antiga desta tela, e a inclusão de delivered/unconfirmed não a
    // revoga.
    expect(saiuDaFila(resumo())).toBe(3); // sent + delivered + unconfirmed
  });

  it("leitura truncada NÃO devolve custo parcial", () => {
    // Um total de dinheiro pela metade não parece pela metade: parece um valor.
    const parcial = resumirDestinatarios(
      [linha("delivered", "0.3217", "0.3217")],
      true,
    );
    expect(parcial.truncado).toBe(true);
    expect(parcial.custoRealizado).toBeNull();
    expect(parcial.custoPrevisto).toBeNull();
    // As CONTAGENS seguem — elas são parciais e a tela pode dizer isso.
    expect(parcial.delivered).toBe(1);
  });
});
