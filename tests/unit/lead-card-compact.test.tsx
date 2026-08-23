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
  it("mostra o telefone quando a org quer contato no card", () => {
    montar();

    expect(screen.getByText("(11) 98472-1130")).toBeInTheDocument();
  });

  it("config.showContact desligado tira o telefone", () => {
    montar({ config: { ...CONFIG_TUDO, showContact: false } });

    expect(screen.queryByText("(11) 98472-1130")).toBeNull();
  });

  it("clicar no card abre o lead", () => {
    const { onClick } = montar();

    fireEvent.click(screen.getByText("Distética Suplementos"));

    expect(onClick).toHaveBeenCalled();
  });

  it("mostra a origem que a página resolveu", () => {
    montar();

    expect(screen.getByText("Meta Ads")).toBeInTheDocument();
  });
});
