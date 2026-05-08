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
  const { organization } = useOrganization();
  const orgId = organization?.id;

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
  const { organization } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      scopes?: string[];
      rate_limit_per_minute?: number;
      expires_at?: string;
    }) => {
      const rawKey = `tcrm_${crypto.randomUUID().replace(/-/g, "")}`;
      const prefix = rawKey.slice(0, 12);

      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const { data, error } = await (supabase.from as any)("api_keys")
        .insert({
          organization_id: organization!.id,
          name: input.name,
          key_hash: keyHash,
          key_prefix: prefix,
          scopes: input.scopes ?? ["read"],
          rate_limit_per_minute: input.rate_limit_per_minute ?? 100,
          expires_at: input.expires_at ?? null,
          created_by: user!.id,
        })
        .select("id")
        .single();
      if (error) throw error;

      return { id: data.id, key: rawKey };
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
