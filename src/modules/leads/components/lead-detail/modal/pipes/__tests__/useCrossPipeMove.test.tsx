import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCrossPipeMove, type CrossPipeMoveTarget } from "../useCrossPipeMove";

/**
 * Trava as CHAVES de invalidação do move de etapa.
 *
 * Chave de invalidação é string solta: se ela não casa a chave da query, o
 * TypeScript não reclama, o code review não vê e a tela fica mentindo até o F5.
 * O repo já regrediu exatamente aqui — `usePipeWhatsapp.ts:224` carrega o
 * comentário "fix3: invalida a chave REAL do board" porque invalidava
 * `pipeline_entries`, que não casa nada. Este arquivo é o que impede a terceira
 * vez: qualquer rename de queryKey do board ou da camada de negócio quebra um
 * teste em vez de quebrar um cliente.
 *
 * As chaves esperadas vêm de:
 *  - `usePaginatedPipeline.ts:182,273` → board dos funis system
 *  - `useCustomPipelines.ts:251,345`   → board + contador do funil custom
 *  - `useLeadsDeals` / `useLeadsSalesMetrics` → camada de negócio da lista/modal
 */

const h = vi.hoisted(() => ({ error: null as { message: string } | null }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: h.error }),
      }),
    }),
  },
}));

const WHATSAPP: CrossPipeMoveTarget = {
  kind: "system",
  pipeId: "entry-1",
  stageKey: "abordado",
  stageLabel: "Abordado",
};

const CUSTOM: CrossPipeMoveTarget = {
  kind: "custom",
  entryId: "custom-entry-1",
  stageId: "11111111-1111-1111-1111-111111111111",
  stageLabel: "Em negociação",
};

/** Renderiza o hook e captura toda queryKey passada a `invalidateQueries`. */
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys: unknown[][] = [];
  vi.spyOn(qc, "invalidateQueries").mockImplementation((filters?: { queryKey?: unknown }) => {
    keys.push((filters?.queryKey ?? []) as unknown[]);
    return Promise.resolve();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(() => useCrossPipeMove("lead-1"), { wrapper });
  const move = async (target: CrossPipeMoveTarget) => {
    await act(async () => {
      await result.current.move(target);
    });
  };
  return { keys, move, result };
}

/** Compara conjuntos de chaves sem depender da ordem das chamadas. */
const asSet = (keys: unknown[][]) => new Set(keys.map((k) => JSON.stringify(k)));
const has = (keys: unknown[][], key: unknown[]) => asSet(keys).has(JSON.stringify(key));

beforeEach(() => {
  h.error = null;
});

describe("useCrossPipeMove — invalidação (funil system)", () => {
  it("invalida exatamente o conjunto esperado: lead, board e camada de negócio", async () => {
    const { keys, move } = setup();
    await move(WHATSAPP);

    expect(asSet(keys)).toEqual(
      asSet([
        ["lead_all_pipelines", "lead-1"],
        ["lead-pipes", "lead-1"],
        ["lead-timeline", "lead-1"],
        ["pipe_whatsapp"],
        ["pipe_confirmacao"],
        ["pipe_propostas"],
        ["pipeline-page"],
        ["pipeline-stage-counts"],
        ["leads-deals"],
        ["leads-sales-metrics"],
      ]),
    );
  });

  it("invalida o BOARD que hospeda o modal — cards e contador de coluna", async () => {
    // O contador (`pipeline-stage-counts`) não tem assinatura de Realtime e tem
    // staleTime 30s: sem esta invalidação ele fica errado até a janela reganhar
    // foco. O card se curaria via Realtime em ~2s; o número, não.
    //
    // SCRUM-637: o alvo system não carrega mais a view — a invalidação é por
    // PREFIXO, que casa tanto as chaves por slug do board legado quanto as por
    // pipeline_id da página unificada (match parcial do TanStack v5).
    const { keys, move } = setup();
    await move(WHATSAPP);

    expect(has(keys, ["pipeline-page"])).toBe(true);
    expect(has(keys, ["pipeline-stage-counts"])).toBe(true);
  });

  it("não toca carteira — nenhuma mutação de card escreve em upsell_*", async () => {
    const { keys, move } = setup();
    await move(WHATSAPP);
    expect(has(keys, ["leads-carteira-metrics"])).toBe(false);
  });
});

describe("useCrossPipeMove — invalidação (funil custom)", () => {
  it("invalida board e contador do custom, e nenhuma chave de funil system", async () => {
    const { keys, move } = setup();
    await move(CUSTOM);

    expect(asSet(keys)).toEqual(
      asSet([
        ["lead_all_pipelines", "lead-1"],
        ["lead-pipes", "lead-1"],
        ["lead-timeline", "lead-1"],
        ["custom_pipe_entries"],
        ["custom_pipe_stage_counts"],
        ["leads-deals"],
        ["leads-sales-metrics"],
      ]),
    );
  });
});

describe("useCrossPipeMove — falha no UPDATE", () => {
  it("não invalida nada quando o banco recusa o move", async () => {
    h.error = { message: "RLS negou" };
    const { keys, move } = setup();
    await move(WHATSAPP);

    expect(keys).toHaveLength(0);
  });
});
