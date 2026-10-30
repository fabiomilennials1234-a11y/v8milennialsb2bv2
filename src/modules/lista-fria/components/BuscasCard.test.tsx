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
  cobranca: "por_contato",
  contatosNovos: 10,
  varridos: 0,
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

  it("Instagram antigo (cobrado por contato) fala em créditos Meta e em limite", () => {
    montar({ fonte: "instagram", titulo: "@crm.datacrazy", encontrados: 40, creditosUsados: 10, creditosLimite: 10, contatosNovos: 10 });
    expect(screen.getByRole("region", { name: "Buscas da Lista fria" })).toHaveTextContent(/limite de\s*10\s*créditos Meta/);
  });

  it("Instagram por varredura: contatos entregues, seguidores analisados e créditos gastos da reserva, sem confundir os três", () => {
    montar({
      fonte: "instagram",
      titulo: "@crm.datacrazy",
      cobranca: "por_varredura",
      status: "concluida",
      creditosLimite: 50,
      creditosUsados: 50,
      varridos: 50,
      encontrados: 50,
      contatosNovos: 3,
    });
    const card = screen.getByRole("region", { name: "Buscas da Lista fria" });
    expect(card).toHaveTextContent(/3\s*contatos novos/);
    expect(card).toHaveTextContent(/50\s*seguidores analisados/);
    expect(card).toHaveTextContent(/50\s*de\s*50\s*créditos Meta/);
    expect(card).not.toHaveTextContent(/limite de/);
    expect(screen.getByTitle(/Se a busca terminar sem nenhum contato, metade dos créditos gastos volta/)).toBeInTheDocument();
  });

  it("busca por varredura sem nenhum contato não oferece revisão (não há o que importar)", () => {
    montar({ fonte: "instagram", cobranca: "por_varredura", status: "concluida", creditosLimite: 50, creditosUsados: 25, varridos: 50, contatosNovos: 0 });
    expect(screen.queryByRole("link", { name: /Revisar e importar/ })).not.toBeInTheDocument();
  });

  it("quem já era lead aparece à parte e não conta como contato novo", () => {
    montar({ contatosNovos: 7, creditosUsados: 7, jaLeads: 3 });
    const card = screen.getByRole("region", { name: "Buscas da Lista fria" });
    expect(card).toHaveTextContent(/7\s*contatos novos/);
    expect(card).toHaveTextContent(/3\s*já são seus leads/);
  });
});
