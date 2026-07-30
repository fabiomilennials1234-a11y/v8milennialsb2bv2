import { describe, it, expect } from "vitest";
import { sharedRpcParams } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import {
  STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES,
} from "@/modules/pipelines/lib/stalled-buckets";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("gate do filtro 'Parado há' nos funis do sistema", () => {
  it("segue desligado enquanto a migration não estiver no repo E aplicada", () => {
    // Este teste é um pedágio, não uma verdade eterna. Ligar a constante sem
    // aplicar a migration faz o board devolver COLUNA VAZIA (PGRST202 engolido
    // pela query), que o operador lê como "não há ninguém parado" — uma
    // afirmação falsa sobre a carteira dele.
    //
    // Ao aplicar a migration: vire a constante para `true` e ajuste este teste
    // no mesmo commit, de propósito, pra decisão ficar no histórico.
    expect(STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES).toBe(false);
  });

  it("a migration existe no repo, esperando apply", () => {
    const path = resolve(
      __dirname,
      "../../supabase/migrations/20270729000010_pipeline_page_stalled_days_filter.sql",
    );
    const sql = readFileSync(path, "utf8");
    // Dropar antes de recriar é o que evita virar overload (ERROR 42725).
    expect(sql).toMatch(/DROP FUNCTION/);
    expect(sql).toMatch(/p_stalled_min_days/);
    expect(sql).toMatch(/p_stalled_max_days/);
    // O EXECUTE chega por dois caminhos (grant implícito a PUBLIC + grant
    // nominal a anon via ALTER DEFAULT PRIVILEGES). Revogar de um só deixa a
    // função aberta — foi o que vazou `import_lead_into_custom_pipeline`.
    expect(sql).toMatch(/REVOKE ALL\s+ON FUNCTION[\s\S]*FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION[\s\S]*FROM "anon"/);
    // E a migration precisa provar o resultado no próprio apply.
    expect(sql).toMatch(/has_function_privilege\(\s*'anon'/);
  });
});

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
