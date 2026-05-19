import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LeadComment, LeadCommentWithAuthor } from "../modal/types";

/**
 * lead_comments + team_members.avatar_url são adicionados pela migration
 * 20260517000000_lead_detail_modal_redesign.sql / 20260940 wave1. Types.ts
 * ainda não regenerados — castamos via `any` localmente.
 */
type AnySupabase = ReturnType<typeof supabase.from>;

function fromLeadComments(): AnySupabase {
  return (supabase.from as unknown as (t: string) => AnySupabase)("lead_comments");
}

export function useLeadComments(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["lead-comments", leadId],
    queryFn: async (): Promise<LeadCommentWithAuthor[]> => {
      if (!leadId) return [];
      const { data, error } = await (fromLeadComments() as any)
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as LeadComment[];

      const memberIds = Array.from(
        new Set(rows.map((r) => r.author_team_member_id).filter(Boolean))
      ) as string[];

      let members: Array<{ id: string; name: string; avatar_url: string | null }> = [];
      if (memberIds.length > 0) {
        const { data: mData } = await (supabase
          .from("team_members")
          .select("id, name, avatar_url") as any)
          .in("id", memberIds);
        members = (mData ?? []) as typeof members;
      }
      const byId = new Map(members.map((m) => [m.id, m]));
      return rows.map((r) => ({
        ...r,
        author: r.author_team_member_id ? byId.get(r.author_team_member_id) ?? null : null,
      }));
    },
    enabled: !!leadId,
  });
}

export function useCreateLeadComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; organizationId: string; body: string; mentions?: string[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sem usuário autenticado");

      const { data: member } = await supabase
        .from("team_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", input.organizationId)
        .maybeSingle();

      const { data, error } = await (fromLeadComments() as any)
        .insert({
          lead_id: input.leadId,
          organization_id: input.organizationId,
          author_user_id: user.id,
          author_team_member_id: member?.id ?? null,
          body: input.body.trim(),
          mentions: input.mentions && input.mentions.length > 0 ? input.mentions : [],
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as LeadComment;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-comments", vars.leadId] });
      qc.invalidateQueries({ queryKey: ["lead-timeline", vars.leadId] });
    },
  });
}

export function useDeleteLeadComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { commentId: string; leadId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (fromLeadComments() as any)
        .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
        .eq("id", input.commentId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-comments", vars.leadId] });
      qc.invalidateQueries({ queryKey: ["lead-timeline", vars.leadId] });
    },
  });
}

export function useUpdateLeadComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { commentId: string; leadId: string; body: string }) => {
      const { error } = await (fromLeadComments() as any)
        .update({ body: input.body.trim(), updated_at: new Date().toISOString() })
        .eq("id", input.commentId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-comments", vars.leadId] });
    },
  });
}
