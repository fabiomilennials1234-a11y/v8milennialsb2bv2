/**
 * Sub-barrel — hooks de **pipelines customizados** + funis temporários.
 *
 * `custom_pipelines` / `custom_pipe_entries` + membros (metas, achieved).
 *
 * Reexportado pela API pública (`../../index.ts`). Não importe este barrel a
 * partir dos leaves deste grupo — use os arquivos diretamente para evitar ciclos.
 */
export * from "./useCustomPipelines";
export * from "./useCustomPipelineMembers";
