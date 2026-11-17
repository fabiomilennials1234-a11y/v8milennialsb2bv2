/**
 * API pública estreita: a lista de funis para o diálogo de agendamento.
 *
 * Existe porque o barrel de `@/modules/pipelines` carrega o módulo todo, e o
 * diálogo de agendamento só precisa dos funis para um seletor. Pelo barrel ele
 * entrava no ciclo pipelines → leads → chat → engagement que o dep-cruiser já
 * conta; por aqui o grafo não cresce.
 */
export { usePipelines } from "./hooks/model/usePipelines";
export { isPipelineVisible, sortPipelinesForNavigation } from "./lib/pipeline-navigation";
