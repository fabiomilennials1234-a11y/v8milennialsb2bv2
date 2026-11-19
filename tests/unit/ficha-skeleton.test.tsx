/**
 * Ficha do lead pela régua de espera: nada antes de 100 ms, osso com a forma
 * real (avatar, nome, ações, campos), frase aos 1 s, nunca "Carregando…".
 * Também mede "tempo até útil" uma vez por abertura.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

let estado: { data: unknown; isLoading: boolean; visibility: string } = {
  data: null,
  isLoading: true,
  visibility: "loading",
};
const marcar = vi.fn();
vi.mock("@/core/perf/MarcarUtil", () => ({
  MarcarUtil: ({ tela, pronto }: { tela: string; pronto: boolean }) => {
    marcar(tela, pronto);
    return null;
  },
}));
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: () => ({ ...estado, organizacaoId: "org-1" }),
}));
vi.mock("@/shared/components/LeadCallActionSlot", () => ({ useLeadCallAction: () => null }));
const { mut } = vi.hoisted(() => ({
  mut: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useLeads", () => ({ useUpdateLead: mut, useToggleLeadAI: mut, useDeleteLead: mut }));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({ useSaveCustomFieldValue: mut }));
vi.mock("@/modules/leads/hooks/useLeadDocument", () => ({ useSalvarLeadDocuments: mut, useSetLeadDocument: mut }));
vi.mock("@/modules/leads/hooks/useLeadPhones", () => ({ useLeadPhones: () => ({ data: [], isLoading: false }) }));
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadComments", () => ({
  useCreateLeadComment: mut,
  useDeleteLeadComment: mut,
  useUpdateLeadComment: mut,
}));
vi.mock("@/modules/leads/components/lead-card/LeadCard", () => ({
  LeadCard: () => <div data-testid="ficha-real">ficha</div>,
}));
vi.mock("@/modules/leads/components/lead-card/LeadCardAside", () => ({ LeadCardAside: () => null }));
vi.mock("@/modules/leads/components/lead-card/LeadCardControles", () => ({ LeadCardControles: () => null }));
vi.mock("@/modules/leads/components/lead-card/LeadCardEtiquetas", () => ({ LeadCardEtiquetas: () => null }));
vi.mock("@/modules/leads/components/lead-card/LeadContatos", () => ({ LeadContatos: () => null }));
vi.mock("@/modules/leads/components/lead-detail/modal/pipes/RegisterHistoricalSalesDialog", () => ({
  RegisterHistoricalSalesDialog: () => null,
}));

import { LeadCardContainer } from "@/modules/leads/components/lead-card/LeadCardContainer";

const LEAD = { id: "lead-1", nome: "Ana", edicao: null, telefone: null };

describe("ficha do lead — régua de espera", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    marcar.mockClear();
    estado = { data: null, isLoading: true, visibility: "loading" };
  });
  afterEach(() => vi.useRealTimers());

  it("osso com forma aos 100 ms, frase aos 1 s, sem 'Carregando…'", () => {
    render(<LeadCardContainer leadId="lead-1" isOpen />);
    expect(screen.queryByText(/Carregando…/)).toBeNull();
    const osso = screen.getByTestId("ficha-skeleton-lead");
    expect(osso.parentElement).toHaveClass("opacity-0");
    act(() => void vi.advanceTimersByTime(100));
    expect(osso.parentElement).toHaveClass("opacity-100");
    act(() => void vi.advanceTimersByTime(900));
    expect(screen.getByText("Abrindo a ficha…").closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByLabelText("Carregando ficha do lead")).toBeInTheDocument();
  });

  it("dado que chega com o osso visível espera os 300 ms mínimos; depois a ficha é útil", () => {
    const { rerender } = render(<LeadCardContainer leadId="lead-1" isOpen />);
    act(() => void vi.advanceTimersByTime(150));
    estado = { data: LEAD, isLoading: false, visibility: "exists" };
    rerender(<LeadCardContainer leadId="lead-1" isOpen />);
    expect(screen.getByTestId("ficha-skeleton-lead")).toBeInTheDocument();
    expect(marcar).toHaveBeenLastCalledWith("ficha_lead", false);
    act(() => void vi.advanceTimersByTime(250));
    expect(screen.getByTestId("ficha-real")).toBeInTheDocument();
    expect(marcar).toHaveBeenLastCalledWith("ficha_lead", true);
  });

  it("fechada não renderiza nem mede", () => {
    render(<LeadCardContainer leadId="lead-1" isOpen={false} />);
    expect(screen.queryByTestId("ficha-skeleton-lead")).toBeNull();
    expect(marcar).not.toHaveBeenCalled();
  });

  it("na moldura do negócio quem mede é o painel do negócio", () => {
    estado = { data: LEAD, isLoading: false, visibility: "exists" };
    render(<LeadCardContainer leadId="lead-1" isOpen modo="negocio" painelNegocios={<div />} />);
    expect(marcar).not.toHaveBeenCalled();
  });
});
