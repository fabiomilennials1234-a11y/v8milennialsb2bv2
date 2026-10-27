/**
 * Chamado b7941f5e — "Abrir conversa" de lead com 2+ contatos caía no principal.
 *
 * Sem telefone definido pelo negócio, o botão navegava com `?lead=<id>` e o
 * chat traduzia o lead para `leads.phone`, o principal. A regra do CTO
 * (`telefoneDoNegocio.ts`, 07/10) é perguntar, nunca chutar o principal — mas a
 * pergunta só existia no negócio COM deal. Card de funil sem negócio e a ficha
 * da lista abriam o principal calados.
 *
 * Os casos fixam a URL que chega em `window.location.assign`, não o desenho.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LEAD_EXEMPLO } from "@/modules/leads/components/lead-card/fixtures";
import type { LeadCardData } from "@/modules/leads/components/lead-card/types";
import type { LeadPhone } from "@/modules/leads/lib/lead-phones";

// ── Mocks do container (mesmo conjunto de `lead-card-cabecalho.test.tsx`) ────
const cardDataRef: { value: LeadCardData | null } = { value: null };
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: () => ({ data: cardDataRef.value, isLoading: false, visibility: "exists" }),
}));
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/hooks/useLeadDocument", () => ({
  useLeadDocument: () => ({ data: null }),
  useLeadDocuments: () => ({ data: [] }),
  useSalvarLeadDocuments: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useSetLeadDocument: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadComments", () => ({
  useCreateLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useUpdateLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useDeleteLeadComment: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/hooks/lead/useLeadTagsAttached", () => ({
  useLeadTagsAttached: () => ({ data: [], isLoading: false }),
  useAddLeadTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useRemoveLeadTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({
  useTags: () => ({ data: [], isLoading: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
// `modo="negocio"` abre na aba Negócios, que monta o diálogo de venda histórica
// (lê `useOrganization` → `AuthContext`). Este arquivo não sobe provider.
vi.mock("@/modules/leads/components/lead-detail/modal/pipes/RegisterHistoricalSalesDialog", () => ({
  RegisterHistoricalSalesDialog: () => null,
}));

// Os contatos do lead — a variável deste arquivo.
const phonesRef: { data: LeadPhone[]; isLoading: boolean } = { data: [], isLoading: false };
// Número compartilhado (PR4): sem marca, o bloco não aparece.
vi.mock("@/modules/leads/hooks/useLeadPhoneCompartilhado", () => ({
  useLeadPhoneCompartilhado: () => ({ data: false }),
  useDescompartilharNumero: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/leads/hooks/useLeadPhones", () => ({
  useLeadPhones: () => ({ data: phonesRef.data, isLoading: phonesRef.isLoading }),
  useSalvarTelefonesDoLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useNomearContatoDoTelefone: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDefinirTelefoneDoNegocio: () => ({ mutateAsync: vi.fn(), isPending: false }),
  buscarLeadIdsPorTelefoneSecundario: vi.fn(async () => []),
  leadPhonesKey: (id: string | null) => ["lead-phones", id],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { LeadCardContainer } from "@/modules/leads/components/lead-card/LeadCardContainer";

const PRINCIPAL = telefone({ id: "t1", phone: "48999990001", label: "Adriel - Dono", isPrimary: true });
const COMPRAS = telefone({ id: "t2", phone: "48999990002", label: "José Luiz - Compras" });

const assign = vi.fn();
beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal("location", { assign });
  cardDataRef.value = { ...LEAD_EXEMPLO, id: "l1", telefone: PRINCIPAL.phone };
  phonesRef.data = [PRINCIPAL, COMPRAS];
  phonesRef.isLoading = false;
});
afterEach(() => vi.unstubAllGlobals());

const botao = () => screen.getByRole("button", { name: "Abrir conversa" });

describe("Abrir conversa — lead com 2+ contatos, sem telefone do negócio", () => {
  it("pergunta com qual contato antes de navegar", () => {
    render(<LeadCardContainer leadId="l1" isOpen />);
    fireEvent.click(botao());

    expect(screen.getByText("Abrir conversa com qual contato?")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("navega para a conversa do contato escolhido, nunca do principal", () => {
    render(<LeadCardContainer leadId="l1" isOpen />);
    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("button", { name: /José Luiz - Compras/ }));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/chat-whatsapp?phone=48999990002&lead=l1");
  });

  it("vale também no card de funil sem negócio (modo negocio, sem telefone do negócio)", () => {
    render(<LeadCardContainer leadId="l1" isOpen modo="negocio" telefoneDaConversa={null} />);
    fireEvent.click(botao());
    fireEvent.click(screen.getByRole("button", { name: /Adriel - Dono/ }));

    expect(assign).toHaveBeenCalledWith("/chat-whatsapp?phone=48999990001&lead=l1");
  });

  it("enquanto os contatos carregam, o botão espera — não chuta o principal", () => {
    phonesRef.data = [];
    phonesRef.isLoading = true;
    render(<LeadCardContainer leadId="l1" isOpen />);

    expect(botao()).toBeDisabled();
  });
});

describe("Abrir conversa — o que já funcionava segue igual", () => {
  it("um contato só: abre direto, sem perguntar", () => {
    phonesRef.data = [PRINCIPAL];
    render(<LeadCardContainer leadId="l1" isOpen />);
    fireEvent.click(botao());

    expect(screen.queryByText("Abrir conversa com qual contato?")).not.toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith("/chat-whatsapp?lead=l1");
  });

  it("negócio com contato escolhido: abre a conversa desse contato, sem perguntar", () => {
    render(<LeadCardContainer leadId="l1" isOpen modo="negocio" telefoneDaConversa={COMPRAS.phone} />);
    fireEvent.click(botao());

    expect(screen.queryByText("Abrir conversa com qual contato?")).not.toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith("/chat-whatsapp?phone=48999990002&lead=l1");
  });

  it("negócio que ainda precisa escolher: o botão fica desabilitado e a faixa pergunta", () => {
    render(<LeadCardContainer leadId="l1" isOpen modo="negocio" telefoneDaConversa={null} conversaPrecisaEscolher />);

    expect(botao()).toBeDisabled();
  });
});

function telefone(over: Partial<LeadPhone> & Pick<LeadPhone, "id" | "phone">): LeadPhone {
  return {
    normalizedPhone: over.phone,
    label: null,
    labelLocked: false,
    isPrimary: false,
    isWhatsApp: null,
    source: "erp",
    ...over,
  };
}
