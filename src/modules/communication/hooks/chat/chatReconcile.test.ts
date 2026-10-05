/**
 * Reconciliação do chat por EVENTO (reconexão do canal e contato fora do
 * cache), com teto de vazão por QueryClient — espelho de `unreadRefresh.ts`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Relogio } from "./unreadRefresh";
import {
  CHAT_RECONCILE_MIN_INTERVAL_MS,
  pedirReconciliacaoDaLista,
  pedirReconciliacaoDoChat,
  reconciliarAposReconexao,
} from "./chatReconcile";

function relogioManual() {
  let agora = 1_000_000;
  let fila: { quando: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const relogio: Relogio = {
    now: () => agora,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      fila.push({ quando: agora + ms, fn, id });
      return id;
    },
    clearTimeout: (h) => {
      fila = fila.filter((t) => t.id !== h);
    },
  };
  const avancar = (ms: number) => {
    agora += ms;
    const vencidos = fila.filter((t) => t.quando <= agora);
    fila = fila.filter((t) => t.quando > agora);
    vencidos.forEach((t) => t.fn());
  };
  return { relogio, avancar };
}

function clienteEspionado() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
  return { qc, spy };
}

const ORG = "org-a";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pedirReconciliacaoDoChat", () => {
  it("janela de 15 s", () => {
    expect(CHAT_RECONCILE_MIN_INTERVAL_MS).toBe(15_000);
  });

  it("invalida as duas raízes da org com refetchType active e cancelRefetch false", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio } = relogioManual();
    pedirReconciliacaoDoChat(qc, ORG, relogio);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["whatsapp_messages", ORG], refetchType: "active" },
      { cancelRefetch: false },
    );
    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["whatsapp_contacts", ORG], refetchType: "active" },
      { cancelRefetch: false },
    );
  });

  it("N pedidos na janela → 1 execução extra (borda de fuga)", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio, avancar } = relogioManual();
    for (let i = 0; i < 10; i++) {
      pedirReconciliacaoDoChat(qc, ORG, relogio);
      avancar(1_000);
    }
    expect(spy).toHaveBeenCalledTimes(2); // ataque = 2 raízes
    avancar(CHAT_RECONCILE_MIN_INTERVAL_MS);
    expect(spy).toHaveBeenCalledTimes(4); // + uma fuga
    avancar(CHAT_RECONCILE_MIN_INTERVAL_MS * 3);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("aba oculta → refetchType none (só marca como velho)", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio } = relogioManual();
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    pedirReconciliacaoDoChat(qc, ORG, relogio);
    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["whatsapp_messages", ORG], refetchType: "none" },
      { cancelRefetch: false },
    );
    vis.mockRestore();
  });

  it("dois QueryClients não compartilham janela", () => {
    const a = clienteEspionado();
    const b = clienteEspionado();
    const { relogio } = relogioManual();
    pedirReconciliacaoDoChat(a.qc, ORG, relogio);
    pedirReconciliacaoDoChat(b.qc, ORG, relogio);
    expect(a.spy).toHaveBeenCalledTimes(2);
    expect(b.spy).toHaveBeenCalledTimes(2);
  });

  it("orgs diferentes no mesmo QueryClient não compartilham janela", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio } = relogioManual();
    pedirReconciliacaoDoChat(qc, "org-a", relogio);
    pedirReconciliacaoDoChat(qc, "org-b", relogio);
    expect(spy).toHaveBeenCalledWith(
      { queryKey: ["whatsapp_messages", "org-b"], refetchType: "active" },
      { cancelRefetch: false },
    );
  });
});

describe("reconciliarAposReconexao", () => {
  it("1º join não reconcilia", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio } = relogioManual();
    reconciliarAposReconexao(qc, ORG, 1, relogio);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejoin reconcilia uma vez", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio } = relogioManual();
    reconciliarAposReconexao(qc, ORG, 1, relogio);
    reconciliarAposReconexao(qc, ORG, 2, relogio);
    expect(spy).toHaveBeenCalledTimes(2); // 2 raízes, 1 execução
  });

  it("dois montadores vendo o MESMO joinCount reconciliam 1× só", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio, avancar } = relogioManual();
    reconciliarAposReconexao(qc, ORG, 2, relogio); // montador A
    reconciliarAposReconexao(qc, ORG, 2, relogio); // montador B
    avancar(CHAT_RECONCILE_MIN_INTERVAL_MS * 2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("rejoins em rajada passam pelo throttle de 15 s", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio, avancar } = relogioManual();
    for (let n = 2; n <= 6; n++) {
      reconciliarAposReconexao(qc, ORG, n, relogio);
      avancar(500);
    }
    avancar(CHAT_RECONCILE_MIN_INTERVAL_MS);
    expect(spy).toHaveBeenCalledTimes(4); // ataque + fuga, 2 raízes cada
  });
});

describe("pedirReconciliacaoDaLista — contato fora do cache (Fase B)", () => {
  const KEY = ["whatsapp_contacts", ORG, "multi:a,b", ""] as const;

  it("evento isolado invalida já, com cancelRefetch false", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio } = relogioManual();
    pedirReconciliacaoDaLista(qc, KEY, relogio);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      { queryKey: KEY, refetchType: "active" },
      { cancelRefetch: false },
    );
  });

  it("rajada de 5 eventos → ≤ 2 invalidações", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio, avancar } = relogioManual();
    for (let i = 0; i < 5; i++) {
      pedirReconciliacaoDaLista(qc, KEY, relogio);
      avancar(200);
    }
    avancar(CHAT_RECONCILE_MIN_INTERVAL_MS * 2);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("listas diferentes têm janelas independentes", () => {
    const { qc, spy } = clienteEspionado();
    const { relogio } = relogioManual();
    pedirReconciliacaoDaLista(qc, KEY, relogio);
    pedirReconciliacaoDaLista(qc, ["whatsapp_contacts", ORG, "inst-x", ""], relogio);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
