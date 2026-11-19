/**
 * Responsável otimista na ficha (régua de espera, CX ①): o avatar troca no
 * clique, antes da gravação; conflito do optimistic lock (#307) e falha
 * devolvem o avatar ao que era. `useLeads.ts` segue intocado (otimismo local).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let resolverUpdate: (() => void) | null = null;
let rejeitarUpdate: ((e: unknown) => void) | null = null;
const updateAsync = vi.fn(
  () =>
    new Promise<void>((res, rej) => {
      resolverUpdate = res;
      rejeitarUpdate = rej;
    }),
);
const notifyError = vi.fn();
const handleConflict = vi.fn(() => true);
const logAction = vi.fn();

vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [
    { id: "tm-ana", name: "Ana Souza" },
    { id: "tm-bia", name: "Bia Lima" },
  ],
}));
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: updateAsync }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => logAction }));
vi.mock("@/shared/hooks/useOptimisticConflictHandler", () => ({
  useOptimisticConflictHandler: () => handleConflict,
}));
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => ({ canReassign: { allowed: true } }),
}));
vi.mock("@/modules/leads/hooks/useLeadOwners", () => ({ useLeadOwnersEnabled: () => false }));
vi.mock("@/modules/leads/hooks/useLeadOwnersMutations", () => ({
  recusaDeDonos: () => undefined,
  useAddLeadOwner: () => ({ mutateAsync: vi.fn() }),
  useRemoveLeadOwner: () => ({ mutateAsync: vi.fn() }),
  useTransferLeadOwner: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/shared/errors", () => ({ notifyError: (...a: unknown[]) => notifyError(...a) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

import { ResponsibleSlot } from "@/modules/leads/components/lead-detail/modal/header/ResponsibleSlot";
import { OptimisticLockConflictError } from "@/modules/platform/lib/optimistic-lock";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ResponsibleSlot
        leadId="lead-1"
        field="sale_responsible_id"
        label="Venda"
        currentMember={{ id: "tm-ana", name: "Ana Souza" }}
        expectedUpdatedAt="2026-11-19T10:00:00Z"
      />
    </QueryClientProvider>,
  );
}

async function escolherBia() {
  fireEvent.click(screen.getByRole("button", { name: "Venda: Ana Souza" }));
  fireEvent.click(await screen.findByRole("button", { name: /Bia Lima/ }));
}

describe("ResponsibleSlot — troca otimista", () => {
  beforeEach(() => {
    updateAsync.mockClear();
    notifyError.mockClear();
    handleConflict.mockClear();
    logAction.mockClear();
  });

  it("o avatar troca no clique, antes de a gravação responder", async () => {
    montar();
    await escolherBia();
    await waitFor(() => expect(updateAsync).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Venda: Bia Lima" })).toBeInTheDocument();
    expect(updateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "lead-1", sale_responsible_id: "tm-bia", expectedUpdatedAt: "2026-11-19T10:00:00Z" }),
    );
    await act(async () => resolverUpdate!());
    await waitFor(() => expect(logAction).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Venda: Bia Lima" })).toBeInTheDocument();
  });

  it("conflito do optimistic lock (#307): avisa pelo handler e devolve o avatar", async () => {
    montar();
    await escolherBia();
    await waitFor(() => expect(updateAsync).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Venda: Bia Lima" })).toBeInTheDocument();
    await act(async () => rejeitarUpdate!(new OptimisticLockConflictError()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Venda: Ana Souza" })).toBeInTheDocument());
    expect(handleConflict).toHaveBeenCalledWith(expect.any(OptimisticLockConflictError), { leadId: "lead-1" });
    // Um aviso só: o do handler de conflito, sem toast de erro genérico por cima.
    expect(notifyError).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it("falha comum: devolve o avatar e avisa", async () => {
    montar();
    await escolherBia();
    await waitFor(() => expect(updateAsync).toHaveBeenCalled());
    await act(async () => rejeitarUpdate!(new Error("rls")));
    await waitFor(() => expect(screen.getByRole("button", { name: "Venda: Ana Souza" })).toBeInTheDocument());
    expect(notifyError).toHaveBeenCalledWith(expect.any(Error), { fallback: "Falha ao atualizar responsável." });
  });

  describe("uma troca por vez (N3: sem conflito falso na 2ª troca rápida)", () => {
    function montarControlado() {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const arvore = (membro: { id: string; name: string } | null, updatedAt: string) => (
        <QueryClientProvider client={qc}>
          <ResponsibleSlot
            leadId="lead-1"
            field="sale_responsible_id"
            label="Venda"
            currentMember={membro}
            expectedUpdatedAt={updatedAt}
          />
        </QueryClientProvider>
      );
      const r = render(arvore({ id: "tm-ana", name: "Ana Souza" }, "2026-11-19T10:00:00Z"));
      return { ecoar: (membro: { id: string; name: string } | null, updatedAt: string) => r.rerender(arvore(membro, updatedAt)) };
    }

    it("enquanto a 1ª grava, o slot trava: nenhuma 2ª gravação com updated_at velho", async () => {
      montarControlado();
      await escolherBia();
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
      const slot = screen.getByRole("button", { name: "Venda: Bia Lima" });
      expect(slot).toBeDisabled();
      expect(slot).toHaveAttribute("aria-busy", "true");
      fireEvent.click(slot);
      expect(screen.queryByRole("button", { name: /Ana Souza/ })).toBeNull();
      expect(updateAsync).toHaveBeenCalledTimes(1);
    });

    it("confirmada mas sem eco do servidor: ainda trava; com o eco, a 2ª troca usa o updated_at NOVO e a base exibida", async () => {
      const { ecoar } = montarControlado();
      await escolherBia();
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
      await act(async () => resolverUpdate!());
      await waitFor(() => expect(logAction).toHaveBeenCalledTimes(1));
      // Sem o refetch, o updated_at da tela é o velho: trocar agora seria conflito falso.
      expect(screen.getByRole("button", { name: "Venda: Bia Lima" })).toBeDisabled();

      ecoar({ id: "tm-bia", name: "Bia Lima" }, "2026-11-19T10:00:05Z");
      const slot = screen.getByRole("button", { name: "Venda: Bia Lima" });
      expect(slot).not.toBeDisabled();
      fireEvent.click(slot);
      fireEvent.click(await screen.findByRole("button", { name: /Ana Souza/ }));
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(2));
      expect(updateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({ sale_responsible_id: "tm-ana", expectedUpdatedAt: "2026-11-19T10:00:05Z" }),
      );
      expect(handleConflict).not.toHaveBeenCalled();
    });
  });
});
