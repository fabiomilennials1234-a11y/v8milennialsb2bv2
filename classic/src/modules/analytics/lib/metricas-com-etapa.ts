import type { MetricTreeNode } from "@/modules/analytics/lib/metric-tree";

/**
 * As medidas que só respondem depois de o usuário escolher DUAS etapas
 * (SCRUM-316 / SCRUM-388).
 *
 * Elas existem no motor desde a migration `20270821120000` e estão
 * DELIBERADAMENTE fora de `ENGINE_METRICS`: a lista lateral só sabe declarar
 * filtro fixo, e `stage_key` é slug do funil de CADA organização — não existe
 * valor que sirva para todas. Listadas lá, apareceriam na barra e levantariam
 * 22023 ao serem soltas no painel: pior que ausentes, porque prometem número e
 * entregam erro.
 *
 * O caminho delas é a métrica PERSONALIZADA, cuja folha aceita `filters`. Este
 * arquivo é a ponte: diz quais medidas exigem etapa, para o compositor pedir as
 * duas antes de deixar salvar.
 */

export interface MedidaComEtapa {
  id: string;
  label: string;
  /** Uma linha explicando o que a medida conta, para o compositor. */
  ajuda: string;
}

export const MEDIDAS_COM_ETAPA: MedidaComEtapa[] = [
  {
    id: "negocios_coorte_origem",
    label: "Chegaram à etapa de origem",
    ajuda: "Negócios que chegaram à primeira etapa dentro do período — a coorte.",
  },
  {
    id: "negocios_coorte_convertidos",
    label: "Chegaram à etapa de destino",
    ajuda: "Da coorte, os que alcançaram a segunda etapa — inclusive fora do período.",
  },
  {
    id: "negocios_coorte_em_aberto",
    label: "Ainda sem desfecho",
    ajuda: "Da coorte, os que não chegaram ao destino nem tiveram desfecho. É a maturação.",
  },
];

export const IDS_COM_ETAPA = new Set(MEDIDAS_COM_ETAPA.map((m) => m.id));

/** Esta medida precisa que o usuário escolha funil e as duas etapas? */
export function exigeEtapas(measureId: string): boolean {
  return IDS_COM_ETAPA.has(measureId);
}

/**
 * A árvore tem alguma folha que exige etapa e ainda não recebeu as duas?
 *
 * É o que trava a prévia e o salvar. Deixar passar produziria uma definição
 * salva que levanta 22023 toda vez que alguém abrir — erro que o cliente vê e
 * não sabe consertar.
 */
export function faltamEtapas(node: MetricTreeNode): boolean {
  if (node.type === "measure") {
    if (!exigeEtapas(node.id)) return false;
    const f = node.filters;
    return !f?.pipeline_id || !f?.from_stage_key || !f?.to_stage_key;
  }
  if (node.type === "op") return faltamEtapas(node.left) || faltamEtapas(node.right);
  return false;
}
