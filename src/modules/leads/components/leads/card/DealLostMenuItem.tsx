import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { DealOutcome } from "../../../hooks/useLeadsDeals";

/** Monta só ao abrir o menu. O desfecho pertence à entrada, não ao lead/etapa. */
export function DealLostMenuItem({ entryId }: { entryId: string }) {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const queryKey = ["deal-menu-outcome", organizationId, entryId];
  const outcome = useQuery({
    queryKey,
    enabled: isReady && !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_entries")
        .select("deal:deals(outcome)")
        .eq("organization_id", organizationId!)
        .eq("id", entryId)
        .single()
        .returns<{ deal: { outcome: DealOutcome } | null }>();
      if (error) throw new Error(error.message);
      // Entradas antigas ainda sem deal são materializadas pela RPC ao decidir.
      return data.deal?.outcome ?? "open";
    },
  });
  const mutation = useMutation({
    mutationFn: async (next: "open" | "lost") => {
      const { error } = await supabase.rpc("definir_desfecho_da_entrada", {
        p_entry_id: entryId,
        p_outcome: next,
      } as never);
      if (error) throw new Error(error.message);
      return next;
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKey, next);
      toast.success(next === "lost" ? "Negócio marcado como perdido" : "Negócio removido de perdido");
      await Promise.all([
        "leads-deals", "deal-card-extras", "funil-desfecho-counts",
        "pipeline-page", "pipeline-stage-counts", "pipeline_entries",
        "custom_pipe_entries", "custom_pipe_stage_counts", "leads-sales-metrics",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: () => toast.error("Não foi possível alterar o negócio. Tente novamente."),
    onSettled: () => { saving.current = false; },
  });
  const lost = outcome.data === "lost";
  const Icon = lost ? RotateCcw : XCircle;

  return (
    <DropdownMenuItem
      disabled={outcome.isPending || outcome.isFetching || mutation.isPending}
      onSelect={(event) => {
        // Mantém o menu disponível para desfazer e impede submissões repetidas.
        event.preventDefault();
        if (saving.current) return;
        if (outcome.isError) {
          void outcome.refetch();
          return;
        }
        if (!outcome.data) return;
        saving.current = true;
        mutation.mutate(lost ? "open" : "lost");
      }}
    >
      <Icon className="w-4 h-4 mr-2" />
      {outcome.isError ? "Tentar carregar desfecho novamente" : lost ? "Remover de perdido" : "Marcar como perdido"}
    </DropdownMenuItem>
  );
}
