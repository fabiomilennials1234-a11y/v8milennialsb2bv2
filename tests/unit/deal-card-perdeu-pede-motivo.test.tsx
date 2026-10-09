/**
 * Painel do Negócio: o botão "Perdeu" pede o motivo (porta única) ANTES do
 * desfecho, grava id + rótulo no metadata da entrada (mesmo par do /funil) e
 * passa o texto à `definir_desfecho_da_entrada` (`p_loss_reason`). Cancelar =
 * nenhuma escrita.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { DealCardData } from "@/modules/leads/components/deal-card/types";
import { NEGOCIO_ESTAGNADO } from "@/modules/leads/components/deal-card/fixtures";

const negocioRef: { value: DealCardData | null } = { value: null };
vi.mock("@/modules/leads/components/deal-card/useDealCardData", () => ({
  useDealCardData: () => ({ data: negocioRef.value, isLoading: false }),
}));

const h = vi.hoisted(() => ({ ordem: [] as string[], rpc: vi.fn(), patch: vi.fn() }));
vi.mock("@/integrations/supabase/entry-metadata", () => ({
  patchEntryMetadata: (...a: unknown[]) => {
    h.ordem.push("metadata");
    return h.patch(...a);
  },
}));
vi.mock("@/integrations/supabase/client", () => {
  function construtor() {
    const no: Record<string, unknown> = {
      delete: () => no, update: () => no, insert: () => no, select: () => no, eq: () => no,
      in: () => no, order: () => no, limit: () => no, is: () => no,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
    };
    return no;
  }
  return {
    supabase: {
      from: () => construtor(),
      rpc: (...a: unknown[]) => {
        h.ordem.push("desfecho");
        h.rpc(...a);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});
vi.mock("@/modules/identity/permissions/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
  logLeadActionDirect: vi.fn(),
}));
vi.mock("@/modules/leads/components/lead-detail/modal/pipes/useCrossPipeMove", () => ({
  useCrossPipeMove: () => ({ move: vi.fn(), pendingStageKey: null, recentlyMovedStageKey: null }),
}));
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: () => ({ data: null, isLoading: false, visibility: "not_found" }),
}));
/** A coluna da pessoa monta `useUpdateLead`, que desce até `useAuth`. */
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { DealPanelProvider } from "@/modules/leads/components/deal-detail/DealPanelProvider";
import { useDealSheet } from "@/modules/leads/components/deal-detail/deal-sheet-context";
import { DealCardPanel } from "@/modules/leads/components/deal-card/DealCardPanel";
import { LeadPanelProvider } from "@/modules/leads/components/lead-detail/hooks/useLeadSheet";
import {
  FakeLossReasonGateProvider,
  makeFakeLossReasonGate,
} from "@/modules/leads/loss-reason-gate/testing";

let gate = makeFakeLossReasonGate();

function Abridor() {
  const { openDeal } = useDealSheet();
  return (
    <button type="button" onClick={() => openDeal("e1", "l1")}>
      abrir
    </button>
  );
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FakeLossReasonGateProvider gate={gate}>
        <LeadPanelProvider>
          <DealPanelProvider>
            <Abridor />
            <DealCardPanel />
          </DealPanelProvider>
        </LeadPanelProvider>
      </FakeLossReasonGateProvider>
    </QueryClientProvider>,
  );
}

async function clicarPerdeu() {
  fireEvent.click(screen.getByText("abrir"));
  const botao = await waitFor(() => {
    const b = document.querySelector<HTMLButtonElement>('button[data-desfecho="lost"]');
    if (!b) throw new Error("botão Perdeu ausente");
    return b;
  });
  fireEvent.click(botao);
}

beforeEach(() => {
  h.ordem = [];
  h.rpc.mockReset();
  h.patch.mockReset().mockResolvedValue(undefined);
  gate = makeFakeLossReasonGate({ id: "lr-7", texto: "Concorrência" });
  negocioRef.value = { ...NEGOCIO_ESTAGNADO, estado: "aberto", funilEhSystem: true };
});

describe("Painel do Negócio — Perdeu exige motivo", () => {
  it("pede o motivo, grava no metadata e passa p_loss_reason à RPC — nessa ordem", async () => {
    montar();
    await clicarPerdeu();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(gate.pedidos).toHaveLength(1);
    expect(h.patch).toHaveBeenCalledWith("e1", { loss_reason_id: "lr-7", loss_reason: "Concorrência" });
    expect(h.rpc).toHaveBeenCalledWith(
      "definir_desfecho_da_entrada",
      expect.objectContaining({ p_entry_id: "e1", p_outcome: "lost", p_loss_reason: "Concorrência" }),
    );
    expect(h.ordem).toEqual(["metadata", "desfecho"]);
  });

  it("cancelar o motivo não escreve nada", async () => {
    gate.resposta = null;
    montar();
    await clicarPerdeu();
    await waitFor(() => expect(gate.pedidos).toHaveLength(1));
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("falha ao gravar o motivo não fecha o negócio", async () => {
    h.patch.mockRejectedValue(new Error("rede"));
    montar();
    await clicarPerdeu();
    await waitFor(() => expect(h.patch).toHaveBeenCalled());
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
