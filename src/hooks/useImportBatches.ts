import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ImportBatch {
  id: string;
  file_name: string | null;
  total_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  rolled_back: boolean;
  rolled_back_at: string | null;
  created_at: string;
  created_by_name: string;
}

export function useImportBatches(limit = 20) {
  const { user } = useAuth();

  return useQuery<ImportBatch[]>({
    queryKey: ["import-batches", user?.id, limit],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_import_batches", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as ImportBatch[];
    },
    enabled: !!user?.id,
  });
}

export function useRollbackImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await (supabase.rpc as any)("rollback_import_batch", {
        p_batch_id: batchId,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; deleted_count: number };
    },
    onSuccess: (data) => {
      toast.success(`Importação revertida: ${data.deleted_count} leads removidos`);
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao reverter: ${error.message}`);
    },
  });
}
