import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { Busca } from "../lib/tipos";
import { BuscasCard } from "./BuscasCard";

const base: Busca = {
  id: "b1",
  fonte: "cnpj",
  titulo: "CNAE 8630-5/04 · SAO PAULO - SP",
  local: { cidade: "SAO PAULO", uf: "SP" },
  status: "parada",
  etapa: null,
  progresso: 100,
  creditosLimite: 10,
  creditosUsados: 10,
  encontrados: 243,
  comTelefone: 184,
  comEmail: 243,
  jaLeads: 0,
  semContato: 0,
  importados: 0,
  importadaEm: null,
  erro: null,
  criadaEm: "2026-10-29T15:00:00Z",
  terminouEm: "2026-10-29T15:00:07Z",
};

const buscas = { current: [base] as Busca[] };

vi.mock("../hooks/useListaFriaDados", () => ({
  useBuscas: () => ({ data: buscas.current, isLoading: false }),
  useSaldos: () => ({ data: { normal: 160, meta: 10 } }),
}));
vi.mock("../hooks/useListaFriaMutacoes", () => ({
  usePararBusca: () => ({ mutate: vi.fn(), isPending: false }),
}));

function montar(b: Partial<Busca> = {}) {
  buscas.current = [{ ...base, ...b }];
  render(
    <MemoryRouter>
      <BuscasCard podeEditar />
    </MemoryRouter>,
  );
}

describe("BuscasCard: o que a busca entregou x o que analisou", () => {
  it("mostra os contatos NOVOS (os cobrados) e o total analisado separado, sem confundir os dois", () => {
    montar();
    const card = screen.getByRole("region", { name: "Buscas da Lista fria" });
    expect(card).toHaveTextContent(/10\s*contatos novos/);
    expect(card).toHaveTextContent(/243\s*analisados/);
    expect(card).toHaveTextContent(/limite de\s*10\s*créditos/);
    // Eram números do universo analisado (184 e 243): induziam a achar que a lista tinha 243 contatos.
    expect(card).not.toHaveTextContent(/com telefone/);
    expect(card).not.toHaveTextContent(/negócios encontrados/);
  });

  it("explica o que 'analisados' quer dizer", () => {
    montar();
    expect(screen.getByTitle(/Só os que cabem nos seus créditos entram na lista/)).toBeInTheDocument();
  });

  it("Instagram fala em créditos Meta", () => {
    montar({ fonte: "instagram", titulo: "@crm.datacrazy", encontrados: 40, creditosUsados: 10, creditosLimite: 10 });
    expect(screen.getByRole("region", { name: "Buscas da Lista fria" })).toHaveTextContent(/limite de\s*10\s*créditos Meta/);
  });

  it("quem já era lead aparece à parte e não conta como contato novo", () => {
    montar({ creditosUsados: 7, jaLeads: 3 });
    const card = screen.getByRole("region", { name: "Buscas da Lista fria" });
    expect(card).toHaveTextContent(/7\s*contatos novos/);
    expect(card).toHaveTextContent(/3\s*já são seus leads/);
  });
});
