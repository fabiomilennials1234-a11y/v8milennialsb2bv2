/**
 * Montagem de pedido cortado na fronteira de página.
 *
 * 🔴 O contexto que dá sentido a estes testes, medido em 01/09 contra o serviço
 * real da Café Jurerê: a página de `/flow/crm/pedidos` é de **25 itens**, não de
 * 25 pedidos. Cada página trouxe exatamente 25 itens distribuídos em 9 a 13
 * pedidos, e em TODAS as fronteiras testadas (1×2, 2×3, 3×4, 4×5) um
 * `numeropedido` apareceu nas duas páginas com os itens repartidos — o pedido
 * 24243 com 6 itens na página 2 e 8 na página 3.
 *
 * Como `replaceOrderItems` apaga os itens do pedido antes de inserir, gravar as
 * duas fatias separadamente deixaria o pedido com a última — 8 de 14 itens, com
 * `line_no` reiniciado em 1, sem erro e sem log.
 */
import { describe, it, expect } from "vitest";
import {
  mesclarFatias,
  numeroDoPedido,
} from "../../supabase/functions/_shared/erp/toth-pedidos-montagem";

describe("numeroDoPedido", () => {
  it("lê a caixa baixa colada que o Flow devolve", () => {
    expect(numeroDoPedido({ numeropedido: "24243" })).toBe("24243");
  });

  it("aceita variação de caixa e separador sem casar exato", () => {
    expect(numeroDoPedido({ numeroPedido: "19400" })).toBe("19400");
    expect(numeroDoPedido({ NUMERO_PEDIDO: "19400" })).toBe("19400");
  });

  it("número em forma de número continua sendo número", () => {
    expect(numeroDoPedido({ numeropedido: 24243 })).toBe("24243");
  });

  it("devolve null quando não há número — quem reclama é o mapeador", () => {
    expect(numeroDoPedido({ dataemissao: "2026-08-28" })).toBeNull();
    expect(numeroDoPedido({ numeropedido: "   " })).toBeNull();
  });
});

describe("mesclarFatias — as duas metades do mesmo pedido", () => {
  /** As duas fatias reais do pedido 24243, reduzidas ao que importa. */
  const fatiaA = {
    numeropedido: "24243",
    valortotalliquido: 32031,
    statuspedido: "FATURADO",
    itens: [{ codigoproduto: "1" }, { codigoproduto: "2" }],
  };
  const fatiaB = {
    numeropedido: "24243",
    valortotalliquido: 32031,
    statuspedido: "FATURADO",
    itens: [{ codigoproduto: "3" }],
  };

  it("a primeira fatia passa inteira", () => {
    expect(mesclarFatias(undefined, fatiaA)).toBe(fatiaA);
  });

  it("os itens SOMAM — é o dado que se perdia", () => {
    const junto = mesclarFatias(fatiaA, fatiaB);
    expect(junto.itens).toHaveLength(3);
    expect((junto.itens as Array<{ codigoproduto: string }>).map((i) => i.codigoproduto)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  /**
   * O ponto que separa "juntar" de "dobrar a receita": o total vem repetido
   * inteiro em cada fatia, não rateado. Somar produziria 64.062 num pedido de
   * 32.031 — e ninguém perceberia, porque o número continua plausível.
   */
  it("o total NÃO soma: vem repetido igual nas duas fatias", () => {
    const junto = mesclarFatias(fatiaA, fatiaB);
    expect(junto.valortotalliquido).toBe(32031);
  });

  it("preserva o cabeçalho do pedido", () => {
    const junto = mesclarFatias(fatiaA, fatiaB);
    expect(junto.numeropedido).toBe("24243");
    expect(junto.statuspedido).toBe("FATURADO");
  });

  it("fatia sem itens não apaga o que já estava montado", () => {
    const junto = mesclarFatias(fatiaA, { numeropedido: "24243" });
    expect(junto.itens).toHaveLength(2);
  });

  it("aceita `items`/`produtos`, as outras chaves que o mapeador tolera", () => {
    const a = { numeropedido: "1", items: [{ codigoproduto: "1" }] };
    const b = { numeropedido: "1", items: [{ codigoproduto: "2" }] };
    expect((mesclarFatias(a, b).items as unknown[]).length).toBe(2);
  });

  it("três fatias seguidas continuam acumulando", () => {
    const c = { numeropedido: "24243", itens: [{ codigoproduto: "4" }] };
    const junto = mesclarFatias(mesclarFatias(fatiaA, fatiaB), c);
    expect(junto.itens).toHaveLength(4);
  });
});
