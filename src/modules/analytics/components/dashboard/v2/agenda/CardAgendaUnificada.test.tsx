import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgendaContato } from "@/modules/analytics/lib/agenda-contatos";
import { itemDoContato, itemDoEvento, type EventoDaAgenda, type ItemAgenda } from "@/modules/analytics/lib/agenda-unificada";
import type { ClienteDaAgenda, ContatoDaReuniao } from "@/modules/analytics/hooks/useAgendaUnificada";

const h = vi.hoisted(() => ({
  itens: [] as ItemAgenda[],
  clientes: new Map<string, ClienteDaAgenda>(),
  contatosDasReunioes: new Map<string, ContatoDaReuniao>(),
}));

vi.mock("@/modules/analytics/hooks/useAgendaUnificada", () => ({
  useAgendaUnificada: () => ({
    hoje: "2026-11-27",
    itens: h.itens,
    clientes: h.clientes,
    contatosDasReunioes: h.contatosDasReunioes,
    isLoading: false,
    isError: false,
    indisponiveis: { eventos: false, contatos: false, atrasados: false },
    refetch: vi.fn(),
  }),
}));
vi.mock("@/modules/analytics/hooks/useAgendaContatos", () => ({
  useMarcarAgendaContato: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useConcluirAgendaContato: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("@/modules/analytics/hooks/useEscopoAgenda", async (orig) => ({
  ...(await orig<typeof import("@/modules/analytics/hooks/useEscopoAgenda")>()),
  useEscopoAgenda: () => ({ podeAlternar: false, visao: "meu", setVisao: vi.fn(), somenteMeus: true, vendoEquipe: false }),
}));
vi.mock("@/modules/engagement", () => ({
  CreateMeetingDialog: () => null,
  useUpdateMeeting: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
// O botão real resolve caixas no Supabase; aqui interessa o número que ele abre.
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: ({ leadId, phone, children, ...rest }: { leadId: string; phone: string; children: React.ReactNode; "aria-label"?: string }) => (
    <button type="button" data-lead={leadId} data-phone={phone} aria-label={rest["aria-label"]}>{children}</button>
  ),
}));

import { CardAgendaUnificada } from "./CardAgendaUnificada";

const contato = (over: Partial<AgendaContato>): AgendaContato => ({
  id: "a1",
  lead_id: "lead-a",
  lead_name: "Alfa Bar",
  lead_company: null,
  lead_phone: "5548999990001",
  lead_phones: ["5548999990001", "5548988880001"],
  lead_erp_code: "7001",
  lead_uf: "SC",
  lead_cidade: null,
  erp_representante: null,
  owner_id: "tm-1",
  owner_name: "Vend",
  data_agenda: "2026-11-27",
  observacao: null,
  situacao: "hoje",
  created_at: "2026-11-20T00:00:00Z",
  ...over,
});

const reuniao = (over: Partial<EventoDaAgenda>): ItemAgenda =>
  itemDoEvento(
    {
      id: "m1",
      source: "meeting",
      title: "Reunião - Beta Loja",
      description: null,
      start_at: "2026-11-27T17:00:00Z",
      event_type: "meeting",
      status: "scheduled",
      lead_id: "lead-b",
      lead_name: "Beta Loja",
      lead_company: null,
      created_by: null,
      creator_name: "Vend",
      ...over,
    },
    "America/Sao_Paulo",
    "2026-11-27",
  ) as ItemAgenda;

function montar() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <CardAgendaUnificada periodo="hoje" onPeriodo={vi.fn()} tipo="todos" onTipo={vi.fn()} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const linhaDe = (cliente: string) => screen.getByRole("button", { name: cliente }).closest("tr") as HTMLElement;

beforeEach(() => {
  h.clientes = new Map([["lead-b", { erpCode: "7002", phone: "5548999990002", uf: null, cidade: null, representante: null }]]);
  h.contatosDasReunioes = new Map();
});

describe("CardAgendaUnificada — contato escolhido", () => {
  it("próximo contato: mostra o contato escolhido e o 'Entrar em contato' abre o número dele", () => {
    h.itens = [itemDoContato(contato({ lead_phone_id: "ph2", contato_nome: "Ana - Financeiro", contato_telefone: "5548988880001" }))];
    montar();
    const linha = linhaDe("Alfa Bar");
    expect(within(linha).getByText("Ana - Financeiro")).toBeInTheDocument();
    const botao = within(linha).getByRole("button", { name: "Entrar em contato com Ana - Financeiro" });
    expect(botao).toHaveAttribute("data-phone", "5548988880001");
  });

  it("próximo contato sem escolha: telefone principal, sem nome de contato", () => {
    h.itens = [itemDoContato(contato({}))];
    montar();
    const linha = linhaDe("Alfa Bar");
    expect(within(linha).getByRole("button", { name: "Entrar em contato com Alfa Bar" })).toHaveAttribute("data-phone", "5548999990001");
    expect(within(linha).queryByText("Ana - Financeiro")).toBeNull();
  });

  it("reunião: o contato escolhido vence o principal do cliente", () => {
    h.itens = [reuniao({})];
    h.contatosDasReunioes = new Map([["m1", { nome: "Bruno - Compras", telefone: "5548977770002" }]]);
    montar();
    const linha = linhaDe("Beta Loja");
    expect(within(linha).getByText("Bruno - Compras")).toBeInTheDocument();
    expect(within(linha).getByRole("button", { name: "Entrar em contato com Bruno - Compras" })).toHaveAttribute("data-phone", "5548977770002");
  });

  it("reunião sem contato escolhido segue no telefone do cliente", () => {
    h.itens = [reuniao({})];
    montar();
    const linha = linhaDe("Beta Loja");
    expect(within(linha).getByRole("button", { name: "Entrar em contato com Beta Loja" })).toHaveAttribute("data-phone", "5548999990002");
  });
});
