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
  // SCRUM-391 — fatia funil (20270821170000). COMPÕE num_vendas e
  // negocios_perdidos; não é conta nova.
  "ganho_perda",
  // SCRUM-422 — vendas com pré-venda (20270821190000)
  "num_vendas_pre_venda",
  // SCRUM-417 — LTV (20270821200000)
  "ltv",
  // SCRUM-419 — clientes sem resposta (20270821210000)
  "clientes_sem_resposta",
  // SCRUM-421 — as duas metades da taxa por automação (20270821220000)
  "disparos_entregues",
  "disparos_respondidos",
  // SCRUM-420 — clientes sem atuação (20270821230000)
  "clientes_sem_atuacao",
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
  it("G1: a oferta de fábrica é 22 medidas + 7 razões + 1 árvore", () => {
    // O número sobe a cada fatia do SCRUM-311, e é isso que ele serve para
    // dizer: medida nova sem passar por aqui é medida que ninguém contou.
    const leafs = ENGINE_METRICS.filter((m) => m.measureRef.kind === "leaf");
    const ratios = ENGINE_METRICS.filter((m) => m.measureRef.kind === "ratio");
    const trees = ENGINE_METRICS.filter((m) => m.measureRef.kind === "tree");
    expect(leafs).toHaveLength(22);
    expect(ratios).toHaveLength(7);
    expect(trees).toHaveLength(1);
  });

  it("SCRUM-311: leads_sem_responsavel não oferece corte por pessoa", () => {
    const m = ENGINE_BY_ID.get("leads_sem_responsavel")!;
    expect(m.cortes).not.toContain("closer");
    expect(m.cortes).not.toContain("sdr");
    // Nem série temporal: é estado atual, não contagem de período.
    expect(m.cortes).not.toContain("tempo");
  });
});

describe("negócios por lead — a armadilha de 100× (SCRUM-392)", () => {
  const npl = ENGINE_BY_ID.get("negocios_por_lead")!;

  it("é ÁRVORE, nunca kind=ratio — é aqui que o erro de 100× morre", () => {
    // `kind: "ratio"` faria o motor derivar count ÷ count como PERCENT e
    // multiplicar por 100, enquanto o front só sufixa "%": "1,35 negócios por
    // lead" viraria "135%". A árvore deriva RAZÃO e não multiplica.
    expect(npl.measureRef.kind).toBe("tree");
    expect(npl.formatId).toBe("ratio_2");
    expect(npl.formatId).not.toBe("percent_1");
  });

  it("divide aberturas de negócio por leads da MESMA janela", () => {
    expect(medidasDe(npl)).toEqual(["negocios_abertos", "leads_criados"]);
    // `negocios_na_etapa` é estoque (âncora `hoje`): dividido por um fluxo,
    // daria um número que muda quando alguém arrasta um card.
    expect(medidasDe(npl)).not.toContain("negocios_na_etapa");
  });

  it("é escalar e não oferece corte além de total", () => {
    expect(npl.cortes).toEqual(["total"]);
    expect(ehEscalar(npl, "total")).toBe(true);
  });

  it("some da lista quando o banco-alvo não tem UM dos operandos", () => {
    // Árvore de fábrica é escrita no código e não passa por trigger nenhum —
    // sem esta checagem ela apareceria em TODA org, inclusive as que ainda não
    // têm a migration de `negocios_abertos`, prometendo número e dando 22023.
    const semNegocios = {
      measures: [{ id: "leads_criados", compatible_recortes: ["total"] }],
    };
    expect(
      filtrarPeloCatalogo(ENGINE_METRICS, semNegocios).map((m) => m.id),
    ).not.toContain("negocios_por_lead");

    const comOsDois = {
      measures: [
        { id: "leads_criados", compatible_recortes: ["total"] },
        { id: "negocios_abertos", compatible_recortes: ["total"] },
      ],
    };
    expect(
      filtrarPeloCatalogo(ENGINE_METRICS, comOsDois).map((m) => m.id),
    ).toContain("negocios_por_lead");
  });

  it("personalizada continua passando sem checagem de catálogo", () => {
    // A distinção que a fatia introduziu: `custom` é validada na escrita pelo
    // banco; `tree` de fábrica, não. Se as duas voltarem a ser tratadas juntas,
    // este caso continua verde e o de cima fica vermelho — que é a ordem certa.
    const daCliente = {
      id: "minha_metrica",
      label: "Minha métrica",
      measureRef: { kind: "custom" as const, id: "abc" },
      cortes: ["total"] as MetricRecorte[],
      formatId: "ratio_2" as const,
    };
    const catalogoVazioDeOperandos = {
      measures: [{ id: "receita", compatible_recortes: ["total"] }],
    };
    expect(
      filtrarPeloCatalogo([daCliente], catalogoVazioDeOperandos).map((m) => m.id),
    ).toEqual(["minha_metrica"]);
  });
});

describe("família origem — é CORTE, não medida (SCRUM-390 / G2)", () => {
  // "Receita por origem" é Faturamento com corte `origem`; "Ranking de origem"
  // é Leads que entraram (e Nº de vendas) com o mesmo corte. Se alguém tirar o
  // corte dessas medidas, a família origem some da tela — e some em silêncio,
  // porque nada no inventário aponta para cá.
  it.each(["receita", "num_vendas", "leads_criados"])(
    "%s oferece o corte origem",
    (id) => {
      const m = ENGINE_BY_ID.get(id)!;
      expect(m.cortes).toContain("origem");
      expect(parEhCompativel(m, "origem")).toBe(true);
    },
  );

  it("nenhuma medida DE RECEITA por origem foi criada em paralelo", () => {
    // Uma segunda soma de dinheiro é uma segunda verdade sobre dinheiro
    // (ADR-0017 §1), e `receita` já tem consumidor legado.
    const ids = ENGINE_METRICS.map((m) => m.id);
    expect(ids).not.toContain("receita_por_origem");
    expect(ids).not.toContain("ranking_origem");
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
