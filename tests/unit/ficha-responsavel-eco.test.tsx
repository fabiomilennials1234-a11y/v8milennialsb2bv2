/**
 * Responsável otimista na ficha — a trava "uma troca por vez" com eco REAL
 * (refetch do `lead-detail`). A trava espera o `updated_at` novo do servidor,
 * mas nunca para sempre: refetch que falha ou eco que não vem no prazo soltam
 * o slot; eco que chega ANTES da gravação responder não trava nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// "Servidor": lead com responsável + updated_at; a gravação aplica o lock #307 de verdade.
const servidor = { sale: "tm-ana", updatedAt: "2026-11-19T10:00:00Z", n: 0, falharGet: false, ecoLento: false };
let antesDeResolver: null | (() => Promise<void>) = null;
const updateAsync = vi.fn(async (v: { sale_responsible_id: string | null; expectedUpdatedAt?: string }) => {
  await new Promise((r) => setTimeout(r, 40));
  if (v.expectedUpdatedAt && v.expectedUpdatedAt !== servidor.updatedAt) {
    const { OptimisticLockConflictError } = await import("@/modules/platform/lib/optimistic-lock");
    throw new OptimisticLockConflictError();
  }
  servidor.sale = v.sale_responsible_id as string;
  servidor.n += 1;
  servidor.updatedAt = `2026-11-19T10:00:0${servidor.n}Z`;
  if (antesDeResolver) await antesDeResolver();
});
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


const NOMES: Record<string, string> = { "tm-ana": "Ana Souza", "tm-bia": "Bia Lima" };
function Pai() {
  const q = useQuery({
    queryKey: ["lead-detail", "lead-1"],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, servidor.ecoLento ? 60_000 : 30));
      if (servidor.falharGet) throw new Error("rede");
      return { sale: servidor.sale, updated_at: servidor.updatedAt };
    },
  });
  if (!q.data) return null;
  return (
    <ResponsibleSlot
      leadId="lead-1"
      field="sale_responsible_id"
      label="Venda"
      currentMember={q.data.sale ? { id: q.data.sale, name: NOMES[q.data.sale] } : null}
      expectedUpdatedAt={q.data.updated_at}
    />
  );
}
let qc: QueryClient;
function montarComServidor() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><Pai /></QueryClientProvider>);
}
const slot = () => screen.getByRole("button", { name: /^Venda/ });
async function escolher(nome: RegExp) {
  fireEvent.click(slot());
  fireEvent.click(await screen.findByRole("button", { name: nome }));
}

describe("ResponsibleSlot — trava do eco (lead-detail refetch)", () => {
  beforeEach(() => {
    Object.assign(servidor, { sale: "tm-ana", updatedAt: "2026-11-19T10:00:00Z", n: 0, falharGet: false, ecoLento: false });
    antesDeResolver = null;
    updateAsync.mockClear(); handleConflict.mockClear(); notifyError.mockClear();
  });

  it("2ª troca rápida: travada até o eco; depois sai com updated_at novo; zero conflito", async () => {
    montarComServidor();
    await screen.findByRole("button", { name: "Venda: Ana Souza" });
    await escolher(/Bia Lima/);
    // 2ª tentativa imediata (durante a gravação)
    fireEvent.click(slot());
    expect(slot()).toBeDisabled();
    await waitFor(() => expect(slot()).not.toBeDisabled(), { timeout: 2000, interval: 5 });
    await escolher(/Ana Souza/);
    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(servidor.sale).toBe("tm-ana"));
    expect(updateAsync.mock.calls.map((c) => c[0].expectedUpdatedAt)).toEqual(["2026-11-19T10:00:00Z", "2026-11-19T10:00:01Z"]);
    expect(handleConflict).not.toHaveBeenCalled();
  });

  it("eco chega ANTES da gravação responder (realtime/refetch rápido): o slot não pode ficar travado para sempre", async () => {
    antesDeResolver = async () => { await qc.refetchQueries({ queryKey: ["lead-detail", "lead-1"] }); };
    montarComServidor();
    await screen.findByRole("button", { name: "Venda: Ana Souza" });
    await escolher(/Bia Lima/);
    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(slot()).not.toBeDisabled(), { timeout: 1000 });
    expect(slot()).toHaveAttribute("aria-label", "Venda: Bia Lima");
  });

  it("refetch do eco falha: o slot não pode ficar travado para sempre", async () => {
    montarComServidor();
    await screen.findByRole("button", { name: "Venda: Ana Souza" });
    servidor.falharGet = true;
    await escolher(/Bia Lima/);
    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    // Solta no ERRO do refetch — bem antes do prazo.
    await waitFor(() => expect(slot()).not.toBeDisabled(), { timeout: 1000 });
  });

  it("eco que não chega: o slot segue travado e solta no prazo (8 s)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      montarComServidor();
      await screen.findByRole("button", { name: "Venda: Ana Souza" });
      servidor.ecoLento = true;
      await escolher(/Bia Lima/);
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(slot()).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
      expect(slot()).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
