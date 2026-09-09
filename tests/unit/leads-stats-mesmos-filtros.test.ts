/**
 * Os cards do topo contam o MESMO recorte que a lista mostra.
 *
 * Fecha `inv:H5-21` (SCRUM-125). A ADR-0024 §2 já tinha tirado os cards do
 * `useMemo` sobre a página — eles passaram a contar a organização. Mas contar a
 * organização inteira ignorando o filtro ativo é o outro lado do mesmo defeito:
 * o card diz 2.987 e a lista embaixo mostra os 40 que casam com o filtro.
 *
 * ── O QUE ESTAVA ERRADO, MEDIDO NO CÓDIGO ─────────────────────────────────
 * `useLeadsStats` reimplementava os filtros inline em vez de usar
 * `applyLeadListFilters`, que é a fonte única compartilhada por `useLeads`,
 * `useLeadsCount` e `useExportLeads`. A cópia divergiu em dois pontos:
 *
 *   1. `filterQualification` era desestruturado, entrava na queryKey e **nunca
 *      era aplicado**. Filtrar trocava a chave do cache — ou seja, refetch a
 *      cada clique — para devolver exatamente o mesmo número;
 *   2. a busca não casava `normalized_phone`, então procurar por telefone
 *      contava um conjunto e listava outro. Telefone é digitado com máscara e
 *      gravado cru: é justamente a busca em que o usuário mais confia.
 *
 * E faltava o guard `is_shadow`, que a lista aplica: lead sombra não aparece
 * embaixo, então não pode entrar na conta de cima.
 *
 * Esta suíte trava a ligação com a fonte única. Se alguém reimplementar filtro
 * aqui de novo, um destes casos cai.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Registro de tudo que o hook pediu ao builder, na ordem. */
interface Chamada {
  metodo: string;
  args: unknown[];
}

const chamadas: Chamada[] = [];

function builderFake() {
  const b: Record<string, unknown> = {};
  const registra = (metodo: string) =>
    (...args: unknown[]) => {
      chamadas.push({ metodo, args });
      return b;
    };
  for (const m of ["select", "eq", "is", "or", "gte", "lte", "lt", "not", "in"]) {
    b[m] = registra(m);
  }
  // O hook faz `await` no builder: resolvemos com uma contagem qualquer.
  (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ count: 7, error: null });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => builderFake() },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({
    organizationId: "org-1",
    isReady: true,
    timezone: "America/Sao_Paulo",
  }),
}));

import { useLeadsStats } from "@/modules/leads/hooks/useLeadsStats";

function montar(filtros: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useLeadsStats(filtros), { wrapper });
}

/** Toda chamada de um método, achatada em `metodo(arg0, arg1)` para inspeção. */
function feitas(metodo: string): string[] {
  return chamadas.filter((c) => c.metodo === metodo).map((c) => c.args.map((a) => JSON.stringify(a)).join(","));
}

beforeEach(() => {
  chamadas.length = 0;
  vi.clearAllMocks();
});

describe("useLeadsStats — o card conta o que a lista mostra", () => {
  it("aplica o filtro de QUALIFICAÇÃO, que antes era ignorado", async () => {
    const { result } = montar({ filterQualification: "ouro" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("eq").some((c) => c.startsWith('"qualification_tier","ouro"'))).toBe(true);
  });

  it('o sentinel "none" vira IS NULL, não igualdade com o texto', async () => {
    const { result } = montar({ filterQualification: "none" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("is").some((c) => c.startsWith('"qualification_tier",null'))).toBe(true);
    expect(feitas("eq").some((c) => c.includes("qualification_tier"))).toBe(false);
  });

  it("busca por telefone casa normalized_phone — a lista casava, o card não", async () => {
    const { result } = montar({ searchQuery: "99999-8888" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // `or()` é chamado duas vezes por query: o guard de lead sombra e a busca.
    // Interessa a cláusula de busca — daí `some`, não `every`.
    const busca = feitas("or").filter((c) => c.includes("name.ilike"));
    expect(busca.length).toBeGreaterThanOrEqual(2);
    expect(busca.every((c) => c.includes("normalized_phone.ilike"))).toBe(true);
    expect(busca.every((c) => c.includes("999998888"))).toBe(true);
  });

  it("termo curto NÃO vira busca de telefone — casaria com a base inteira", async () => {
    const { result } = montar({ searchQuery: "21" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("or").every((c) => !c.includes("normalized_phone"))).toBe(true);
  });

  it("exclui lead sombra, igual à lista", async () => {
    const { result } = montar({});
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("or").some((c) => c.includes("is_shadow"))).toBe(true);
  });

  it("sem filtro nenhum, nenhum recorte extra entra na query", async () => {
    const { result } = montar({});
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("eq").some((c) => c.includes('"origin"'))).toBe(false);
    expect(feitas("eq").some((c) => c.includes("qualification_tier"))).toBe(false);
    expect(feitas("or").some((c) => c.includes("name.ilike"))).toBe(false);
    // `rating` saiu da interface em 2026-09-03 — não entra em recorte nenhum.
    expect(feitas("gte").filter((c) => c.includes("rating")).length).toBe(0);
  });

  it('origem "all" é ausência de filtro, não um valor', async () => {
    const { result } = montar({ filterOrigin: "all" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("eq").some((c) => c.includes('"origin","all"'))).toBe(false);
  });

  it("mantém o recorte de tenancy e de lixeira em toda contagem", async () => {
    const { result } = montar({});
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("eq").filter((c) => c.startsWith('"organization_id","org-1"')).length).toBeGreaterThanOrEqual(2);
    expect(feitas("is").filter((c) => c.startsWith('"deleted_at",null')).length).toBeGreaterThanOrEqual(2);
  });

  it("a janela de criação continua valendo para os dois números", async () => {
    const { result } = montar({ createdFrom: "2026-08-01T03:00:00.000Z", createdTo: "2026-08-31T02:59:59.999Z" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(feitas("gte").filter((c) => c.startsWith('"created_at","2026-08-01')).length).toBeGreaterThanOrEqual(2);
    expect(feitas("lte").filter((c) => c.startsWith('"created_at","2026-08-31')).length).toBeGreaterThanOrEqual(2);
  });
});
