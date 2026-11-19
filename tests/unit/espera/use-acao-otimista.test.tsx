import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const notifyError = vi.fn();
vi.mock("@/shared/errors", () => ({ notifyError: (...a: unknown[]) => notifyError(...a) }));

import { useAcaoOtimista, type AcaoOtimista } from "@/shared/espera";

type Lead = { id: string; responsavel: string };
const CHAVE = ["lead", "l1"] as const;
const OUTRA = ["lead", "l1", "detalhe"] as const;

function montar(qc: QueryClient, executar: (v: { para: string }) => Promise<unknown>, extra: Partial<AcaoOtimista<{ para: string }, unknown, Lead | undefined>> = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(
    () =>
      useAcaoOtimista<{ para: string }, unknown, Lead | undefined>({
        mutationKey: ["trocar-responsavel"],
        executar,
        aplicar: (client, v) => {
          const antes = client.getQueryData<Lead>(CHAVE);
          client.setQueryData<Lead>(CHAVE, (l) => (l ? { ...l, responsavel: v.para } : l));
          return antes;
        },
        reverter: (client, snap) => client.setQueryData(CHAVE, snap),
        alvos: () => [CHAVE],
        mensagemDeErro: () => "Não foi possível trocar o responsável.",
        ...extra,
      }),
    { wrapper },
  );
}

describe("useAcaoOtimista", () => {
  let qc: QueryClient;
  beforeEach(() => {
    notifyError.mockReset();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData<Lead>(CHAVE, { id: "l1", responsavel: "Ana" });
    qc.setQueryData(OUTRA, { x: 1 });
  });

  it("aplica ANTES de o executar resolver", async () => {
    let resolver!: () => void;
    const executar = vi.fn(() => new Promise<void>((r) => (resolver = r)));
    const { result } = montar(qc, executar);
    act(() => result.current.mutate({ para: "Bia" }));
    await waitFor(() => expect(executar).toHaveBeenCalled());
    expect(qc.getQueryData<Lead>(CHAVE)?.responsavel).toBe("Bia");
    await act(async () => resolver());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("erro reverte o snapshot e avisa com a mensagem da ação", async () => {
    const falha = new Error("conflict 409");
    const { result } = montar(qc, () => Promise.reject(falha));
    act(() => result.current.mutate({ para: "Bia" }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<Lead>(CHAVE)?.responsavel).toBe("Ana");
    expect(notifyError).toHaveBeenCalledWith(falha, { fallback: "Não foi possível trocar o responsável." });
  });

  it("invalida só as chaves exatas dos alvos — nunca prefixo nem raiz", async () => {
    const inval = vi.spyOn(qc, "invalidateQueries");
    const { result } = montar(qc, () => Promise.resolve());
    act(() => result.current.mutate({ para: "Bia" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(inval).toHaveBeenCalled());
    for (const [filtro] of inval.mock.calls) {
      expect(filtro).toEqual({ queryKey: CHAVE, exact: true });
    }
    expect(qc.getQueryState(OUTRA)?.isInvalidated).toBe(false);
  });

  it("cancela consultas em voo dos alvos antes de aplicar", async () => {
    const cancel = vi.spyOn(qc, "cancelQueries");
    const { result } = montar(qc, () => Promise.resolve());
    act(() => result.current.mutate({ para: "Bia" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cancel).toHaveBeenCalledWith({ queryKey: CHAVE, exact: true });
  });

  it("aoConfirmar recebe a resposta", async () => {
    const aoConfirmar = vi.fn();
    const { result } = montar(qc, () => Promise.resolve({ ok: 1 }), { aoConfirmar });
    act(() => result.current.mutate({ para: "Bia" }));
    await waitFor(() => expect(aoConfirmar).toHaveBeenCalledWith({ ok: 1 }, { para: "Bia" }));
  });

  it("alvo raiz (chave de 1 segmento) é recusado", async () => {
    const executar = vi.fn(() => Promise.resolve());
    const { result } = montar(qc, executar, { alvos: () => [["lead"]] });
    act(() => result.current.mutate({ para: "Bia" }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(executar).not.toHaveBeenCalled();
    expect(qc.getQueryData<Lead>(CHAVE)?.responsavel).toBe("Ana");
  });

  it("scope serializa: o 2º só executa depois do 1º terminar", async () => {
    const ordem: string[] = [];
    let soltar1!: () => void;
    const executar = vi.fn((v: { para: string }) => {
      ordem.push(`ini:${v.para}`);
      return v.para === "1"
        ? new Promise<void>((r) => (soltar1 = () => { ordem.push("fim:1"); r(); }))
        : Promise.resolve().then(() => void ordem.push(`fim:${v.para}`));
    });
    const { result } = montar(qc, executar, { scope: "lead:l1" });
    act(() => {
      result.current.mutate({ para: "1" });
      result.current.mutate({ para: "2" });
    });
    await waitFor(() => expect(ordem).toContain("ini:1"));
    expect(ordem).not.toContain("ini:2");
    await act(async () => soltar1());
    await waitFor(() => expect(ordem).toEqual(["ini:1", "fim:1", "ini:2", "fim:2"]));
  });
});
