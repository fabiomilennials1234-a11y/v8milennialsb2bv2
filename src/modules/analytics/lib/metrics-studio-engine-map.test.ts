import { describe, it, expect } from "vitest";
import {
  COMPATIBILIDADE,
  CORTES_POR_PESSOA,
  ENGINE_BY_ID,
  ENGINE_METRICS,
  FORMATO_DA_MEDIDA,
  ROTULO_DO_CORTE,
  UNIDADE_DA_MEDIDA,
  cortesVisiveis,
  ehEscalar,
  filtrarPeloCatalogo,
  medidasDe,
  parEhCompativel,
  type MetricRecorte,
} from "./metrics-studio-engine-map";

/**
 * Rede contra o erro caro: oferecer na UI um par (medida, corte) que o motor
 * recusa com EXCEPTION 22023 — erro que não é capturado por
 * isMissingSchemaError e derruba a janela em runtime.
 */

/**
 * Vocabulário FECHADO das medidas — a união do que as migrations do repo criam.
 * Não é um retrato de prod: é o contrato do código.
 *
 * ⚠ MUDOU DE INTENÇÃO na fatia 9/10, e vale dizer por quê. Antes esta lista era
 * o catálogo de PRODUÇÃO, e havia um teste afirmando que nada apontava para
 * medida fora dele. Aquilo reprovava a cada fatia nova do SCRUM-311 — a lista
 * ficava desatualizada por construção — e, pior, não protegia ambiente nenhum
 * em runtime: quem lia a lista estática era a UI, e a UI oferecia a medida do
 * mesmo jeito no dia em que o código entrasse antes da migration.
 *
 * A defesa real agora é `filtrarPeloCatalogo`, que intersecta esta lista com o
 * catálogo VIVO de `fn_metric_catalog()`. Este teste passou a guardar a outra
 * metade: que o código não referencia medida que migration nenhuma cria.
 */
const VOCABULARIO_DAS_MEDIDAS = [
  // catálogo v1 (20260723100000)
  "receita",
  "num_vendas",
  "leads_criados",
  "reunioes_marcadas",
  "reunioes_realizadas",
  "leads_na_etapa",
  "tempo_medio_etapa",
  // SCRUM-311, uma migration por fatia
  "leads_sem_responsavel",
  "leads_avaliados",
  "leads_nao_avaliados",
  "boas_avaliacoes",
  "negocios_perdidos",
  "tempo_resposta_equipe",
  "reunioes_no_show",
  // fatia 9 — Lead ≠ Negócio (20270813100000)
  "negocios_na_etapa",
  "negocios_abertos",
];

describe("engine map — integridade contra o catálogo do motor", () => {
  it("toda medida referenciada é criada por alguma migration do repo", () => {
    for (const m of ENGINE_METRICS) {
      for (const medida of medidasDe(m)) {
        expect(VOCABULARIO_DAS_MEDIDAS, `${m.id} → ${medida}`).toContain(medida);
      }
    }
  });

  it("o vocabulário e as tabelas de apoio não divergem", () => {
    // Medida referenciada sem entrada em COMPATIBILIDADE/FORMATO/UNIDADE
    // quebraria a janela de um jeito que só aparece ao abrir.
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind !== "leaf") continue;
      expect(COMPATIBILIDADE[m.measureRef.id], `COMPATIBILIDADE[${m.measureRef.id}]`).toBeDefined();
      expect(FORMATO_DA_MEDIDA[m.measureRef.id], `FORMATO[${m.measureRef.id}]`).toBeDefined();
      expect(UNIDADE_DA_MEDIDA[m.measureRef.id], `UNIDADE[${m.measureRef.id}]`).toBeDefined();
    }
  });

  describe("filtrarPeloCatalogo — a defesa que roda em runtime", () => {
    it("oferece só o que o banco-alvo calcula", () => {
      // Um banco que só tem o catálogo v1: as fatias do SCRUM-311 somem da
      // lista em vez de virarem janela que levanta 22023.
      const catalogoV1 = {
        measures: [
          { id: "receita", compatible_recortes: ["total", "tempo", "origem", "closer", "sdr", "pipeline", "tag", "stream"] },
          { id: "num_vendas", compatible_recortes: ["total", "tempo"] },
          { id: "leads_criados", compatible_recortes: ["total", "tempo"] },
        ],
      };
      const oferecidas = filtrarPeloCatalogo(ENGINE_METRICS, catalogoV1).map((m) => m.id);

      expect(oferecidas).toContain("receita");
      // Razões sobrevivem quando os DOIS filhos existem no catálogo.
      expect(oferecidas).toContain("taxa_conversao"); // num_vendas ÷ leads_criados
      expect(oferecidas).toContain("ticket_medio"); // receita ÷ num_vendas
      // E as fatias do SCRUM-311 somem, que é o ponto.
      expect(oferecidas).not.toContain("reunioes_no_show");
      expect(oferecidas).not.toContain("negocios_por_etapa");
      expect(oferecidas).not.toContain("taxa_qualidade");
    });

    it("razão some quando UM dos filhos falta", () => {
      const so_receita = { measures: [{ id: "receita", compatible_recortes: ["total"] }] };
      const oferecidas = filtrarPeloCatalogo(ENGINE_METRICS, so_receita).map((m) => m.id);
      expect(oferecidas).toContain("receita");
      expect(oferecidas).not.toContain("ticket_medio"); // falta num_vendas
      expect(oferecidas).not.toContain("taxa_conversao"); // falta leads_criados
    });

    it("corte que o banco não aceita é podado, e a medida sobrevive", () => {
      const catalogo = { measures: [{ id: "receita", compatible_recortes: ["total"] }] };
      const receita = filtrarPeloCatalogo(ENGINE_METRICS, catalogo).find((m) => m.id === "receita")!;
      expect(receita.cortes).toEqual(["total"]);
    });

    it("medida sem NENHUM corte aceito não é oferecida", () => {
      const catalogo = { measures: [{ id: "receita", compatible_recortes: [] }] };
      expect(filtrarPeloCatalogo(ENGINE_METRICS, catalogo)).toEqual([]);
    });

    it("FALHA PARA FECHADO: catálogo vazio não oferece a lista estática", () => {
      // Deploy pela metade (RPC ausente) devolve catálogo vazio. Oferecer tudo
      // ali seria oferecer tudo quebrado.
      expect(filtrarPeloCatalogo(ENGINE_METRICS, { measures: [] })).toEqual([]);
    });
  });

  it("TODO corte oferecido está na tabela de compatibilidade", () => {
    for (const m of ENGINE_METRICS) {
      for (const corte of m.cortes) {
        expect(parEhCompativel(m, corte), `${m.id} × ${corte}`).toBe(true);
      }
    }
  });

  it("nenhuma métrica oferece corte que o motor recusa", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind !== "leaf") continue;
      const aceitos = COMPATIBILIDADE[m.measureRef.id];
      for (const corte of m.cortes) {
        expect(aceitos, `${m.id}`).toContain(corte);
      }
    }
  });

  it("tempo_medio_etapa não oferece total — a exceção do catálogo", () => {
    const m = ENGINE_BY_ID.get("tempo_medio_etapa")!;
    expect(COMPATIBILIDADE.tempo_medio_etapa).not.toContain("total");
    expect(m.cortes).not.toContain("total");
    expect(parEhCompativel(m, "total")).toBe(false);
  });

  it("o formato bate com o formato canônico da medida (leaf)", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind !== "leaf") continue;
      expect(m.formatId, m.id).toBe(FORMATO_DA_MEDIDA[m.measureRef.id]);
    }
  });
});

describe("engine map — decisões do grill", () => {
  it("G2: toda métrica declara ao menos um corte, e o primeiro é o default", () => {
    for (const m of ENGINE_METRICS) {
      expect(m.cortes.length, m.id).toBeGreaterThan(0);
      expect(parEhCompativel(m, m.cortes[0]), m.id).toBe(true);
    }
  });

  it("G2: razão não oferece corte — o motor força total nos dois filhos", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind === "ratio") {
        expect(m.cortes, m.id).toEqual(["total"]);
      }
    }
  });

  it("razão é sempre escalar; leaf é escalar só no total", () => {
    for (const m of ENGINE_METRICS) {
      if (m.measureRef.kind === "ratio") {
        expect(ehEscalar(m, "total"), m.id).toBe(true);
      } else {
        expect(ehEscalar(m, "total"), m.id).toBe(true);
        const naoTotal = m.cortes.find((c) => c !== "total");
        if (naoTotal) expect(ehEscalar(m, naoTotal), `${m.id}/${naoTotal}`).toBe(false);
      }
    }
  });

  it("G6: sem permissão de Ranking, cortes por pessoa somem", () => {
    const receita = ENGINE_BY_ID.get("receita")!;
    const comPermissao = cortesVisiveis(receita, true);
    const semPermissao = cortesVisiveis(receita, false);

    expect(comPermissao).toContain("closer");
    expect(comPermissao).toContain("sdr");
    for (const corte of CORTES_POR_PESSOA) {
      expect(semPermissao).not.toContain(corte);
    }
    // O resto sobrevive — a trava é cirúrgica, não desliga a métrica.
    expect(semPermissao).toContain("total");
    expect(semPermissao).toContain("origem");
  });

  it("G6: métrica sem corte por pessoa não muda com a permissão", () => {
    const leads = ENGINE_BY_ID.get("leads_criados")!;
    expect(cortesVisiveis(leads, false)).toEqual(cortesVisiveis(leads, true));
  });

  it("G6: nenhuma métrica fica sem corte algum quando a trava aplica", () => {
    for (const m of ENGINE_METRICS) {
      expect(cortesVisiveis(m, false).length, m.id).toBeGreaterThan(0);
    }
  });

  // Tripwire deliberado: mexer nestes números é declarar que a oferta mudou.
  // Ele NÃO é a defesa contra oferecer medida que o banco não tem — essa é
  // `filtrarPeloCatalogo`, testada acima. Aqui só se afirma que ninguém
  // acrescentou entrada por acidente.
  it("G1: a oferta de fábrica é 16 medidas + 5 razões", () => {
    const leafs = ENGINE_METRICS.filter((m) => m.measureRef.kind === "leaf");
    const ratios = ENGINE_METRICS.filter((m) => m.measureRef.kind === "ratio");
    expect(leafs).toHaveLength(16);
    expect(ratios).toHaveLength(5);
  });

  it("SCRUM-311: leads_sem_responsavel não oferece corte por pessoa", () => {
    const m = ENGINE_BY_ID.get("leads_sem_responsavel")!;
    expect(m.cortes).not.toContain("closer");
    expect(m.cortes).not.toContain("sdr");
    // Nem série temporal: é estado atual, não contagem de período.
    expect(m.cortes).not.toContain("tempo");
  });
});

describe("engine map — higiene", () => {
  it("não há id duplicado", () => {
    const ids = ENGINE_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo corte usado tem rótulo de UI", () => {
    const usados = new Set<MetricRecorte>(ENGINE_METRICS.flatMap((m) => m.cortes));
    for (const corte of usados) {
      expect(ROTULO_DO_CORTE[corte], corte).toBeTruthy();
    }
  });

  it("toda métrica tem rótulo humano, sem id cru vazando para a tela", () => {
    for (const m of ENGINE_METRICS) {
      expect(m.label.length, m.id).toBeGreaterThan(2);
      expect(m.label).not.toBe(m.id);
    }
  });
});
