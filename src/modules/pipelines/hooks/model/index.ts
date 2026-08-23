/**
 * Sub-barrel — hooks do **modelo novo** de pipelines.
 *
 * Operam `pipeline_entries` + `pipeline_stages` (coluna `stage_id` uuid).
 * Contraste com `../legacy` (views `pipe_*`, coluna `status` slug).
 *
 * Reexportado pela API pública do módulo (`../../index.ts`). Não importe este
 * barrel a partir dos leaves deste grupo — use os arquivos diretamente para
 * evitar ciclos.
 */
export * from "./usePipelines";
export * from "./usePipelineEntries";
export * from "./usePipelineStages";
export * from "./useStageLeadIds";
export * from "./useFilteredLeadIds";
export * from "./useCustomFilteredLeadIds";
export * from "./useAllFunnelsLeadIds";

// `usePipelineEntries` existe em ./usePipelines (versão por pipelineId) e em
// ./usePipelineEntries (versão slug-typed). O conflito entre os dois `export *`
// acima torna o nome ambíguo — o esbuild (dev server / Vite) falha o build com
// "Ambiguous import has multiple matching exports". Este re-export nomeado
// explícito tem precedência sobre os `export *` e fixa a versão pública como a
// slug-typed (intenção documentada no CLAUDE.md do módulo). A versão por
// pipelineId continua acessível via deep-import de ./usePipelines.
export { usePipelineEntries } from "./usePipelineEntries";

// SCRUM-388 — etapas de um funil, sistema ou custom, sem quem chama precisar
// saber em qual tabela elas moram.
export { useEtapasDoFunil } from "./useEtapasDoFunil";
export type { EtapaDoFunil } from "./useEtapasDoFunil";
