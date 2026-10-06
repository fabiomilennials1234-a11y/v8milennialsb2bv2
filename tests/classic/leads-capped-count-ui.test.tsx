/**
 * Interface CLÁSSICA — contagem com teto na tela de Leads (port de 2026-10-05).
 *
 * Mesmo comportamento de `tests/unit/leads-capped-count-ui.test.tsx`, no
 * visual pré-V5: os três cards de `LeadsStatsV2` da clássica (total, este mês,
 * com responsável — "N sem dono" no rodapé) e a paginação Anterior/Próxima.
 * Acima do teto a tela diz "1.000+", e nada que dependa do total exato finge
 * que sabe: percentual, barra, "sem dono" por subtração, última página.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  LEADS_COUNT_CAP,
  cappedPagination,
  countFromRows,
  formatCappedCount,
  knownTotalLabel,
} from "@/modules/leads/lib/capped-count";
import { LeadsStatsV2 } from "@/modules/leads/components/leads/LeadsStatsV2";

const exact = (value: number) => ({ value, capped: false });
const capped = { value: LEADS_COUNT_CAP, capped: true };

describe("teto e formatação", () => {
  it("o teto é 1.000 — uma constante só", () => {
    expect(LEADS_COUNT_CAP).toBe(1000);
    expect(countFromRows(1000)).toEqual(capped);
    expect(countFromRows(37)).toEqual(exact(37));
  });

  it('acima do teto diz "1.000+", abaixo diz o número', () => {
    expect(formatCappedCount(capped)).toBe("1.000+");
    expect(formatCappedCount(exact(987))).toBe("987");
    expect(formatCappedCount(undefined)).toBe("—");
  });

  it("rodapé: o total que se pode afirmar — piso no teto, exato no fim do recorte", () => {
    expect(knownTotalLabel(capped, 0, 50, 50)).toBe("1.000+");
    expect(knownTotalLabel(capped, 24, 50, 50)).toBe("1.250+");
    expect(knownTotalLabel(capped, 24, 50, 12)).toBe("1.212");
    expect(knownTotalLabel(exact(1234), 0, 50, 50)).toBe("1.234");
  });
});

describe("paginação Anterior/Próxima sobre contagem com teto", () => {
  it("total exato: página X de Y, como antes", () => {
    expect(cappedPagination(exact(120), 0, 50, 50)).toEqual({ lastPage: 2, hasNext: true });
    expect(cappedPagination(exact(120), 2, 50, 20)).toEqual({ lastPage: 2, hasNext: false });
  });

  it("no teto: Próxima segue enquanto a página vem cheia — inclusive depois da 20ª", () => {
    expect(cappedPagination(capped, 19, 50, 50)).toEqual({ lastPage: null, hasNext: true });
    expect(cappedPagination(capped, 25, 50, 50)).toEqual({ lastPage: null, hasNext: true });
    expect(cappedPagination(capped, 25, 50, 3)).toEqual({ lastPage: null, hasNext: false });
  });
});

describe("cards do topo da clássica com teto", () => {
  it('total acima do teto: "1.000+", sem percentual nem barra; "sem dono" vira N+', () => {
    render(<LeadsStatsV2 total={capped} thisMonth={exact(40)} withOwner={exact(300)} />);

    expect(screen.getByText("1.000+")).toBeInTheDocument();
    expect(screen.getByText("1.000 ou mais, com os filtros atuais")).toBeInTheDocument();
    expect(screen.queryByText(/do total entraram/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("700+ sem dono")).toBeInTheDocument();
  });

  it("com responsável também no teto: não há subtração honesta", () => {
    render(<LeadsStatsV2 total={capped} thisMonth={capped} withOwner={capped} />);

    expect(screen.getAllByText("1.000+")).toHaveLength(3);
    expect(screen.getByText("sem dono: recorte grande demais para contar")).toBeInTheDocument();
  });

  it("abaixo do teto tudo continua exato, com percentual e barra", () => {
    render(<LeadsStatsV2 total={exact(40)} thisMonth={exact(12)} withOwner={exact(30)} />);

    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("30% do total entraram este mês")).toBeInTheDocument();
    expect(screen.getByText("10 sem dono")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("recorte vazio: nenhum sem dono, sem barra", () => {
    render(<LeadsStatsV2 total={exact(0)} thisMonth={exact(0)} withOwner={exact(0)} />);
    expect(screen.getByText("nenhum sem dono")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
