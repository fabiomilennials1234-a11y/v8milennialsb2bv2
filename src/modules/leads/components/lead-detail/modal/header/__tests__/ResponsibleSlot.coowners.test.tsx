import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResponsibleSlot } from "../ResponsibleSlot";

/**
 * Chamado 793f4b05 — com a flag de N donos, trocar o responsável é
 * TRANSFERÊNCIA (RPC), que mantém o anterior como co-dono por padrão. Sem a
 * flag, e para esvaziar o slot, segue o UPDATE de sempre.
 */

const flag = vi.hoisted(() => ({ enabled: true }));
const updateSpy = vi.fn().mockResolvedValue({});
const transferSpy = vi.fn().mockResolvedValue(undefined);
const addSpy = vi.fn().mockResolvedValue(undefined);
const removeSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/leads/hooks/useLeadOwners", () => ({
  useLeadOwnersEnabled: () => flag.enabled,
}));
vi.mock("@/modules/leads/hooks/useLeadOwnersMutations", () => ({
  useTransferLeadOwner: () => ({ mutateAsync: transferSpy, isPending: false }),
  useAddLeadOwner: () => ({ mutateAsync: addSpy, isPending: false }),
  useRemoveLeadOwner: () => ({ mutateAsync: removeSpy, isPending: false }),
  recusaDeDonos: (e: { code?: string }) => (e?.code === "PT409" ? "Texto da recusa." : undefined),
}));
const notifySpy = vi.hoisted(() => vi.fn());
vi.mock("@/shared/errors", () => ({ notifyError: notifySpy }));
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: updateSpy, isPending: false }),
}));
vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [
    { id: "tm-varejo", name: "Varejo Silva", avatar_url: null },
    { id: "tm-envase", name: "Envase Costa", avatar_url: null },
  ],
}));
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => ({ canReassign: { allowed: true, isLoading: false } }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/shared/hooks/useOptimisticConflictHandler", () => ({
  useOptimisticConflictHandler: () => () => false,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const VAREJO = { id: "tm-varejo", name: "Varejo Silva" };

function abrir(props: Partial<Parameters<typeof ResponsibleSlot>[0]> = {}) {
  render(
    <ResponsibleSlot
      leadId="lead-1"
      field="sale_responsible_id"
      label="Venda"
      currentMember={VAREJO}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /venda/i }));
}

beforeEach(() => {
  flag.enabled = true;
  updateSpy.mockClear();
  transferSpy.mockClear();
  addSpy.mockClear();
  removeSpy.mockClear();
  notifySpy.mockClear();
});

describe("ResponsibleSlot — N donos por lead", () => {
  it("com a flag, escolher outra pessoa transfere e mantém a anterior como co-dona", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /envase costa/i }));

    await waitFor(() =>
      expect(transferSpy).toHaveBeenCalledWith({ toMemberId: "tm-envase", role: "venda", keepPrevious: true }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("desmarcar 'Manter como co-dono' transfere sem manter", async () => {
    abrir();
    fireEvent.click(await screen.findByLabelText(/manter varejo silva como co-dono/i));
    fireEvent.click(screen.getByRole("button", { name: /envase costa/i }));

    await waitFor(() =>
      expect(transferSpy).toHaveBeenCalledWith({ toMemberId: "tm-envase", role: "venda", keepPrevious: false }),
    );
  });

  it("o papel da transferência segue o slot: pré-venda manda pre_venda", async () => {
    abrir({ field: "pre_sale_responsible_id", label: "Pré-Venda" });
    fireEvent.click(await screen.findByRole("button", { name: /envase costa/i }));

    await waitFor(() =>
      expect(transferSpy).toHaveBeenCalledWith(expect.objectContaining({ role: "pre_venda" })),
    );
  });

  it("slot vazio: transfere sem manter ninguém e sem mostrar a opção", async () => {
    abrir({ currentMember: null });
    expect(screen.queryByLabelText(/como co-dono/i)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /envase costa/i }));

    await waitFor(() =>
      expect(transferSpy).toHaveBeenCalledWith({ toMemberId: "tm-envase", role: "venda", keepPrevious: false }),
    );
  });

  it("esvaziar o slot continua sendo UPDATE (a RPC não aceita destino nulo)", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /remover varejo silva/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "lead-1", sale_responsible_id: null })),
    );
    expect(transferSpy).not.toHaveBeenCalled();
  });

  describe("esvaziar o slot respeita o checkbox, qualquer que seja a origem do principal", () => {
    it("manter marcado: garante a linha de co-dono de quem saiu", async () => {
      abrir();
      fireEvent.click(await screen.findByRole("button", { name: /remover varejo silva/i }));

      await waitFor(() => expect(addSpy).toHaveBeenCalledWith("tm-varejo"));
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it("manter desmarcado: apaga a linha de co-dono de quem saiu", async () => {
      abrir();
      fireEvent.click(await screen.findByLabelText(/manter varejo silva como co-dono/i));
      fireEvent.click(screen.getByRole("button", { name: /remover varejo silva/i }));

      await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("tm-varejo"));
      expect(addSpy).not.toHaveBeenCalled();
    });

    it("PT409 (ainda é principal no outro papel) não é erro para o usuário", async () => {
      removeSpy.mockRejectedValueOnce({ code: "PT409", message: "raw" });
      abrir();
      fireEvent.click(await screen.findByLabelText(/manter varejo silva como co-dono/i));
      fireEvent.click(screen.getByRole("button", { name: /remover varejo silva/i }));

      await waitFor(() => expect(removeSpy).toHaveBeenCalled());
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it("outro erro no ajuste é notificado, mas o slot já foi esvaziado", async () => {
      addSpy.mockRejectedValueOnce({ code: "XX000", message: "boom" });
      abrir();
      fireEvent.click(await screen.findByRole("button", { name: /remover varejo silva/i }));

      await waitFor(() =>
        expect(notifySpy).toHaveBeenCalledWith(
          expect.objectContaining({ code: "XX000" }),
          expect.objectContaining({ fallback: "O responsável saiu, mas não foi possível ajustar o co-dono." }),
        ),
      );
      expect(updateSpy).toHaveBeenCalled();
    });
  });

  it("recusa do banco vai para notifyError com o texto da recusa, e a seleção não vira sucesso", async () => {
    transferSpy.mockRejectedValueOnce({ code: "PT409", message: "raw" });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /envase costa/i }));

    await waitFor(() =>
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PT409" }),
        expect.objectContaining({ message: "Texto da recusa." }),
      ),
    );
  });

  it("sem a flag, é o UPDATE de sempre e a opção não existe", async () => {
    flag.enabled = false;
    abrir();
    expect(screen.queryByLabelText(/como co-dono/i)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /envase costa/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ sale_responsible_id: "tm-envase" })),
    );
    expect(transferSpy).not.toHaveBeenCalled();
  });
});
