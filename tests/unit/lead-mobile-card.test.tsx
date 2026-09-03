/**
 * A lista de Leads abaixo de 768px.
 *
 * Fecha `inv:H8-33`. A entrega da fatia 1 no celular era o único pedaço sem
 * prova nenhuma: o cartão vivia inline nas 1.239 linhas de `Leads.tsx`, e
 * montar a página num teste exigiria mockar quarenta hooks — então ninguém
 * testava. O cartão saiu para `LeadMobileCard` (sem mudar pixel) e a prova é
 * esta.
 *
 * O centro da suíte é `inv:H5-07` — "Relação e Situação também no card do
 * celular", que estava marcado *escrito, sem prova*. A ADR-0023 §6 diz que as
 * duas nunca colapsam numa só, e o celular é a mesma página: se colapsarem
 * aqui, colapsaram para quem trabalha no telefone, que é a maioria do time de
 * campo.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  LeadMobileCard,
  type LeadMobileCardLead,
} from "@/modules/leads/components/leads/LeadMobileCard";
import type { LeadStanding } from "@/modules/leads/lib/lead-relacao-situacao";
import type { LeadDeal } from "@/modules/leads/hooks/useLeadsDeals";

const LEAD: LeadMobileCardLead = {
  id: "l1",
  name: "Distética Suplementos",
  company: "Distética Comércio Ltda",
  phone: "(11) 98472-1130",
  email: "compras@distetica.com.br",
  origin: "meta_ads",
};

function negocio(over: Partial<LeadDeal> = {}): LeadDeal {
  return {
    funnelName: "Orçamentos",
    funnelColor: "#a855f7",
    outcome: "open",
    ...over,
  } as LeadDeal;
}

function standing(over: Partial<LeadStanding> = {}): LeadStanding {
  return { relacao: "lead", prova: null, emNegociacao: false, maisAvancado: null, ...over };
}

function montar(props: Partial<React.ComponentProps<typeof LeadMobileCard>> = {}) {
  const onOpen = props.onOpen ?? vi.fn();
  render(
    <LeadMobileCard
      lead={LEAD}
      standing={standing()}
      onOpen={onOpen}
      originLabel="Meta Ads"
      originClassName="border-blue-500/30"
      createdLabel="04/08/2026"
      {...props}
    />,
  );
  return onOpen;
}

describe("LeadMobileCard — Relação e Situação no celular (ADR-0023 §6)", () => {
  it("mostra as duas, lado a lado, no caso mais comum: Lead sem negócio", () => {
    montar();

    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Sem negócio aberto")).toBeInTheDocument();
  });

  it("marca Cliente sem apagar a Situação — quem já comprou também pode estar negociando", () => {
    montar({
      standing: standing({
        relacao: "cliente",
        prova: "erp",
        emNegociacao: true,
        maisAvancado: negocio(),
      }),
    });

    expect(screen.getByText("Cliente")).toBeInTheDocument();
    expect(screen.getByText("Em negociação")).toBeInTheDocument();
    expect(screen.getByText("· Orçamentos")).toBeInTheDocument();
    // As duas convivem: nenhuma colapsa na outra.
    expect(screen.queryByText("Sem negócio aberto")).toBeNull();
  });

  it("Cliente sem negócio aberto continua dizendo que não há negócio", () => {
    montar({ standing: standing({ relacao: "cliente", prova: "funil" }) });

    expect(screen.getByText("Cliente")).toBeInTheDocument();
    expect(screen.getByText("Sem negócio aberto")).toBeInTheDocument();
  });

  it("em negociação sem funil resolvido não inventa nome de funil", () => {
    montar({ standing: standing({ emNegociacao: true, maisAvancado: null }) });

    expect(screen.getByText("Em negociação")).toBeInTheDocument();
    expect(screen.queryByText(/^· /)).toBeNull();
  });

  it("sem standing carregado, cai em Lead / sem negócio — nunca em branco", () => {
    montar({ standing: undefined });

    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Sem negócio aberto")).toBeInTheDocument();
  });
});

describe("LeadMobileCard — o resto do cartão", () => {
  it("abre o lead ao tocar", () => {
    const onOpen = montar();

    fireEvent.click(screen.getByText("Distética Suplementos"));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("omite empresa, telefone e email quando não existem, em vez de linha vazia", () => {
    montar({ lead: { ...LEAD, company: null, phone: null, email: null } });

    expect(screen.queryByText("Distética Comércio Ltda")).toBeNull();
    expect(screen.queryByText("(11) 98472-1130")).toBeNull();
    expect(screen.queryByText("compras@distetica.com.br")).toBeNull();
    expect(screen.getByText("Distética Suplementos")).toBeInTheDocument();
  });

  it("mostra os dois responsáveis quando existem", () => {
    montar({
      lead: {
        ...LEAD,
        pre_sale_responsible: { name: "Luiza" },
        sale_responsible: { name: "Marcos" },
      },
    });

    expect(screen.getByText("Luiza")).toBeInTheDocument();
    expect(screen.getByText("Marcos")).toBeInTheDocument();
  });

  it("pinta a borda quando selecionado", () => {
    const { container } = render(
      <LeadMobileCard
        lead={LEAD}
        standing={standing()}
        selecionado
        onOpen={vi.fn()}
        originLabel="Meta Ads"
        createdLabel="04/08/2026"
      />,
    );

    expect(container.firstElementChild?.className).toContain("border-primary/40");
  });

  it("mostra origem e data de criação já formatadas pela página", () => {
    montar();

    expect(screen.getByText("Meta Ads")).toBeInTheDocument();
    expect(screen.getByText("04/08/2026")).toBeInTheDocument();
  });
});

/**
 * O que o celular NÃO tem — medido, e escrito como teste para que a lacuna
 * pare de ser vaga ("a fatia 1 não existe abaixo de 768px") e vire linha com
 * dono. Estes casos passam HOJE porque descrevem a ausência; quando a ausência
 * for corrigida, eles falham e mandam atualizar a suíte junto com o card.
 */
describe("LeadMobileCard — as ausências conhecidas do celular", () => {
  it("não traz a coluna de Negócios da fatia 1 (inv:H1-04) — só a linha de Situação", () => {
    montar({
      standing: standing({ emNegociacao: true, maisAvancado: negocio({ value: 12400 } as never) }),
    });

    // O desktop mostra valor, etapa e tempo parado por negócio; aqui não há nada disso.
    expect(screen.queryByText(/12\.400|R\$/)).toBeNull();
  });

  it("não oferece seleção pelo cartão — o ato de selecionar só existe no desktop", () => {
    montar({ selecionado: false });

    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
