import { useCallback } from "react";
import { toast } from "sonner";

import { LeadCard } from "./LeadCard";
import { useLeadCardData } from "./useLeadCardData";
import { useUpdateLead } from "../../hooks/useLeads";

/**
 * O Card do Lead ligado ao banco.
 *
 * Separado de `LeadCard` de propósito: o componente de cima não conhece
 * Supabase, react-query nem contexto de organização — o que mantém a rota de
 * visualização (`/preview.html`) funcionando com dados de exemplo e permite
 * testar o desenho sem subir banco nenhum.
 *
 * ── ABRIR UM NEGÓCIO ──────────────────────────────────────────────────────
 * `onOpenDeal` recebe o `pipeline_entries.id`, que é exatamente o que
 * `useDealSheet().openDeal(entryId, leadId)` espera. O card do Negócio **já
 * existe** (`components/deal-detail/DealDetailDialog`, usado hoje pelos três
 * funis) e já carrega etapa, reunião e orçamento — o corte Lead↔Negócio não
 * cria buraco funcional, só devolve cada controle para o card dono dele.
 *
 * A prop é opcional porque nem todo ponto de montagem tem `DealPanelProvider`
 * acima. Sem ela, o negócio continua listado e legível; só não navega.
 */
export function LeadCardContainer({
  leadId,
  isOpen,
  onOpenDeal,
  onNewDeal,
}: {
  leadId: string | null;
  isOpen: boolean;
  onOpenDeal?: (entryId: string, leadId: string) => void;
  onNewDeal?: () => void;
}) {
  const { data, isLoading, visibility } = useLeadCardData(leadId, isOpen);
  const updateLead = useUpdateLead();

  const salvarNota = useCallback(
    (texto: string) => {
      if (!leadId) return;
      updateLead.mutate(
        { id: leadId, notes: texto },
        {
          onError: () =>
            toast.error("Não foi possível salvar a anotação. O texto continua na tela."),
        },
      );
    },
    [leadId, updateLead],
  );

  if (!isOpen) return null;

  if (isLoading || visibility === "loading") {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-background">
        <span className="text-[13px] text-muted-foreground">Carregando…</span>
      </div>
    );
  }

  // Espelha o vocabulário de `can_view_lead`. Não colapsa os três casos numa
  // mensagem só: "não existe", "está na lixeira" e "você não tem acesso" pedem
  // reações diferentes de quem está lendo.
  if (visibility !== "exists" || !data) {
    const mensagem =
      visibility === "deleted"
        ? "Este lead está na lixeira."
        : visibility === "permission_denied"
          ? "Você não tem acesso a este lead."
          : "Lead não encontrado.";
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-background px-6 text-center">
        <span className="text-[13px] text-muted-foreground">{mensagem}</span>
      </div>
    );
  }

  return (
    <LeadCard
      lead={data}
      onSaveNote={salvarNota}
      onOpenDeal={onOpenDeal ? (entryId) => onOpenDeal(entryId, data.id) : undefined}
      onNewDeal={onNewDeal}
    />
  );
}
