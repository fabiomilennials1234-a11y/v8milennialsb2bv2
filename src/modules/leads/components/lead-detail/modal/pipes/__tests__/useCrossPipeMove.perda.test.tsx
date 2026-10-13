import { renderHook, act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCrossPipeMove, type CrossPipeMoveTarget } from "../useCrossPipeMove";
import { StageRail } from "../StageRail";
import {
  FakeLossReasonGateProvider,
  makeFakeLossReasonGate,
} from "../../../../../loss-reason-gate/testing";

/**
 * Mover para etapa de PERDA pelo trilho (modal do lead, `DealDetailDialog`,
 * painel do Negócio — os três usam `useCrossPipeMove`) pede o motivo, grava no
 * metadata e só então move. Cancelar = nenhuma escrita.
 */

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  update: vi.fn(),
  rpc: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/integrations/supabase/entry-metadata", () => ({
  patchEntryMetadata: (...a: unknown[]) => {
    h.ordem.push("metadata");
    return h.patch(...a);
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => {
      h.ordem.push("move");
      h.rpc(...a);
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({
      update: (v: unknown) => ({
        eq: () => {
          h.ordem.push("move");
          h.update(v);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

let gate = makeFakeLossReasonGate();

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <FakeLossReasonGateProvider gate={gate}>{children}</FakeLossReasonGateProvider>
    </QueryClientProvider>
  );
}

const PERDA_SYSTEM: CrossPipeMoveTarget = {
  kind: "system",
  pipeId: "entry-1",
  stageKey: "perdido_desqualificado",
  stageLabel: "Perdido/Desqualificado",
  isLoss: true,
};

beforeEach(() => {
  h.ordem = [];
  h.update.mockReset();
  h.rpc.mockReset();
  h.patch.mockReset().mockResolvedValue(undefined);
  gate = makeFakeLossReasonGate({ id: "lr-9", texto: "Preço" });
});

async function mover(target: CrossPipeMoveTarget) {
  const { result } = renderHook(() => useCrossPipeMove("lead-1"), { wrapper });
  await act(async () => {
    await result.current.move(target);
  });
}

describe("useCrossPipeMove — etapa de perda", () => {
  it("pede o motivo, grava id + rótulo no metadata e SÓ então move (system)", async () => {
    await mover(PERDA_SYSTEM);
    expect(gate.pedidos).toEqual([{ stageName: "Perdido/Desqualificado" }]);
    expect(h.patch).toHaveBeenCalledWith("entry-1", { loss_reason_id: "lr-9", loss_reason: "Preço" });
    expect(h.ordem).toEqual(["metadata", "move"]);
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ stage_key: "perdido_desqualificado" }));
  });

  it("funil custom: o motivo vai para a entrada (entryId) antes do RPC de move", async () => {
    await mover({
      kind: "custom",
      entryId: "custom-entry-1",
      stageId: "11111111-1111-1111-1111-111111111111",
      stageLabel: "Perda",
      isLoss: true,
    });
    expect(h.patch).toHaveBeenCalledWith("custom-entry-1", { loss_reason_id: "lr-9", loss_reason: "Preço" });
    expect(h.ordem).toEqual(["metadata", "move"]);
  });

  it("cancelar não grava nem move", async () => {
    gate.resposta = null;
    await mover(PERDA_SYSTEM);
    expect(gate.pedidos).toHaveLength(1);
    expect(h.ordem).toEqual([]);
  });

  it("falha ao gravar o motivo não move", async () => {
    h.patch.mockRejectedValue(new Error("rede"));
    await mover(PERDA_SYSTEM);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("motivo já colhido por quem chama (`perda`) não pergunta de novo nem regrava", async () => {
    await mover({ ...PERDA_SYSTEM, perda: { id: "lr-1", texto: "Sem budget" } });
    expect(gate.pedidos).toHaveLength(0);
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.ordem).toEqual(["move"]);
  });

  it("etapa comum move sem perguntar", async () => {
    await mover({ kind: "system", pipeId: "entry-1", stageKey: "abordado", stageLabel: "Abordado" });
    expect(gate.pedidos).toHaveLength(0);
    expect(h.ordem).toEqual(["move"]);
  });
});

describe("StageRail — o clique numa etapa de perda leva `isLoss` ao move", () => {
  it("passa isLoss da etapa para o alvo", () => {
    const onMove = vi.fn();
    render(
      <StageRail
        pipe={{
          kind: "system",
          recordId: "entry-1",
          pipeRef: "whatsapp",
          shortLabel: "Mustang",
          color: "#f00",
          currentKey: "novo",
          stages: [
            { key: "novo", label: "Novo" },
            { key: "perdido_desqualificado", label: "Perdido", isLoss: true },
          ],
        }}
        pendingStageKey={null}
        recentlyMovedStageKey={null}
        onMove={onMove}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Perdido/ }));
    return waitFor(() =>
      expect(onMove).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "system", stageKey: "perdido_desqualificado", isLoss: true }),
      ),
    );
  });
});
