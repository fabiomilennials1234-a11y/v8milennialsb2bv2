/**
 * Mapa StudioMetric → motor (SCRUM-310, épico #1194 · ADR-0023).
 *
 * O catálogo do Estúdio (`metrics-studio-catalog.ts`) é o INVENTÁRIO das 29
 * métricas do roadmap, com o estado de cada uma. Este arquivo é outra coisa: a
 * lista do que o motor realmente calcula, e como.
 *
 * Decisões do grill de 2026-08-11 que moldam este arquivo
 * (`.specs/features/metricas-v2/SPEC.md` §1.7):
 *
 *   G1 — a UI mostra SÓ o que tem número real. Métrica fora deste mapa não
 *        aparece na lista lateral; nada de amostra na frente do cliente.
 *   G2 — o corte é escolha do usuário, não atributo da métrica. Por isso
 *        `cortes[]` em vez de um `recorte` fixo, e por isso "Receita por
 *        origem" deixa de ser item próprio: é Faturamento com corte `origem`.
 *   G3 — vela sai. Nenhum binding oferece OHLC porque o motor não tem.
 *   G6 — cortes por pessoa (closer/sdr) exigem a permissão do Ranking.
 *
 * As duas linguagens NÃO se traduzem por semelhança de nome:
 * `taxa_conversao` e `ticket_medio` são RAZÕES, não medidas.
 *
 * ⚠ Só entra aqui o que o motor calcula. Medido em 2026-08-11: o catálogo de
 * PROD tem 7 medidas. As outras chegam pelas migrations do SCRUM-311, e a UI só
 * as mostra depois do apply — cada uma some sozinha da tela enquanto a sua
 * migration não estiver aplicada, porque o motor levanta 22023 e a janela cai.
 *
 * `reunioes_no_show` NÃO vem de `20260727140000` (aquela nunca foi aplicada e
 * NÃO PODE ser: reescreve `_metric_leaf` com o CASE de 8 medidas e apaga o
 * roteamento das 16). Vem de `20270812120000`, que absorveu as duas metades no
 * despachante vigente.
 *
 * `meta_definida` continua fora: alvo é CAMPO do payload (`target`), não medida,
 * e o motor só compõe razão entre dois ids do catálogo (SCRUM-365).
 */

import type { MeasureRef } from "@/modules/analytics/hooks/useMetricMeasure";
// `metric-tree` é folha e só importa `metric-vocabulary` — a aresta daqui para
// lá não fecha ciclo.
import type { MetricTreeNode } from "@/modules/analytics/lib/metric-tree";
import type {
  MetricFilters,
  MetricFormatId,
  MetricRecorte,
  MetricUnit,
} from "@/modules/analytics/lib/metric-vocabulary";

// Os três tipos passaram a morar em `lib/metric-vocabulary` (módulo folha) para
// que `metric-tree` possa usá-los sem fechar ciclo com este arquivo. Continuam
// re-exportados daqui: nenhum consumidor precisou mudar de import.
export type { MetricFormatId, MetricRecorte };

/**
 * Cortes que expõem número por PESSOA. G6: só aparecem para quem já tem acesso
 * ao Ranking — a mesma regra que hoje governa `/performance`.
 */
export const CORTES_POR_PESSOA: MetricRecorte[] = ["closer", "sdr"];

/** Rótulo de UI por corte. Linguagem de produto, não do banco. */
export const ROTULO_DO_CORTE: Record<MetricRecorte, string> = {
  total: "Total",
  tempo: "Por dia",
  origem: "Por origem",
  closer: "Por closer",
  sdr: "Por SDR",
  tag: "Por tag",
  produto: "Por produto",
  stream: "Por tipo de negócio",
  pipeline: "Por funil",
  etapa: "Por etapa",
  desfecho: "Ganho x perda",
};

export interface EngineMetric {
  /** Id do StudioMetric correspondente, quando existe no inventário. */
  id: string;
  label: string;
  measureRef: MeasureRef;
  /**
   * Cortes que o motor aceita para esta métrica, na ordem em que aparecem na
   * UI. O primeiro é o default da janela.
   *
   * Razão ignora corte — o motor força `total` nos dois filhos —, então razão
   * declara `["total"]` e a UI não mostra o seletor.
   */
  cortes: MetricRecorte[];
  formatId: MetricFormatId;
  filtrosFixos?: MetricFilters;
}

/**
 * Compatibilidade medida × recorte, conferida contra `metric_catalog_measure_recortes`
 * em PROD (2026-08-11) linha a linha. Par ausente = `EXCEPTION 22023` no motor,
 * que NÃO é capturado por `isMissingSchemaError` e derruba a janela.
 *
 * `tempo_medio_etapa` é a única medida SEM `total`.
 */
export const COMPATIBILIDADE: Record<string, MetricRecorte[]> = {
  receita: ["total", "closer", "sdr", "origem", "tag", "stream", "pipeline", "tempo"],
  num_vendas: ["total", "closer", "sdr", "origem", "tag", "stream", "pipeline", "tempo"],
  leads_criados: ["total", "origem", "produto", "tag", "tempo"],
  reunioes_marcadas: ["total", "sdr", "origem", "tag", "tempo"],
  reunioes_realizadas: ["total", "sdr", "origem", "tag", "tempo"],
  leads_na_etapa: ["total", "pipeline", "etapa"],
  tempo_medio_etapa: ["etapa", "pipeline"],
  // SCRUM-311 fatia 1. Sem 'tempo' (é estado, não série) e sem corte por
  // pessoa ("sem dono por vendedor" é contradição).
  leads_sem_responsavel: ["total", "origem", "tag"],
  // SCRUM-311 fatias 2-8 — portadas para o motor pela pilha, e até aqui
  // INVISÍVEIS na tela: catálogo tem a medida, a lista lateral não a oferecia.
  leads_avaliados: ["total", "origem", "tag", "produto", "tempo"],
  leads_nao_avaliados: ["total", "origem", "tag", "produto", "tempo"],
  boas_avaliacoes: ["total", "origem", "tag", "produto", "tempo"],
  negocios_perdidos: ["total", "closer", "origem", "pipeline", "tempo"],
  tempo_resposta_equipe: ["total", "origem", "tempo"],
  reunioes_no_show: ["total", "sdr", "origem", "tempo"],
  // SCRUM-311 fatia 9 — a unidade do funil é o NEGÓCIO (ADR-0023).
  negocios_na_etapa: ["total", "pipeline", "etapa"],
  negocios_abertos: ["total", "tempo", "origem", "pipeline", "etapa"],
  // SCRUM-391 fatia funil. Sem `total` de proposito: somar ganho com perda da
  // um numero que nao responde pergunta nenhuma.
  ganho_perda: ["desfecho"],
  // SCRUM-422. Mesmos recortes de num_vendas: e a mesma consulta com um
  // predicado a mais.
  num_vendas_pre_venda: ["total", "closer", "sdr", "origem", "tag", "stream", "pipeline", "tempo"],
  // SCRUM-417. Só `total`: recortar LTV dividiria a receita de um balde pelo
  // denominador de outro — número plausível e errado.
  ltv: ["total"],
};

/** Formato único por medida, de `metric_catalog_measure_formats` em prod. */
export const FORMATO_DA_MEDIDA: Record<string, MetricFormatId> = {
  receita: "currency_brl",
  num_vendas: "integer",
  leads_criados: "integer",
  reunioes_marcadas: "integer",
  reunioes_realizadas: "integer",
  leads_na_etapa: "integer",
  tempo_medio_etapa: "duration_human",
  leads_sem_responsavel: "integer",
  leads_avaliados: "integer",
  leads_nao_avaliados: "integer",
  boas_avaliacoes: "integer",
  negocios_perdidos: "integer",
  reunioes_no_show: "integer",
  tempo_resposta_equipe: "duration_human",
  negocios_na_etapa: "integer",
  negocios_abertos: "integer",
  ganho_perda: "integer",
  num_vendas_pre_venda: "integer",
  ltv: "currency_brl",
};

/**
 * Unidade por medida, de `metric_catalog_measures.unit` em prod.
 *
 * A árvore personalizada precisa da UNIDADE, não do formato: é dela que sai a
 * derivação de `receita ÷ leads → currency`. O compositor lê daqui para dizer
 * "essa conta não fecha" antes de o banco dizer.
 */
export const UNIDADE_DA_MEDIDA: Record<string, MetricUnit> = {
  receita: "currency",
  num_vendas: "count",
  leads_criados: "count",
  reunioes_marcadas: "count",
  reunioes_realizadas: "count",
  leads_na_etapa: "count",
  tempo_medio_etapa: "duration_seconds",
  leads_sem_responsavel: "count",
  leads_avaliados: "count",
  leads_nao_avaliados: "count",
  boas_avaliacoes: "count",
  negocios_perdidos: "count",
  reunioes_no_show: "count",
  tempo_resposta_equipe: "duration_seconds",
  negocios_na_etapa: "count",
  negocios_abertos: "count",
  ganho_perda: "count",
  num_vendas_pre_venda: "count",
  ltv: "currency",
};

/**
 * O que o Estúdio oferece de FÁBRICA: 16 medidas + 5 razões.
 *
 * As personalizadas do cliente NÃO entram nesta constante — elas vêm do banco
 * (`metric_custom_definitions`) e são juntadas em runtime por
 * `useStudioCatalog`. Esta lista é o que o motor calcula sem ninguém compor.
 *
 * Fora daqui, com o motivo:
 *   - `meta_definida` → alvo é campo do payload, não medida (SCRUM-365)
 *   - `curva_abc`, `taxa_resposta_automacao` → não existem
 *   - as demais do inventário → vivem em hook legado (SCRUM-311 as porta)
 */
export const ENGINE_METRICS: EngineMetric[] = [
  {
    id: "receita",
    label: "Faturamento",
    measureRef: { kind: "leaf", id: "receita" },
    cortes: ["total", "tempo", "origem", "closer", "sdr", "pipeline", "tag", "stream"],
    formatId: "currency_brl",
  },
  {
    id: "num_vendas",
    label: "Nº de vendas",
    measureRef: { kind: "leaf", id: "num_vendas" },
    cortes: ["total", "tempo", "origem", "closer", "sdr", "pipeline", "tag", "stream"],
    formatId: "integer",
  },
  {
    id: "leads_criados",
    label: "Leads que entraram",
    measureRef: { kind: "leaf", id: "leads_criados" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    id: "reunioes_marcadas",
    label: "Reuniões marcadas",
    measureRef: { kind: "leaf", id: "reunioes_marcadas" },
    cortes: ["total", "tempo", "origem", "sdr", "tag"],
    formatId: "integer",
  },
  {
    id: "reunioes_realizadas",
    label: "Reuniões comparecidas",
    measureRef: { kind: "leaf", id: "reunioes_realizadas" },
    cortes: ["total", "tempo", "origem", "sdr", "tag"],
    formatId: "integer",
  },
  // SCRUM-311 fatia 9 — LEAD ≠ NEGÓCIO, e a janela salva não muda de id.
  //
  // Este item já se chamava "Negócios na etapa" na tela, mas apontava para
  // `leads_na_etapa`, que conta ENTRADA. Medido em prod (2026-08-12): 41.025
  // entradas para 36.073 leads distintos — 12% de diferença que ninguém via. O
  // `id` do StudioMetric fica: painel salvo referencia `negocios_por_etapa` e
  // continua abrindo. O que muda é para onde ele aponta.
  {
    id: "negocios_por_etapa",
    label: "Negócios na etapa",
    measureRef: { kind: "leaf", id: "negocios_na_etapa" },
    cortes: ["total", "etapa", "pipeline"],
    formatId: "integer",
  },
  {
    // A outra metade da separação: pessoa distinta. Um lead com 3 negócios
    // conta 1 aqui e 3 acima — e é isso que o E2E do lead com dois negócios
    // prova.
    id: "leads_na_etapa",
    label: "Leads na etapa",
    measureRef: { kind: "leaf", id: "leads_na_etapa" },
    cortes: ["total", "etapa", "pipeline"],
    formatId: "integer",
  },
  {
    id: "negocios_abertos",
    label: "Negócios abertos",
    measureRef: { kind: "leaf", id: "negocios_abertos" },
    cortes: ["total", "tempo", "origem", "pipeline", "etapa"],
    formatId: "integer",
  },
  {
    id: "leads_sem_responsavel",
    label: "Leads sem responsável",
    measureRef: { kind: "leaf", id: "leads_sem_responsavel" },
    cortes: ["total", "origem", "tag"],
    formatId: "integer",
  },
  {
    id: "tempo_medio_etapa",
    label: "Tempo médio na etapa",
    measureRef: { kind: "leaf", id: "tempo_medio_etapa" },
    // Sem 'total': o catálogo de prod não aceita. Default vira 'etapa'.
    cortes: ["etapa", "pipeline"],
    formatId: "duration_human",
  },

  // SCRUM-311 fatias 2-8 — o motor já as calcula desde a pilha do épico; até
  // aqui nenhuma aparecia na lista lateral, o que é o mesmo que não existir
  // para quem usa o produto.
  {
    id: "negocios_perdidos",
    label: "Negócios perdidos",
    measureRef: { kind: "leaf", id: "negocios_perdidos" },
    cortes: ["total", "tempo", "origem", "closer", "pipeline"],
    formatId: "integer",
  },
  {
    id: "leads_avaliados",
    label: "Leads avaliados",
    measureRef: { kind: "leaf", id: "leads_avaliados" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    id: "leads_nao_avaliados",
    label: "Leads não avaliados",
    measureRef: { kind: "leaf", id: "leads_nao_avaliados" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    id: "boas_avaliacoes",
    label: "Boas avaliações",
    measureRef: { kind: "leaf", id: "boas_avaliacoes" },
    cortes: ["total", "tempo", "origem", "tag", "produto"],
    formatId: "integer",
  },
  {
    // O rótulo diz REGISTRO, não comparecimento — medido em prod: 627 marcadas
    // × 159 comparecidas, e o cliente não falta a 3 de cada 4 reuniões. A
    // medida enxerga a lacuna de registro, e o nome não pode prometer outra
    // coisa (ver o cabeçalho de 20270812120000).
    id: "reunioes_no_show",
    label: "Reuniões sem comparecimento registrado",
    measureRef: { kind: "leaf", id: "reunioes_no_show" },
    cortes: ["total", "tempo", "origem", "sdr"],
    formatId: "integer",
  },
  {
    id: "tempo_resposta_equipe",
    label: "Tempo médio de resposta",
    measureRef: { kind: "leaf", id: "tempo_resposta_equipe" },
    cortes: ["total", "tempo", "origem"],
    formatId: "duration_human",
  },

  // Razões: profundidade 1, dois filhos, ambos forçados a 'total' pelo motor.
  // `series` vem SEMPRE null — a UI não oferece corte nem gráfico de série.
  {
    // Renomeada na fatia 9: o denominador é LEAD, e sob a unidade nova isso
    // precisa estar no rótulo. Um lead com 3 negócios entra UMA vez aqui e pode
    // ganhar TRÊS — a taxa passa de 100% e não é defeito, é a pergunta que ela
    // responde. Quem quer conversão na unidade do funil usa a de baixo.
    id: "taxa_conversao",
    label: "Taxa de conversão por lead",
    measureRef: { kind: "ratio", num: "num_vendas", den: "leads_criados" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    id: "taxa_conversao_negocio",
    label: "Taxa de conversão por negócio",
    measureRef: { kind: "ratio", num: "num_vendas", den: "negocios_abertos" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    id: "comparecimento",
    label: "Taxa de comparecimento",
    measureRef: { kind: "ratio", num: "reunioes_realizadas", den: "reunioes_marcadas" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    id: "ticket_medio",
    label: "Ticket médio",
    measureRef: { kind: "ratio", num: "receita", den: "num_vendas" },
    cortes: ["total"],
    formatId: "currency_brl",
  },
  {
    // SCRUM-311 fatia 7. Os dois filhos ancoram em `entradas` e o numerador é
    // subconjunto do denominador — a razão vive em [0, 100] por construção.
    id: "taxa_qualidade",
    label: "Taxa de qualidade de leads",
    measureRef: { kind: "ratio", num: "boas_avaliacoes", den: "leads_avaliados" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    // SCRUM-417 — a decisão do SCRUM-365: receita REALIZADA por cliente, numa
    // janela própria de 12 meses ancorada no fim do período escolhido.
    //
    // Trocar o seletor de "este mês" para "este ano" mexe pouco neste número, e
    // é assim que tem que ser: LTV de um mês não existe.
    id: "ltv",
    label: "LTV do cliente",
    measureRef: { kind: "leaf", id: "ltv" },
    cortes: ["total"],
    formatId: "currency_brl",
  },
  {
    // SCRUM-422 — a taxa que o SCRUM-393 definiu: venda com pré-venda sobre o
    // total de vendas.
    //
    // Os dois filhos são `count`, e AQUI o ×100 do ramo `ratio` é o certo:
    // taxa É percentual. Em `negocios_por_lead` a mesma derivação seria o erro
    // de 100× — a diferença não é técnica, é semântica.
    //
    // O numerador é subconjunto do denominador por construção, então a razão
    // vive em [0, 100] sem trava. Mesma disciplina de `taxa_qualidade`.
    id: "taxa_pre_venda",
    label: "Vendas com pré-venda",
    measureRef: { kind: "ratio", num: "num_vendas_pre_venda", den: "num_vendas" },
    cortes: ["total"],
    formatId: "percent_1",
  },
  {
    // SCRUM-391 fatia funil. A medida é COMPOSIÇÃO: o motor chama as mesmas
    // funções de `num_vendas` e `negocios_perdidos` em vez de recontar, então
    // os três números batem por construção.
    //
    // A OUTRA metade do card não virou entrada nenhuma: "Negócios por funil" é
    // `negocios_por_etapa` com corte `pipeline` (decisão G2), e já está aqui.
    id: "ganho_perda",
    label: "Ganho e perda",
    measureRef: { kind: "leaf", id: "ganho_perda" },
    cortes: ["desfecho"],
    formatId: "integer",
  },
  {
    // SCRUM-392 — e o ponto inteiro da fatia é o que ela NÃO é.
    //
    // O inventário declara `negocios_por_lead` com `unit: "ratio"`, e a
    // tentação é escrever `kind: "ratio"`. Não pode: o ramo `ratio` do motor
    // deriva `count ÷ count` como PERCENT e multiplica por 100, enquanto o
    // front só sufixa "%" sem multiplicar. Declarada assim, "1,35 negócios por
    // lead" imprime "135%" — erro de 100× que nenhum teste de tipo pega.
    //
    // A árvore da Emenda 1 deriva `count ÷ count` como RAZÃO e nunca
    // multiplica (asserção UN1 de `metric_custom_tree_test.sql`). Por isso
    // `kind: "tree"`, e por isso o formato é `ratio_2`.
    //
    // Zero migration: os dois operandos já estão no motor, e os dois ancoram em
    // `entradas` — aberturas de negócio na janela sobre leads que entraram na
    // mesma janela. Dividir estoque por fluxo daria um número que muda quando
    // alguém arrasta um card, e é justamente o que `negocios_na_etapa`
    // (âncora `hoje`) seria aqui.
    id: "negocios_por_lead",
    label: "Negócios por lead",
    measureRef: {
      kind: "tree",
      tree: {
        type: "op",
        op: "div",
        left: { type: "measure", id: "negocios_abertos" },
        right: { type: "measure", id: "leads_criados" },
      },
      format_id: "ratio_2",
    },
    cortes: ["total"],
    formatId: "ratio_2",
  },
  // ⚠ `conversao_entre_etapas` (SCRUM-316, migration 20270821120000) EXISTE no
  // motor e está DELIBERADAMENTE FORA desta lista. Não adicione.
  //
  // Ela exige os filtros `from_stage_key` e `to_stage_key`, e esta lista só sabe
  // declarar `filtrosFixos` ESTÁTICOS — mas `stage_key` é slug do funil de CADA
  // org, então não existe valor que sirva para todas. Listada aqui, apareceria
  // na barra lateral e levantaria 22023 ao ser solta no painel: pior que
  // ausente, porque promete um número e entrega erro.
  //
  // O caminho dela é a MÉTRICA PERSONALIZADA, cuja folha já aceita `filters`
  // (`MetricTreeNode`) e cujo validador já os confere (`CHAVES_DE_FILTRO`). O
  // que falta é o `MetricComposer` expor a escolha das duas etapas — fatia
  // própria, porque precisa listar as etapas do funil escolhido.
];

export const ENGINE_BY_ID = new Map(ENGINE_METRICS.map((m) => [m.id, m]));

/**
 * Ids de medida referenciados (1 para leaf, 2 para razão).
 *
 * Personalizada devolve lista vazia: os operandos dela vivem na árvore, do lado
 * do banco, e quem precisa deles é o compositor — não este mapa.
 */
export function medidasDe(m: EngineMetric): string[] {
  if (m.measureRef.kind === "leaf") return [m.measureRef.id];
  if (m.measureRef.kind === "ratio") return [m.measureRef.num, m.measureRef.den];
  // Árvore DE FÁBRICA (SCRUM-392): os operandos são escritos aqui, neste
  // arquivo, e não foram validados contra catálogo nenhum na escrita — ao
  // contrário da personalizada, que passa pelo trigger do banco. Então eles
  // precisam ser conferidos como os de qualquer outra: devolvê-los é o que
  // permite a `filtrarPeloCatalogo` esconder a métrica na org onde a migration
  // do operando ainda não rodou, em vez de oferecer uma janela que levanta
  // 22023 ao ser solta no painel.
  if (m.measureRef.kind === "tree") return folhasDaArvore(m.measureRef.tree);
  return [];
}

/** Ids de medida nas folhas da árvore, em ordem de leitura. */
function folhasDaArvore(node: MetricTreeNode): string[] {
  if (node.type === "measure") return [node.id];
  if (node.type === "op") return [...folhasDaArvore(node.left), ...folhasDaArvore(node.right)];
  return []; // literal
}

/**
 * Razão e personalizada são SEMPRE escalares — o motor devolve `series: null`
 * nas duas. Leaf é escalar só no corte `total`.
 */
export function ehEscalar(m: EngineMetric, corte: MetricRecorte): boolean {
  return m.measureRef.kind !== "leaf" || corte === "total";
}

/**
 * Cortes que ESTE usuário pode escolher. G6: corte por pessoa depende da
 * permissão do Ranking.
 */
export function cortesVisiveis(m: EngineMetric, podeVerPorPessoa: boolean): MetricRecorte[] {
  if (podeVerPorPessoa) return m.cortes;
  return m.cortes.filter((c) => !CORTES_POR_PESSOA.includes(c));
}

/**
 * Guarda de runtime do par (medida, corte). Razão ignora o corte — o motor
 * força `total` nos filhos —, então a checagem vale só para leaf.
 */
export function parEhCompativel(m: EngineMetric, corte: MetricRecorte): boolean {
  if (m.measureRef.kind !== "leaf") return true;
  return COMPATIBILIDADE[m.measureRef.id]?.includes(corte) ?? false;
}

/**
 * O que ESTE banco realmente calcula, dentre o que o código sabe desenhar.
 *
 * ⚠ Existe porque a lista de cima é ESTÁTICA e o catálogo do motor é DADO: cada
 * medida chega por uma migration própria, e as migrations do SCRUM-311 não
 * estão todas em todo ambiente. Oferecer na lista lateral uma medida que o
 * banco-alvo não tem faz `fn_metric_measure` levantar `EXCEPTION 22023` — que
 * `isMissingSchemaError` NÃO captura e que derruba a janela inteira, com a
 * pessoa achando que quebrou o produto.
 *
 * Antes disto, um teste unitário congelava a lista contra um retrato do
 * catálogo de prod. Aquilo funcionava como aviso, não como defesa: passava a
 * reprovar toda vez que uma fatia nova entrava, e não protegia ambiente nenhum
 * em runtime. Aqui quem decide o que aparece é o próprio banco.
 *
 * FALHA PARA FECHADO. Catálogo vazio (RPC ausente, deploy pela metade) devolve
 * lista vazia em vez da lista estática — mesma escolha da trava de rollout do
 * Estúdio: não oferecer é melhor que oferecer e quebrar.
 *
 * Filtra também os CORTES, pela compatibilidade que o banco declara. A tabela
 * `COMPATIBILIDADE` deste arquivo é uma cópia conferida à mão; a do banco é a
 * fonte.
 */
export function filtrarPeloCatalogo(
  metrics: EngineMetric[],
  catalogo: { measures: { id: string; compatible_recortes?: string[] }[] },
): EngineMetric[] {
  const disponiveis = new Map(
    catalogo.measures.map((m) => [m.id, new Set(m.compatible_recortes ?? [])]),
  );
  if (disponiveis.size === 0) return [];

  return metrics.flatMap((m) => {
    // Personalizada não passa por aqui: a árvore dela já foi validada contra o
    // catálogo na escrita E é revalidada em runtime pelo motor.
    //
    // Árvore DE FÁBRICA passa (SCRUM-392): ela é escrita neste arquivo e não
    // encosta em trigger nenhum, então os operandos dela têm que ser conferidos
    // como os de qualquer outra medida. Antes desta linha, `kind: "tree"` era
    // tratado junto de `custom` e escapava da checagem — e a primeira árvore de
    // fábrica teria aparecido na lista lateral de TODA org, inclusive as que
    // ainda não têm a migration do operando, prometendo número e entregando
    // 22023.
    if (m.measureRef.kind === "custom") return [m];

    const medidas = medidasDe(m);
    if (!medidas.every((id) => disponiveis.has(id))) return [];

    // Razão e árvore ignoram corte — o motor força `total` nos filhos.
    if (m.measureRef.kind === "ratio" || m.measureRef.kind === "tree") return [m];

    const aceitos = disponiveis.get(m.measureRef.id)!;
    const cortes = m.cortes.filter((c) => aceitos.has(c));
    // Medida sem NENHUM corte aceito não tem como ser aberta.
    return cortes.length === 0 ? [] : [{ ...m, cortes }];
  });
}
