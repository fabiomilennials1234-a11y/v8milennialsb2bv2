import { useCallback } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { LeadCard } from "./LeadCard";
import { LeadCardAside } from "./LeadCardAside";
import { useLeadCardData } from "./useLeadCardData";
import { useUpdateLead, useToggleLeadAI, useDeleteLead } from "../../hooks/useLeads";
import { useSaveCustomFieldValue } from "../../hooks/useLeadCustomFields";

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
  forma = "card",
  onAbrirFicha,
}: {
  leadId: string | null;
  isOpen: boolean;
  onOpenDeal?: (entryId: string, leadId: string) => void;
  onNewDeal?: () => void;
  /**
   * `card` é a ficha inteira; `coluna` é a faixa de 356px que o painel do
   * Negócio encosta à esquerda (o print do DataCrazy).
   *
   * As duas formas ficam no MESMO container de propósito: o que muda é o
   * desenho, não de onde vem o dado nem como ele grava. Um segundo container
   * significaria uma segunda regra de "campo do sistema vai por `useUpdateLead`,
   * campo da org vai por `useSaveCustomFieldValue`" — e é assim que as duas
   * gravações começam a divergir.
   */
  forma?: "card" | "coluna";
  /** Só na forma `coluna`: leva para a ficha inteira do lead. */
  onAbrirFicha?: () => void;
}) {
  const { data, isLoading, visibility } = useLeadCardData(leadId, isOpen);
  const updateLead = useUpdateLead();
  const saveCustomField = useSaveCustomFieldValue();
  const toggleAI = useToggleLeadAI();
  const deleteLead = useDeleteLead();

  /**
   * Grava um campo do bloco Dados.
   *
   * Campo do sistema vai por `useUpdateLead`; campo da organização vai por
   * `useSaveCustomFieldValue`, e a `chave` dele É o id da definição. A
   * distinção sai do próprio campo (`personalizado`) em vez de um prefixo na
   * chave — prefixo em id é a classe de gambiarra que sobrevive anos.
   *
   * Campo `somenteLeitura` nunca chega aqui: a interface não o deixa entrar em
   * edição. Aceitar o texto e não gravar seria pior que não oferecer.
   */
  const salvarCampo = useCallback(
    async (chave: string, valor: string) => {
      if (!leadId || !data) return;
      const campo = data.campos.flatMap((g) => g.campos).find((c) => c.chave === chave);
      if (!campo || campo.somenteLeitura) return;

      const limpo = valor.trim();
      if (campo.personalizado) {
        await saveCustomField.mutateAsync({ leadId, fieldId: chave, value: limpo });
        return;
      }
      await updateLead.mutateAsync({ id: leadId, [chave]: limpo === "" ? null : limpo });
    },
    [leadId, data, saveCustomField, updateLead],
  );

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

  // Na forma `coluna` a caixa de aviso tem de ocupar EXATAMENTE a largura da
  // coluna: sem isso ela vira `flex-1` e empurra o negócio para fora da tela
  // enquanto carrega, e o painel pisca de duas larguras a cada abertura.
  const molduraAviso =
    forma === "coluna"
      ? "w-[356px] shrink-0 border-r border-border"
      : "rounded-xl border border-border";

  if (isLoading || visibility === "loading") {
    return (
      <div className={cn("flex h-full items-center justify-center bg-background", molduraAviso)}>
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
      <div
        className={cn(
          "flex h-full items-center justify-center bg-background px-6 text-center",
          molduraAviso,
        )}
      >
        <span className="text-[13px] text-muted-foreground">{mensagem}</span>
      </div>
    );
  }

  if (forma === "coluna") {
    return (
      <LeadCardAside
        lead={data}
        onSaveNote={salvarNota}
        onSaveField={salvarCampo}
        onAbrirFicha={onAbrirFicha}
      />
    );
  }

  return (
    <LeadCard
      lead={data}
      onSaveNote={salvarNota}
      onOpenDeal={onOpenDeal ? (entryId) => onOpenDeal(entryId, data.id) : undefined}
      onNewDeal={onNewDeal}
      onSaveField={salvarCampo}
      onToggleCopilot={(ativo) =>
        leadId && toggleAI.mutate({ leadId, disabled: !ativo })
      }
      onDelete={async () => {
        if (!leadId || !data) return;
        // Confirmação nativa, igual ao card antigo: exclusão de lead leva junto
        // conversas, reuniões e follow-ups. Trocar por um diálogo bonito é
        // trabalho de UI que não vale atrasar o fechamento do buraco.
        if (!window.confirm(`Excluir "${data.nome}"? A ação vai para a lixeira.`)) return;
        try {
          await deleteLead.mutateAsync(leadId);
          toast.success("Lead movido para a lixeira.");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erro ao excluir o lead.");
        }
      }}
    />
  );
}
