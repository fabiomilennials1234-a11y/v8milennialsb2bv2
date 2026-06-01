/**
 * PipeOpsPort — porta de operações de pipeline consumida por leads.
 *
 * Inversão de dependência (arch-deepening Fase 7): leads NÃO importa
 * `@/modules/pipelines`. Em vez disso, define aqui a abstração (DIP — o consumer
 * é dono da interface) e recebe a implementação real via React context, provida
 * por `pipelines` no nível do App. Assim a única direção de import passa a ser
 * `pipelines → leads`, quebrando o ciclo.
 *
 * Mecanismo: **hook-injection**. O port expõe os próprios hooks (`use*`) +
 * slots de componente. leads chama `port.useX()` na sua própria render tree —
 * preservando realtime, queryKeys e invalidação exatamente como antes (zero
 * mudança de comportamento). NÃO são fetchers async re-embrulhados.
 *
 * Só referencia tipos de `@/contracts/pipe` e `@/integrations/supabase/types`
 * (infra), nunca `@/modules/pipelines` — senão o type-edge persistiria e o
 * dep-cruiser manteria o ciclo.
 */
import type {
  ComponentType,
  ReactNode,
} from "react";
import type {
  UseQueryResult,
  UseMutationResult,
} from "@tanstack/react-query";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import type {
  PipelineType,
  PipelineStage,
  CustomPipeline,
  CustomPipelineStage,
  CustomPipeEntry,
  PipePropostaItem,
  PipePropostaItemInsert,
  LossReason,
  ReschedulingMode,
} from "@/contracts/pipe";

type PipeWhatsappRow = Tables<"pipe_whatsapp">;
type PipeConfirmacaoRow = Tables<"pipe_confirmacao">;
type PipePropostaRow = Tables<"pipe_propostas">;

type PipeWhatsappInsert = Partial<PipeWhatsappRow> & { lead_id: string };
type PipeConfirmacaoInsert = Partial<PipeConfirmacaoRow> & { lead_id: string };
type PipePropostaInsert = Partial<PipePropostaRow> & { lead_id: string };

// Variáveis das mutations de update — espelham as assinaturas reais dos hooks
// de pipelines (preservadas para não mudar comportamento dos call sites).
type PipeWhatsappUpdateVars = TablesUpdate<"pipe_whatsapp"> & {
  id: string;
  leadId?: string;
  sdrId?: string | null;
  expectedUpdatedAt?: string;
};
type PipeConfirmacaoUpdateVars = TablesUpdate<"pipe_confirmacao"> & {
  id: string;
  leadId?: string;
  assignedTo?: string | null;
  expectedUpdatedAt?: string;
};
type PipePropostaUpdateVars = TablesUpdate<"pipe_propostas"> & {
  id: string;
  leadId?: string;
  closerId?: string | null;
  skip_auto_push?: boolean;
  expectedUpdatedAt?: string;
};

type StageOptionsByPipe = {
  stagesByPipe: Record<string, { value: string; label: string }[]>;
  isLoading: boolean;
};

type AddLeadToCustomPipeVars = {
  pipeline_id: string;
  lead_id: string;
  stage_id: string;
  assigned_to?: string;
  notes?: string;
};

/** Props do RescheduleModal (slot — implementação fica em pipelines). */
export interface RescheduleModalSlotProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  mode?: ReschedulingMode;
  pipeItem: {
    id: string;
    lead_id: string;
    lead?: { name?: string; company?: string; phone?: string } | null;
    responsible_id?: string | null;
    sdr_id?: string | null;
    closer_id?: string | null;
    meeting_date?: string | null;
  } | null;
}

/**
 * Superfície completa de pipeline-ops que leads consome. Implementada por
 * `pipelines` (PipeOpsProvider) usando os hooks/components reais.
 */
export interface PipeOpsPort {
  // ── Stages (canônico) ────────────────────────────────────────────────────
  usePipelineStages: (pipelineType: PipelineType) => UseQueryResult<PipelineStage[]>;
  useAllPipelineStageOptions: () => StageOptionsByPipe;

  // ── Custom pipelines ──────────────────────────────────────────────────────
  useCustomPipelines: () => UseQueryResult<CustomPipeline[]>;
  useCustomPipelineStages: (
    pipelineId: string | undefined,
  ) => UseQueryResult<CustomPipelineStage[]>;
  useAddLeadToCustomPipe: () => UseMutationResult<
    CustomPipeEntry,
    Error,
    AddLeadToCustomPipeVars
  >;
  useMoveLeadInCustomPipe: () => UseMutationResult<
    unknown,
    Error,
    { entry_id: string; pipeline_id: string; stage_id: string }
  >;
  useRemoveLeadFromCustomPipe: () => UseMutationResult<
    unknown,
    Error,
    { entry_id: string; pipeline_id: string }
  >;

  // ── Pipe legacy: create ───────────────────────────────────────────────────
  useCreatePipeWhatsapp: () => UseMutationResult<unknown, Error, PipeWhatsappInsert>;
  useCreatePipeConfirmacao: () => UseMutationResult<unknown, Error, PipeConfirmacaoInsert>;
  useCreatePipeProposta: () => UseMutationResult<unknown, Error, PipePropostaInsert>;

  // ── Pipe legacy: update / delete ──────────────────────────────────────────
  useUpdatePipeWhatsapp: () => UseMutationResult<unknown, Error, PipeWhatsappUpdateVars>;
  useUpdatePipeConfirmacao: () => UseMutationResult<unknown, Error, PipeConfirmacaoUpdateVars>;
  useDeletePipeConfirmacao: () => UseMutationResult<unknown, Error, string>;
  useUpdatePipeProposta: () => UseMutationResult<unknown, Error, PipePropostaUpdateVars>;
  useDeletePipeProposta: () => UseMutationResult<unknown, Error, string>;

  // ── Pipe legacy: by-lead reads ────────────────────────────────────────────
  usePipeConfirmacaoByLeadId: (
    leadId: string | null | undefined,
  ) => UseQueryResult<PipeConfirmacaoRow | null>;
  usePipePropostaByLeadId: (
    leadId: string | null | undefined,
  ) => UseQueryResult<PipePropostaRow | null>;

  // ── Proposta items ────────────────────────────────────────────────────────
  usePipePropostaItems: (
    propostaId: string | null | undefined,
  ) => UseQueryResult<PipePropostaItem[]>;
  useCreatePipePropostaItem: () => UseMutationResult<unknown, Error, PipePropostaItemInsert>;
  useUpdatePipePropostaItem: () => UseMutationResult<
    unknown,
    Error,
    { id: string; product_id?: string | null; quantity?: number; unit_price?: number | null; sale_value?: number | null }
  >;
  useDeletePipePropostaItem: () => UseMutationResult<
    unknown,
    Error,
    { id: string; propostaId: string }
  >;

  // ── Loss reasons ──────────────────────────────────────────────────────────
  useLossReasons: () => UseQueryResult<LossReason[]>;

  // ── Component slots (domínio pipelines, montados dentro de leads) ─────────
  RescheduleModal: ComponentType<RescheduleModalSlotProps>;
}

export type { ReactNode };
