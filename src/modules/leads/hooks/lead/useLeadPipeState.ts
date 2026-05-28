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

export {
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
} from "@/modules/pipelines/hooks/useCustomPipelines";
