import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Leituras canônicas do hook: pipeline_entries, pipeline_stages ×2, pipelines, pipeline_display_config. */
const LEITURAS = 5;

const state = vi.hoisted(() => ({ failAt: -1, calls: 0, tables: [] as string[] }));

const DATA: Record<string, unknown[]> = {
  pipeline_entries: [
    { id: "entry-1", pipeline_id: "pipe-wa", stage_key: "novo", closed_at: null, stage_changed_at: null, created_at: null },
  ],
  pipelines: [{ id: "pipe-wa", slug: "whatsapp", type: "system", name: "WhatsApp", color: "#6366f1", icon: "" }],
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const index = state.calls++;
      state.tables.push(table);
      const response = () => ({
        data: DATA[table] ?? [],
        error: index % LEITURAS === state.failAt ? { message: "503 indisponível" } : null,
      });
      const chain = {
        select: () => chain, eq: () => chain, order: () => chain,
        maybeSingle: () => Promise.resolve(response()),
        then: (resolve: (value: ReturnType<typeof response>) => unknown) => Promise.resolve(response()).then(resolve),
      };
      return chain;
    },
  },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "riofix" } }),
}));
vi.mock("../pipe-ops", () => ({ usePipeOps: () => ({ useCustomPipelines: () => ({ data: [] }) }) }));

import { useLeadAllPipelines } from "./useLeadAllPipelines";

beforeEach(() => { state.calls = 0; state.failAt = -1; state.tables = []; });

function renderLeadPipelines() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(() => useLeadAllPipelines("lead-1"), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...view, client };
}

describe("Funis para criar negócio", () => {
  it.each([0, 1, 2, 3, 4])("não trata falha na consulta %i como ausência de negócios e permite retry", async (index) => {
    state.failAt = index;
    const { result, client } = renderLeadPipelines();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    state.failAt = -1;
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    client.clear();
  });

  // Chamados 6bdadd97 / f055fbd8: `public.upsell` não existe em prod; a
  // leitura voltava PGRST205 e, com o throw estrito do #2230, derrubava tudo.
  it("não lê a tabela legada upsell e devolve o negócio do lead", async () => {
    const { result, client } = renderLeadPipelines();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.tables).not.toContain("upsell");
    expect(state.tables).toHaveLength(LEITURAS);
    const whatsapp = result.current.data?.find((p) => p.type === "standard" && p.pipeType === "whatsapp");
    expect(whatsapp).toMatchObject({ pipeId: "entry-1", pipelineDbId: "pipe-wa", currentStage: "novo" });
    // A linha sintética "Carteira" segue emitida como em prod: sem negócio, sem etapa.
    const carteira = result.current.data?.find((p) => p.type === "standard" && p.pipeType === "upsell");
    expect(carteira).toMatchObject({ label: "Carteira", pipelineDbId: null, pipeId: null, currentStage: null });
    client.clear();
  });
});
