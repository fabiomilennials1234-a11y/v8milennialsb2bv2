import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export function useCreateSandbox() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("create_org_sandbox", {
        p_source_org_id: organization!.id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Sandbox criado — troque de organização para acessar");
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: () => {
      toast.error("Erro ao criar sandbox — verifique permissões de admin");
    },
  });
}
