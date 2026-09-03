import { describe, it, expect } from "vitest";
import { sharedRpcParams } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";

/**
 * Contrato de ordem de deploy do filtro "Parado há".
 *
 * O PostgREST resolve a RPC por nome + argumentos. Um parâmetro que o banco
 * ainda não conhece não é ignorado: a chamada inteira falha com PGRST202 e o
 * board para de carregar — não só o filtro. Como a migration
 * `20270729000010` é aplicada à mão (prod é botão do humano), o front precisa
 * poder subir antes dela.
 */
describe("sharedRpcParams — parâmetros de 'Parado há'", () => {
  const base = () => sharedRpcParams("whatsapp", "org-1", "", {});

  it("filtro inativo não manda os parâmetros novos", () => {
    const params = base();
    expect(params).not.toHaveProperty("p_stalled_min_days");
    expect(params).not.toHaveProperty("p_stalled_max_days");
  });

  it("chave ausente e chave nula são casos diferentes — nulo também omite", () => {
    // A página passa `stalledBucket?.minDays ?? null` quando não há faixa. Se
    // isso virasse `p_stalled_min_days: null` na chamada, o board quebraria
    // contra o banco sem migration exatamente no caminho mais comum.
    const params = sharedRpcParams("whatsapp", "org-1", "", {
      stalledMinDays: null,
      stalledMaxDays: null,
    });
    expect(Object.keys(params)).not.toContain("p_stalled_min_days");
    expect(Object.keys(params)).not.toContain("p_stalled_max_days");
  });

  it("faixa com teto manda os dois limites", () => {
    const params = sharedRpcParams("whatsapp", "org-1", "", {
      stalledMinDays: 3,
      stalledMaxDays: 7,
    });
    expect(params).toMatchObject({ p_stalled_min_days: 3, p_stalled_max_days: 7 });
  });

  it("faixa aberta ('mais de 30 dias') manda o piso e teto nulo", () => {
    const params = sharedRpcParams("whatsapp", "org-1", "", {
      stalledMinDays: 31,
      stalledMaxDays: null,
    });
    expect(params).toMatchObject({ p_stalled_min_days: 31, p_stalled_max_days: null });
  });

  it("faixa começando em zero é enviada — 0 não é 'sem filtro'", () => {
    // "Até 2 dias" tem minDays 0. Um teste de veracidade em vez de != null
    // aqui descartaria a faixa inteira em silêncio.
    const params = sharedRpcParams("whatsapp", "org-1", "", {
      stalledMinDays: 0,
      stalledMaxDays: 2,
    });
    expect(params).toMatchObject({ p_stalled_min_days: 0, p_stalled_max_days: 2 });
  });

  it("o resto do bloco de parâmetros não muda com o filtro ligado", () => {
    // Os dois RPCs (cards e contagem da coluna) consomem este mesmo objeto — é
    // o que garante badge == cards. O filtro novo não pode alterar mais nada.
    const off = base();
    const on = sharedRpcParams("whatsapp", "org-1", "", {
      stalledMinDays: 8,
      stalledMaxDays: 14,
    });
    const { p_stalled_min_days, p_stalled_max_days, ...rest } = on as Record<string, unknown>;
    expect(rest).toEqual(off);
  });
});
