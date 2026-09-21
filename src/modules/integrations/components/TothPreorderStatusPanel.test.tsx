import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TothPreorderStatusPanel } from "./TothPreorderStatusPanel";
import { TothOrderDraftPanel } from "./TothOrderDraftPanel";
import { getTothPreorderStatus, parseTothPreorderWorkspace, type TothPreorderOperation, type TothPreorderWorkspace } from "../lib/toth-preorder-status";
import type { TothOrderWorkspace } from "../lib/toth-order-domain";

const { rpc, invoke, session } = vi.hoisted(() => ({
  rpc: vi.fn(), invoke: vi.fn(),
  session: { organizationId: "org-1", teamMemberId: "admin-1", isReady: true },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, functions: { invoke } } }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => session }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

let queryClient: QueryClient;
let server: TothPreorderWorkspace;
const date = "2026-09-21T12:00:00.000Z";

function operation(overrides: Partial<TothPreorderOperation> = {}): TothPreorderOperation {
  return {
    id: "operation-1", draft_revision: 2, delivery_state: "received", commercial_state: "pending",
    reconciliation_state: "not_due", external_id: "ERP-123", approved_total: null,
    updated_at: date, last_error_code: null, ...overrides,
  };
}

function show() {
  return render(<QueryClientProvider client={queryClient}><TothPreorderStatusPanel dealId="deal-1" /></QueryClientProvider>);
}

beforeEach(() => {
  session.organizationId = "org-1";
  session.teamMemberId = "admin-1";
  session.isReady = true;
  server = { can_send: false, blockers: [], operation: operation() };
  rpc.mockReset();
  invoke.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === "toth_preorder_workspace") return { data: structuredClone(server), error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); queryClient.clear(); focusManager.setFocused(undefined); });

describe("TothPreorderStatusPanel — recebimento e decisão comercial", () => {
  it("não inventa operação quando não existe pré-pedido", async () => {
    server.operation = null;
    const view = show();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("toth_preorder_workspace", { p_deal_id: "deal-1" }));
    expect(view.container).toBeEmptyDOMElement();
  });

  it.each(["PGRST202", "42883"])("oculta status em servidor antigo sem RPC (%s)", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "RPC missing" } });
    const view = show();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(view.container).toBeEmptyDOMElement();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("recebido e em análise não anuncia ganho nem aprovação", async () => {
    show();
    expect(await screen.findByText("Recebido no ERP")).toBeInTheDocument();
    expect(screen.getByText("Em análise")).toBeInTheDocument();
    expect(screen.queryByText(/ganho|venda confirmada|aprovado no erp/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar/i })).not.toBeInTheDocument();
  });

  it("aprovação com pendência local não anuncia atualização já concluída", async () => {
    server.operation = operation({ commercial_state: "approved", reconciliation_state: "pending", approved_total: 199.5 });
    show();
    expect(await screen.findByText("Aprovado no ERP")).toBeInTheDocument();
    expect(screen.getByText(/Atualização do CRM pendente/)).toBeInTheDocument();
    expect(screen.getByText("Total aprovado no ERP")).toBeInTheDocument();
    expect(screen.queryByText("A aprovação do ERP foi registrada no CRM.")).not.toBeInTheDocument();
    expect(screen.queryByText(/ganho/i)).not.toBeInTheDocument();
  });

  it("apresenta aprovação registrada somente com conciliação concluída", async () => {
    server.operation = operation({ commercial_state: "approved", reconciliation_state: "complete", approved_total: 200 });
    show();
    expect(await screen.findByText("A aprovação do ERP foi registrada no CRM.")).toBeInTheDocument();
    expect(screen.queryByText(/Atualização do CRM pendente/)).not.toBeInTheDocument();
  });

  it.each([
    { approved_total: null }, { approved_total: 0 }, { approved_total: 100.001 },
    { approved_total: 10000000000 }, { external_id: null }, { reconciliation_state: "unknown" },
  ])("não anuncia aprovação com evidência inconsistente: %j", async (change) => {
    rpc.mockResolvedValue({ data: { ...server, operation: {
      ...operation({ commercial_state: "approved", reconciliation_state: "pending", approved_total: 200 }), ...change,
    } }, error: null });
    show();
    expect(await screen.findByText("Não foi possível confirmar a situação atual do pré-pedido.")).toBeInTheDocument();
    expect(screen.queryByText("Aprovado no ERP")).not.toBeInTheDocument();
    expect(screen.queryByText("Total aprovado no ERP")).not.toBeInTheDocument();
  });

  it.each(["toth_approved_order_changed", "toth_observation_version_conflict", "external_identity_changed", "toth_unknown_commercial_status"])(
    "não apresenta aprovação anterior como atual após divergência (%s)", async (last_error_code) => {
      server.operation = operation({ commercial_state: "approved", reconciliation_state: "blocked", approved_total: 200, last_error_code });
      show();
      expect(await screen.findByText("Conferência necessária")).toBeInTheDocument();
      expect(screen.queryByText("Aprovado no ERP")).not.toBeInTheDocument();
      expect(screen.queryByText("Total aprovado no ERP")).not.toBeInTheDocument();
    },
  );

  it("mostra rejeição do ERP sem convertê-la em falha de transporte", async () => {
    server.operation = operation({ commercial_state: "rejected" });
    show();
    expect(await screen.findByText("Rejeitado no ERP")).toBeInTheDocument();
    expect(screen.queryByText("Falha no envio")).not.toBeInTheDocument();
    expect(screen.queryByText(/ganho/i)).not.toBeInTheDocument();
  });

  it("confirmação incerta prevalece sobre campos contraditórios de aprovação", async () => {
    server.operation = operation({ delivery_state: "awaiting_confirmation", commercial_state: "approved", reconciliation_state: "complete", approved_total: 200 });
    show();
    expect(await screen.findByText("Aguardando confirmação")).toBeInTheDocument();
    expect(screen.queryByText("Aprovado no ERP")).not.toBeInTheDocument();
    expect(screen.queryByText("Total aprovado no ERP")).not.toBeInTheDocument();
    expect(screen.queryByText(/ganho/i)).not.toBeInTheDocument();
  });

  it("estado desconhecido nunca é interpretado como aprovação", async () => {
    rpc.mockResolvedValue({ data: { ...server, operation: { ...operation(), commercial_state: "new_supplier_state" } }, error: null });
    show();
    expect(await screen.findByText("Decisão não confirmada")).toBeInTheDocument();
    expect(screen.queryByText("Aprovado no ERP")).not.toBeInTheDocument();
  });

  it("falha técnica não expõe código bruto ou informação sensível de erro", async () => {
    server.operation = operation({ delivery_state: "failed", last_error_code: "Authorization Bearer secret" });
    show();
    expect(await screen.findByText("Falha no envio")).toBeInTheDocument();
    expect(screen.queryByText(/Bearer secret/)).not.toBeInTheDocument();
  });

  it("negação de acesso no refetch remove dados anteriores da tela", async () => {
    server.operation = operation({ commercial_state: "approved", reconciliation_state: "complete", approved_total: 200 });
    show();
    expect(await screen.findByText("ERP-123")).toBeInTheDocument();
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "toth_access_denied" } });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar situação" }));
    expect(await screen.findByText("Você não tem acesso à situação deste pré-pedido.")).toBeInTheDocument();
    expect(screen.queryByText("ERP-123")).not.toBeInTheDocument();
    expect(screen.queryByText("Aprovado no ERP")).not.toBeInTheDocument();
    expect(screen.queryByText("Total aprovado no ERP")).not.toBeInTheDocument();
  });

  it("erro de consulta não apresenta último dado em cache como situação atual", async () => {
    show();
    await screen.findByText("ERP-123");
    rpc.mockRejectedValue(new Error("network error with internal details"));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar situação" }));
    expect(await screen.findByText("Não foi possível confirmar a situação atual do pré-pedido.")).toBeInTheDocument();
    expect(screen.queryByText("ERP-123")).not.toBeInTheDocument();
    expect(screen.queryByText(/internal details/)).not.toBeInTheDocument();
  });

  it("troca de usuário na mesma organização não reutiliza o status da outra conta", async () => {
    const view = show();
    await screen.findByText("ERP-123");
    let resolveQuery!: (value: { data: TothPreorderWorkspace; error: null }) => void;
    const pending = new Promise<{ data: TothPreorderWorkspace; error: null }>((resolve) => { resolveQuery = resolve; });
    rpc.mockReturnValue(pending);
    session.teamMemberId = "member-2";
    view.rerender(<QueryClientProvider client={queryClient}><TothPreorderStatusPanel dealId="deal-1" /></QueryClientProvider>);
    expect(screen.queryByText("ERP-123")).not.toBeInTheDocument();
    await act(async () => { resolveQuery({ data: { can_send: false, blockers: [], operation: null }, error: null }); });
    expect(view.container).toBeEmptyDOMElement();
    expect(queryClient.getQueryData(["toth-preorder-workspace", "org-1", "admin-1", "deal-1"])).toBeDefined();
    expect(queryClient.getQueryData(["toth-preorder-workspace", "org-1", "member-2", "deal-1"])).toBeDefined();
  });

  it("atualização manual só lê a RPC local, sem envio, ERP direto ou refresh ao focar", async () => {
    server.can_send = true;
    show();
    await screen.findByText("ERP-123");
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(rpc).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar situação" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls.every(([name, args]) => name === "toth_preorder_workspace" && Object.keys(args).join() === "p_deal_id")).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /enviar/i })).not.toBeInTheDocument();
  });

  it("refresh de status integrado preserva o formulário sujo e o bloqueio de envio", async () => {
    const draft: TothOrderWorkspace = {
      enabled: true, can_prepare: true, can_review: true, audit: [], blockers: [],
      catalog: [{ product_external_id: "CAFE-1", description: "Café" }],
      draft: { id: "draft-1", deal_id: "deal-1", revision: 2, reviewed_revision: 2, reviewed_by: "admin-1", reviewed_at: date,
        created_at: date, updated_at: date, items: [{ product_external_id: "CAFE-1", quantity: 2 }], notes: "Texto salvo" },
    };
    rpc.mockImplementation(async (name: string) => {
      if (name === "toth_preorder_workspace") return { data: structuredClone(server), error: null };
      if (name === "toth_order_workspace") return { data: structuredClone(draft), error: null };
      if (name === "toth_order_preparer_access") return { data: [], error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    render(<QueryClientProvider client={queryClient}><TothOrderDraftPanel dealId="deal-1" /></QueryClientProvider>);
    const notes = await screen.findByRole("textbox", { name: "Observações do rascunho" });
    fireEvent.change(notes, { target: { value: "Minha alteração não salva" } });
    await screen.findByText("Recebido no ERP");
    server.operation = operation({ commercial_state: "approved", reconciliation_state: "pending", approved_total: 200 });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar situação" }));
    await screen.findByText("Aprovado no ERP");
    expect(notes).toHaveValue("Minha alteração não salva");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar revisão preparatória" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar ao ERP" })).toBeDisabled();
    expect(rpc.mock.calls.every(([name]) => ["toth_preorder_workspace", "toth_order_workspace", "toth_order_preparer_access"].includes(name))).toBe(true);
  });
});

describe("toth-preorder-status — validação defensiva", () => {
  it.each(["queued", "sending", "failed", "blocked", "unknown"] as const)("%s não confirma aprovação mesmo com decisão contraditória", (delivery_state) => {
    expect(getTothPreorderStatus(operation({ delivery_state, commercial_state: "approved", reconciliation_state: "complete" })).approvalConfirmed).toBe(false);
  });
  it("recusa valor inválido antes de apresentar aprovação", () => {
    expect(parseTothPreorderWorkspace({ ...server, operation: operation({ commercial_state: "approved", approved_total: -1 }) })).toBeNull();
  });
  it("recusa operação incompleta em vez de fabricar estado", () => {
    expect(parseTothPreorderWorkspace({ can_send: false, blockers: [], operation: {} })).toBeNull();
  });
  it("preserva identificadores literais Unicode aceitos pelo SQL", () => {
    const external_id = "\u00a0" + "😀".repeat(126) + "\u00a0";
    expect(parseTothPreorderWorkspace({ ...server, operation: operation({ external_id }) })?.operation?.external_id).toBe(external_id);
    expect(parseTothPreorderWorkspace({ ...server, operation: operation({ external_id: "😀".repeat(129) }) })).toBeNull();
  });
  it("sinaliza aprovação com atualização local bloqueada", () => {
    const result = getTothPreorderStatus(operation({ commercial_state: "approved", reconciliation_state: "blocked", approved_total: 200 }));
    expect(result.label).toBe("Aprovado no ERP");
    expect(result.localNotice).toContain("Atualização do CRM bloqueada");
  });
});
