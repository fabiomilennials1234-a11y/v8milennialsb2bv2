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
  QueryClient,
} from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
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
  SystemPipeDisplay,
} from "@/contracts/pipe";

type PipeWhatsappRow = Tables<"pipe_whatsapp">;
type PipeConfirmacaoRow = Tables<"pipe_confirmacao">;
type PipePropostaRow = Tables<"pipe_propostas">;

type PipeWhatsappInsert = Partial<PipeWhatsappRow> & { lead_id: string };
type PipeConfirmacaoInsert = Partial<PipeConfirmacaoRow> & { lead_id: string };
type PipePropostaInsert = Partial<PipePropostaRow> & { lead_id: string };

// Variáveis das mutations de update — espelham as assinaturas reais dos hooks
// de pipelines (preservadas para não mudar comportamento dos call sites).
//
// `Partial<Row>` e não `TablesUpdate<>`: pipe_whatsapp/confirmacao/propostas são
// VIEWS, e o gerador de types só emite Row para view — TablesUpdate aceita
// apenas `keyof Tables`. Mesmo padrão que os Inserts acima já usavam, e
// semanticamente equivalente: payload de update é linha parcial.
type PipeWhatsappUpdateVars = Partial<PipeWhatsappRow> & {
  id: string;
  leadId?: string;
  sdrId?: string | null;
  expectedUpdatedAt?: string;
};
type PipeConfirmacaoUpdateVars = Partial<PipeConfirmacaoRow> & {
  id: string;
  leadId?: string;
  assignedTo?: string | null;
  expectedUpdatedAt?: string;
};
type PipePropostaUpdateVars = Partial<PipePropostaRow> & {
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

/**
 * Funil da org no modelo unificado (SCRUM-633) — QUALQUER funil, sistema ou
 * custom, endereçado por `pipelines.id`. Shape mínimo que os diálogos de bulk
 * precisam; a implementação real (pipelines) pode devolver linhas mais ricas.
 */
export interface FunnelOption {
  id: string;
  name: string;
  slug: string;
  type: "system" | "custom";
  is_active: boolean;
}

/** Etapa de qualquer funil por uuid (`pipeline_stages.id`) — alvo canônico de escrita. */
export interface FunnelStageOption {
  id: string;
  stage_key: string;
  name: string;
  position: number;
}

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

/** Props do MergedMeetingEditor (slot — funil mergeado, ADR-0004). */
export interface MergedMeetingEditorSlotProps {
  /** pipeline_entries.id da entry whatsapp (agendado/remarcar/...). */
  entryId: string;
  leadId: string;
  leadName?: string | null;
  leadCompany?: string | null;
  leadPhone?: string | null;
  currentMeetingDate?: string | null;
  locked?: boolean;
}

/**
 * Superfície completa de pipeline-ops que leads consome. Implementada por
 * `pipelines` (PipeOpsProvider) usando os hooks/components reais.
 */
export interface PipeOpsPort {
  // ── Mover negócio (ADR-0023 decisão 4: avançar é MOVER, não copiar) ──────
  //
  // Entra pela PORTA, e não por `import { moverNegocio } from "@/modules/pipelines"`,
  // que foi a primeira tentativa e estava errada: o barrel de pipelines carrega o
  // `PipeOpsProvider`, então importá-lo de dentro de `leads` arrasta o provider
  // inteiro para qualquer arquivo que renderize o drawer — três suítes de teste
  // quebraram por causa disso, e o custo em runtime seria o mesmo. A porta existe
  // justamente para inverter essa dependência.
  usePipelineId: (slug: PipelineType) => UseQueryResult<string | null>;
  moverNegocio: (params: {
    entryId: string;
    targetPipelineId: string;
    targetStageKey: string;
    stageOrigem?: string | null;
    assignedTo?: string | null;
  }) => Promise<void>;
  invalidateAfterMove: (queryClient: QueryClient, leadId?: string) => void;

  // ── Stages (canônico) ────────────────────────────────────────────────────
  usePipelineStages: (pipelineType: PipelineType) => UseQueryResult<PipelineStage[]>;
  useAllPipelineStageOptions: () => StageOptionsByPipe;

  // ── Modelo unificado por pipeline_id (SCRUM-633) ─────────────────────────
  // Um funil, um id: os diálogos de bulk listam TODOS os funis da org e as
  // etapas do escolhido sem saber a família — mata o sentinela `custom:<id>`
  // e o hack `(isCustom ? "whatsapp" : pipe)` do BulkMoveDialog.
  //
  // 🚨 `FunnelOption.name` é `pipelines.name` — para funil de SISTEMA esse é o
  // nome CONGELADO do seed ("Qualificação"/"Confirmação"/"Propostas"), que a
  // navegação nunca mostra. Ao exibir um `FunnelOption` de sistema, passe por
  // `nomeDoFunil` (`@/contracts/pipe`) com o display config da org — senão o
  // defeito da SCRUM-608 reaparece nas telas novas.
  useFunnels: () => UseQueryResult<FunnelOption[]>;
  useFunnelStages: (
    pipelineId: string | undefined,
  ) => UseQueryResult<FunnelStageOption[]>;

  /**
   * Os funis de SISTEMA que esta organização tem, com o nome que ela usa.
   *
   * Existe porque `leads` monta o cadastro e precisa rotular funil pelo
   * `display_name` da org — não pelo `pipelines.name` do seed, e muito menos
   * por string cravada (SCRUM-608). Lista vazia é resposta legítima: a org
   * pode ter excluído todos os funis de sistema.
   *
   * Não se sobrepõe a `useFunnels`: aquele responde "quais funis existem, por
   * id"; este responde "quais funis de sistema a org TEM e como ela os chama".
   */
  useSystemPipes: () => UseQueryResult<SystemPipeDisplay[]>;

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
  MergedMeetingEditor: ComponentType<MergedMeetingEditorSlotProps>;
}

export type { ReactNode };
