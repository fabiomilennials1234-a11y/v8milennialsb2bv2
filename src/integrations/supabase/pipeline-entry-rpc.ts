import { supabase } from "./client";
import type { Json } from "./types";

export type SystemPipelineSlug = "whatsapp" | "confirmacao" | "propostas";

/**
 * Índice que garante UM card aberto sem negócio por lead em cada funil
 * (migration 20271119000000). Card com negócio fica fora — recompra.
 */
export const UM_CARD_SEM_NEGOCIO_INDEX = "uq_pipeline_entries_um_card_sem_negocio";

/**
 * Marca da recusa de domínio de `abrir_negocio` (20271218000000): o lead já tem
 * card aberto sem negócio neste funil, mas o chamador não o enxerga
 * (Visualização no Funil "só os meus").
 */
export const LEAD_JA_NO_FUNIL_MARK = "lead_ja_no_funil";

/**
 * O lead já tem card aberto sem negócio neste funil: o insert perdeu para ele.
 * Duas formas: o índice único (`23505` com o nome do índice) ou a recusa de
 * domínio de `abrir_negocio`, que existe porque quem não enxerga o card do
 * outro não tem como saber que ele existe.
 */
export function isLeadJaNoFunil(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== "23505") return false;
  const text = String(message ?? "");
  return text.includes(UM_CARD_SEM_NEGOCIO_INDEX) || text.includes(LEAD_JA_NO_FUNIL_MARK);
}

/**
 * Para portas automáticas (ingestão, integração): se o lead já está no funil,
 * o card que existe É o card — não é erro. Qualquer outra falha segue.
 */
export function ignorarSeLeadJaNoFunil(error: unknown): null {
  if (isLeadJaNoFunil(error)) return null;
  throw error;
}

export interface CreateSystemPipelineEntryInput {
  organizationId: string;
  slug: SystemPipelineSlug;
  leadId: string;
  stageKey?: string | null;
  assignedTo?: string | null;
  preSaleResponsibleId?: string | null;
  saleResponsibleId?: string | null;
  metadata?: Json;
  notes?: string | null;
  closedAt?: string | null;
  id?: string;
}

export interface CreateCustomPipelineEntryInput {
  organizationId: string;
  pipelineId: string;
  leadId: string;
  stageId: string;
  assignedTo?: string | null;
  preSaleResponsibleId?: string | null;
  saleResponsibleId?: string | null;
  dealId?: string | null;
  notes?: string | null;
  enteredAt?: string | null;
  stageChangedAt?: string | null;
  id?: string;
}

export async function createSystemPipelineEntry(
  input: CreateSystemPipelineEntryInput,
): Promise<string> {
  const suppliedMetadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : {};
  const metadataDefaults: Record<SystemPipelineSlug, Record<string, Json>> = {
    whatsapp: {
      responsible_id: null,
      sdr_id: null,
      scheduled_date: null,
    },
    confirmacao: {
      meeting_date: null,
      is_confirmed: false,
      closer_id: null,
      responsible_id: null,
      sdr_id: null,
      meet_link: null,
      metrics_period_at: null,
    },
    propostas: {
      sale_value: null,
      closer_id: null,
      responsible_id: null,
      product_id: null,
      product_type: null,
      calor: null,
      loss_reason: null,
      loss_reason_id: null,
      commitment_date: null,
      contract_duration: null,
      metrics_period_at: null,
    },
  };
  const metadata = { ...metadataDefaults[input.slug], ...suppliedMetadata };
  const derivedAssignedTo = (() => {
    if (input.assignedTo !== undefined) return input.assignedTo;
    const responsible = metadata.responsible_id as string | null;
    const closer = metadata.closer_id as string | null;
    const sdr = metadata.sdr_id as string | null;
    if (input.slug === "whatsapp") return responsible ?? sdr;
    if (input.slug === "confirmacao") return responsible ?? closer ?? sdr;
    return responsible ?? closer;
  })();

  const { data, error } = await supabase.rpc("fn_entrada_sistema_criar", {
    p_organization_id: input.organizationId,
    p_slug: input.slug,
    p_lead_id: input.leadId,
    p_stage_key: input.stageKey ?? undefined,
    p_assigned_to: derivedAssignedTo ?? undefined,
    p_pre_sale_responsible_id: input.preSaleResponsibleId ?? undefined,
    p_sale_responsible_id: input.saleResponsibleId ?? undefined,
    p_metadata: metadata,
    p_notes: input.notes ?? undefined,
    p_closed_at: input.closedAt ?? undefined,
    p_id: input.id,
  });

  if (error) throw error;
  return data;
}

export async function updateSystemPipelineEntry(
  entryId: string,
  patch: Record<string, Json | undefined>,
): Promise<void> {
  const { error } = await supabase.rpc("fn_entrada_sistema_atualizar", {
    p_entry_id: entryId,
    p_patch: Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Json,
  });

  if (error) throw error;
}

export async function createCustomPipelineEntry(
  input: CreateCustomPipelineEntryInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("fn_entrada_custom_criar", {
    p_organization_id: input.organizationId,
    p_pipeline_id: input.pipelineId,
    p_lead_id: input.leadId,
    p_stage_id: input.stageId,
    p_assigned_to: input.assignedTo ?? undefined,
    p_pre_sale_responsible_id: input.preSaleResponsibleId ?? undefined,
    p_sale_responsible_id: input.saleResponsibleId ?? undefined,
    p_deal_id: input.dealId ?? undefined,
    p_notes: input.notes ?? undefined,
    p_entered_at: input.enteredAt ?? undefined,
    p_stage_changed_at: input.stageChangedAt ?? undefined,
    p_id: input.id,
  });

  if (error) throw error;
  return data;
}

export async function updateCustomPipelineEntry(
  entryId: string,
  patch: Record<string, Json | undefined>,
): Promise<void> {
  const { error } = await supabase.rpc("fn_entrada_custom_atualizar", {
    p_entry_id: entryId,
    p_patch: Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Json,
  });

  if (error) throw error;
}
