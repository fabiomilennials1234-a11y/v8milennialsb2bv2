import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TothOrderDraftPanel } from "./TothOrderDraftPanel";
import type { TothOrderDraftInput, TothOrderWorkspace } from "../lib/toth-order-domain";

const { rpc, session } = vi.hoisted(() => ({ rpc: vi.fn(), session: { organizationId: "org-1", teamMemberId: "admin-1", isReady: true } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => session }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
// The separate read-only status query is covered, including its integration
// with a dirty draft, by TothPreorderStatusPanel.test.tsx.
vi.mock("./TothPreorderStatusPanel", () => ({ TothPreorderStatusPanel: () => null }));

let server: TothOrderWorkspace;
let queryClient: QueryClient;
const date = "2026-09-17T12:00:00.000Z";
const preparers = [{ team_member_id: "member-1", name: "Vendedora", can_prepare: false }];

function workspace(): TothOrderWorkspace {
  return {
    enabled: true, can_prepare: true, can_review: true,
    draft: {
      id: "draft-1", deal_id: "deal-1", revision: 1, reviewed_revision: null,
      reviewed_at: null, reviewed_by: null, created_at: date, updated_at: date,
      items: [{ product_external_id: "CAFE-1", quantity: 2 }], notes: "Observação salva",
    },
    catalog: [{ product_external_id: "CAFE-1", description: "Café torrado" }],
    audit: [], blockers: ["supplier_contract_unverified"],
  };
}

function setupRpc() {
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "toth_order_workspace") return { data: structuredClone(server), error: null };
    if (name === "toth_order_preparer_access") return { data: structuredClone(preparers), error: null };
    if (name === "toth_set_order_preparer") {
      preparers[0].can_prepare = args.p_enabled as boolean;
      return { data: structuredClone(preparers), error: null };
    }
    if (name === "toth_save_order_draft") {
      if (args.p_expected_revision !== (server.draft?.revision ?? 0)) {
        return { data: null, error: { code: "40001", message: "toth_revision_conflict" } };
      }
      server.draft = {
        ...workspace().draft!, revision: (server.draft?.revision ?? 0) + 1,
        items: args.p_items as TothOrderDraftInput["items"], notes: args.p_notes as string,
      };
      return { data: structuredClone(server), error: null };
    }
    if (name === "toth_review_order_draft") {
      if (args.p_expected_revision !== server.draft?.revision) {
        return { data: null, error: { code: "40001", message: "toth_revision_conflict" } };
      }
      server.draft = { ...server.draft!, reviewed_revision: server.draft!.revision, reviewed_at: date, reviewed_by: "admin-1" };
      return { data: structuredClone(server), error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
}

function show(dealId = "deal-1") {
  return render(<QueryClientProvider client={queryClient}><TothOrderDraftPanel dealId={dealId} /></QueryClientProvider>);
}

async function notes() {
  return screen.findByRole("textbox", { name: "Observações do rascunho" });
}

function mutationCalls(name: string) {
  return rpc.mock.calls.filter(([rpcName]) => rpcName === name);
}

beforeEach(() => {
  server = workspace();
  session.organizationId = "org-1";
  session.teamMemberId = "admin-1";
  session.isReady = true;
  preparers[0].can_prepare = false;
  rpc.mockReset();
  setupRpc();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => { cleanup(); queryClient.clear(); });

describe("TothOrderDraftPanel — preparação local segura", () => {
  it("não exibe o painel nem busca permissões quando o servidor desabilita a preparação", async () => {
    server.enabled = false;
    const { container } = show();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(rpc).toHaveBeenCalledWith("toth_order_workspace", { p_deal_id: "deal-1" });
    expect(mutationCalls("toth_order_preparer_access")).toHaveLength(0);
  });

  it("exibe indisponibilidade em português quando a migration ainda não existe", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing RPC" } });
    show();
    expect(await screen.findByText("A preparação de pedidos ainda não está disponível neste ambiente.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("salva rascunho de observações sem catálogo com revisão zero e sem organization_id no payload", async () => {
    server.draft = null;
    server.catalog = [];
    show();
    fireEvent.change(await notes(), { target: { value: "Entregar pela manhã" } });
    expect(screen.getByText("Catálogo do ERP indisponível")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar produto" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Registrar revisão preparatória" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("toth_save_order_draft", {
      p_deal_id: "deal-1", p_expected_revision: 0, p_items: [], p_notes: "Entregar pela manhã",
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled());
    expect(server.draft).toMatchObject({ revision: 1 });
  });

  it("membro autorizado prepara mas não revisa nem gerencia permissões", async () => {
    server.can_review = false;
    show();
    fireEvent.change(await notes(), { target: { value: "Rascunho da equipe" } });
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Registrar revisão preparatória" })).not.toBeInTheDocument();
    expect(screen.queryByText("Quem pode preparar rascunhos")).not.toBeInTheDocument();
    expect(mutationCalls("toth_order_preparer_access")).toHaveLength(0);
  });

  it("usuário sem permissão consulta sem poder editar ou salvar", async () => {
    server.can_prepare = false;
    server.can_review = false;
    show();
    expect(await notes()).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Quantidade 1" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
  });

  it("bloqueia revisão de alterações não salvas e invalida revisão anterior ao salvar", async () => {
    server.draft = { ...server.draft!, reviewed_revision: 1, reviewed_at: date, reviewed_by: "admin-1" };
    show();
    fireEvent.change(await notes(), { target: { value: "Nova observação" } });
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar revisão preparatória" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar revisão preparatória" })).toBeEnabled());
    expect(server.draft?.reviewed_revision).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar revisão preparatória" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("toth_review_order_draft", { p_deal_id: "deal-1", p_expected_revision: 2 }));
    await waitFor(() => expect(screen.getByText("Revisão preparatória registrada")).toBeInTheDocument());
  });

  it("preserva alterações locais após conflito no servidor e exige recarga explícita", async () => {
    show();
    fireEvent.change(await notes(), { target: { value: "Meu trabalho local" } });
    server.draft = { ...server.draft!, revision: 2, notes: "Mudança de outra pessoa" };
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("O rascunho mudou")).toBeInTheDocument();
    expect(await notes()).toHaveValue("Meu trabalho local");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    expect(mutationCalls("toth_save_order_draft")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Descartar alterações locais e carregar versão atual" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Observações do rascunho" })).toHaveValue("Mudança de outra pessoa"));
    expect(screen.queryByText("O rascunho mudou")).not.toBeInTheDocument();
  });

  it("refetch em segundo plano não sobrescreve formulário sujo nem avança a versão-base", async () => {
    show();
    fireEvent.change(await notes(), { target: { value: "Ainda escrevendo" } });
    server.draft = { ...server.draft!, revision: 3, notes: "Versão remota" };
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ["toth-order-workspace", "org-1", "admin-1", "deal-1"] }); });
    expect(await notes()).toHaveValue("Ainda escrevendo");
    expect(screen.getByText("O rascunho mudou")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar revisão preparatória" })).toBeDisabled();
    expect(mutationCalls("toth_save_order_draft")).toHaveLength(0);
  });

  it("erro de refetch mantém o formulário e o trabalho local", async () => {
    show();
    fireEvent.change(await notes(), { target: { value: "Não perder esta anotação" } });
    rpc.mockResolvedValue({ data: null, error: { code: "500", message: "Database unavailable" } });
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ["toth-order-workspace", "org-1", "admin-1", "deal-1"] }); });
    expect(await notes()).toHaveValue("Não perder esta anotação");
    expect(screen.getByText(/Não foi possível concluir a ação\. Tente novamente\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("mantém envio desabilitado mesmo revisado e sem bloqueios retornados pelo servidor", async () => {
    server.blockers = [];
    server.draft = { ...server.draft!, reviewed_revision: 1, reviewed_at: date, reviewed_by: "admin-1" };
    show();
    await notes();
    const send = screen.getByRole("button", { name: "Enviar ao ERP" });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(rpc.mock.calls.every(([name]) => ["toth_order_workspace", "toth_order_preparer_access"].includes(name))).toBe(true);
    expect(screen.queryByRole("spinbutton", { name: /preço/i })).not.toBeInTheDocument();
  });

  it("recusa quantidade inválida antes de salvar e não oferece SKU livre", async () => {
    show();
    await notes();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantidade 1" }), { target: { value: "0" } });
    expect(screen.getByText("A quantidade deve ser maior que zero.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Produto 1" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Produto 1" })).not.toBeInTheDocument();
    expect(mutationCalls("toth_save_order_draft")).toHaveLength(0);
  });

  it("administrador concede preparação pela RPC restrita", async () => {
    show();
    await notes();
    fireEvent.click(screen.getByText("Quem pode preparar rascunhos"));
    const permission = await screen.findByRole("switch", { name: "Vendedora" });
    fireEvent.click(permission);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("toth_set_order_preparer", {
      p_deal_id: "deal-1", p_team_member_id: "member-1", p_enabled: true,
    }));
    await waitFor(() => expect(permission).toBeChecked());
  });

  it("isola cache e formulário ao mudar de organização", async () => {
    const view = show();
    fireEvent.change(await notes(), { target: { value: "Dados locais da organização um" } });
    session.organizationId = "org-2";
    server.draft = { ...server.draft!, notes: "Dados da organização dois" };
    view.rerender(<QueryClientProvider client={queryClient}><TothOrderDraftPanel dealId="deal-1" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Observações do rascunho" })).toHaveValue("Dados da organização dois"));
    expect(queryClient.getQueryData(["toth-order-workspace", "org-1", "admin-1", "deal-1"])).toBeDefined();
    expect(queryClient.getQueryData(["toth-order-workspace", "org-2", "admin-1", "deal-1"])).toBeDefined();
  });

  it("não reutiliza dados e permissões de outro usuário da mesma organização", async () => {
    const view = show();
    fireEvent.change(await notes(), { target: { value: "Rascunho local do administrador" } });
    expect(screen.getByRole("button", { name: "Registrar revisão preparatória" })).toBeInTheDocument();
    const oldImplementation = rpc.getMockImplementation()!;
    let resolveWorkspace!: (response: { data: TothOrderWorkspace; error: null }) => void;
    const pendingWorkspace = new Promise<{ data: TothOrderWorkspace; error: null }>((resolve) => { resolveWorkspace = resolve; });
    rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
      name === "toth_order_workspace" ? pendingWorkspace : oldImplementation(name, args));
    session.teamMemberId = "member-2";
    server.can_prepare = false;
    server.can_review = false;
    server.draft = { ...server.draft!, notes: "Versão consultável pelo membro" };
    view.rerender(<QueryClientProvider client={queryClient}><TothOrderDraftPanel dealId="deal-1" /></QueryClientProvider>);
    expect(screen.queryByRole("textbox", { name: "Observações do rascunho" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar revisão preparatória" })).not.toBeInTheDocument();
    await act(async () => { resolveWorkspace({ data: structuredClone(server), error: null }); });
    expect(await notes()).toHaveValue("Versão consultável pelo membro");
    expect(await notes()).toBeDisabled();
    expect(screen.queryByText("Quem pode preparar rascunhos")).not.toBeInTheDocument();
    expect(queryClient.getQueryData(["toth-order-workspace", "org-1", "admin-1", "deal-1"])).toBeDefined();
    expect(queryClient.getQueryData(["toth-order-workspace", "org-1", "member-2", "deal-1"])).toBeDefined();
  });

  it("resposta de save iniciado por outra conta não contamina o cache da conta atual", async () => {
    const view = show();
    fireEvent.change(await notes(), { target: { value: "Salvamento do administrador" } });
    const savedByAdmin = workspace();
    savedByAdmin.draft = { ...savedByAdmin.draft!, revision: 2, notes: "Salvamento do administrador" };
    const oldImplementation = rpc.getMockImplementation()!;
    let resolveSave!: (response: { data: TothOrderWorkspace; error: null }) => void;
    const pendingSave = new Promise<{ data: TothOrderWorkspace; error: null }>((resolve) => { resolveSave = resolve; });
    rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
      name === "toth_save_order_draft" ? pendingSave : oldImplementation(name, args));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(mutationCalls("toth_save_order_draft")).toHaveLength(1));
    session.teamMemberId = "member-2";
    server.can_prepare = false;
    server.can_review = false;
    server.draft = { ...server.draft!, notes: "Visão atual do membro" };
    view.rerender(<QueryClientProvider client={queryClient}><TothOrderDraftPanel dealId="deal-1" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Observações do rascunho" })).toHaveValue("Visão atual do membro"));
    await act(async () => { resolveSave({ data: savedByAdmin, error: null }); });
    await waitFor(() => expect(queryClient.getQueryData<TothOrderWorkspace>(["toth-order-workspace", "org-1", "admin-1", "deal-1"])?.draft?.revision).toBe(2));
    expect(queryClient.getQueryData<TothOrderWorkspace>(["toth-order-workspace", "org-1", "member-2", "deal-1"])?.can_review).toBe(false);
    expect(await notes()).toHaveValue("Visão atual do membro");
    expect(screen.queryByRole("button", { name: "Registrar revisão preparatória" })).not.toBeInTheDocument();
  });
});
