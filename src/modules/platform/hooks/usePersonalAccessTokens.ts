import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";

/**
 * Personal Access Tokens for the customer-facing crm-mcp (.specs/features/crm-mcp/DESIGN.md §7.5).
 *
 * - list/revoke run directly under the caller's RLS (pat_owner_select / pat_owner_update) —
 *   a user only ever sees and revokes their OWN tokens;
 * - creation goes through the `create-pat` edge function (it generates the token, stores only
 *   the hash, and returns the plaintext ONCE — never readable again).
 *
 * `personal_access_tokens` is not yet in the generated Database type, so we type the rows
 * locally and cast the query (the codebase's Pattern C, mirrors useApiKeys).
 */
export interface PersonalAccessToken {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  audience: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface CreatedPat {
  pat_id: string;
  token: string; // plaintext — shown once
  token_prefix: string;
  expires_at: string;
  scopes: string[];
}

export function usePersonalAccessTokens() {
  const { organizationId } = useOrganization();

  return useQuery<PersonalAccessToken[]>({
    queryKey: ["personal-access-tokens", organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("personal_access_tokens")
        .select(
          "id, name, token_prefix, scopes, audience, last_used_at, expires_at, revoked_at, created_at",
        )
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PersonalAccessToken[];
    },
    enabled: !!organizationId,
  });
}

export function useCreatePersonalAccessToken() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation<CreatedPat, Error, { name: string; scopes?: string[]; expires_in_days?: number }>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke("create-pat", {
        body: { ...input, organization_id: organizationId },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as CreatedPat;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-access-tokens"] });
    },
    onError: () => {
      toast.error("Não foi possível criar o token");
    },
  });
}

export function useRevokePersonalAccessToken() {
  const queryClient = useQueryClient();

  return useMutation<string, Error, string>({
    mutationFn: async (id) => {
      const { error } = await (supabase.from as any)("personal_access_tokens")
        .update({ revoked_at: new Date().toISOString(), revoked_reason: "user" })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success("Token revogado");
      queryClient.invalidateQueries({ queryKey: ["personal-access-tokens"] });
    },
    onError: () => {
      toast.error("Erro ao revogar token");
    },
  });
}
