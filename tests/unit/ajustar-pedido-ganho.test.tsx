import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AjustarPedidoGanho } from "@/modules/leads/components/deal-card/AjustarPedidoGanho";

const item = {
  id: "i1",
  nome: "Café",
  quantidade: 2,
  precoUnitario: 50,
  descontoPercent: 0,
  total: 100,
  produtoId: "p1",
  ordem: 0,
};

describe("ajuste do pedido ganho", () => {
  it("altera quantidade e envia o pedido inteiro em uma gravação", async () => {
    const salvar = vi.fn().mockResolvedValue(undefined);
    const cancelar = vi.fn();
    render(
      <AjustarPedidoGanho
        itens={[item]}
        valor={100}
        onSalvar={salvar}
        onCancelar={cancelar}
      />,
    );
    fireEvent.change(screen.getByLabelText("Quantidade de Café"), {
      target: { value: "3" },
    });
    expect(screen.getByText("Novo total: R$ 150,00")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Salvar ajuste" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo do ajuste"), {
      target: { value: "Mais uma caixa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ajuste" }));
    await waitFor(() => expect(cancelar).toHaveBeenCalledTimes(1));
    expect(salvar).toHaveBeenCalledExactlyOnceWith({
      valor: 150,
      motivo: "Mais uma caixa",
      itens: [{ id: "i1", quantity: 3, unit_price: 50, discount_percent: 0 }],
    });
  });
  it("permite corrigir valor manual sem itens", async () => {
    const salvar = vi.fn().mockResolvedValue(undefined);
    render(
      <AjustarPedidoGanho
        itens={[]}
        valor={100}
        onSalvar={salvar}
        onCancelar={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Novo valor do pedido"), {
      target: { value: "15000" },
    });
    fireEvent.change(screen.getByLabelText("Motivo do ajuste"), {
      target: { value: "Quantidade aumentada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ajuste" }));
    await waitFor(() =>
      expect(salvar).toHaveBeenCalledExactlyOnceWith({
        valor: 150,
        motivo: "Quantidade aumentada",
        itens: null,
      }),
    );
  });
  it.each(["0", "-1", "Infinity", "NaN"])(
    "recusa quantidade inválida %s",
    (quantidade) => {
      render(
        <AjustarPedidoGanho
          itens={[item]}
          valor={100}
          onSalvar={vi.fn()}
          onCancelar={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByLabelText("Quantidade de Café"), {
        target: { value: quantidade },
      });
      fireEvent.change(screen.getByLabelText("Motivo do ajuste"), {
        target: { value: "Ajuste" },
      });
      expect(
        screen.getByRole("button", { name: "Salvar ajuste" }),
      ).toBeDisabled();
    },
  );
  it("mantém o rascunho e exibe o motivo quando o servidor recusa", async () => {
    const cancelar = vi.fn();
    render(
      <AjustarPedidoGanho
        itens={[item]}
        valor={100}
        onSalvar={vi.fn().mockRejectedValue(new Error("Atualize a ficha"))}
        onCancelar={cancelar}
      />,
    );
    fireEvent.change(screen.getByLabelText("Quantidade de Café"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Motivo do ajuste"), {
      target: { value: "Mais café" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar ajuste" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Atualize a ficha"),
    );
    expect(screen.getByLabelText("Quantidade de Café")).toHaveValue("3");
    expect(cancelar).not.toHaveBeenCalled();
  });
  it("cancelar não grava", () => {
    const salvar = vi.fn(),
      cancelar = vi.fn();
    render(
      <AjustarPedidoGanho
        itens={[]}
        valor={100}
        onSalvar={salvar}
        onCancelar={cancelar}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar ajuste" }));
    expect(cancelar).toHaveBeenCalledOnce();
    expect(salvar).not.toHaveBeenCalled();
  });
});
