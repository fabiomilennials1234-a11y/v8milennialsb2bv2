/**
 * pipe-ops — porta + context da inversão leads↔pipelines.
 *
 * `pipelines` importa `PipeOpsPort` + `PipeOpsContextProvider` daqui para
 * implementar e injetar. leads consome via `usePipeOps()`.
 */
export type { PipeOpsPort, RescheduleModalSlotProps } from "./PipeOpsPort";
export { PipeOpsContextProvider, usePipeOps } from "./PipeOpsContext";
