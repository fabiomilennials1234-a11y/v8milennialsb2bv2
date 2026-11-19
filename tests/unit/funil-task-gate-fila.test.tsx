/**
 * Porta de tarefas do move (TaskMoveGate) em FILA (qa Q1, régua de espera).
 *
 * Com o card do Funil movido de forma otimista ANTES da checagem, um 2º
 * arrasto durante a checagem do 1º não pode receber `false` na hora — o card
 * iria ao destino e voltaria sem aviso. O 2º espera a vez e recebe a resposta
 * dele; nunca duas checagens/modais ao mesmo tempo.
 */
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useContext } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

type Pedido = { fn: string; args: Record<string, unknown>; resolver: (v: unknown) => void; rejeitar: (e: unknown) => void };
const pedidos: Pedido[] = [];
const taskRpc = vi.fn((fn: string, args: Record<string, unknown>) =>
  new Promise((resolver, rejeitar) => pedidos.push({ fn, args, resolver, rejeitar })));

vi.mock("@/modules/engagement/lib/task-api", () => ({ taskRpc: (fn: string, args: Record<string, unknown>) => taskRpc(fn, args) }));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
  useIdentity: () => ({ userId: "u-1" }),
}));
const notifyError = vi.fn();
vi.mock("@/shared/errors", () => ({ notifyError: (...a: unknown[]) => notifyError(...a) }));

import { TaskMoveGateProvider } from "@/modules/engagement/components/tasks/TaskMoveGate";
import { TaskMoveContext, type RequestTaskMove } from "@/modules/engagement/components/tasks/task-move-context";

let pedir!: RequestTaskMove;
function Captura() {
  pedir = useContext(TaskMoveContext)!;
  return null;
}
const montar = () => render(<TaskMoveGateProvider><Captura /></TaskMoveGateProvider>);

beforeEach(() => {
  pedidos.length = 0;
  taskRpc.mockClear();
  notifyError.mockClear();
});

describe("TaskMoveGate — checagens em fila", () => {
  it("2º pedido durante a checagem do 1º espera a vez e recebe a SUA resposta (não `false` na hora)", async () => {
    montar();
    let r1!: Promise<boolean>;
    let r2!: Promise<boolean>;
    act(() => { r1 = pedir("e-1"); r2 = pedir("e-2"); });
    await waitFor(() => expect(pedidos).toHaveLength(1));
    expect(pedidos[0].args).toEqual({ p_entry: "e-1" });
    // Um em voo: o do e-2 ainda não foi ao servidor.
    let decidiu2 = false;
    void r2.then(() => { decidiu2 = true; });
    await act(async () => { await Promise.resolve(); });
    expect(decidiu2).toBe(false);

    await act(async () => { pedidos[0].resolver([]); });
    await expect(r1).resolves.toBe(true);
    await waitFor(() => expect(pedidos).toHaveLength(2));
    expect(pedidos[1].args).toEqual({ p_entry: "e-2" });
    await act(async () => { pedidos[1].resolver([]); });
    await expect(r2).resolves.toBe(true);
  });

  it("2º pedido enquanto o modal do 1º está aberto espera o modal fechar; depois checa o dele", async () => {
    montar();
    let r1!: Promise<boolean>;
    let r2!: Promise<boolean>;
    act(() => { r1 = pedir("e-1"); r2 = pedir("e-2"); });
    await waitFor(() => expect(pedidos).toHaveLength(1));
    await act(async () => { pedidos[0].resolver([{ id: "t-1", title: "Ligar" }]); });
    expect(await screen.findByText("Avançar com pendências")).toBeInTheDocument();
    expect(pedidos).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await expect(r1).resolves.toBe(false);
    await waitFor(() => expect(pedidos).toHaveLength(2));
    await act(async () => { pedidos[1].resolver([]); });
    await expect(r2).resolves.toBe(true);
  });

  it("falha na checagem do 1º não trava a fila", async () => {
    montar();
    let r1!: Promise<boolean>;
    let r2!: Promise<boolean>;
    act(() => { r1 = pedir("e-1"); r2 = pedir("e-2"); });
    await waitFor(() => expect(pedidos).toHaveLength(1));
    await act(async () => { pedidos[0].rejeitar(new Error("rede")); });
    await expect(r1).resolves.toBe(false);
    expect(notifyError).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pedidos).toHaveLength(2));
    await act(async () => { pedidos[1].resolver([]); });
    await expect(r2).resolves.toBe(true);
  });

  it("checagem pendurada: em 10 s o move é recusado com aviso e a fila anda", async () => {
    vi.useFakeTimers();
    try {
      montar();
      let r1!: Promise<boolean>;
      let r2!: Promise<boolean>;
      act(() => { r1 = pedir("e-1"); r2 = pedir("e-2"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(pedidos).toHaveLength(1);
      // O servidor nunca responde o 1º.
      await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
      let decidiu1 = false;
      void r1.then(() => { decidiu1 = true; });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(decidiu1).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await expect(r1).resolves.toBe(false);
      expect(notifyError).toHaveBeenCalledTimes(1);
      expect(String(notifyError.mock.calls[0][1]?.fallback)).toMatch(/demorou demais/);
      // A fila não travou: o 2º checa e decide.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(pedidos).toHaveLength(2);
      await act(async () => { pedidos[1].resolver([]); await vi.advanceTimersByTimeAsync(0); });
      await expect(r2).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o prazo vale para a 2ª ida (pendências), não para o modal: modal aberto não expira", async () => {
    vi.useFakeTimers();
    try {
      montar();
      let r1!: Promise<boolean>;
      act(() => { r1 = pedir("e-1"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { pedidos[0].resolver([{ id: "t-1", title: "Ligar" }]); await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText("Avançar com pendências")).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.getByText("Avançar com pendências")).toBeInTheDocument();
      expect(notifyError).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
      await expect(r1).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
