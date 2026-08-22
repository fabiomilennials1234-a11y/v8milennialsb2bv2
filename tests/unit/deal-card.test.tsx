/**
 * Card do Negócio — as regras que a medição de produção impôs ao card.
 *
 * Fecha metade de `inv:H8-31`: até aqui, nenhum arquivo de teste importava
 * `deal-card` ou `lead-card`. Os dois cards são a entrega da PR #1411 e
 * subiram sem uma linha de cobertura.
 *
 * O que se cobre aqui é o que quebra em produção, não a aparência:
 *
 *   1. ganhar e perder são MOVIMENTOS para etapa terminal (ADR-0023 §5) — e
 *      somem quando o funil não tem uma. São 83 funis custom nessa situação;
 *      botão que não tem para onde ir é botão que mente;
 *   2. o alerta de estagnação compara com a mediana da própria etapa, não com
 *      um número fixo. A 30 dias fixos, 22.060 dos 38.403 negócios abertos
 *      acenderiam — alarme que toca sempre não é alarme;
 *   3. a seção de dinheiro some quando não há valor. `sale_value` existe em
 *      1,1% dos 38.739 negócios; mostrar "R$ 0,00" em 98,9% das aberturas é
 *      afirmar que o negócio não vale nada, o que é diferente de não saber.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DealCard } from "@/modules/leads/components/deal-card/DealCard";
import type { DealCardData, DealCardStage } from "@/modules/leads/components/deal-card/types";

const ETAPAS_COM_DESFECHO: DealCardStage[] = [
  { chave: "orcamento", chaveEntry: "orcamento", nome: "Orçamento", papel: "aberto" },
  { chave: "proposta_enviada", chaveEntry: "proposta_enviada", nome: "Proposta enviada", papel: "aberto" },
  { chave: "vendido", chaveEntry: "vendido", nome: "Vendido", papel: "ganho" },
  { chave: "perdido", chaveEntry: "perdido", nome: "Perdido", papel: "perdido" },
];

/** O funil custom sem etapa terminal — 83 deles em prod. */
const ETAPAS_SEM_DESFECHO: DealCardStage[] = [
  { chave: "s1", chaveEntry: "s1", nome: "Triagem", papel: "aberto" },
  { chave: "s2", chaveEntry: "s2", nome: "Em análise", papel: "aberto" },
];

function negocio(over: Partial<DealCardData> = {}): DealCardData {
  return {
    id: "e1",
    titulo: "Reposição trimestral",
    estado: "aberto",
    lead: {
      id: "l1",
      nome: "Distética Suplementos",
      empresa: "Distética Comércio Ltda",
      telefone: "(11) 98472-1130",
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
    pipeTable: "pipe_propostas",
    etapas: ETAPAS_COM_DESFECHO,
    etapaAtual: "proposta_enviada",
    dono: "Luiza Andrade",
    diasEmAberto: 96,
    diasNaEtapa: 10,
    medianaDaEtapa: 21,
    valor: 0,
    moeda: "BRL",
    produto: null,
    reuniao: null,
    desfecho: null,
    movimentacoes: [],
    nota: "",
    // ── Campos do painel de duas colunas ──────────────────────────────────
    // `itens` NÃO pode faltar: `contaDoNegocio` soma a lista, e sem ela o
    // painel inteiro morre com "Cannot read properties of undefined". Como
    // `tsconfig.app.json` só inclui `src`, esta pasta não é checada por tipo
    // e um fixture defasado passa a compilar e só explode em tempo de teste.
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

describe("DealCard — ganhar e perder são movimentos, não estado", () => {
  it("oferece Ganhou e Perdeu quando o funil tem etapa terminal", () => {
    render(<DealCard negocio={negocio()} />);
    expect(screen.getByRole("button", { name: /ganhou/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /perdeu/i })).toBeInTheDocument();
  });

  it("Ganhou move para a chave da etapa de papel ganho", () => {
    const onMoverEtapa = vi.fn();
    render(<DealCard negocio={negocio()} onMoverEtapa={onMoverEtapa} />);

    fireEvent.click(screen.getByRole("button", { name: /ganhou/i }));

    expect(onMoverEtapa).toHaveBeenCalledWith("vendido");
  });

  it("Perdeu move para a chave da etapa de papel perdido", () => {
    const onMoverEtapa = vi.fn();
    render(<DealCard negocio={negocio()} onMoverEtapa={onMoverEtapa} />);

    fireEvent.click(screen.getByRole("button", { name: /perdeu/i }));

    expect(onMoverEtapa).toHaveBeenCalledWith("perdido");
  });

  it("esconde as duas ações no funil sem etapa terminal (83 funis custom em prod)", () => {
    render(<DealCard negocio={negocio({ etapas: ETAPAS_SEM_DESFECHO, etapaAtual: "s1" })} />);

    expect(screen.queryByRole("button", { name: /ganhou/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /perdeu/i })).toBeNull();
  });

  it("mostra só Ganhou quando o funil tem ganho mas não tem perdido", () => {
    const etapas: DealCardStage[] = [
      { chave: "s1", chaveEntry: "s1", nome: "Triagem", papel: "aberto" },
      { chave: "ok", chaveEntry: "ok", nome: "Fechado", papel: "ganho" },
    ];
    render(<DealCard negocio={negocio({ etapas, etapaAtual: "s1" })} />);

    expect(screen.getByRole("button", { name: /ganhou/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /perdeu/i })).toBeNull();
  });

  it("negócio já fechado não oferece ação de desfecho", () => {
    render(
      <DealCard
        negocio={negocio({
          estado: "ganho",
          desfecho: { quando: "2026-07-30T12:00:00.000Z", valorVenda: 12400, motivo: null },
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: /ganhou/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /perdeu/i })).toBeNull();
  });

  it("trava as ações enquanto um movimento está em voo", () => {
    const onMoverEtapa = vi.fn();
    render(<DealCard negocio={negocio()} onMoverEtapa={onMoverEtapa} movendo="vendido" />);

    const ganhou = screen.getByRole("button", { name: /ganhou/i });
    expect(ganhou).toBeDisabled();
    fireEvent.click(ganhou);
    expect(onMoverEtapa).not.toHaveBeenCalled();
  });
});

/**
 * A regra é a mesma de sempre — acende acima do DOBRO da mediana da etapa, não
 * de um número fixo. O que mudou com o painel de duas colunas foi só a
 * superfície: a frase corrida ("parado muito acima do normal desta etapa")
 * virou o primeiro LADRILHO do print, que troca de rótulo e de tom.
 */
describe("DealCard — estagnação compara com a etapa, não com um número fixo", () => {
  it("acende acima do dobro da mediana da etapa", () => {
    render(<DealCard negocio={negocio({ diasNaEtapa: 74, medianaDaEtapa: 21 })} />);

    expect(screen.getByText(/^parado na etapa$/i)).toBeInTheDocument();
    expect(screen.getByText("74")).toBeInTheDocument();
    expect(screen.getByText(/normal aqui: 21 dias/i)).toBeInTheDocument();
  });

  it("NÃO acende no dobro exato — a fronteira é estritamente maior", () => {
    render(<DealCard negocio={negocio({ diasNaEtapa: 42, medianaDaEtapa: 21 })} />);

    expect(screen.getByText(/^em aberto$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^parado na etapa$/i)).toBeNull();
    expect(screen.queryByText(/normal aqui:/i)).toBeNull();
  });

  it("NÃO acende sem mediana — etapa sem amostra não vira acusação", () => {
    render(<DealCard negocio={negocio({ diasNaEtapa: 400, medianaDaEtapa: null })} />);

    expect(screen.getByText(/^em aberto$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^parado na etapa$/i)).toBeNull();
  });

  it("negócio fechado troca Tempo por Desfecho — parado não quer dizer nada depois da venda", () => {
    render(
      <DealCard
        negocio={negocio({
          estado: "perdido",
          diasNaEtapa: 400,
          medianaDaEtapa: 21,
          desfecho: { quando: "2026-07-30T12:00:00.000Z", valorVenda: null, motivo: "Preço" },
        })}
      />,
    );

    // O bloco de desfecho deixou de ser <h2> e virou a faixa "Perdido em".
    expect(screen.getByText(/^perdido em$/i)).toBeInTheDocument();
    expect(screen.getByText("Preço")).toBeInTheDocument();
    // O que este teste guarda: depois do fecho o painel NÃO acusa estagnação.
    expect(screen.queryByText(/^parado na etapa$/i)).toBeNull();
    expect(screen.queryByText(/normal aqui:/i)).toBeNull();
    // ⚠ HERDADO desta branch, ainda não corrigido: o primeiro ladrilho só tem
    // dois rótulos ("Parado na etapa" | "Em aberto"), então um negócio PERDIDO
    // ainda aparece rotulado como "Em aberto". Não é o que este teste guarda,
    // mas está errado na tela — decidir o rótulo do negócio fechado.
  });
});

describe("DealCard — dinheiro some quando não há, em vez de virar R$ 0,00", () => {
  it("esconde a seção Valor no negócio sem valor nem produto (98,9% deles)", () => {
    render(<DealCard negocio={negocio({ valor: 0, produto: null })} />);

    expect(screen.queryByRole("heading", { name: /^valor$/i })).toBeNull();
    expect(screen.queryByText(/R\$\s*0,00/)).toBeNull();
  });

  it("mostra a seção quando há valor", () => {
    render(<DealCard negocio={negocio({ valor: 12400 })} />);

    expect(screen.getByRole("heading", { name: /^valor$/i })).toBeInTheDocument();
  });

  it("mostra a seção quando há só produto, sem valor", () => {
    render(<DealCard negocio={negocio({ valor: 0, produto: "Linha Performance 5kg" })} />);

    expect(screen.getByRole("heading", { name: /^valor$/i })).toBeInTheDocument();
    expect(screen.getByText("Linha Performance 5kg")).toBeInTheDocument();
  });
});

describe("DealCard — o lead é link, não conteúdo", () => {
  it("clicar na empresa abre o card da pessoa pelo id", () => {
    const onOpenLead = vi.fn();
    render(<DealCard negocio={negocio()} onOpenLead={onOpenLead} />);

    fireEvent.click(screen.getByText("Distética Comércio Ltda"));

    expect(onOpenLead).toHaveBeenCalledWith("l1");
  });

  it("cai no nome da pessoa quando não há empresa", () => {
    render(<DealCard negocio={negocio({ lead: { ...negocio().lead, empresa: null } })} />);

    expect(screen.getByText("Distética Suplementos")).toBeInTheDocument();
  });

  it("marca Cliente quando a pessoa já comprou (ADR-0023 §6/§7)", () => {
    render(<DealCard negocio={negocio({ lead: { ...negocio().lead, relacao: "cliente" } })} />);

    expect(screen.getByText("Cliente")).toBeInTheDocument();
  });

  it("diz sem dono em vez de estampar uuid — o caso cross-org que o M6 trava", () => {
    render(<DealCard negocio={negocio({ dono: null })} />);

    expect(screen.getByText(/sem dono/i)).toBeInTheDocument();
  });
});

describe("DealCard — anotação", () => {
  /**
   * No painel de duas colunas a anotação deixou de ficar solta na rolagem e
   * virou a segunda aba do bloco de dinheiro ("Produtos e Valores" · "Anotação").
   * A textarea só existe depois do clique — antes disto os testes achavam o
   * campo direto, e passaram a não achar nada.
   */
  function abrirAnotacao() {
    fireEvent.click(screen.getByRole("button", { name: /^anotação$/i }));
    return screen.getByRole("textbox");
  }

  it("não grava quando o texto não mudou", () => {
    const onSaveNote = vi.fn();
    render(<DealCard negocio={negocio({ nota: "Aguardando retorno" })} onSaveNote={onSaveNote} />);

    fireEvent.blur(abrirAnotacao());

    expect(onSaveNote).not.toHaveBeenCalled();
  });

  it("grava o texto novo ao sair do campo", () => {
    const onSaveNote = vi.fn();
    render(<DealCard negocio={negocio({ nota: "Aguardando retorno" })} onSaveNote={onSaveNote} />);

    const campo = abrirAnotacao();
    fireEvent.change(campo, { target: { value: "Cliente pediu desconto" } });
    fireEvent.blur(campo);

    expect(onSaveNote).toHaveBeenCalledWith("Cliente pediu desconto");
  });

  it("troca de negócio troca a anotação em tela — o card é reusado entre cards do funil", () => {
    const { rerender } = render(<DealCard negocio={negocio({ id: "e1", nota: "Nota do e1" })} />);
    expect(abrirAnotacao()).toHaveValue("Nota do e1");

    rerender(<DealCard negocio={negocio({ id: "e2", nota: "Nota do e2" })} />);
    // Trocar de negócio volta para "Produtos e Valores" — de propósito.
    expect(abrirAnotacao()).toHaveValue("Nota do e2");
  });
});
