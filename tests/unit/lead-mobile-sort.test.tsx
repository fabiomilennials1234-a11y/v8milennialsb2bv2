/**
 * Ordenação da lista de Leads no celular.
 *
 * Fecha `inv:H5-22` (SCRUM-127). No desktop quem ordena é o cabeçalho da
 * tabela; abaixo de 768px não há cabeçalho — a lista vira cartões —, então
 * ordenar simplesmente não existia. Quem trabalha no telefone ficava preso na
 * ordem padrão numa base onde a maior org tem 3.929 leads.
 *
 * O ponto da suíte NÃO é o desenho da faixa. É que ela **não inventa
 * semântica**: lê o catálogo fechado de `LEAD_SORT_COLUMNS` e delega a decisão
 * a `toggleLeadSort`, a mesma fonte única do cabeçalho (ADR-0024 decisão 2).
 * Dois defeitos que isso impede:
 *
 *   1. **oferecer coluna que não ordena no servidor.** Contatos, Tags,
 *      Negócios e Dono não têm ordem server-side; ordená-las no cliente
 *      reordenaria as 50 linhas da página e chamaria isso de ordenação — a
 *      mesma mentira que a decisão 2 tirou dos cards do topo;
 *   2. **divergir do desktop na regra do clique.** Se aqui o primeiro clique
 *      em "Nome" descesse e no desktop subisse, a mesma lista teria duas
 *      ordens dependendo do aparelho.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LeadMobileSortBar } from "@/modules/leads/components/leads/LeadMobileSortBar";
import {
  DEFAULT_LEAD_SORT,
  LEAD_SORT_COLUMNS,
  toggleLeadSort,
  type LeadListSort,
  type LeadSortKey,
} from "@/modules/leads/lib/lead-list-sort";

function montar(sort: LeadListSort = DEFAULT_LEAD_SORT) {
  const onSortChange = vi.fn();
  render(<LeadMobileSortBar sort={sort} onSortChange={onSortChange} />);
  return onSortChange;
}

describe("LeadMobileSortBar — só oferece o que ordena no servidor", () => {
  it("mostra exatamente as colunas do catálogo fechado, nem uma a mais", () => {
    montar();

    const botoes = screen.getAllByRole("button");
    expect(botoes).toHaveLength(Object.keys(LEAD_SORT_COLUMNS).length);
    expect(screen.getByTestId("lead-mobile-sort-name")).toBeInTheDocument();
    expect(screen.getByTestId("lead-mobile-sort-created_at")).toBeInTheDocument();
  });

  it("não oferece as colunas que só ordenariam a página", () => {
    montar();

    for (const rotulo of [/tags/i, /neg[óo]cios/i, /contatos/i, /dono/i]) {
      expect(screen.queryByRole("button", { name: rotulo })).toBeNull();
    }
  });
});

describe("LeadMobileSortBar — a regra do clique é a do desktop", () => {
  it("clicar na coluna ATIVA inverte a direção", () => {
    const onSortChange = montar({ key: "created_at", direction: "desc" });

    fireEvent.click(screen.getByTestId("lead-mobile-sort-created_at"));

    expect(onSortChange).toHaveBeenCalledWith({ key: "created_at", direction: "asc" });
  });

  it("clicar na OUTRA coluna adota a direção natural dela — nome começa de A", () => {
    const onSortChange = montar({ key: "created_at", direction: "desc" });

    fireEvent.click(screen.getByTestId("lead-mobile-sort-name"));

    expect(onSortChange).toHaveBeenCalledWith({ key: "name", direction: "asc" });
  });

  it("e data começa da mais recente, não da mais antiga", () => {
    const onSortChange = montar({ key: "name", direction: "asc" });

    fireEvent.click(screen.getByTestId("lead-mobile-sort-created_at"));

    expect(onSortChange).toHaveBeenCalledWith({ key: "created_at", direction: "desc" });
  });

  it("dois cliques na mesma coluna voltam ao ponto de partida", () => {
    const onSortChange = montar({ key: "name", direction: "asc" });

    fireEvent.click(screen.getByTestId("lead-mobile-sort-name"));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", direction: "desc" });

    // A faixa é controlada: quem guarda o estado é a página. Simulamos a volta
    // remontando com o que ela devolveu.
    const segunda = montar({ key: "name", direction: "desc" });
    fireEvent.click(screen.getAllByTestId("lead-mobile-sort-name")[1]);
    expect(segunda).toHaveBeenLastCalledWith({ key: "name", direction: "asc" });
  });
});

describe("LeadMobileSortBar — a faixa entrega ordenação PRONTA, não a coluna", () => {
  /**
   * O defeito que esta suíte não pegava, e que viveu até o `typecheck` voltar
   * a rodar: a página ligava `onSortChange` ao handler do cabeçalho do
   * desktop, que recebe a COLUNA e resolve a direção. Como a faixa já resolve,
   * o toggle era aplicado duas vezes — e a segunda recebia um objeto onde se
   * espera `"name" | "created_at"`.
   *
   * A suíte inteira acima monta a faixa com um `onSortChange` de mentira, então
   * nada aqui divergia. O gate real é o compilador; este caso existe para que a
   * consequência fique escrita: o duplo toggle não degrada, ele derruba a tela.
   */
  it("aplicar o toggle no que a faixa já resolveu derruba a lista", () => {
    const jaResolvido = toggleLeadSort(DEFAULT_LEAD_SORT, "name");

    expect(() =>
      toggleLeadSort(DEFAULT_LEAD_SORT, jaResolvido as unknown as LeadSortKey),
    ).toThrow(TypeError);
  });

  it("o que a faixa emite é persistível como está — é um LeadListSort completo", () => {
    const onSortChange = montar({ key: "created_at", direction: "desc" });

    fireEvent.click(screen.getByTestId("lead-mobile-sort-name"));

    const [emitido] = onSortChange.mock.calls[0] as [LeadListSort];
    expect(Object.keys(emitido).sort()).toEqual(["direction", "key"]);
    expect(LEAD_SORT_COLUMNS[emitido.key]).toBeDefined();
    expect(["asc", "desc"]).toContain(emitido.direction);
  });
});

describe("LeadMobileSortBar — o que está ativo aparece", () => {
  it("marca a coluna ativa por aria-pressed", () => {
    montar({ key: "name", direction: "asc" });

    expect(screen.getByTestId("lead-mobile-sort-name")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("lead-mobile-sort-created_at")).toHaveAttribute("aria-pressed", "false");
  });

  it("a seta só existe na coluna ativa — seta na inativa sugeriria que ela ordena", () => {
    montar({ key: "created_at", direction: "desc" });

    expect(screen.getByTestId("lead-mobile-sort-created_at").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("lead-mobile-sort-name").querySelector("svg")).toBeNull();
  });

  it("o grupo tem rótulo acessível", () => {
    montar();

    expect(screen.getByRole("group", { name: /ordenar a lista/i })).toBeInTheDocument();
  });
});
