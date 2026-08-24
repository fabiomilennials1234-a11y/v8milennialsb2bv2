/**
 * O sinal de dois Negócios abertos no MESMO funil. (#1773)
 *
 * O modelo autoriza (ADR-0023 decisão 2) — é assim que recompra se representa.
 * A API cria e devolve `warning.code = lead_has_open_deal_in_pipeline`.
 *
 * Só que aviso em corpo de resposta 201 ninguém lê: quem integra ignora o campo,
 * e o vendedor, que é quem sofre, nunca vê. Sem a marca aqui o sinal é enfeite —
 * foi essa a ressalva quando o CTO escolheu "cria e sinaliza" em vez de recusar.
 *
 * O caso comum NÃO é recompra: é a mesma pessoa preenchendo o mesmo anúncio duas
 * vezes. Medido em produção em 2026-08-23, logo após o backfill: ZERO Leads com
 * dois Negócios abertos no mesmo funil. É capacidade nova, e a primeira vez que
 * acontecer alguém precisa perceber.
 *
 * O que se cobre aqui é a fronteira, não a aparência:
 *
 *   1. dois ABERTOS no mesmo funil → marca nos dois;
 *   2. dois abertos em funis DIFERENTES → sem marca (é o normal: um lead
 *      atravessa vários funis na mesma venda);
 *   3. um aberto + um FECHADO no mesmo funil → sem marca. Cliente que comprou e
 *      voltou é exatamente o que o modelo existe para representar; marcar isso
 *      transformaria a feature em alarme falso permanente.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LeadCardDeals } from "@/modules/leads/components/lead-card/LeadCardDeals";
import type { LeadCardDeal } from "@/modules/leads/components/lead-card/types";

function negocio(over: Partial<LeadCardDeal> & { id: string }): LeadCardDeal {
  return {
    titulo: "Negócio",
    funil: "Orçamentos",
    funilCor: "#a855f7",
    etapa: "enviada",
    valor: 1000,
    estado: "aberto",
    diasNaEtapa: 3,
    diasEmAberto: 10,
    progresso: { indice: 1, total: 5 },
    ...over,
  } as LeadCardDeal;
}

function montar(negocios: LeadCardDeal[]) {
  return render(
    <LeadCardDeals negocios={negocios} onOpenDeal={vi.fn()} onNewDeal={vi.fn()} />,
  );
}

describe("card do Lead — dois Negócios abertos no mesmo funil", () => {
  it("marca os DOIS quando estão no mesmo funil", () => {
    montar([
      negocio({ id: "d1", funil: "Orçamentos" }),
      negocio({ id: "d2", funil: "Orçamentos" }),
    ]);

    const marcas = screen.getAllByTestId("negocio-duplicado-no-funil");
    expect(marcas).toHaveLength(2);
    expect(marcas[0]).toHaveTextContent("2 neste funil");
  });

  // Controle. Sem ele, uma marca que aparecesse SEMPRE passaria no teste acima.
  it("não marca quando os abertos estão em funis diferentes", () => {
    montar([
      negocio({ id: "d1", funil: "Orçamentos" }),
      negocio({ id: "d2", funil: "Qualificação" }),
    ]);

    expect(screen.queryByTestId("negocio-duplicado-no-funil")).toBeNull();
  });

  // A fronteira que importa: recompra legítima não é duplicata.
  it("não marca quando o outro do mesmo funil está FECHADO", () => {
    montar([
      negocio({ id: "d1", funil: "Orçamentos", estado: "aberto" }),
      negocio({ id: "d2", funil: "Orçamentos", estado: "ganho" }),
    ]);

    expect(screen.queryByTestId("negocio-duplicado-no-funil")).toBeNull();
  });

  it("marca os três quando são três no mesmo funil", () => {
    montar([
      negocio({ id: "d1", funil: "Orçamentos" }),
      negocio({ id: "d2", funil: "Orçamentos" }),
      negocio({ id: "d3", funil: "Orçamentos" }),
    ]);

    const marcas = screen.getAllByTestId("negocio-duplicado-no-funil");
    expect(marcas).toHaveLength(3);
    expect(marcas[0]).toHaveTextContent("3 neste funil");
  });

  // A marca precisa ser lida por quem não enxerga cor nem ícone.
  it("a marca tem texto acessível dizendo o que é", () => {
    montar([
      negocio({ id: "d1", funil: "Orçamentos" }),
      negocio({ id: "d2", funil: "Orçamentos" }),
    ]);

    const marca = screen.getAllByTestId("negocio-duplicado-no-funil")[0];
    expect(marca.getAttribute("title") ?? "").toMatch(/Orçamentos/);
  });
});
