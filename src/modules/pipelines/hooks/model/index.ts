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
