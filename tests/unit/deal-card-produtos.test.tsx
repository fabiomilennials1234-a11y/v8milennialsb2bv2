/**
 * Produtos do Negócio — a tabela editável e a conta.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
 * Até aqui o caminho de produto era a ÚNICA parte do painel do Negócio sem uma
 * linha de cobertura: `grep -rln "deal_items" tests/` devolvia zero, e a única
 * menção a itens em toda a suíte era o campo de fixture `itens: []` do
 * `deal-card.test.tsx` — que trava a FORMA do objeto e nenhum comportamento.
 * Toda regra de exibição do bloco (o "—" em vez de "R$ 0,00", a frase de
 * ausência, o desconto derivado) estava desprotegida.
 *
 * O que se cobre aqui é o que quebra dinheiro na tela, não a aparência:
 *
 *   1. **o preço unitário aparece SEMPRE**, inclusive com quantidade 1 — que é
 *      o caso comum. O formato anterior escondia o unitário quando `qtd === 1`
 *      e mostrava só o total, e um número solto não se confere;
 *   2. **editar manda os números PARSEADOS**, não o texto da tela. "R$ 1.234,56"
 *      tem de virar `1234.56`, e vírgula decimal tem de virar ponto;
 *   3. **remover pede confirmação NA LINHA** — o painel já é um `Dialog`, e um
 *      segundo overlay reprova `cards-nunca-empilham.test.tsx`;
 *   4. **quantidade 0 não salva**: a tabela tem `CHECK (quantity > 0)` e o
 *      caminho para tirar o produto é o Remover, não zerar;
 *   5. **sem callback, sem botão** — a mesma regra do "+ Adicionar produto":
 *      oferecer uma ação cuja escrita falharia é pior do que não oferecer.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import { DealCardMoney } from "@/modules/leads/components/deal-card/DealCardMoney";
import { contaDoNegocio } from "@/modules/leads/components/deal-card/conta-do-negocio";
import type { DealCardItem } from "@/modules/leads/components/deal-card/types";

function item(over: Partial<DealCardItem> = {}): DealCardItem {
  return {
    id: "i1",
    nome: "Produto A",
    quantidade: 2,
    precoUnitario: 100,
    total: 200,
    produtoId: "p1",
    descontoPercent: 0,
    ordem: 0,
    ...over,
  };
}

/** O exemplo do pedido: A 2×100 + B 1×250 = 450. */
const DOIS_PRODUTOS: DealCardItem[] = [
  item(),
  item({ id: "i2", nome: "Produto B", quantidade: 1, precoUnitario: 250, total: 250, produtoId: "p2", ordem: 1 }),
];

describe("contaDoNegocio — a conta mora num lugar só", () => {
  it("soma os totais dos itens", () => {
    const { temItens, total, desconto } = contaDoNegocio(DOIS_PRODUTOS, null);
    expect(temItens).toBe(true);
    expect(total).toBe(450);
    expect(desconto).toBe(0);
  });

  it("o desconto é a diferença entre o bruto e o total gravado", () => {
    // 2 × 100 = 200 de bruto; `total` gravado (coluna GENERATED) é 180 → 20 de
    // abatimento. O desconto NÃO é recalculado a partir de discount_percent:
    // quem manda é o número que o banco gerou.
    const { desconto, total } = contaDoNegocio([item({ total: 180, descontoPercent: 10 })], null);
    expect(desconto).toBe(20);
    expect(total).toBe(180);
  });

  it("sem itens, cai para o valor do negócio; sem ele, para o valor do funil", () => {
    expect(contaDoNegocio([], 900).total).toBe(900);
    expect(contaDoNegocio([], null, 700).total).toBe(700);
    expect(contaDoNegocio([], null).total).toBe(0);
  });

  it("havendo itens, o valor digitado no negócio NÃO é usado", () => {
    // O trigger `trg_deal_items_sync_value` reescreve `deals.value` com a soma
    // dos itens a cada toque. Preferir o valor digitado seria mostrar um número
    // que o banco já apagou.
    expect(contaDoNegocio(DOIS_PRODUTOS, 999_999).total).toBe(450);
  });
});

describe("DealCardMoney — a tabela de produtos", () => {
  it("mostra as colunas do pedido, com valor unitário e total por linha", () => {
    render(<DealCardMoney itens={DOIS_PRODUTOS} valorDoNegocio={null} />);

    expect(screen.getByText("Produto")).toBeTruthy();
    expect(screen.getByText("Qtd")).toBeTruthy();
    expect(screen.getByText("Valor unit.")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();

    expect(screen.getByText("Produto A")).toBeTruthy();
    expect(screen.getByText("R$ 100,00")).toBeTruthy();
    expect(screen.getByText("R$ 200,00")).toBeTruthy();
    expect(screen.getByText("Produto B")).toBeTruthy();
  });

  it("mostra o preço unitário mesmo quando a quantidade é 1", () => {
    // O formato antigo só escrevia "1 × R$ 250,00" quando qtd > 1 — ou seja,
    // escondia justamente no caso mais comum.
    render(
      <DealCardMoney
        itens={[item({ quantidade: 1, precoUnitario: 250, total: 250 })]}
        valorDoNegocio={null}
      />,
    );
    expect(screen.getAllByText("R$ 250,00").length).toBeGreaterThanOrEqual(2);
  });

  it("soma o total dos produtos e o casa com o valor do negócio", () => {
    render(<DealCardMoney itens={DOIS_PRODUTOS} valorDoNegocio={null} />);

    expect(screen.getByText("Total dos produtos")).toBeTruthy();
    expect(screen.getByText("Valor do negócio")).toBeTruthy();
    expect(screen.getByText("soma dos produtos")).toBeTruthy();
    expect(screen.getAllByText("R$ 450,00").length).toBe(2);
  });

  it("com desconto, separa subtotal, abatimento e total", () => {
    render(
      <DealCardMoney
        itens={[item({ total: 180, descontoPercent: 10 })]}
        valorDoNegocio={null}
      />,
    );
    expect(screen.getByText("Subtotal dos produtos")).toBeTruthy();
    expect(screen.getByText("R$ 200,00")).toBeTruthy();
    expect(screen.getByText("Desconto (−)")).toBeTruthy();
    expect(screen.getByText("R$ 20,00")).toBeTruthy();
    // Três vezes: o total da linha, o "Total dos produtos" e o "Valor do
    // negócio" — os três TÊM de bater, e é essa igualdade que se está travando.
    expect(screen.getAllByText("R$ 180,00").length).toBe(3);
  });

  it("marca o produto avulso, que é o que não vira histórico do lead", () => {
    render(
      <DealCardMoney itens={[item({ produtoId: null })]} valorDoNegocio={null} />,
    );
    expect(screen.getByText("avulso")).toBeTruthy();
  });

  it("sem produto, diz que está vazio — e nada além disso", () => {
    render(<DealCardMoney itens={[]} valorDoNegocio={null} />);
    expect(screen.getByText(/Nenhum produto lançado neste negócio/)).toBeTruthy();
    // Sem lastro nenhum o total é "—", nunca "R$ 0,00".
    expect(screen.getByText("—")).toBeTruthy();
  });

  /**
   * A frase *"Este card ainda não tem um negócio aberto — abra um em Novo
   * negócio"* SAIU, e este teste existe para ela não voltar.
   *
   * Ela era honesta enquanto o botão não descia em card sem `deals` — 9.258 de
   * 48.138 entradas em prod (19,2%). Agora o "+ Adicionar produto" desce em
   * todo card e o negócio é materializado no clique, então a frase mandaria a
   * pessoa para outra tela com o botão ali do lado.
   */
  it("nunca manda abrir negócio em outra tela — o botão faz isso sozinho", () => {
    render(<DealCardMoney itens={[]} valorDoNegocio={null} />);
    expect(screen.queryByText(/ainda não tem um negócio aberto/)).toBeNull();
    expect(screen.queryByText(/Novo negócio/)).toBeNull();
  });
});

describe("DealCardMoney — editar e remover", () => {
  it("sem os callbacks, não desenha lápis nem lixeira", () => {
    render(<DealCardMoney itens={DOIS_PRODUTOS} valorDoNegocio={null} />);
    expect(screen.queryByLabelText("Editar Produto A")).toBeNull();
    expect(screen.queryByLabelText("Remover Produto A")).toBeNull();
  });

  it("editar manda os números PARSEADOS, não o texto da tela", async () => {
    const onEditarItem = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onEditarItem={onEditarItem} />,
    );

    fireEvent.click(screen.getByLabelText("Editar Produto A"));

    // O campo já vem com o que está gravado.
    const qtd = screen.getByLabelText("Quantidade de Produto A") as HTMLInputElement;
    expect(qtd.value).toBe("2");

    fireEvent.change(qtd, { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Valor unitário de Produto A"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("Desconto em % de Produto A"), {
      target: { value: "5" },
    });

    fireEvent.click(screen.getByLabelText("Salvar Produto A"));

    await waitFor(() =>
      expect(onEditarItem).toHaveBeenCalledWith({
        itemId: "i1",
        quantidade: 3,
        precoUnitario: 1234.56,
        descontoPercent: 5,
      }),
    );
  });

  it("aceita vírgula decimal na quantidade", async () => {
    const onEditarItem = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onEditarItem={onEditarItem} />,
    );

    fireEvent.click(screen.getByLabelText("Editar Produto A"));
    fireEvent.change(screen.getByLabelText("Quantidade de Produto A"), {
      target: { value: "1,5" },
    });
    fireEvent.click(screen.getByLabelText("Salvar Produto A"));

    await waitFor(() =>
      expect(onEditarItem).toHaveBeenCalledWith(
        expect.objectContaining({ quantidade: 1.5 }),
      ),
    );
  });

  it("quantidade 0 NÃO salva — tirar o produto é outra ação", () => {
    const onEditarItem = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onEditarItem={onEditarItem} />,
    );

    fireEvent.click(screen.getByLabelText("Editar Produto A"));
    fireEvent.change(screen.getByLabelText("Quantidade de Produto A"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByLabelText("Salvar Produto A"));

    expect(onEditarItem).not.toHaveBeenCalled();
  });

  it("cancelar a edição não grava nada e volta ao valor gravado", () => {
    const onEditarItem = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onEditarItem={onEditarItem} />,
    );

    fireEvent.click(screen.getByLabelText("Editar Produto A"));
    fireEvent.change(screen.getByLabelText("Quantidade de Produto A"), {
      target: { value: "9" },
    });
    fireEvent.click(screen.getByLabelText("Cancelar edição de Produto A"));

    expect(onEditarItem).not.toHaveBeenCalled();
    // A linha voltou ao gravado: 2 × R$ 100,00 = R$ 200,00, e o mesmo número
    // aparece nos dois rodapés.
    expect(screen.getAllByText("R$ 200,00").length).toBe(3);

    // Reabrir parte do gravado, não do rascunho abandonado.
    fireEvent.click(screen.getByLabelText("Editar Produto A"));
    expect((screen.getByLabelText("Quantidade de Produto A") as HTMLInputElement).value).toBe("2");
  });

  it("a edição mostra a prévia do total da linha antes de salvar", () => {
    render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onEditarItem={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText("Editar Produto A"));
    fireEvent.change(screen.getByLabelText("Quantidade de Produto A"), {
      target: { value: "3" },
    });
    expect(screen.getByText("R$ 300,00")).toBeTruthy();
  });

  it("remover pede confirmação NA LINHA — sem abrir um segundo overlay", async () => {
    const onRemoverItem = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onRemoverItem={onRemoverItem} />,
    );

    fireEvent.click(screen.getByLabelText("Remover Produto A"));

    expect(screen.getByText(/Remover "Produto A" deste negócio\?/)).toBeTruthy();
    // A confirmação é conteúdo do próprio bloco: nenhum `role="dialog"` nasce.
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(0);
    expect(onRemoverItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(onRemoverItem).toHaveBeenCalledWith("i1"));
  });

  it("cancelar a remoção não remove", () => {
    const onRemoverItem = vi.fn().mockResolvedValue(undefined);
    render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onRemoverItem={onRemoverItem} />,
    );

    fireEvent.click(screen.getByLabelText("Remover Produto A"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onRemoverItem).not.toHaveBeenCalled();
    expect(screen.getByText("Produto A")).toBeTruthy();
  });

  it("falha ao salvar mantém a linha em edição — não apaga o que foi digitado", async () => {
    const onEditarItem = vi.fn().mockRejectedValue(new Error("23514"));
    render(
      <DealCardMoney itens={[item()]} valorDoNegocio={null} onEditarItem={onEditarItem} />,
    );

    fireEvent.click(screen.getByLabelText("Editar Produto A"));
    fireEvent.change(screen.getByLabelText("Quantidade de Produto A"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByLabelText("Salvar Produto A"));

    await waitFor(() => expect(onEditarItem).toHaveBeenCalled());
    expect((screen.getByLabelText("Quantidade de Produto A") as HTMLInputElement).value).toBe("7");
  });

  it("cada linha edita a si mesma — abrir uma não mexe na outra", () => {
    render(
      <DealCardMoney itens={DOIS_PRODUTOS} valorDoNegocio={null} onEditarItem={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText("Editar Produto A"));

    expect(screen.getByLabelText("Quantidade de Produto A")).toBeTruthy();
    expect(screen.queryByLabelText("Quantidade de Produto B")).toBeNull();
    // A linha B continua legível.
    expect(screen.getByText("Produto B")).toBeTruthy();
  });

  it("o botão de adicionar só existe com o callback", () => {
    const { rerender } = render(<DealCardMoney itens={DOIS_PRODUTOS} valorDoNegocio={null} />);
    expect(screen.queryByText("Adicionar produto")).toBeNull();

    rerender(
      <DealCardMoney itens={DOIS_PRODUTOS} valorDoNegocio={null} onAdicionarProduto={() => {}} />,
    );
    expect(screen.getByText("Adicionar produto")).toBeTruthy();
  });

  it("o cabeçalho da seção nomeia o que a tabela é", () => {
    const { container } = render(<DealCardMoney itens={DOIS_PRODUTOS} valorDoNegocio={null} />);
    const titulo = container.querySelector("h3");
    expect(titulo && within(titulo as HTMLElement).getByText("Produtos do Negócio")).toBeTruthy();
  });
});
