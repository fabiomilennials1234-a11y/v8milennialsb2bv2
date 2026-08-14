/**
 * `LeadCardCompact` — o card de 98,8px do redesenho de Funis.
 *
 * Fecha `inv:H2-12`. O card confortável media ~250px e cabiam duas fichas por
 * coluna; o compacto entrega o MESMO conteúdo em três linhas. A economia não
 * vem de cortar dado, vem de parar de dar linha própria a cada um — e é isso
 * que uma regressão desfaz sem parecer que desfez.
 *
 * O que se prova:
 *
 *   1. **o nome trunca em UMA linha.** Com `line-clamp-2` um nome longo empurra
 *      o card para 115px e a coluna perde uma ficha inteira: a altura passa a
 *      depender do cadastro, não do layout;
 *   2. **valor grande vira `R$ 1,2M`** em vez de `R$ 1.200.000` — sete
 *      caracteres a mais estouram a linha de badges;
 *   3. **data sem hora não vira "· 00:00"**, que leria como reunião de
 *      madrugada. Meia-noite é ausência de hora, não hora zero;
 *   4. o que a org desligou em `config` não ocupa espaço.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LeadCardCompact } from "@/modules/leads/components/leads/card/LeadCardCompact";

type Props = React.ComponentProps<typeof LeadCardCompact>;

const CONFIG_TUDO: Props["config"] = {
  showContact: true,
  showValue: true,
  showDate: true,
  showProducts: true,
  showMeetLink: true,
  showNotes: true,
};

const LEAD: Props["lead"] = {
  id: "l1",
  name: "Distética Suplementos",
  company: "Distética Comércio Ltda",
  phone: "(11) 98472-1130",
  value: 12400,
  stageEnteredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  preSaleResponsible: { name: "Luiza Andrade" },
};

function montar(over: Partial<Props> = {}) {
  const onClick = over.onClick ?? vi.fn();
  const utils = render(
    <LeadCardCompact
      lead={LEAD}
      config={CONFIG_TUDO}
      origin={{ bg: "bg-blue-500/10", text: "text-blue-400", label: "Meta Ads" }}
      urgency={null}
      dateIndicator={null}
      parsedDate={null}
      menuItems={<div>menu</div>}
      {...over}
      onClick={onClick}
    />,
  );
  return { onClick, ...utils };
}

describe("LeadCardCompact — a altura não pode depender do cadastro", () => {
  it("o nome trunca em uma linha só", () => {
    const { container } = montar({
      lead: { ...LEAD, name: "Distribuidora de Suplementos e Alimentos Naturais do Vale do Paraíba" },
    });

    const nome = screen.getByText(/Distribuidora de Suplementos/);
    const classe = nome.className;
    expect(classe).toMatch(/truncate|line-clamp-1/);
    expect(classe).not.toMatch(/line-clamp-2/);
    expect(container.firstChild).toBeTruthy();
  });

  it("mostra nome e empresa na mesma linha de cima", () => {
    montar();

    expect(screen.getByText("Distética Suplementos")).toBeInTheDocument();
    expect(screen.getByText("Distética Comércio Ltda")).toBeInTheDocument();
  });
});

describe("LeadCardCompact — dinheiro abreviado para não estourar a linha", () => {
  it("milhão vira R$ 1,2M", () => {
    montar({ lead: { ...LEAD, value: 1_200_000 } });

    expect(screen.getByText(/R\$ 1,2M/)).toBeInTheDocument();
  });

  it("valor comum sai em BRL sem centavos", () => {
    montar({ lead: { ...LEAD, value: 2500 } });

    expect(screen.getByText(/R\$\s?2\.500/)).toBeInTheDocument();
  });

  it("config.showValue desligado tira o valor da tela", () => {
    montar({ config: { ...CONFIG_TUDO, showValue: false }, lead: { ...LEAD, value: 12400 } });

    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it("lead sem valor não imprime R$ nenhum", () => {
    montar({ lead: { ...LEAD, value: null } });

    expect(screen.queryByText(/R\$/)).toBeNull();
  });
});

describe("LeadCardCompact — compromisso: meia-noite é ausência de hora", () => {
  it("data com hora sai como 12/08 · 14:00", () => {
    montar({ parsedDate: new Date(2026, 7, 12, 14, 0) });

    expect(screen.getByText(/12\/08 · 14:00/)).toBeInTheDocument();
  });

  it("data à meia-noite sai só com o dia — sem '· 00:00'", () => {
    montar({ parsedDate: new Date(2026, 7, 12, 0, 0) });

    expect(screen.getByText(/12\/08/)).toBeInTheDocument();
    expect(screen.queryByText(/00:00/)).toBeNull();
  });

  it("config.showDate desligado tira o compromisso", () => {
    montar({ config: { ...CONFIG_TUDO, showDate: false }, parsedDate: new Date(2026, 7, 12, 14, 0) });

    expect(screen.queryByText(/12\/08/)).toBeNull();
  });
});

describe("LeadCardCompact — contato e interação", () => {
  /**
   * O telefone saiu da face do card, e é regra de produto, não esquecimento:
   * com WhatsApp e ligar no rodapé — os dois já usando o número —, imprimir
   * `(11) 98472-1130` gastava uma linha para repetir o que os botões fazem.
   * Quem precisa do número lê no card do negócio.
   */
  it("não imprime o telefone: quem fala com a pessoa é o botão", () => {
    montar();

    expect(screen.queryByText("(11) 98472-1130")).toBeNull();
  });

  it("o botão de WhatsApp aparece quando a página sabe discar", () => {
    const onWhatsApp = vi.fn();
    montar({ onWhatsApp });

    fireEvent.click(screen.getByLabelText(/Abrir WhatsApp de Distética Suplementos/));

    expect(onWhatsApp).toHaveBeenCalled();
  });

  it("sem telefone discável não há botão de WhatsApp", () => {
    montar();

    expect(screen.queryByLabelText(/Abrir WhatsApp/)).toBeNull();
  });

  it("negócio fechado perde o rodapé de ação — vira registro", () => {
    montar({ lead: { ...LEAD, outcome: "won" }, onWhatsApp: vi.fn() });

    expect(screen.getByTestId("selo-desfecho")).toHaveTextContent("Ganha");
    expect(screen.queryByLabelText(/Abrir WhatsApp/)).toBeNull();
  });

  it("clicar no card abre o lead", () => {
    const { onClick } = montar();

    fireEvent.click(screen.getByText("Distética Suplementos"));

    expect(onClick).toHaveBeenCalled();
  });

  /**
   * A origem virou ponto de 6px: continua no card (o vendedor reconhece a cor)
   * sem gastar a largura de um distintivo escrito. O rótulo vive no nome
   * acessível — é o que o leitor de tela e o teste leem.
   */
  it("a origem continua legível, como ponto rotulado", () => {
    montar();

    expect(screen.getByLabelText("Origem: Meta Ads")).toBeInTheDocument();
    expect(screen.queryByText("Meta Ads")).toBeNull();
  });

  it("lead sem empresa cede a linha para a origem, não para 'Sem empresa'", () => {
    montar({ lead: { ...LEAD, company: null } });

    expect(screen.getByText("Meta Ads")).toBeInTheDocument();
    expect(screen.queryByText(/Sem empresa/)).toBeNull();
  });
});

/**
 * A regra que substituiu a linha de sete distintivos: **no máximo dois sinais
 * de estado**, escolhidos por severidade. Sem isto o card volta a ter uma
 * fileira que ninguém lê.
 */
describe("LeadCardCompact — no máximo dois sinais, o mais severo primeiro", () => {
  it("atrasado vence 'parado' e 'inativo'", () => {
    montar({
      lead: { ...LEAD, isInactive: true, stageEnteredAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
      dateIndicator: { label: "Atrasado", className: "" },
    });

    expect(screen.getByText("Atrasado")).toBeInTheDocument();
    expect(screen.queryByText(/parado/)).toBeNull();
    expect(screen.queryByText("Inativo")).toBeNull();
  });

  it("parado só acende a partir de 7 dias — 3 dias não é notícia", () => {
    montar({ lead: { ...LEAD, stageEnteredAt: new Date(Date.now() - 3 * 86_400_000).toISOString() } });

    expect(screen.queryByText(/parado/)).toBeNull();
  });

  it("negócio fechado não mostra sinal de urgência nenhum", () => {
    montar({
      lead: { ...LEAD, outcome: "lost", lossReason: "Financeiro", stageEnteredAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
    });

    expect(screen.queryByText(/parado/)).toBeNull();
    expect(screen.getByTestId("motivo-perda")).toHaveTextContent("Financeiro");
  });
});
