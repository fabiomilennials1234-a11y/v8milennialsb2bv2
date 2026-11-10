import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// O `rpcNaoTipada` é o real: o dublê é o cliente, como em useFunilDesfechoPorMes.test.
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-1", isReady: true }) }));

import { useFocoNoNegocio } from "./useFocoNoNegocio";
import { FOCO_SEGMENTO } from "@/modules/pipelines/lib/foco-no-funil";
import { toAppError } from "@/shared/errors";

const FILTROS = { p_org_id: "org-1", p_search: null, p_responsible_id: "tm-1" } as never;

function montar(entryId: string | null, filtros = FILTROS, opcoes: { pronto?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const pedido = entryId ? { entryId, nonce: 7 } : null;
  const hook = renderHook(() => useFocoNoNegocio("pl-1", pedido, filtros, opcoes), { wrapper });
  return { qc, ...hook };
}

const devolve = (data: unknown) => rpc.mockResolvedValue({ data, error: null });

beforeEach(() => rpc.mockReset());

describe("useFocoNoNegocio", () => {
  it("pergunta à RPC com o MESMO recorte do board e devolve a linha no formato do card", async () => {
    devolve([
      {
        id: "e-9",
        pipeline_id: "pl-1",
        lead_id: "lead-9",
        stage_key: "novo",
        metadata: { meeting_date: "2026-11-12T13:00:00Z" },
        created_at: "2026-08-01T10:00:00Z",
        lead: JSON.stringify({ id: "lead-9", name: "Bar do Zé" }),
        visivel_no_recorte: true,
      },
    ]);
    const { result } = montar("e-9");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpc).toHaveBeenCalledWith("localizar_negocio_no_funil", { ...(FILTROS as object), p_entry_id: "e-9" });
    const foco = result.current.data!;
    expect(foco).toMatchObject({ entryId: "e-9", pipelineId: "pl-1", stageKey: "novo", leadId: "lead-9", visivel: true });
    // Mesmo achatamento da coluna: lead vira objeto, metadata sobe para o card.
    expect((foco.linha?.lead as { name: string }).name).toBe("Bar do Zé");
    expect(foco.linha?.meeting_date).toBe("2026-11-12T13:00:00Z");
    // A linha do card não carrega o campo de controle da RPC.
    expect(foco.linha).not.toHaveProperty("visivel_no_recorte");
  });

  it("o recorte esconde: sabe ONDE está, mas não há linha para fixar", async () => {
    devolve([{ id: "e-9", pipeline_id: "pl-1", lead_id: "lead-9", stage_key: "novo", lead: null, metadata: null, visivel_no_recorte: false }]);
    const { result } = montar("e-9");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ visivel: false, linha: null, stageKey: "novo" });
  });

  it("nenhuma linha = negócio que a pessoa não vê (ou não existe)", async () => {
    devolve([]);
    const { result } = montar("e-9");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("sem negócio pedido, não chama o banco", () => {
    montar(null);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recorte ainda não assentado (visão salva não lida): espera, não busca", () => {
    montar("e-9", FILTROS, { pronto: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("RPC fora do ar (migration não aplicada): erro na hora, sem nova tentativa", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.localizar_negocio_no_funil" },
    });
    const { result } = montar("e-9");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("RPC lenta (statement timeout): o erro chega classificado como demora, não como 'desconhecido'", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout", details: null, hint: null },
    });
    const { result } = montar("e-9");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(toAppError(result.current.error, "Não foi possível localizar o negócio.").code).toBe("request.timeout");
  });

  it("mora sob o prefixo das colunas — recebe toda invalidação que o board já recebe", async () => {
    devolve([]);
    const { qc, result } = montar("e-9");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [chave] = qc.getQueryCache().findAll({ queryKey: ["pipeline-page", "pl-1", FOCO_SEGMENTO] });
    expect(chave?.queryKey).toEqual(["pipeline-page", "pl-1", FOCO_SEGMENTO, "org-1", JSON.stringify(FILTROS), "e-9", 7]);
  });
});
