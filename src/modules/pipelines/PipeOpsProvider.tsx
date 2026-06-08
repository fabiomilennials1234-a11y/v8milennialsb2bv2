/**
 * PipeOpsProvider — implementação de PipeOpsPort (inversão leads↔pipelines).
 *
 * Esta é a ÚNICA direção de import permitida pós-inversão: `pipelines → leads`
 * (importa a abstração `PipeOpsPort` + o injetor `PipeOpsContextProvider`).
 * Monta-se no App acima das rotas; leads consome via `usePipeOps()`.
 *
 * O port é um objeto de hooks reais + slots de componente. leads chama
 * `port.useX()` na própria render tree — realtime/queryKeys/invalidação
 * preservados (zero mudança de comportamento).
 */
import { type ReactNode, useMemo } from "react";
import { PipeOpsContextProvider, type PipeOpsPort } from "@/modules/leads";

import {
  usePipelineStages,
  useAllPipelineStageOptions,
} from "./hooks/model/usePipelineStages";
import {
  useCustomPipelines,
  useCustomPipelineStages,
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
} from "./hooks/custom/useCustomPipelines";
import {
  useCreatePipeWhatsapp,
  useUpdatePipeWhatsapp,
} from "./hooks/legacy/usePipeWhatsapp";
import {
  useCreatePipeConfirmacao,
  useUpdatePipeConfirmacao,
  useDeletePipeConfirmacao,
} from "./hooks/legacy/usePipeConfirmacao";
import { usePipeConfirmacaoByLeadId } from "./hooks/legacy/usePipeConfirmacaoByLeadId";
import {
  useCreatePipeProposta,
  useUpdatePipeProposta,
  useDeletePipeProposta,
} from "./hooks/legacy/usePipePropostas";
import { usePipePropostaByLeadId } from "./hooks/legacy/usePipePropostaByLeadId";
import {
  usePipePropostaItems,
  useCreatePipePropostaItem,
  useUpdatePipePropostaItem,
  useDeletePipePropostaItem,
} from "./hooks/legacy/usePipePropostaItems";
import { useLossReasons } from "./hooks/config/useLossReasons";
import { RescheduleModal } from "./components/legacy/confirmacao/RescheduleModal";
import { MergedMeetingEditor } from "./components/kanban/MergedMeetingEditor";

/**
 * Objeto-port estável. Os hooks são referências de função (estáveis entre
 * renders), então `useMemo` sem deps é seguro e evita re-render dos consumers.
 */
const port: PipeOpsPort = {
  usePipelineStages,
  useAllPipelineStageOptions,
  useCustomPipelines,
  useCustomPipelineStages,
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
  useCreatePipeWhatsapp,
  useCreatePipeConfirmacao,
  useCreatePipeProposta,
  useUpdatePipeWhatsapp,
  useUpdatePipeConfirmacao,
  useDeletePipeConfirmacao,
  useUpdatePipeProposta,
  useDeletePipeProposta,
  usePipeConfirmacaoByLeadId,
  usePipePropostaByLeadId,
  usePipePropostaItems,
  useCreatePipePropostaItem,
  useUpdatePipePropostaItem,
  useDeletePipePropostaItem,
  useLossReasons,
  RescheduleModal,
  MergedMeetingEditor,
} as PipeOpsPort;

export function PipeOpsProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => port, []);
  return <PipeOpsContextProvider value={value}>{children}</PipeOpsContextProvider>;
}
