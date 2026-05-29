/**
 * Sub-barrel — hooks de **configuração, métricas e regras** dos pipes.
 *
 * Display config (visibilidade por org), métricas agregadas, dispatch rules
 * (sequência de templates), distribution rules (round-robin) e loss reasons.
 *
 * Reexportado pela API pública (`../../index.ts`). Não importe este barrel a
 * partir dos leaves deste grupo — use os arquivos diretamente para evitar ciclos.
 */
export * from "./usePipelineDisplayConfig";
export * from "./usePipeMetrics";
export * from "./usePipeDispatchRules";
export * from "./usePipeDistribution";
export * from "./useLossReasons";
