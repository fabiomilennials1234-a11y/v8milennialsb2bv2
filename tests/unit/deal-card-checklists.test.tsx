/**
 * Checklists no Card do Negócio.
 *
 * ── O DEFEITO QUE ISTO TRANCA ─────────────────────────────────────────────
 * O card do funil anuncia "N atividades em aberto" — e esse número sai de
 * CHECKLIST, não da tabela `activities`. Clicar no card abria um painel onde
 * checklist não existia em lugar nenhum, e o item "Checklists" do menu do card
 * fazia exatamente a mesma coisa: abria o negócio e parava ali. Da tela, isso
 * se lê como "não acontece nada".
 *
 * O que se cobre aqui é a COSTURA, que é onde estava o buraco:
 *
 *   1. a aba existe e mostra o que a pessoa marca;
 *   2. quem pede a aba (o menu do card) chega nela — o pedido atravessa o
 *      `DealSheetContext` e sobrevive à abertura do painel;
 *   3. abrir pelo caminho normal NÃO herda o pedido anterior.
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { DealCard } from "@/modules/leads/components/deal-card/DealCard";
import { DealPanelProvider } from "@/modules/leads/components/deal-detail/DealPanelProvider";
import { useDealSheet } from "@/modules/leads/components/deal-detail/deal-sheet-context";
import type { DealCardData, DealCardStage } from "@/modules/leads/components/deal-card/types";

/**
 * O conteúdo da aba entra por SLOT, não por import: ele fala com banco, e o
 * `DealCard` é montado também por `/preview.html`, que não pode ter caminho
 * até o Supabase (`inv:H5-17`). Aqui o slot é um dublê — o que se prova é a
 * navegação até ele.
 */
const PAINEL = <div data-testid="painel-checklists">checklists do lead</div>;

const ETAPAS: DealCardStage[] = [
  { chave: "orcamento", chaveEntry: "orcamento", nome: "Orçamento", papel: "aberto" },
  { chave: "vendido", chaveEntry: "vendido", nome: "Vendido", papel: "ganho" },
];

function negocio(over: Partial<DealCardData> = {}): DealCardData {
  return {
    id: "e1",
    dealId: null,
    titulo: "Reposição trimestral",
    estado: "aberto",
    lead: {
      id: "l1",
      nome: "Distética Suplementos",
      empresa: null,
      telefone: null,
      relacao: "lead",
      email: null,
      origem: null,
      chegouEm: null,
      qualificacao: null,
      preQualificacao: null,
      responsaveis: { preVenda: null, venda: null },
      etiquetas: [],
      faturamento: null,
    },
    funil: "Orçamentos",
    funilCor: "#a855f7",
    etapas: ETAPAS,
    etapaAtual: "orcamento",
    dono: null,
    diasEmAberto: 3,
    diasNaEtapa: 1,
    medianaDaEtapa: 10,
    valor: 0,
    moeda: "BRL",
    produto: null,
    reuniao: null,
    desfecho: null,
    movimentacoes: [],
    nota: "",
    valorDoNegocio: null,
    probabilidade: null,
    previsaoFechamento: null,
    fechadoEm: null,
    criadoEm: null,
    itens: [],
    atividades: [],
    outrosNegocios: [],
    ...over,
  };
}

describe("Card do Negócio — a aba de Checklists", () => {
  it("oferece a aba e abre o painel dentro dela", () => {
    render(<DealCard negocio={negocio()} painelChecklists={PAINEL} />);

    // Não vem aberta: a primeira aba continua sendo o negócio.
    expect(screen.queryByTestId("painel-checklists")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Checklists/ }));
    expect(screen.getByTestId("painel-checklists")).toBeInTheDocument();
  });

  it("sem o slot a aba não existe — é o que separa o painel de verdade do /preview", () => {
    render(<DealCard negocio={negocio()} />);
    expect(screen.queryByRole("button", { name: /Checklists/ })).not.toBeInTheDocument();
  });

  it("pedir a aba sem ter o slot cai no negócio, não numa aba em branco", () => {
    render(<DealCard negocio={negocio()} abaInicial="checklists" />);
    expect(screen.queryByTestId("painel-checklists")).not.toBeInTheDocument();
    expect(screen.getByText("Reposição trimestral")).toBeInTheDocument();
  });

  it("o selo da aba é a fração, não o total — 'em aberto' é a pergunta", () => {
    render(
      <DealCard negocio={negocio()} painelChecklists={PAINEL} resumoChecklists={{ feitos: 2, total: 5 }} />,
    );
    expect(screen.getByRole("button", { name: /Checklists/ })).toHaveTextContent("2/5");
  });

  it("sem checklist nenhum a aba não carimba 0/0 — número que não muda nada é ruído", () => {
    render(
      <DealCard negocio={negocio()} painelChecklists={PAINEL} resumoChecklists={{ feitos: 0, total: 0 }} />,
    );
    expect(screen.getByRole("button", { name: /Checklists/ })).not.toHaveTextContent("0/0");
  });

  it("abre JÁ na aba pedida por quem clicou 'Checklists' no menu do card", () => {
    render(<DealCard negocio={negocio()} painelChecklists={PAINEL} abaInicial="checklists" />);
    expect(screen.getByTestId("painel-checklists")).toBeInTheDocument();
  });

  it("trocar de negócio devolve o painel à aba pedida, não à aba em que se estava", () => {
    const { rerender } = render(
      <DealCard negocio={negocio()} painelChecklists={PAINEL} abaInicial={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Checklists/ }));
    expect(screen.getByTestId("painel-checklists")).toBeInTheDocument();

    rerender(<DealCard negocio={negocio({ id: "e2" })} painelChecklists={PAINEL} abaInicial={null} />);
    expect(screen.queryByTestId("painel-checklists")).not.toBeInTheDocument();
  });
});

// ── O pedido de aba atravessando o provider ─────────────────────────────────

let sheet: ReturnType<typeof useDealSheet>;
function Espiao() {
  sheet = useDealSheet();
  return null;
}

describe("DealPanelProvider — a aba pedida", () => {
  beforeEach(() => {
    render(
      <DealPanelProvider>
        <Espiao />
      </DealPanelProvider>,
    );
  });

  it("abrir pelo clique normal não pede aba nenhuma", () => {
    act(() => sheet.openDeal("e1", "l1"));
    expect(sheet.aba).toBeNull();
  });

  it("o menu do card abre e SÓ ENTÃO pede a aba — a ordem é o que faz funcionar", () => {
    act(() => {
      sheet.openDeal("e1", "l1");
      sheet.pedirAba("checklists");
    });
    expect(sheet.isOpen).toBe(true);
    expect(sheet.entryId).toBe("e1");
    expect(sheet.aba).toBe("checklists");
  });

  it("o pedido morre na próxima abertura — não contamina o card seguinte", () => {
    act(() => {
      sheet.openDeal("e1", "l1");
      sheet.pedirAba("checklists");
    });
    act(() => sheet.openDeal("e2", "l2"));
    expect(sheet.aba).toBeNull();
  });

  it("fechar limpa o pedido junto", () => {
    act(() => {
      sheet.openDeal("e1", "l1");
      sheet.pedirAba("checklists");
    });
    act(() => sheet.close());
    expect(sheet.aba).toBeNull();
    expect(sheet.isOpen).toBe(false);
  });
});
