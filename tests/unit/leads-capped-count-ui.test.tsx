/**
 * Contagem com teto na tela de Leads.
 *
 * As contagens deixaram de ser `count: exact` (varre o recorte inteiro sob RLS,
 * 6× por aba aberta) e passaram a ler no máximo `LEADS_COUNT_CAP` ids. Acima do
 * teto a tela diz "1.000+" — e nada que dependa do total exato pode continuar
 * fingindo que sabe: percentual, "sem responsável" por subtração, botão da
 * última página.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import {
  LEADS_COUNT_CAP,
  formatCappedCount,
  formatShownTotal,
  countFromRows,
  cappedPagination,
  knownTotalLabel,
} from "@/modules/leads/lib/capped-count";
import { LeadsStatsV2 } from "@/modules/leads/components/leads/LeadsStatsV2";
import { LeadsPageSegments } from "@/modules/leads/components/leads/LeadsPageSegments";

const exact = (value: number) => ({ value, capped: false });
const capped = { value: LEADS_COUNT_CAP, capped: true };

describe("teto e formatação", () => {
  it("o teto é 1.000 — uma constante só", () => {
    expect(LEADS_COUNT_CAP).toBe(1000);
  });

  it("linhas lidas viram contagem: abaixo do teto exata, no teto marcada", () => {
    expect(countFromRows(37)).toEqual(exact(37));
    expect(countFromRows(1000)).toEqual(capped);
  });

  it('acima do teto diz "1.000+", abaixo diz o número', () => {
    expect(formatCappedCount(capped)).toBe("1.000+");
    expect(formatCappedCount(exact(987))).toBe("987");
    expect(formatCappedCount(undefined)).toBe("—");
  });

  it("rodapé: dentro do teto, de 1.000+; passado o teto, o que já se sabe", () => {
    expect(formatShownTotal(capped, 0, 50, 50)).toBe("Mostrando 1–50 de 1.000+");
    expect(formatShownTotal(capped, 24, 50, 50)).toBe("Mostrando 1.201–1.250 de 1.250+");
    // Página incompleta depois do teto: chegou ao fim, o total agora é exato.
    expect(formatShownTotal(capped, 24, 50, 12)).toBe("Mostrando 1.201–1.212 de 1.212");
    expect(formatShownTotal(exact(120), 2, 50, 20)).toBe("Mostrando 101–120 de 120");
  });
});

describe("paginação sobre contagem com teto (a regra que as duas interfaces usam)", () => {
  it("total exato: há última página", () => {
    expect(cappedPagination(exact(120), 0, 50, 50)).toEqual({ lastPage: 2, hasNext: true });
    expect(cappedPagination(exact(120), 2, 50, 20)).toEqual({ lastPage: 2, hasNext: false });
    expect(cappedPagination(exact(0), 0, 50, 0)).toEqual({ lastPage: 0, hasNext: false });
  });

  it("no teto: sem última página; próxima enquanto a página vem cheia — inclusive depois da 20ª", () => {
    expect(cappedPagination(capped, 19, 50, 50)).toEqual({ lastPage: null, hasNext: true });
    expect(cappedPagination(capped, 30, 50, 50)).toEqual({ lastPage: null, hasNext: true });
    expect(cappedPagination(capped, 30, 50, 7)).toEqual({ lastPage: null, hasNext: false });
  });

  it("sem contagem ainda: nada a paginar", () => {
    expect(cappedPagination(undefined, 0, 50, 50)).toEqual({ lastPage: null, hasNext: false });
  });

  it("o total que se pode afirmar: piso no teto, exato no fim do recorte", () => {
    expect(knownTotalLabel(capped, 0, 50, 50)).toBe("1.000+");
    expect(knownTotalLabel(capped, 24, 50, 50)).toBe("1.250+");
    expect(knownTotalLabel(capped, 24, 50, 12)).toBe("1.212");
    expect(knownTotalLabel(exact(987), 0, 50, 50)).toBe("987");
  });
});

describe("cards do topo com teto", () => {
  it('total acima do teto: "1.000+", sem percentual, "sem responsável" vira N+', () => {
    render(<LeadsStatsV2 total={capped} thisMonth={exact(40)} withOwner={exact(300)} />);

    expect(screen.getByText("1.000+")).toBeInTheDocument();
    expect(screen.queryByText("%")).not.toBeInTheDocument();
    expect(screen.queryByText(/do total entraram/)).not.toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("700+")).toBeInTheDocument();
  });

  it('com responsável também no teto: "sem responsável" fica "—" (não há subtração honesta)', () => {
    render(<LeadsStatsV2 total={capped} thisMonth={exact(40)} withOwner={capped} />);

    // rótulo → linha do rótulo → cartão
    const semDono = screen.getByText("Leads sem responsável").parentElement!.parentElement!;
    expect(within(semDono).getByText("—")).toBeInTheDocument();
  });

  it("abaixo do teto tudo continua exato, com percentual", () => {
    render(<LeadsStatsV2 total={exact(40)} thisMonth={exact(12)} withOwner={exact(30)} />);

    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument(); // 30/40 → 75 %
    expect(screen.getByText("30% do total entraram este mês")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument(); // 40 − 30
  });
});

describe("paginação navegável além da página 20", () => {
  it("total conhecido: primeira, vizinhas e última, como antes", () => {
    render(<LeadsPageSegments page={3} lastPage={9} hasNext onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Página 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página 4" })).toHaveAttribute("aria-current", "page");
  });

  it("no teto: sem botão de última página; Próxima segue enquanto a página vem cheia", () => {
    const onChange = vi.fn();
    render(<LeadsPageSegments page={19} lastPage={null} hasNext onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Página 20" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Página 21" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Página 1000" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it("página 25 de um recorte com teto ainda navega para a 26", () => {
    const onChange = vi.fn();
    render(<LeadsPageSegments page={24} lastPage={null} hasNext onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Página 26" }));
    expect(onChange).toHaveBeenCalledWith(25);
    expect(screen.getByRole("button", { name: "Página 1" })).toBeInTheDocument();
  });

  it("fim do recorte com teto (página incompleta): Próxima desliga", () => {
    render(<LeadsPageSegments page={24} lastPage={null} hasNext={false} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Próxima" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Página 26" })).not.toBeInTheDocument();
  });
});
