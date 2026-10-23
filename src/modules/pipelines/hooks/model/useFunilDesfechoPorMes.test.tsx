import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DESFECHO_POR_MES_KEY, useFunilDesfechoPorMes } from "./useFunilDesfechoPorMes";

// ── Mocks ──────────────────────────────────────────────────────────────────
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PIPELINE_ID = "8106f2dc-e13b-4aaa-8058-05034c1e239a";
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rpc.mockReset();
});

describe("useFunilDesfechoPorMes (Chamado 172ef046)", () => {
  it("K3 — chama get_funil_desfecho_por_mes com p_pipeline_id, p_org_id e p_tz e agrupa por etapa", async () => {
    rpc.mockResolvedValue({
      data: [
        { stage_key: "vendido", outcome: "won", month_key: "2026-09", cnt: 69, total: 411501.3 },
        // bigint/numeric podem chegar como texto: o hook normaliza.
        { stage_key: "vendido", outcome: "won", month_key: "2026-10", cnt: "25", total: "91084.14" },
        { stage_key: "perdido", outcome: "lost", month_key: "2026-09", cnt: 34, total: null },
        // Desfecho fora do domínio não entra.
        { stage_key: "vendido", outcome: "open", month_key: "2026-10", cnt: 3, total: 1 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useFunilDesfechoPorMes(PIPELINE_ID), { wrapper });

    await waitFor(() => expect(result.current.porEtapa).not.toBeNull());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_funil_desfecho_por_mes", {
      p_pipeline_id: PIPELINE_ID,
      p_org_id: "org-1",
      p_tz: TZ,
    });
    expect(result.current.porEtapa).toEqual({
      vendido: [
        { outcome: "won", monthKey: "2026-09", count: 69, total: 411501.3 },
        { outcome: "won", monthKey: "2026-10", count: 25, total: 91084.14 },
      ],
      perdido: [{ outcome: "lost", monthKey: "2026-09", count: 34, total: null }],
    });
    expect(client.getQueryCache().find({ queryKey: [DESFECHO_POR_MES_KEY, PIPELINE_ID, "org-1", TZ] })).toBeTruthy();
  });

  it("K3 — desligado sem pipeline: não chama a RPC", async () => {
    const { result } = renderHook(() => useFunilDesfechoPorMes(undefined), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.porEtapa).toBeNull();
  });

  it("K3 — erro da RPC (ex.: migration ainda não aplicada) vira 'sem resumo', sem quebrar", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.get_funil_desfecho_por_mes" },
    });
    const { result } = renderHook(() => useFunilDesfechoPorMes(PIPELINE_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.porEtapa).toBeNull();
    // Sem retry: o resumo é um extra — falhou, a pilha volta ao modo parcial.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("desligado (filtro ativo) não devolve o resumo que ficou no cache", async () => {
    rpc.mockResolvedValue({
      data: [{ stage_key: "vendido", outcome: "won", month_key: "2026-09", cnt: 69, total: 1 }],
      error: null,
    });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useFunilDesfechoPorMes(PIPELINE_ID, { enabled }),
      { wrapper, initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.porEtapa).not.toBeNull());

    rerender({ enabled: false });
    expect(result.current.porEtapa).toBeNull();
  });

  it("resposta no teto de linhas do PostgREST é tratada como incompleta", async () => {
    rpc.mockResolvedValue({
      data: Array.from({ length: 1000 }, (_, i) => ({
        stage_key: `s${i}`,
        outcome: "won",
        month_key: "2026-09",
        cnt: 1,
        total: 1,
      })),
      error: null,
    });
    const { result } = renderHook(() => useFunilDesfechoPorMes(PIPELINE_ID), { wrapper });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.porEtapa).toBeNull();
  });
});
