import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { DealOutcome } from "../../../hooks/useLeadsDeals";
import { notifyError } from "@/shared/errors";
import { cancelarEfeitoDeDesfecho, dispararEfeitoDeDesfecho } from "../../../lib/card-effects";
import { useLossReasonGate } from "../../../loss-reason-gate";
import type { PerdaResolvida } from "@/contracts/pipe/perda";

type Decisao = { next: "open" } | { next: "lost"; perda: PerdaResolvida };

/** Monta só ao abrir o menu. O desfecho pertence à entrada, não ao lead/etapa. */
export function DealLostMenuItem({ entryId }: { entryId: string }) {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const { capturarMotivoDaPerda } = useLossReasonGate();
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
    mutationFn: async (decisao: Decisao) => {
      // O motivo já está no metadata (gravado pela porta antes de chegar
      // aqui); a RPC o copia para `deals.loss_reason`.
      const { error } = await supabase.rpc("definir_desfecho_da_entrada", {
        p_entry_id: entryId,
        p_outcome: decisao.next,
        ...(decisao.next === "lost" && decisao.perda.texto ? { p_loss_reason: decisao.perda.texto } : {}),
      } as never);
      if (error) throw new Error(error.message);
      return decisao.next;
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKey, next);
      toast.success(next === "lost" ? "Negócio marcado como perdido" : "Negócio removido de perdido");
      if (next === "lost") dispararEfeitoDeDesfecho(entryId, "lost");
      else cancelarEfeitoDeDesfecho(entryId);
      await Promise.all([
        "leads-deals", "deal-card-extras", "funil-desfecho-counts",
        "pipeline-page", "pipeline-stage-counts", "pipeline_entries",
        "custom_pipe_entries", "custom_pipe_stage_counts", "leads-sales-metrics",
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (caught: unknown) => notifyError(caught, { fallback: "Não foi possível alterar o negócio. Tente novamente." }),
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
        if (lost) {
          mutation.mutate({ next: "open" });
          return;
        }
        // Perder pede o motivo (SCRUM-369) e o grava antes do desfecho.
        // Cancelou / falhou a gravação: libera o item sem escrever nada.
        void capturarMotivoDaPerda({ entryIds: [entryId] }).then((perda) => {
          if (!perda) {
            saving.current = false;
            return;
          }
          mutation.mutate({ next: "lost", perda });
        });
      }}
    >
      <Icon className="w-4 h-4 mr-2" />
      {outcome.isError ? "Tentar carregar desfecho novamente" : lost ? "Remover de perdido" : "Marcar como perdido"}
    </DropdownMenuItem>
  );
}
