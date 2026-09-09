/**
 * O cluster "Dados" saiu da LISTA de Leads e foi para o CARD — ADR-0024 §1.
 *
 * Prova `inv:H5-01` (SCRUM-107), que até aqui era decisão escrita sem teste.
 *
 * ── SCRUM-126: onde o bloco "Compras" foi parar ──────────────────────────────
 * A ADR-0024 §1 mandou o cluster para "o drawer", e o arquivo se chamava
 * `lista-dados-no-drawer.test.tsx`. Aquele drawer **não é mais montado**: os
 * dois cards (Lead e Negócio) o substituíram, e o destino real do bloco é a
 * seção "A relação" do `LeadCardMetrics`, dentro do Card do Lead.
 *
 * Renomeado para `lista-dados-no-card` porque o nome antigo mandava o próximo
 * leitor procurar um componente que não existe — e o bloco "Compras" já tinha
 * ficado uma sprint com dono ambíguo exatamente por isso. O conteúdo dos casos
 * não mudou: eles sempre testaram o card (`LeadCardMetrics`), nunca um drawer.
 *
 * Alcance, depois do SCRUM-124: o Card do Lead passou a ser montado pelos quatro
 * funis e pela aba de Leads. Antes, o bloco só era alcançável por uma porta —
 * o que fazia "o destino do bloco" parecer questão em aberto quando na verdade
 * a questão era o card não estar montado em lugar nenhum além do pipe-whatsapp.
 *
 * O número que motivou a mudança: medido em prod 2026-08-04, de **35.165 leads
 * vivos só 1.018** tinham algo para mostrar naquela coluna — ela estava vazia
 * em **97,1%** das linhas e era a mais larga da lista, com **290px**. Restringir
 * às orgs com ERP foi descartado pelo mesmo dado: a org mais preenchida da base
 * (Basic4u) chega a 23,7%.
 *
 * A decisão tem DUAS metades e as duas quebram sozinhas:
 *
 *   1. a LISTA não pode voltar a estampar total acumulado, nº de pedidos, ciclo
 *      de recompra e última compra — nem quando o lead TEM esses números. É
 *      justamente o lead cheio que faz a coluna parecer boa ideia de novo;
 *   2. o CARD precisa mostrá-los, senão a decisão não moveu nada: apagou. Um
 *      teste que só provasse a ausência aprovaria a deleção.
 *
 * O que a lista MANTEVE de propósito também está aqui, para que ninguém
 * "termine a limpeza" levando junto: ticket médio (na coluna Nome) e o selo de
 * `segment` (nas Tags) continuam saindo de `metrics`.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  LeadListRow,
  LeadListHeader,
  type LeadListItem,
} from "@/modules/leads/components/leads/LeadListRow";
import { LeadCardMetrics } from "@/modules/leads/components/lead-card/LeadCardMetrics";
import type { LeadCarteiraMetrics } from "@/modules/leads/hooks/useLeadsCarteiraMetrics";
import type { LeadCardMetrics as MetricasDoCard } from "@/modules/leads/components/lead-card/types";

/** O lead que a coluna "Dados" existia para servir — 2,9% da base. */
const METRICAS_RICAS = {
  totalSpent: 44300,
  ordersCount: 24,
  avgTicket: 1845.83,
  cycleDays: 60,
  lastPurchaseDays: 12,
  segment: "ouro",
} as unknown as LeadCarteiraMetrics;

const LEAD = {
  id: "l1",
  name: "Distética Suplementos",
  company: "Distética Comércio Ltda",
  phone: "(11) 98472-1130",
  email: "compras@distetica.com.br",
  origin: "indicacao",
  lead_tags: [],
} as unknown as LeadListItem;

function linha(over: Partial<React.ComponentProps<typeof LeadListRow>> = {}) {
  return render(
    <LeadListRow
      lead={LEAD}
      metrics={METRICAS_RICAS}
      deals={[]}
      selected={false}
      onToggleSelect={vi.fn()}
      onOpen={vi.fn()}
      createdLabel="04/08/2026"
      originLabel="Indicação"
      originClassName="border-emerald-500/20"
      {...over}
    />,
  );
}

const METRICAS_DO_CARD: MetricasDoCard = {
  acumulado: 44300,
  ticketMedio: 1845.83,
  pedidos: 24,
  cicloDias: 60,
  ultimaCompraDias: 12,
  idadeDias: 266,
  semContatoDias: 3,
};

describe("Lista de Leads — o cluster Dados NÃO volta para a linha (ADR-0024 §1)", () => {
  it("não estampa o total acumulado, mesmo no lead que tem R$ 44.300 de histórico", () => {
    const { container } = linha();

    // O total existe em `metrics` e é ignorado pela linha de propósito.
    expect(container.textContent).not.toContain("44.300");
  });

  it("não estampa nº de pedidos, ciclo de recompra nem dias desde a última compra", () => {
    linha();

    expect(screen.queryByText(/pedidos/i)).toBeNull();
    expect(screen.queryByText(/recompra/i)).toBeNull();
    expect(screen.queryByText(/última compra/i)).toBeNull();
    expect(screen.queryByText(/^24$/)).toBeNull();
    expect(screen.queryByText(/60\s*dias/i)).toBeNull();
    expect(screen.queryByText(/12\s*dias/i)).toBeNull();
  });

  it("o cabeçalho não tem coluna Dados — a largura de 290px ficou com a lista", () => {
    render(<LeadListHeader />);

    expect(screen.queryByText(/^dados$/i)).toBeNull();
  });

  it("o cabeçalho declara as onze colunas que sobraram, e nessa ordem", () => {
    const { container } = render(<LeadListHeader />);

    const celulas = Array.from(container.firstElementChild!.children).map((c) =>
      (c.textContent ?? "").trim(),
    );

    // "Recompra" entrou com o anel de tempo médio de recompra (#1994,
    // `438e538d`), que acrescentou a coluna e não atualizou esta lista. Passou
    // despercebido porque `main` está com `Lint & Build` vermelho e o job de
    // Unit Tests fica `skipped` atrás dele — só rodou de novo aqui.
    expect(celulas).toEqual([
      "",
      "Nome",
      "Contatos",
      "Tags",
      "Relação",
      "Situação",
      "Negócios",
      "Recompra",
      "Dono da conta",
      "Data de criação",
      "",
    ]);
  });
});

describe("Lista de Leads — o que ficou de `metrics` ficou de propósito", () => {
  it("ticket médio continua na coluna Nome — é o único número de carteira que sobrou", () => {
    linha();

    expect(screen.getByText(/ticket médio/i)).toBeInTheDocument();
    expect(screen.getByText("R$ 1.845,83")).toBeInTheDocument();
  });

  it("o selo de segmento continua nas Tags", () => {
    linha();

    expect(screen.getByText("ouro")).toBeInTheDocument();
  });

  it("lead sem carteira nenhuma não ganha linha vazia de número", () => {
    linha({ metrics: undefined });

    expect(screen.getByText("R$ 0,00")).toBeInTheDocument();
    expect(screen.queryByText("ouro")).toBeNull();
  });
});

describe("Card do Lead — os quatro números que saíram da lista chegaram aqui", () => {
  it("mostra acumulado, pedidos, ciclo de recompra e última compra", () => {
    render(<LeadCardMetrics metricas={METRICAS_DO_CARD} />);

    expect(screen.getByText("R$ 44.300")).toBeInTheDocument();
    expect(screen.getByText(/já comprou/i)).toBeInTheDocument();

    expect(screen.getByText(/^pedidos$/i)).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();

    expect(screen.getByText(/ciclo de recompra/i)).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();

    expect(screen.getByText(/última compra/i)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("no lead que nunca comprou — 94% da base — o bloco some inteiro em vez de mostrar zeros", () => {
    render(
      <LeadCardMetrics
        metricas={{ ...METRICAS_DO_CARD, acumulado: 0, ticketMedio: 0, pedidos: 0, cicloDias: null, ultimaCompraDias: null }}
      />,
    );

    expect(screen.queryByText(/já comprou/i)).toBeNull();
    expect(screen.queryByText(/ciclo de recompra/i)).toBeNull();
    expect(screen.queryByText(/R\$\s*0,00/)).toBeNull();
    // Mas diz por que não há nada, em vez de deixar buraco.
    expect(screen.getByText(/aparecem quando o primeiro negócio for ganho/i)).toBeInTheDocument();
  });

  it("idade e sem-contato ficam SEMPRE — são a única temperatura de quem nunca comprou", () => {
    render(
      <LeadCardMetrics metricas={{ ...METRICAS_DO_CARD, pedidos: 0, semContatoDias: null }} />,
    );

    expect(screen.getByText(/na base há/i)).toBeInTheDocument();
    expect(screen.getByText("266")).toBeInTheDocument();
    expect(screen.getByText(/sem contato/i)).toBeInTheDocument();
    expect(screen.getByText("nunca")).toBeInTheDocument();
  });
});
