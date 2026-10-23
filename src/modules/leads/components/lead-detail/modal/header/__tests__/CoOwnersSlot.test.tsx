import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CoOwnersSlot } from "../CoOwnersSlot";

// ─── Mocks ──────────────────────────────────────────────────────────

type Dono = { id: string; name: string; avatarUrl: string | null; papeis: Array<"venda" | "pre_venda" | "co"> };

const state = vi.hoisted(() => ({
  owners: [] as Array<{ id: string; name: string; avatarUrl: string | null; papeis: Array<"venda" | "pre_venda" | "co"> }>,
  canReassign: true,
}));

const addSpy = vi.fn().mockResolvedValue(undefined);
const removeSpy = vi.fn().mockResolvedValue(undefined);
const logSpy = vi.fn();
const notifySpy = vi.hoisted(() => vi.fn());

vi.mock("@/modules/leads/hooks/useLeadOwners", () => ({
  useLeadOwners: () => ({ data: state.owners }),
}));
vi.mock("@/modules/leads/hooks/useLeadOwnersMutations", () => ({
  useAddLeadOwner: () => ({ mutateAsync: addSpy, isPending: false }),
  useRemoveLeadOwner: () => ({ mutateAsync: removeSpy, isPending: false }),
  recusaDeDonos: (e: { code?: string }) => (e?.code === "PT422" ? "Texto da recusa." : undefined),
}));
vi.mock("@/shared/errors", () => ({ notifyError: notifySpy }));

vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [
    { id: "tm-fernanda", name: "Fernanda Souza", avatar_url: null },
    { id: "tm-fran", name: "Fran Lima", avatar_url: null },
    { id: "tm-ana", name: "Ana Reis", avatar_url: null },
  ],
}));

vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => ({
    canReassign: { allowed: state.canReassign, isLoading: false },
  }),
}));

vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => logSpy }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const principal = (name: string, id: string, papel: "pre_venda" | "venda"): Dono => ({
  id,
  name,
  avatarUrl: null,
  papeis: [papel],
});
const coDono = (name: string, id: string): Dono => ({ id, name, avatarUrl: null, papeis: ["co"] });

function renderSlot() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CoOwnersSlot leadId="lead-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.owners = [];
  state.canReassign = true;
  addSpy.mockClear();
  removeSpy.mockClear();
  logSpy.mockClear();
  notifySpy.mockClear();
});

describe("CoOwnersSlot", () => {
  it("sem co-donos, o botão convida a adicionar", () => {
    renderSlot();
    expect(screen.getByRole("button", { name: /co-donos — adicionar/i })).toBeInTheDocument();
  });

  it("com co-donos, o botão nomeia todos", () => {
    state.owners = [principal("Fernanda Souza", "tm-fernanda", "venda"), coDono("Fran Lima", "tm-fran")];
    renderSlot();
    expect(screen.getByRole("button", { name: "Co-donos: Fran Lima" })).toBeInTheDocument();
  });

  it("sem permissão de reatribuir, o botão fica desabilitado", () => {
    state.canReassign = false;
    renderSlot();
    expect(screen.getByRole("button", { name: /co-donos/i })).toBeDisabled();
  });

  it("o popover mostra principais sem botão de remover e co-donos com ele", async () => {
    state.owners = [principal("Fernanda Souza", "tm-fernanda", "venda"), coDono("Fran Lima", "tm-fran")];
    renderSlot();
    fireEvent.click(screen.getByRole("button", { name: /co-donos/i }));

    expect(await screen.findByText("Donos do lead")).toBeInTheDocument();
    expect(screen.getByText("Venda")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover Fran Lima dos co-donos" })).toBeInTheDocument();
    // O principal não se remove aqui: troca pelo slot de Venda/Pré-Venda.
    expect(screen.queryByRole("button", { name: /remover fernanda/i })).not.toBeInTheDocument();
  });

  it("a mesma pessoa principal nos dois papéis aparece uma vez, com os dois rótulos", async () => {
    state.owners = [{ id: "tm-fernanda", name: "Fernanda Souza", avatarUrl: null, papeis: ["venda", "pre_venda"] }];
    renderSlot();
    fireEvent.click(screen.getByRole("button", { name: /co-donos/i }));

    expect(await screen.findByText("Venda · Pré-Venda")).toBeInTheDocument();
    expect(screen.getAllByText("Fernanda Souza")).toHaveLength(1);
  });

  it("quem já é dono (principal ou co) não aparece como candidato", async () => {
    state.owners = [principal("Fernanda Souza", "tm-fernanda", "venda"), coDono("Fran Lima", "tm-fran")];
    renderSlot();
    fireEvent.click(screen.getByRole("button", { name: /co-donos/i }));
    await screen.findByText("Adicionar co-dono");

    // Só a Ana sobra como botão de adicionar (Fernanda e Fran estão como donos).
    expect(screen.getByRole("button", { name: "Ana Reis" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fernanda Souza" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fran Lima" })).not.toBeInTheDocument();
  });

  it("clicar no candidato adiciona pela RPC e registra no histórico do lead", async () => {
    state.owners = [principal("Fernanda Souza", "tm-fernanda", "venda")];
    renderSlot();
    fireEvent.click(screen.getByRole("button", { name: /co-donos/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fran Lima" }));

    await waitFor(() => expect(addSpy).toHaveBeenCalledWith("tm-fran"));
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-1", description: 'Co-dono adicionado: "Fran Lima"' }),
    );
  });

  it("remover um co-dono chama a RPC com o membro certo", async () => {
    state.owners = [principal("Fernanda Souza", "tm-fernanda", "venda"), coDono("Fran Lima", "tm-fran")];
    renderSlot();
    fireEvent.click(screen.getByRole("button", { name: /co-donos/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Remover Fran Lima dos co-donos" }));

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("tm-fran"));
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Co-dono removido: "Fran Lima"' }),
    );
  });

  it("recusa do banco vai para notifyError com o texto da recusa e não registra no histórico", async () => {
    addSpy.mockRejectedValueOnce({ code: "PT422", message: "raw" });
    renderSlot();
    fireEvent.click(screen.getByRole("button", { name: /co-donos/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Ana Reis" }));

    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PT422" }),
        expect.objectContaining({ message: "Texto da recusa." }),
      ),
    );
    expect(logSpy).not.toHaveBeenCalled();
  });
});
