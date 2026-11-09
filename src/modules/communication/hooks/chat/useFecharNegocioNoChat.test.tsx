import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SALE_VALUE_REQUIRED_MARKER } from "@/lib/rpc-errors";

const ordem: string[] = [];
const rpc = vi.fn();
const mutateAsync = vi.fn();
const requestTaskMove = vi.fn();
const capturarMotivoDaPerda = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/engagement/tasks", () => ({ useTaskMoveGate: () => requestTaskMove }));

import { useFecharNegocioNoChat } from "./useFecharNegocioNoChat";

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useFecharNegocioNoChat({ moverEtapa: mutateAsync, capturarMotivoDaPerda }), { wrapper }).result.current;
}

const vendido = { key: "vendido", stageId: "st-1", label: "Vendido" };

beforeEach(() => {
  ordem.length = 0;
  rpc.mockReset().mockImplementation(async () => {
    ordem.push("rpc");
    return { error: null };
  });
  mutateAsync.mockReset().mockImplementation(async () => {
    ordem.push("move");
  });
  requestTaskMove.mockReset().mockResolvedValue(true);
  capturarMotivoDaPerda.mockReset().mockResolvedValue({ texto: "Preço", id: "m1" });
});

describe("useFecharNegocioNoChat", () => {
  it("ganho com outra etapa: MOVE primeiro, desfecho depois", async () => {
    const { fechar } = setup();
    const r = await fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "novo", destino: vendido });
    expect(r).toEqual({ status: "ok" });
    expect(ordem).toEqual(["move", "rpc"]);
    expect(mutateAsync).toHaveBeenCalledWith({ id: "e1", stageId: "st-1" });
    expect(rpc).toHaveBeenCalledWith("definir_desfecho_da_entrada", expect.objectContaining({ p_entry_id: "e1", p_outcome: "won" }));
  });

  it("manter na etapa atual: só o desfecho, sem mover", async () => {
    const { fechar } = setup();
    await fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "novo", destino: null });
    expect(ordem).toEqual(["rpc"]);
  });

  it("destino igual à etapa atual não move", async () => {
    const { fechar } = setup();
    await fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "vendido", destino: vendido });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(ordem).toEqual(["rpc"]);
  });

  it("etapa sem stageId usa stageKey", async () => {
    const { fechar } = setup();
    await fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "novo", destino: { key: "vendido", label: "Vendido" } });
    expect(mutateAsync).toHaveBeenCalledWith({ id: "e1", stageKey: "vendido" });
  });

  it("perda: pede o motivo ANTES de mover e manda o texto à RPC", async () => {
    const { fechar } = setup();
    const r = await fechar({ entryId: "e1", desfecho: "lost", etapaAtualKey: "novo", destino: { key: "perdido", label: "Perdido" } });
    expect(r).toEqual({ status: "ok" });
    expect(capturarMotivoDaPerda).toHaveBeenCalledWith({ entryIds: ["e1"], stageName: "Perdido" });
    expect(ordem).toEqual(["move", "rpc"]);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_outcome: "lost", p_loss_reason: "Preço" });
  });

  it("motivo da perda cancelado: nada é escrito", async () => {
    capturarMotivoDaPerda.mockResolvedValue(null);
    const { fechar } = setup();
    const r = await fechar({ entryId: "e1", desfecho: "lost", etapaAtualKey: "novo", destino: vendido });
    expect(r).toEqual({ status: "cancelado" });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tarefa pendente recusada: nada é escrito, nem o motivo é pedido", async () => {
    requestTaskMove.mockResolvedValue(false);
    const { fechar } = setup();
    const r = await fechar({ entryId: "e1", desfecho: "lost", etapaAtualKey: "novo", destino: vendido });
    expect(r).toEqual({ status: "cancelado" });
    expect(capturarMotivoDaPerda).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("banco exige valor: devolve pede-valor com o que já foi feito, sem lançar", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "23514", message: `x ${SALE_VALUE_REQUIRED_MARKER} y` } });
    const { fechar } = setup();
    const r = await fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "novo", destino: vendido });
    expect(r).toEqual({ status: "pede-valor", perda: null, moveu: true });
  });

  it("segunda tentativa só do desfecho leva o valor na MESMA chamada", async () => {
    const { registrarDesfecho } = setup();
    await registrarDesfecho({ entryId: "e1", desfecho: "won", perda: null, valor: 1500 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_entry_id: "e1", p_outcome: "won", p_valor: 1500 });
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("desfecho falha depois de mover: o retorno diz que moveu (a tela avisa)", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "XX000", message: "boom" } });
    const { fechar } = setup();
    const r = await fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "novo", destino: vendido });
    expect(r).toMatchObject({ status: "falhou-depois-de-mover", destino: "Vendido" });
  });

  it("desfecho falha sem ter movido: lança, para a tela mostrar o erro", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "XX000", message: "boom" } });
    const { fechar } = setup();
    await expect(fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "novo", destino: null })).rejects.toMatchObject({ message: "boom" });
  });

  it("falha ao mover: lança e NÃO registra desfecho", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("sem permissão"));
    const { fechar } = setup();
    await expect(fechar({ entryId: "e1", desfecho: "won", etapaAtualKey: "novo", destino: vendido })).rejects.toThrow("sem permissão");
    expect(rpc).not.toHaveBeenCalled();
  });
});
