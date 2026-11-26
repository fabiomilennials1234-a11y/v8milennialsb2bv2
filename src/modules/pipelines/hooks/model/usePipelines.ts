import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isLeadJaNoFunil } from "@/integrations/supabase/pipeline-entry-rpc";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { invalidateAfterMove } from "../../lib/moverNegocio";
import { isEtapaDePerda } from "@/contracts/pipe/perda";

export interface Pipeline {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  type: "system" | "custom";
  description: string | null;
  icon: string;
  color: string;
  display_order: number;
  is_active: boolean;
  config: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineEntry {
  id: string;
  organization_id: string;
  pipeline_id: string;
  lead_id: string | null;
  deal_id: string | null;
  stage_key: string;
  assigned_to: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  entered_at: string;
  stage_changed_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

type PipelineEntryInsert = Omit<
  PipelineEntry,
  "id" | "organization_id" | "created_at" | "updated_at" | "entered_at" | "stage_changed_at" | "stage_key"
> & ({ stage_id: string; stage_key?: never } | { stage_key: string; stage_id?: never });

const STALE_TIME = 2 * 60_000;
/** Frescor da lista de funis — o mesmo na tela e no aquecimento do boot. */
export const PIPELINES_STALE_MS = STALE_TIME;

/**
 * Chave da lista de funis da org — a MESMA de `usePipelines` e do aquecimento
 * do boot (`src/core/boot-prewarm.ts`). `/funil/:slug` resolve o slug nela.
 */
export const pipelinesQueryKey = (organizationId: string | null | undefined) =>
  ["pipelines", organizationId] as const;

/** Funis da org, na ordem de exibição. Leitura sob RLS. */
export async function buscarPipelinesDaOrg(organizationId: string | null | undefined): Promise<Pipeline[]> {
  if (!organizationId) return [] as Pipeline[];

  const { data, error } = await (supabase.from as any)("pipelines")
    .select("*")
    .eq("organization_id", organizationId)
    .order("display_order", { ascending: true });

  if (error) throw error;
  return data as Pipeline[];
}

export function usePipelines() {
  const { organizationId } = useOrganization();

  useRealtimeSubscription("pipelines", ["pipelines"]);

  return useQuery({
    queryKey: pipelinesQueryKey(organizationId),
    queryFn: () => buscarPipelinesDaOrg(organizationId),
    enabled: !!organizationId,
    staleTime: STALE_TIME,
  });
}

export function usePipeline(slug: string | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["pipelines", organizationId, slug],
    queryFn: async () => {
      if (!organizationId || !slug) return null;

      const { data, error } = await (supabase.from as any)("pipelines")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("slug", slug)
        .single();

      if (error) throw error;
      return data as Pipeline;
    },
    enabled: !!organizationId && !!slug,
    staleTime: STALE_TIME,
  });
}

export function usePipelineEntries(pipelineId: string | undefined) {
  const { organizationId } = useOrganization();

  useRealtimeSubscription("pipeline_entries", ["pipeline_entries"]);

  return useQuery({
    queryKey: ["pipeline_entries", organizationId, pipelineId],
    queryFn: async () => {
      if (!organizationId || !pipelineId) return [] as PipelineEntry[];

      const { data, error } = await (supabase.from as any)("pipeline_entries")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false })
        .limit(10000);

      if (error) throw error;
      return data as PipelineEntry[];
    },
    enabled: !!organizationId && !!pipelineId,
    staleTime: STALE_TIME,
  });
}

export function usePipelineEntriesBySlug(slug: string) {
  const { organizationId } = useOrganization();
  const { data: pipeline } = usePipeline(slug);

  useRealtimeSubscription("pipeline_entries", ["pipeline_entries"]);

  return useQuery({
    queryKey: ["pipeline_entries", organizationId, pipeline?.id],
    queryFn: async () => {
      if (!organizationId || !pipeline?.id) return [] as PipelineEntry[];

      const { data, error } = await (supabase.from as any)("pipeline_entries")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("pipeline_id", pipeline.id)
        .order("created_at", { ascending: false })
        .limit(10000);

      if (error) throw error;
      return data as PipelineEntry[];
    },
    enabled: !!organizationId && !!pipeline?.id,
    staleTime: STALE_TIME,
  });
}

export function useCreatePipelineEntry() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (entry: PipelineEntryInsert) => {
      if (!organizationId) throw new Error("Organization not available");

      const { data, error } = await (supabase.from as any)("pipeline_entries")
        .insert({ ...entry, organization_id: organizationId })
        .select()
        .single();

      if (isLeadJaNoFunil(error)) throw new Error("Este lead já está neste funil");
      if (error) throw error;
      return data as PipelineEntry;
    },
    onSuccess: (data) => {
      invalidateAfterMove(queryClient, data.lead_id ?? undefined);
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
  });
}

export function useUpdatePipelineEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PipelineEntry> & { id: string }) => {
      const { data, error } = await (supabase.from as any)("pipeline_entries")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as PipelineEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
  });
}

export function useMovePipelineEntry() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, transfer, ...stage }: {
      id: string;
      transfer?: { fromPipelineId: string; toPipelineId: string; leadId: string };
    } & (
      { stageId: string; stageKey?: never } | { stageKey: string; stageId?: never }
    )) => {
      // Quem manda `stage_id` manda `stage_key` junto: os gatilhos que fecham o
      // negócio (`trg_enforce_closed_at`), gravam o histórico e capturam venda
      // (`fn_capture_pipeline_stage_event`) são `UPDATE OF stage_key` — olham o
      // SET, não o valor que o espelho copia. Só `stage_id` moveu o card e
      // calou os três (Café Jurerê, 09/2026: "Perdido" sem `closed_at`).
      let stageCols: { stage_id: string; stage_key: string } | { stage_key: string };
      if (transfer) {
        if (!organizationId) throw new Error("Organização ativa não encontrada");
        const targetStage = supabase
          .from("pipeline_stages")
          .select("id, stage_key, stage_role, is_final_negative, destino:pipelines!pipeline_stages_pipeline_id_fkey!inner(id)")
          .eq("organization_id", organizationId)
          .eq("pipeline_id", transfer.toPipelineId)
          .eq("destino.is_active", true)
          .eq("is_active", true);
        if (stage.stageId !== undefined) targetStage.eq("id", stage.stageId);
        else targetStage.eq("stage_key", stage.stageKey);
        const { data: target, error: stageError } = await targetStage.maybeSingle();
        if (stageError) throw stageError;
        if (!target || target.stage_role === "won" || isEtapaDePerda(target)) {
          throw new Error("Escolha uma etapa ativa que mantenha o negócio aberto.");
        }
        stageCols = { stage_id: target.id, stage_key: target.stage_key };
      } else if (stage.stageKey !== undefined) {
        stageCols = { stage_key: stage.stageKey };
      } else {
        const { data: target, error: stageError } = await supabase
          .from("pipeline_stages")
          .select("stage_key")
          .eq("id", stage.stageId)
          .single();
        if (stageError) throw stageError;
        stageCols = { stage_id: stage.stageId, stage_key: target.stage_key };
      }

      const update = supabase.from("pipeline_entries")
        .update({
          ...stageCols,
          ...(transfer && { pipeline_id: transfer.toPipelineId }),
          stage_changed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (transfer) {
        // Mantém a entrada original. Se o destino já tiver um card sem negócio,
        // o índice rejeita a troca sem fundir os dois.
        update.eq("organization_id", organizationId!)
          .eq("lead_id", transfer.leadId)
          .eq("pipeline_id", transfer.fromPipelineId)
          .is("closed_at", null);
      }
      const { data, error } = await update.select().single();
      if (isLeadJaNoFunil(error)) throw new Error("Este lead já tem um negócio aberto no funil de destino.");
      if (transfer && error?.code === "PGRST116") {
        throw new Error("O negócio mudou ou você não tem permissão para movê-lo.");
      }
      if (error) throw error;
      return data as PipelineEntry;
    },
    onSuccess: (data) => {
      invalidateAfterMove(queryClient, data.lead_id ?? undefined);
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
  });
}

export function useMigratePipeEntries() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("Organization not available");

      const { data, error } = await supabase.rpc("migrate_pipe_entries" as any, {
        p_organization_id: organizationId,
      });

      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
  });
}
