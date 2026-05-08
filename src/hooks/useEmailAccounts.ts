import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface EmailAccount {
  id: string;
  provider: "gmail" | "outlook";
  email_address: string;
  display_name: string | null;
  sync_status: "pending" | "syncing" | "synced" | "error";
  sync_error: string | null;
  last_sync_at: string | null;
  is_active: boolean;
  created_at: string;
}

export function useEmailAccounts() {
  const { user } = useAuth();

  return useQuery<EmailAccount[]>({
    queryKey: ["email-accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("email_accounts")
        .select("id, provider, email_address, display_name, sync_status, sync_error, last_sync_at, is_active, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EmailAccount[];
    },
    enabled: !!user?.id,
  });
}

export function useDisconnectEmailAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await (supabase.from as any)("email_accounts")
        .delete()
        .eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta de email desconectada");
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}

export function useToggleEmailAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accountId, isActive }: { accountId: string; isActive: boolean }) => {
      const { error } = await (supabase.from as any)("email_accounts")
        .update({ is_active: isActive })
        .eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
    },
  });
}
