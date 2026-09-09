import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
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
      // Escopos, limite e validade vão no MESMO chamado. O padrão anterior era
      // criar e depois `UPDATE api_keys SET scopes`, do lado do cliente — e a
      // RLS filtrava esse UPDATE em silêncio para quem é master sem vínculo
      // ativo na organização: o supabase-js devolve sucesso com zero linhas
      // afetadas. A chave nascia com o default da coluna e o erro só aparecia
      // depois, como 403 na integração.
      const { data, error } = await supabase.rpc("generate_api_key", {
        p_org_id: organizationId!,
        p_name: input.name,
        p_created_by: user!.id,
        // `?? null` passava com os tipos antigos, em que os parâmetros
        // opcionais da RPC chegavam como `any`. Nos tipos gerados de prod eles
        // são `T | undefined`: "não informado" em argumento de RPC é ausência,
        // não nulo.
        p_scopes: input.scopes ?? undefined,
        p_rate_limit_per_minute: input.rate_limit_per_minute ?? undefined,
        p_expires_at: input.expires_at ?? undefined,
      });
      if (error) throw error;

      const result = data as {
        key_id: string;
        raw_key: string;
        prefix: string;
        scopes: string[];
      };

      // A função devolve o que FICOU gravado. Se divergir do pedido, quem criou
      // precisa saber agora — não na primeira chamada que tomar 403.
      const pedidos = input.scopes ?? [];
      const faltando = pedidos.filter((s) => !(result.scopes ?? []).includes(s));
      if (faltando.length > 0) {
        throw new Error(
          `A chave foi criada, mas sem os escopos: ${faltando.join(", ")}. Fale com o suporte antes de usá-la.`,
        );
      }

      return { id: result.key_id, key: result.raw_key, scopes: result.scopes ?? [] };
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
