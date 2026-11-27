import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { itemDoEvento, type EventoDaAgenda, type ItemAgenda } from "@/modules/analytics/lib/agenda-unificada";

const HOJE = "2026-11-27";

const h = vi.hoisted(() => ({ itens: [] as ItemAgenda[], mutate: vi.fn() }));

vi.mock("@/modules/analytics/hooks/useAgendaUnificada", () => ({
  useAgendaUnificada: () => ({
    hoje: "2026-11-27",
    itens: h.itens,
    clientes: new Map(),
    // Lido pelo card do #2587 (contato escolhido na reunião); aqui fica vazio.
    contatosDasReunioes: new Map(),
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
  useUpdateMeeting: () => ({ mutate: h.mutate, isPending: false, variables: undefined }),
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

import { CardAgendaUnificada } from "./CardAgendaUnificada";

let seq = 0;
const evento = (over: Partial<EventoDaAgenda>): ItemAgenda => {
  seq += 1;
  return itemDoEvento(
    {
      id: `m${seq}`,
      source: "meeting",
      title: "Reunião",
      description: null,
      start_at: "2026-11-27T13:00:00Z", // 10:00 em Brasília
      event_type: "meeting",
      status: "scheduled",
      lead_id: `lead-${seq}`,
      lead_name: `Cliente ${seq}`,
      lead_company: null,
      created_by: null,
      creator_name: "Vend",
      ...over,
    },
    "America/Sao_Paulo",
    HOJE,
  ) as ItemAgenda;
};

function montar() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <CardAgendaUnificada periodo="semana" onPeriodo={vi.fn()} tipo="todos" onTipo={vi.fn()} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const linhaDe = (nome: string) => screen.getByRole("button", { name: nome }).closest("tr") as HTMLElement;

beforeEach(() => {
  h.itens = [];
  h.mutate.mockReset();
});

describe("CardAgendaUnificada — comparecimento das reuniões", () => {
  it("reunião de HOJE ainda aberta mostra os dois botões e grava o desfecho", () => {
    h.itens = [evento({ id: "hoje", lead_name: "Panni Padaria" })];
    montar();
    const linha = within(linhaDe("Panni Padaria"));
    fireEvent.click(linha.getByRole("button", { name: "Compareceu: reunião com Panni Padaria" }));
    expect(h.mutate).toHaveBeenCalledWith({ id: "hoje", status: "completed" });
    fireEvent.click(linha.getByRole("button", { name: "Não compareceu: reunião com Panni Padaria" }));
    expect(h.mutate).toHaveBeenLastCalledWith({ id: "hoje", status: "no_show" });
  });

  it("reunião atrasada segue com os dois botões", () => {
    h.itens = [evento({ lead_name: "Marinas Palace", start_at: "2026-11-26T19:00:00Z" })];
    montar();
    const linha = within(linhaDe("Marinas Palace"));
    expect(linha.getByRole("button", { name: /^Compareceu:/ })).not.toHaveAttribute("aria-disabled");
    expect(linha.getByRole("button", { name: /^Não compareceu:/ })).not.toHaveAttribute("aria-disabled");
  });

  it("reunião de dia futuro mostra os botões, mas não grava antes do dia", () => {
    h.itens = [evento({ id: "amanha", lead_name: "Hotel Amanhã", start_at: "2026-11-28T13:00:00Z" })];
    montar();
    const linha = within(linhaDe("Hotel Amanhã"));
    const sim = linha.getByRole("button", { name: /^Compareceu: .*marque no dia da reunião/ });
    const nao = linha.getByRole("button", { name: /^Não compareceu: .*marque no dia da reunião/ });
    expect(sim).toHaveAttribute("aria-disabled", "true");
    expect(nao).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sim);
    fireEvent.click(nao);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("reunião com desfecho mostra qual foi, sem botões", () => {
    h.itens = [
      evento({ lead_name: "Foi", status: "completed" }),
      evento({ lead_name: "Faltou", status: "no_show" }),
    ];
    montar();
    const foi = within(linhaDe("Foi"));
    expect(foi.getByText("Compareceu")).toBeInTheDocument();
    expect(foi.queryByRole("button", { name: /^Compareceu:/ })).toBeNull();
    const faltou = within(linhaDe("Faltou"));
    expect(faltou.getByText("Não compareceu")).toBeInTheDocument();
    expect(faltou.queryByRole("button", { name: /^Não compareceu:/ })).toBeNull();
  });

  it("toda reunião aberta do período tem o par — não só as atrasadas", () => {
    h.itens = [
      evento({ start_at: "2026-11-26T19:00:00Z" }), // ontem
      evento({}), // hoje
      evento({}), // hoje
      evento({ source: "scheduled_message", lead_name: "Mensagem" }),
    ];
    montar();
    expect(screen.getAllByRole("button", { name: /^Compareceu:/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Não compareceu:/ })).toHaveLength(3);
    expect(within(linhaDe("Mensagem")).queryByRole("button", { name: /compareceu/i })).toBeNull();
  });
});
