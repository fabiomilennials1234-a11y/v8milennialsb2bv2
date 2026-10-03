/**
 * Bento do V5 — o que as telas assumem de KpiTile, DeltaChip e KpiRow.
 *
 * DeltaChip: "subiu" não é sempre "bom". Tempo de resposta e atrasos invertem
 * — cair é a boa notícia. Errar isso pinta de verde uma piora.
 * KpiRow: grade a partir de `sm`, carrossel com snap abaixo. As classes são o
 * contrato com o CSS; o teste trava as que decidem o comportamento.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DeltaChip, FocusCard, InkRow, InkSplit, KpiRow, KpiTile } from "./bento";

describe("DeltaChip", () => {
  it("alta é boa por padrão", () => {
    render(<DeltaChip value={12} />);
    expect(screen.getByText("12%")).toHaveClass("text-success-strong");
  });

  it("queda é ruim por padrão", () => {
    render(<DeltaChip value={-8} />);
    expect(screen.getByText("8%")).toHaveClass("text-destructive");
  });

  it("com `invert`, queda é boa e alta é ruim", () => {
    const { rerender } = render(<DeltaChip value={-8} invert />);
    expect(screen.getByText("8%")).toHaveClass("text-success-strong");
    rerender(<DeltaChip value={5} invert />);
    expect(screen.getByText("5%")).toHaveClass("text-destructive");
  });

  it("mostra o valor absoluto — a seta já diz a direção", () => {
    render(<DeltaChip value={-3.5} />);
    expect(screen.getByText("3,5%")).toBeInTheDocument();
  });
});

describe("KpiTile", () => {
  it("delta tem precedência sobre a nota", () => {
    render(<KpiTile label="Leads novos" value="406" delta={10} note="195 no mês anterior" />);
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.queryByText("195 no mês anterior")).toBeNull();
  });

  it("sem delta, mostra a nota", () => {
    render(<KpiTile label="Leads novos" value="406" note="195 no mês anterior" />);
    expect(screen.getByText("195 no mês anterior")).toBeInTheDocument();
  });

  it("repassa papel e handlers — o cartão clicável é alcançável por teclado", () => {
    render(<KpiTile label="Ganhos" value="12" role="button" tabIndex={0} />);
    expect(screen.getByRole("button")).toHaveAttribute("tabindex", "0");
  });
});

describe("KpiRow", () => {
  it("no celular é carrossel com snap; a partir de sm vira grade", () => {
    render(
      <KpiRow cols={3}>
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </KpiRow>,
    );
    const fileira = screen.getByText("a").parentElement!;
    expect(fileira).toHaveClass("flex", "snap-x", "snap-mandatory", "overflow-x-auto", "scroll-px-4");
    expect(fileira).toHaveClass("sm:grid", "sm:grid-cols-3", "sm:overflow-visible");
  });

  it("quatro colunas passam por duas no tablet", () => {
    render(
      <KpiRow cols={4}>
        <div>a</div>
      </KpiRow>,
    );
    expect(screen.getByText("a").parentElement).toHaveClass("sm:grid-cols-2", "lg:grid-cols-4");
  });
});

describe("InkSplit", () => {
  it("lista à esquerda e foco à direita no desktop; foco primeiro no celular", () => {
    render(
      <InkSplit
        title="Aguardando resposta"
        count={2}
        list={
          <>
            <InkRow selected>Fernanda</InkRow>
            <InkRow>Carlos</InkRow>
          </>
        }
        detail={<FocusCard>Detalhe da Fernanda</FocusCard>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Aguardando resposta" })).toBeInTheDocument();
    const lista = screen.getByRole("button", { name: "Fernanda" }).parentElement!;
    const foco = screen.getByText("Detalhe da Fernanda").parentElement!;
    expect(lista).toHaveClass("order-2", "lg:order-1");
    expect(foco).toHaveClass("order-1", "lg:order-2");
    expect(lista.parentElement).toHaveClass("lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]");
  });

  it("a linha selecionada se anuncia como pressionada", () => {
    render(<InkSplit list={<InkRow selected>Fernanda</InkRow>} detail={null} />);
    expect(screen.getByRole("button", { name: "Fernanda" })).toHaveAttribute("aria-pressed", "true");
  });
});

