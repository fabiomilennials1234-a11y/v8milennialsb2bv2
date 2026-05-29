import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";

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
  "id" | "organization_id" | "created_at" | "updated_at" | "entered_at" | "stage_changed_at"
>;

const STALE_TIME = 2 * 60_000;

export function usePipelines() {
  const { organizationId } = useOrganization();

  useRealtimeSubscription("pipelines", ["pipelines"]);

  return useQuery({
    queryKey: ["pipelines", organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as Pipeline[];

      const { data, error } = await (supabase.from as any)("pipelines")
        .select("*")
        .eq("organization_id", organizationId)
        .order("display_order", { ascending: true });

      if (error) throw error;
      return data as Pipeline[];
    },
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

      if (error) throw error;
      return data as PipelineEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
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

  return useMutation({
    mutationFn: async ({ id, stageKey }: { id: string; stageKey: string }) => {
      const { data, error } = await (supabase.from as any)("pipeline_entries")
        .update({ stage_key: stageKey, stage_changed_at: new Date().toISOString() })
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
