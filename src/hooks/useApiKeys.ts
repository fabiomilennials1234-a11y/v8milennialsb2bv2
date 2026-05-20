import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_minute: number;
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export function useApiKeys() {
  const { organizationId } = useOrganization();
  const orgId = organizationId;

  return useQuery<ApiKey[]>({
    queryKey: ["api-keys", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("api_keys")
        .select("id, name, key_prefix, scopes, rate_limit_per_minute, last_used_at, expires_at, is_active, created_at")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ApiKey[];
    },
    enabled: !!orgId,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      scopes?: string[];
      rate_limit_per_minute?: number;
      expires_at?: string;
    }) => {
      const { data, error } = await supabase.rpc("generate_api_key", {
        p_org_id: organizationId!,
        p_name: input.name,
        p_created_by: user!.id,
      });
      if (error) throw error;

      const result = data as { key_id: string; raw_key: string; prefix: string };

      const hasCustomConfig =
        input.scopes || input.rate_limit_per_minute || input.expires_at;
      if (hasCustomConfig) {
        const { error: updateError } = await (supabase.from as any)("api_keys")
          .update({
            ...(input.scopes && { scopes: input.scopes }),
            ...(input.rate_limit_per_minute && { rate_limit_per_minute: input.rate_limit_per_minute }),
            ...(input.expires_at && { expires_at: input.expires_at }),
          })
          .eq("id", result.key_id);
        if (updateError) throw updateError;
      }

      return { id: result.key_id, key: result.raw_key };
    },
    onSuccess: () => {
      toast.success("API key criada — copie agora, não será exibida novamente");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await (supabase.from as any)("api_keys")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("id", keyId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("API key revogada");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}
