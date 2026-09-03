/**
 * Renomear um funil tem de aparecer ONDE o funil aparece.
 *
 * Agora que dá para renomear a partir do hub e do cabeçalho do quadro, a
 * pessoa renomeia e continua olhando para a mesma tela — a lateral, a lista e
 * o título têm de acompanhar na hora. Cada uma dessas superfícies lê de um
 * cache diferente:
 *
 *   · lateral (`useNavigationModel`) → pipeline-display-config + pipelines +
 *     custom_pipelines (variante "active")
 *   · hub `/funis` .................. pipeline-display-config + pipelines +
 *     custom_pipelines ("permanent"/"temporary")
 *   · quadro `/funil/:slug` ......... pipelines + custom_pipeline (por slug)
 *   · painel do lead ................ lead_all_pipelines
 *
 * Um prefixo esquecido significa nome velho na tela até o próximo F5 — e o
 * usuário concluindo que o rename não funcionou.
 *
 * O teste trava também a ESCRITA no funil de sistema: o nome exibido dele vem
 * do registro, então a mutation precisa sincronizar `display_name` além de
 * `pipelines.name` (a precedência documentada em `usePipelineIdentity`).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const tabelasEscritas: Array<{ tabela: string; payload: Record<string, unknown> }> = [];

function chain(tabela: string) {
  const c: Record<string, unknown> = {};
  c.update = vi.fn((payload: Record<string, unknown>) => {
    tabelasEscritas.push({ tabela, payload });
    return c;
  });
  c.eq = vi.fn(() => c);
  c.select = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue({ data: { id: "p1" }, error: null });
  // `pipeline_display_config` não encadeia `.select()`: a promise é o próprio
  // encadeamento de `.eq()`.
  c.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (tabela: string) => chain(tabela) },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

import { useUpdatePipelineIdentity } from "@/modules/pipelines/hooks/config/usePipelineIdentity";

function montar() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidadas: unknown[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filtros: { queryKey?: unknown[] }) => {
    invalidadas.push(filtros?.queryKey?.[0]);
    return original(filtros);
  }) as typeof queryClient.invalidateQueries;

  const { result } = renderHook(() => useUpdatePipelineIdentity(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { result, invalidadas };
}

beforeEach(() => {
  tabelasEscritas.length = 0;
});

describe("useUpdatePipelineIdentity — o rename chega em todas as telas", () => {
  it("invalida todo cache que carrega nome de funil", async () => {
    const { result, invalidadas } = montar();

    await act(async () => {
      await result.current.mutateAsync({
        id: "p1",
        slug: "pos-venda",
        type: "custom",
        name: "Pós-venda 2.0",
        icon: "kanban",
        color: "#22c55e",
      });
    });

    expect(invalidadas).toEqual(
      expect.arrayContaining([
        "pipelines",
        "pipeline-display-config",
        "custom_pipelines",
        "custom_pipeline",
        "lead_all_pipelines",
      ]),
    );
  });

  it("funil de sistema: escreve no registro além do canônico — é de lá que o nome é lido", async () => {
    const { result } = montar();

    await act(async () => {
      await result.current.mutateAsync({
        id: "p1",
        slug: "whatsapp",
        type: "system",
        name: "Oportunidades",
        icon: "target",
        color: "#3b82f6",
      });
    });

    expect(tabelasEscritas.map((e) => e.tabela)).toEqual([
      "pipelines",
      "pipeline_display_config",
    ]);
    expect(tabelasEscritas[1].payload).toMatchObject({ display_name: "Oportunidades" });
  });

  it("funil custom não toca no registro de sistema", async () => {
    const { result } = montar();

    await act(async () => {
      await result.current.mutateAsync({
        id: "p1",
        slug: "pos-venda",
        type: "custom",
        name: "Pós-venda",
        icon: "kanban",
        color: "#22c55e",
      });
    });

    expect(tabelasEscritas.map((e) => e.tabela)).toEqual(["pipelines"]);
  });

  it("nome vazio é recusado antes de qualquer escrita", async () => {
    const { result } = montar();

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          id: "p1",
          slug: "pos-venda",
          type: "custom",
          name: "   ",
          icon: "kanban",
          color: "#22c55e",
        });
      }),
    ).rejects.toThrow(/não pode ficar vazio/);
    expect(tabelasEscritas).toHaveLength(0);
  });
});
