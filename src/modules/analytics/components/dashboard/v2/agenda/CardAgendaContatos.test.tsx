import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgendaContato, FiltroAgenda } from "@/modules/analytics/lib/agenda-contatos";

const h = vi.hoisted(() => ({
  data: [] as AgendaContato[],
  concluir: vi.fn(),
  marcar: vi.fn(),
  isAdmin: false,
  visao: "todos" as "meu" | "todos",
  setVisao: vi.fn(),
}));

vi.mock("@/modules/analytics/hooks/useAgendaContatos", () => ({
  useAgendaContatos: () => ({ data: h.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useConcluirAgendaContato: () => ({ mutate: h.concluir, isPending: false, variables: undefined }),
  useMarcarAgendaContato: () => ({ mutate: h.marcar, mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useBuscaClientesAgenda: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/modules/analytics/hooks/useEscopoAgenda", async (orig) => ({
  ...(await orig<typeof import("@/modules/analytics/hooks/useEscopoAgenda")>()),
  useEscopoAgenda: () => ({
    podeAlternar: h.isAdmin,
    visao: h.visao,
    setVisao: h.setVisao,
    somenteMeus: !h.isAdmin || h.visao === "meu",
    vendoEquipe: h.isAdmin && h.visao === "todos",
  }),
}));
// O botão real resolve caixas no Supabase; aqui interessa que ele está na linha
// com o lead e o telefone certos.
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: ({ leadId, phone, children, ...rest }: { leadId: string; phone: string; children: React.ReactNode; "aria-label"?: string }) => (
    <button type="button" data-lead={leadId} data-phone={phone} aria-label={rest["aria-label"]}>{children}</button>
  ),
}));

import { CardAgendaContatos } from "./CardAgendaContatos";

const HOJE = "2026-11-10";
const linha = (over: Partial<AgendaContato>): AgendaContato => ({
  id: "a1",
  lead_id: "lead-1",
  lead_name: "Alfa Bar",
  lead_company: "Alfa LTDA",
  lead_phone: "5548999990001",
  lead_phones: ["5548999990001", "554833330001"],
  lead_erp_code: "7001",
  lead_uf: "SC",
  lead_cidade: "FLORIANOPOLIS",
  erp_representante: "FERNANDA LESSIR MACHADO",
  owner_id: "tm-1",
  owner_name: "Vend 1",
  data_agenda: HOJE,
  observacao: null,
  situacao: "hoje",
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

function montar(filtro: FiltroAgenda = "todas", onFiltro = vi.fn()) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <CardAgendaContatos hoje={HOJE} filtro={filtro} onFiltro={onFiltro} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isAdmin = false;
  h.visao = "todos";
  h.data = [
    linha({ id: "a-atrasada", lead_id: "l-g", lead_name: "Gama Café", data_agenda: "2026-11-07", situacao: "atrasada" }),
    linha({ id: "a-hoje", lead_id: "l-b", lead_name: "Beta Loja", situacao: "hoje", observacao: "Fechar pedido" }),
    linha({ id: "a-futura", lead_id: "l-a", lead_name: "Alfa Bar", data_agenda: "2026-11-15", situacao: "futura" }),
  ];
});

describe("CardAgendaContatos", () => {
  it("mostra as colunas da planilha da Café", () => {
    montar();
    const cab = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(cab).toEqual(["Cód.", "Cliente", "Nome fantasia", "Telefones", "Data da agenda", "Cidade", "Representante", "Contato", "Fechar agenda"]);
  });

  it("traz os dados do cliente: código, nome fantasia, telefones, cidade e representante", () => {
    h.data = [linha({ lead_name: "GSC COMERCIO DE ALIMENTOS LTDA", lead_company: "SABOR & CIA" })];
    montar();
    const corpo = screen.getAllByRole("rowgroup")[1];
    expect(within(corpo).getByText("7001")).toBeInTheDocument();
    expect(within(corpo).getByText("SABOR & CIA")).toBeInTheDocument();
    expect(within(corpo).getByText(/99999-0001/)).toBeInTheDocument();
    expect(within(corpo).getByText(/3333-0001/)).toBeInTheDocument();
    expect(within(corpo).getByText(/florianopolis/i)).toBeInTheDocument();
    expect(within(corpo).getByText(/fernanda lessir machado/i)).toBeInTheDocument();
  });

  it("nome fantasia igual à razão social não se repete", () => {
    h.data = [linha({ lead_name: "Alfa Bar", lead_company: "Alfa Bar" })];
    montar();
    expect(screen.getAllByText("Alfa Bar")).toHaveLength(1);
  });

  it("pinta a data: vermelho atrasada, amarelo hoje, azul futura", () => {
    montar();
    const atrasada = screen.getByRole("button", { name: /Atrasada: sáb, 07 nov/i });
    const hoje = screen.getByRole("button", { name: /Hoje: ter, 10 nov/i });
    const futura = screen.getByRole("button", { name: /Futura: dom, 15 nov/i });
    expect(atrasada.className).toMatch(/destructive/);
    expect(hoje.className).toMatch(/warning/);
    expect(futura.className).toMatch(/scheduled/);
    expect(atrasada).toHaveTextContent("há 3 dias");
    expect(futura).toHaveTextContent("em 5 dias");
  });

  it("Entrar em contato abre a conversa do lead certo", () => {
    montar();
    const botao = screen.getByRole("button", { name: "Entrar em contato com Beta Loja" });
    expect(botao).toHaveAttribute("data-lead", "l-b");
    expect(botao).toHaveAttribute("data-phone", "5548999990001");
  });

  it("o X fecha a agenda daquela linha — e só por ele ela sai", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Fechar agenda de Gama Café" }));
    expect(h.concluir).toHaveBeenCalledWith({ id: "a-atrasada", lead_name: "Gama Café" });
  });

  it("cliente sem telefone: avisa em vez de mostrar botão que não leva a lugar nenhum", () => {
    h.data = [linha({ lead_phone: null })];
    montar();
    expect(screen.queryByRole("button", { name: /Entrar em contato/ })).not.toBeInTheDocument();
    expect(screen.getByText("Sem telefone")).toBeInTheDocument();
  });

  it("filtro de cor mostra só aquela cor", () => {
    montar("atrasada");
    const corpo = screen.getAllByRole("rowgroup")[1];
    expect(within(corpo).getAllByRole("row")).toHaveLength(1);
    expect(within(corpo).getByText("Gama Café")).toBeInTheDocument();
  });

  it("admin na visão da equipe vê de quem é cada agenda", () => {
    h.isAdmin = true;
    montar();
    expect(screen.getAllByText("Agenda: Vend 1").length).toBeGreaterThan(0);
  });

  it("vendedor não vê a linha de dono da agenda", () => {
    montar();
    expect(screen.queryByText(/^Agenda:/)).not.toBeInTheDocument();
  });

  it("vendedor não tem o toggle Meu/Todos", () => {
    montar();
    expect(screen.queryByRole("radiogroup", { name: "Ver agendas" })).not.toBeInTheDocument();
  });

  it("admin tem o toggle Meu/Todos e trocar pede a outra visão", () => {
    h.isAdmin = true;
    montar();
    const grupo = screen.getByRole("radiogroup", { name: "Ver agendas" });
    fireEvent.click(within(grupo).getByRole("radio", { name: "Meu" }));
    expect(h.setVisao).toHaveBeenCalledWith("meu");
  });

  it("admin em Meu: sem rótulo Equipe e sem a linha de dono", () => {
    h.isAdmin = true;
    h.visao = "meu";
    montar();
    expect(screen.queryByText("Equipe")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Agenda:/)).not.toBeInTheDocument();
  });

  it("lista vazia explica o que fazer", () => {
    h.data = [];
    montar();
    expect(screen.getByText("Nenhuma agenda marcada")).toBeInTheDocument();
  });
});
