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
import { usePipelineDisplayConfig } from "./hooks/config/usePipelineDisplayConfig";
import { RescheduleModal } from "./components/legacy/confirmacao/RescheduleModal";
import { MergedMeetingEditor } from "./components/kanban/MergedMeetingEditor";
import { usePipelineId } from "./hooks/model/usePipelineEntries";
import { usePipelines } from "./hooks/model/usePipelines";
import { useStagesDoFunil } from "./hooks/model/useStagesDoFunil";
import { moverNegocio, invalidateAfterMove } from "./lib/moverNegocio";

/**
 * Objeto-port estável. Os hooks são referências de função (estáveis entre
 * renders), então `useMemo` sem deps é seguro e evita re-render dos consumers.
 */
const port: PipeOpsPort = {
  // ADR-0023 decisão 4 — o drawer do lead também faz a transição
  // compareceu → Orçamentos, e entra por aqui em vez de importar o barrel de
  // pipelines (que carregaria este próprio provider de dentro de `leads`).
  usePipelineId,
  moverNegocio,
  invalidateAfterMove,
  usePipelineStages,
  useAllPipelineStageOptions,
  // SCRUM-633 — modelo unificado por pipeline_id (bulk sem sentinela custom:)
  useFunnels: usePipelines,
  useFunnelStages: useStagesDoFunil,
  // SCRUM-608 — "quais funis de sistema a org TEM, e como ela os chama".
  // `PipelineDisplayConfig` é superset estrutural de `SystemPipeDisplay` (traz
  // `id`/`organization_id` a mais), então o hook satisfaz a porta sem adaptador.
  useSystemPipes: usePipelineDisplayConfig,
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
