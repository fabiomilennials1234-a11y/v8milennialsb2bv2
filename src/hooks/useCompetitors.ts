import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export interface Competitor {
  id: string;
  name: string;
  aliases: string[];
  website: string | null;
  strengths: string[];
  weaknesses: string[];
  battlecard_md: string | null;
  win_rate_vs: number | null;
  total_encounters: number;
  total_wins: number;
  is_active: boolean;
  created_at: string;
}

export interface CompetitorMention {
  id: string;
  competitor_id: string;
  conversation_id: string;
  lead_id: string | null;
  deal_id: string | null;
  matched_keyword: string;
  snippet: string | null;
  detected_at: string;
}

export interface CompetitorStats {
  competitor_id: string;
  competitor_name: string;
  total_encounters: number;
  total_wins: number;
  win_rate: number;
}

export function useCompetitors() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<Competitor[]>({
    queryKey: ["competitors", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("competitors")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("is_active", true)
        .order("total_encounters", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Competitor[];
    },
    enabled: !!orgId,
  });
}

export function useCreateCompetitor() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      aliases?: string[];
      website?: string;
      strengths?: string[];
      weaknesses?: string[];
      battlecard_md?: string;
    }) => {
      const { data, error } = await (supabase.from as any)("competitors")
        .insert({
          organization_id: organization!.id,
          name: input.name,
          aliases: input.aliases ?? [],
          website: input.website ?? null,
          strengths: input.strengths ?? [],
          weaknesses: input.weaknesses ?? [],
          battlecard_md: input.battlecard_md ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Concorrente cadastrado");
      queryClient.invalidateQueries({ queryKey: ["competitors"] });
    },
  });
}

export function useUpdateCompetitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Omit<Competitor, "id" | "created_at">>) => {
      const { error } = await (supabase.from as any)("competitors")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Concorrente atualizado");
      queryClient.invalidateQueries({ queryKey: ["competitors"] });
    },
  });
}

export function useCompetitorStats() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<CompetitorStats[]>({
    queryKey: ["competitor-stats", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_competitor_stats", {
        p_org_id: orgId,
      });
      if (error) throw error;
      return (data ?? []) as CompetitorStats[];
    },
    enabled: !!orgId,
  });
}

export function useCompetitorMentions(competitorId: string | null) {
  return useQuery<CompetitorMention[]>({
    queryKey: ["competitor-mentions", competitorId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("competitor_mentions")
        .select("*")
        .eq("competitor_id", competitorId!)
        .order("detected_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as CompetitorMention[];
    },
    enabled: !!competitorId,
  });
}
