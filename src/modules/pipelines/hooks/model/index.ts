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
// Disambiguate: usePipelines.ts and usePipelineEntries.ts both export
// `usePipelineEntries`. Public surface = slug-typed version (per module CLAUDE.md).
// Explicit re-export overrides the ambiguous `export *` for dev (esbuild) parity.
export { usePipelineEntries } from "./usePipelineEntries";
export * from "./usePipelineStages";
export * from "./useStageLeadIds";
export * from "./useFilteredLeadIds";
export * from "./useCustomFilteredLeadIds";
