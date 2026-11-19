/**
 * Painel do Negócio — duplo clique em "Ganhou" com a checagem de tarefa em
 * FILA (TaskMoveGate): o 2º clique não pode esperar a vez e chamar
 * `definir_desfecho_da_entrada` de novo (celebração e log em dobro). A trava
 * liga ANTES do primeiro await.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
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
/** A porta de tarefa: cada pedido fica pendurado até o teste responder. */
const porta = vi.hoisted(() => ({ pedidos: [] as Array<(v: boolean) => void> }));
vi.mock("@/modules/engagement/tasks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTaskMoveGate: () => () => new Promise<boolean>((r) => porta.pedidos.push(r)),
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

async function botaoGanhou() {
  fireEvent.click(screen.getByText("abrir"));
  return waitFor(() => {
    const b = document.querySelector<HTMLButtonElement>('button[data-desfecho="won"]');
    if (!b) throw new Error("botão Ganhou ausente");
    return b;
  });
}

beforeEach(() => {
  h.ordem = [];
  h.rpc.mockReset();
  h.patch.mockReset().mockResolvedValue(undefined);
  porta.pedidos.length = 0;
  gate = makeFakeLossReasonGate({ id: "lr-7", texto: "Concorrência" });
  negocioRef.value = { ...NEGOCIO_ESTAGNADO, estado: "aberto", funilEhSystem: true };
});

describe("Painel do Negócio — desfecho não dispara duas vezes", () => {
  it("duplo clique em Ganhou durante a checagem de tarefa: UMA checagem, UMA RPC", async () => {
    montar();
    const botao = await botaoGanhou();
    // Os dois cliques no MESMO quadro, antes de o `disabled` chegar ao DOM.
    act(() => {
      botao.click();
      botao.click();
    });
    await waitFor(() => expect(porta.pedidos).toHaveLength(1));
    porta.pedidos[0](true);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(porta.pedidos).toHaveLength(1);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("checagem recusada solta a trava: o próximo clique decide de novo", async () => {
    montar();
    const botao = await botaoGanhou();
    fireEvent.click(botao);
    await waitFor(() => expect(porta.pedidos).toHaveLength(1));
    porta.pedidos[0](false);
    await waitFor(() => expect(botao).not.toBeDisabled());
    fireEvent.click(botao);
    await waitFor(() => expect(porta.pedidos).toHaveLength(2));
    porta.pedidos[1](true);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
  });
});
