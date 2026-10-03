/**
 * useLeadPipeState — fachada sobre useLeadAllPipelines + mutations.
 *
 * Onda 3.1, C11. Agrupa query + mutations de pipeline em uma API coesa.
 * NÃO reimplementa lógica — delega para os hooks existentes.
 */

export {
  useLeadAllPipelines,
  useAddLeadToStandardPipe,
  useMoveLeadInStandardPipe,
  useRemoveLeadFromStandardPipe,
  type PipelineStatus,
  type StandardPipelineStatus,
  type CustomPipelineStatus,
} from "../useLeadAllPipelines";

// Mutations de custom-pipe (add/move/remove) movidas para trás do PipeOpsPort
// (inversão F7). Consumir via `usePipeOps()` na render tree — não re-exportar
// hooks aqui (quebraria a injeção e recriaria o edge leads→pipelines).
