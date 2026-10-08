/**
 * CPF/CNPJ editável na ficha do lead (Chamado 93027ffb, decisão do CTO 07/10).
 *
 * Antes: a linha "CPF / CNPJ" era `somenteLeitura` para todas as orgs e não
 * tinha onde gravar — `documento` não é coluna de `leads`, e o valor do Toth
 * é reescrito pelo sync a cada volta. Agora:
 *   · quem tem `leads.edit_document` edita; quem não tem vê a linha travada;
 *   · grava pela RPC `set_lead_document` (override em `lead_documents`), e
 *     NUNCA por `updateLead`;
 *   · recusa do banco (DV, documento em uso) vira mensagem humana e o texto
 *     digitado fica na linha;
 *   · override aparece com o selo "alterado no Torque" e o valor do ERP ao lado.
 *
 * Documentos: sintéticos, gerados aqui. Nenhum CPF/CNPJ real no repositório.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { LEAD_EXEMPLO } from "@/modules/leads/components/lead-card/fixtures";
import type { LeadCardData, LeadCardField } from "@/modules/leads/components/lead-card/types";
import { formatBrDocument } from "@/modules/leads/lib/document";

function cnpj(base12: string): string {
  const digito = (b: string) => {
    let soma = 0;
    for (let i = 0; i < b.length; i++) soma += Number(b[b.length - 1 - i]) * ((i % 8) + 2);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const b13 = base12 + digito(base12);
  return b13 + digito(b13);
}
const DOC = cnpj("112223330001");
const DOC_ERP = cnpj("445556660001");
const DOC_DV_ERRADO = DOC.slice(0, -1) + String((Number(DOC.at(-1)) + 1) % 10);

// ── Banco ───────────────────────────────────────────────────────────────────
const rpc = vi.fn();
const overrideNoBanco: { value: Record<string, unknown> | null } = { value: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            tabela === "lead_documents" ? { data: overrideNoBanco.value, error: null } : { data: null, error: null },
        }),
      }),
    }),
  },
}));

// ── O hook de dados: real nos testes do hook, dublado nos do container ─────
const modo: { real: boolean; data: LeadCardData | null } = { real: false, data: null };
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/leads/components/lead-card/useLeadCardData")>();
  return {
    ...actual,
    useLeadCardData: (leadId: string | null, isOpen: boolean) =>
      modo.real
        ? actual.useLeadCardData(leadId, isOpen)
        : { data: modo.data, isLoading: false, visibility: "exists", organizacaoId: "org-1", membroId: "m-1", souAdmin: false },
  };
});

// Fontes do hook real.
const leadRef: { value: Record<string, unknown> | null } = { value: null };
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadDetail", () => ({
  useLeadDetail: () => ({ lead: leadRef.value, isLoading: false, visibility: "exists" }),
}));
vi.mock("@/modules/leads/hooks/useLeadTimeline", () => ({
  useLeadTimeline: () => ({ data: { events: [], metrics: { lastContact: null } } }),
}));
const permissao = { allowed: false };
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "m-1", role: "member" }),
  useTeamMembers: () => ({ data: [] }),
  useFeaturePermission: (chave: string) => ({
    allowed: chave === "leads.edit_document" && permissao.allowed,
    isLoading: false,
    hasError: false,
  }),
}));
const cadastroErp: { value: Record<string, unknown> | undefined } = { value: undefined };
vi.mock("@/modules/leads/hooks/useCafeJurereCadastro", () => ({
  useCafeJurereCadastro: () => ({ data: cadastroErp.value, isFetching: false, isError: false }),
}));
vi.mock("@/modules/leads/hooks/useLeadsDeals", () => ({ useLeadsDeals: () => ({ data: {} }) }));
vi.mock("@/modules/leads/hooks/useOrgUsaLeiDoErp", () => ({
  useOrgUsaLeiDoErp: () => ({ usaLeiDoErp: false, isLoading: false }),
}));
vi.mock("@/modules/leads/components/lead-card/useProdutosPorNegocio", () => ({
  useProdutosPorNegocio: () => ({ data: {} }),
}));
vi.mock("@/modules/leads/hooks/useLeadsSalesMetrics", () => ({ useLeadsSalesMetrics: () => ({ data: {} }) }));
vi.mock("@/modules/leads/hooks/useLeadsCarteiraMetrics", () => ({ useLeadsCarteiraMetrics: () => ({ data: {} }) }));

// Mutações e satélites do container.
const updateLeadAsync = vi.fn().mockResolvedValue({});
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: updateLeadAsync, mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useLeadCustomFields: () => ({ data: [] }),
  useLeadCustomFieldValues: () => ({ data: [] }),
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadComments", () => ({
  useLeadComments: () => ({ data: [] }),
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
const notifyError = vi.fn();
vi.mock("@/shared/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/errors")>()),
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

import { useLeadCardData } from "@/modules/leads/components/lead-card/useLeadCardData";
import { LeadCardContainer } from "@/modules/leads/components/lead-card/LeadCardContainer";
import { mensagemDoErroDeDocumento } from "@/modules/leads/hooks/useLeadDocument";

function comCliente() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function campoDocumento(over: Partial<LeadCardField> = {}): LeadCardField {
  return { chave: "documento", rotulo: "CPF / CNPJ", valor: null, tipo: "documento", vazio: "Informe o documento", ...over };
}

function fichaCom(documento: LeadCardField): LeadCardData {
  return {
    ...LEAD_EXEMPLO,
    id: "lead-1",
    campos: [{ titulo: "Perfil", campos: [{ chave: "name", rotulo: "Nome", valor: "Pessoa", tipo: "texto" }, documento] }],
  };
}

function abrir(documento: LeadCardField) {
  modo.real = false;
  modo.data = fichaCom(documento);
  return render(<LeadCardContainer leadId="lead-1" isOpen />, { wrapper: comCliente() });
}

/** Clica no valor, digita e confirma — o mesmo gesto da ficha. */
function editarDocumento(atual: string, novo: string) {
  fireEvent.click(screen.getByText(atual));
  const input = screen.getByDisplayValue(atual === "Informe o documento" ? "" : atual.replace(/\D/g, ""));
  fireEvent.change(input, { target: { value: novo } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  rpc.mockReset();
  updateLeadAsync.mockClear();
  notifyError.mockReset();
  permissao.allowed = false;
  overrideNoBanco.value = null;
  cadastroErp.value = undefined;
  leadRef.value = { id: "lead-1", name: "Pessoa", organization_id: "org-1" };
});

// ── O hook: a trava é a permissão; o valor é o override ─────────────────────
describe("useLeadCardData — CPF/CNPJ", () => {
  const documentoDe = (data: LeadCardData | null) =>
    data?.campos.flatMap((g) => g.campos).find((c) => c.chave === "documento");

  it("sem leads.edit_document a linha fica travada", async () => {
    modo.real = true;
    const { result } = renderHook(() => useLeadCardData("lead-1", true), { wrapper: comCliente() });
    await waitFor(() => expect(documentoDe(result.current.data)).toBeDefined());
    expect(documentoDe(result.current.data)).toMatchObject({ somenteLeitura: true, valor: null });
  });

  it("com leads.edit_document a linha edita, em qualquer org (não só Café Jurerê)", async () => {
    modo.real = true;
    permissao.allowed = true;
    const { result } = renderHook(() => useLeadCardData("lead-1", true), { wrapper: comCliente() });
    await waitFor(() => expect(documentoDe(result.current.data)).toBeDefined());
    expect(documentoDe(result.current.data)?.somenteLeitura).toBe(false);
  });

  it("o override de lead_documents vira o valor, marcado como alterado no Torque", async () => {
    modo.real = true;
    permissao.allowed = true;
    overrideNoBanco.value = { document: DOC, erp_document_at_set: null, erp_writeback_status: "nao_aplicavel", updated_at: "2026-10-08T12:00:00Z" };
    const { result } = renderHook(() => useLeadCardData("lead-1", true), { wrapper: comCliente() });
    await waitFor(() => expect(documentoDe(result.current.data)?.valor).toBe(DOC));
    expect(documentoDe(result.current.data)).toMatchObject({ alteradoLocalmente: true, somenteLeitura: false });
  });

  it("na Café Jurerê o override vence o ERP e a trava continua sendo só a permissão", async () => {
    modo.real = true;
    permissao.allowed = true;
    overrideNoBanco.value = { document: DOC, erp_document_at_set: DOC_ERP, erp_writeback_status: "pendente", updated_at: "2026-10-08T12:00:00Z" };
    cadastroErp.value = { cnpj: DOC_ERP, erp_metadata: {} };
    const { result } = renderHook(() => useLeadCardData("lead-1", true), { wrapper: comCliente() });
    await waitFor(() => expect(documentoDe(result.current.data)?.valor).toBe(DOC));
    expect(documentoDe(result.current.data)).toMatchObject({ alteradoLocalmente: true, valorErp: DOC_ERP, origemErp: false, somenteLeitura: false });
  });
});

// ── O container: para onde o documento grava ────────────────────────────────
describe("LeadCardContainer — CPF/CNPJ grava pela RPC", () => {
  it("documento válido vai para set_lead_document, nunca para updateLead", async () => {
    rpc.mockResolvedValue({ data: { document: DOC, erp_document: null, overridden: true, erp_writeback_status: "nao_aplicavel" }, error: null });
    abrir(campoDocumento());
    editarDocumento("Informe o documento", formatBrDocument(DOC)!);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("set_lead_document", { p_lead_id: "lead-1", p_document: formatBrDocument(DOC) });
    expect(updateLeadAsync).not.toHaveBeenCalled();
  });

  it("apagar o texto é clear: a RPC recebe vazio (volta a valer o ERP)", async () => {
    rpc.mockResolvedValue({ data: { document: null, erp_document: null, overridden: false, erp_writeback_status: null }, error: null });
    abrir(campoDocumento({ valor: DOC, alteradoLocalmente: true }));
    editarDocumento(formatBrDocument(DOC)!, "");
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_lead_document", { p_lead_id: "lead-1", p_document: "" }));
    expect(updateLeadAsync).not.toHaveBeenCalled();
  });

  it("DV errado é recusado antes de ir ao banco, com mensagem humana e o texto na linha", async () => {
    abrir(campoDocumento());
    editarDocumento("Informe o documento", DOC_DV_ERRADO);
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect((notifyError.mock.calls[0][0] as Error).message).toBe("CPF/CNPJ inválido");
    expect(rpc).not.toHaveBeenCalled();
    expect(updateLeadAsync).not.toHaveBeenCalled();
    // O texto digitado continua na linha, marcado como erro, para corrigir o dígito.
    expect(screen.getByText(DOC_DV_ERRADO).closest("button")).toHaveClass("text-destructive");
  });

  it("documento em uso (PT409) vira a frase da ficha, sem revelar o outro lead", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "Este documento já está em outro cliente da organização.", details: "documento_em_uso" } });
    abrir(campoDocumento());
    editarDocumento("Informe o documento", DOC);
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect((notifyError.mock.calls[0][0] as Error).message).toBe("Este documento já está em outro cliente da organização");
    expect(screen.getByText(DOC).closest("button")).toHaveClass("text-destructive");
  });

  it("sem permissão a linha não abre edição e diz por quê", () => {
    abrir(campoDocumento({ somenteLeitura: true, valor: DOC }));
    const botao = screen.getByText(formatBrDocument(DOC)!).closest("button")!;
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", "Sem permissão para alterar o documento");
    fireEvent.click(botao);
    expect(screen.queryByDisplayValue(DOC)).toBeNull();
  });

  it("override aparece formatado, com o selo e o valor do ERP no hover", () => {
    abrir(campoDocumento({ valor: DOC, alteradoLocalmente: true, valorErp: DOC_ERP }));
    expect(screen.getByText(formatBrDocument(DOC)!)).toBeInTheDocument();
    expect(screen.getByText("alterado no Torque")).toHaveAttribute("title", `No ERP: ${formatBrDocument(DOC_ERP)}`);
  });

  it("override sem documento no ERP diz isso no hover", () => {
    abrir(campoDocumento({ valor: DOC, alteradoLocalmente: true, valorErp: null }));
    expect(screen.getByText("alterado no Torque")).toHaveAttribute("title", "Sem documento no ERP");
  });
});

describe("mensagemDoErroDeDocumento", () => {
  it("mapeia cada recusa da RPC para a frase da ficha", () => {
    expect(mensagemDoErroDeDocumento({ code: "PT422", message: "x" })).toBe("CPF/CNPJ inválido");
    expect(mensagemDoErroDeDocumento({ code: "PT409", message: "x" })).toBe("Este documento já está em outro cliente da organização");
    expect(mensagemDoErroDeDocumento({ code: "42501", message: "Sem permissão para alterar o documento." })).toBe("Sem permissão para alterar o documento");
    expect(mensagemDoErroDeDocumento({ code: "XX000", message: "boom" })).toBe("Não foi possível salvar o documento");
  });
});
