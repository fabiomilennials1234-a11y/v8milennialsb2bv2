import { useCallback } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useLeadCallAction } from "@/shared/components/LeadCallActionSlot";

import { LeadCard } from "./LeadCard";
import { LeadCardAside } from "./LeadCardAside";
import { LeadCardControles } from "./LeadCardControles";
import { LeadCardEtiquetas } from "./LeadCardEtiquetas";
import { useLeadCardData } from "./useLeadCardData";
import type { QualificationTier } from "../lead-detail/modal/types";
import { useUpdateLead, useToggleLeadAI, useDeleteLead } from "../../hooks/useLeads";
import { useSaveCustomFieldValue } from "../../hooks/useLeadCustomFields";
import {
  useCreateLeadComment,
  useDeleteLeadComment,
  useUpdateLeadComment,
} from "../lead-detail/hooks/useLeadComments";

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
  podeCriarEtiqueta = false,
}: {
  leadId: string | null;
  isOpen: boolean;
  onOpenDeal?: (entryId: string, leadId: string) => void;
  onNewDeal?: () => void;
  /**
   * Oferece criar etiqueta NOVA a partir do card, e não só pendurar uma que já
   * existe. Só de admin: `tags_insert_admin_only` exige `is_user_admin()` no
   * INSERT em `tags`, enquanto `lead_tags_insert_organization` deixa qualquer
   * pessoa da org pendurar. Quem sabe a resposta passa adiante — o painel do
   * Negócio já tem `souAdmin` em mãos — em vez de este container perguntar de
   * novo em toda abertura de card.
   */
  podeCriarEtiqueta?: boolean;
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
  const { data, isLoading, visibility, organizacaoId } = useLeadCardData(leadId, isOpen);
  const renderLigar = useLeadCallAction();
  const updateLead = useUpdateLead();
  const saveCustomField = useSaveCustomFieldValue();
  const toggleAI = useToggleLeadAI();
  const deleteLead = useDeleteLead();
  const criarComentario = useCreateLeadComment();
  const atualizarComentario = useUpdateLeadComment();
  const removerComentario = useDeleteLeadComment();

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

  /**
   * ── Comentar PELA ficha da pessoa ────────────────────────────────────────
   * Sem `pipelineEntryId`: o comentário escrito aqui é do LEAD, não de um
   * negócio. É a semântica que a coluna já documenta — NULL quer dizer
   * "nasceu fora de um negócio" — e é o que os 2.867 comentários antigos de
   * prod são. Carimbar um negócio escolhido pela ficha inventaria vínculo, e
   * vínculo inventado faz o selo do painel do Negócio mentir.
   */
  const comentar = useCallback(
    async (texto: string) => {
      if (!leadId || !organizacaoId) return;
      try {
        await criarComentario.mutateAsync({ leadId, organizationId: organizacaoId, body: texto });
      } catch {
        toast.error("Não foi possível publicar o comentário. O texto continua na caixa.");
        // Reergue para a caixa NÃO esvaziar — engolir aqui apagaria o texto.
        throw new Error("comentario-nao-publicado");
      }
    },
    [leadId, organizacaoId, criarComentario],
  );

  const editarComentario = useCallback(
    async (id: string, texto: string) => {
      if (!leadId) return;
      try {
        await atualizarComentario.mutateAsync({ commentId: id, leadId, body: texto });
      } catch {
        toast.error("Não foi possível salvar a edição do comentário.");
        throw new Error("comentario-nao-editado");
      }
    },
    [leadId, atualizarComentario],
  );

  const apagarComentario = useCallback(
    async (id: string) => {
      if (!leadId) return;
      try {
        await removerComentario.mutateAsync({ commentId: id, leadId });
        toast.success("Comentário apagado.");
      } catch {
        toast.error("Não foi possível apagar o comentário.");
      }
    },
    [leadId, removerComentario],
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
    /**
     * Os ids vêm de `data.edicao`, e NÃO de um segundo `useLeadDetail`.
     *
     * Chamar o hook de novo aqui parecia grátis — react-query devolveria a
     * mesma linha do cache — mas `useLeadDetail` monta `useTrackView`, que não
     * deduplica: cada montagem dispara `track_recent_view`. Como o
     * `useDealCardData` do painel já o chama, a segunda chamada gravaria DUAS
     * visualizações a cada abertura do painel. Quem pegou foi
     * `cards-nunca-empilham.test.tsx`.
     *
     * O `as` cobre o `types.ts` gerado, que ainda não conhece o enum de tier —
     * mesmo motivo do cast em `QualificationSlot.tsx:37`.
     */
    const e = data.edicao;
    const tier = (v: string | null | undefined): QualificationTier | null =>
      v ? (v as QualificationTier) : null;

    return (
      <LeadCardAside
        lead={data}
        onSaveNote={salvarNota}
        onSaveField={salvarCampo}
        onAbrirFicha={onAbrirFicha}
        editorDeEtiquetas={
          leadId ? (
            <LeadCardEtiquetas
              leadId={leadId}
              podeCriar={podeCriarEtiqueta}
              alinhamento="centro"
            />
          ) : undefined
        }
        controles={
          leadId && e ? (
            <LeadCardControles
              leadId={leadId}
              preVenda={e.preVenda}
              venda={e.venda}
              preQualificacao={tier(e.preQualificacao)}
              qualificacao={tier(e.qualificacao)}
              atualizadoEm={e.atualizadoEm}
            />
          ) : undefined
        }
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
      // Sem org conhecida a caixa de escrever some: a policy de INSERT exige a
      // org, e oferecer uma ação cujo gravar falharia é pior que não oferecer.
      onComentar={leadId && organizacaoId ? comentar : undefined}
      onEditarComentario={leadId ? editarComentario : undefined}
      onApagarComentario={leadId ? apagarComentario : undefined}
      comentando={criarComentario.isPending}
      editorDeEtiquetas={
        leadId ? (
          <LeadCardEtiquetas leadId={leadId} podeCriar={podeCriarEtiqueta} />
        ) : undefined
      }
      // Vê o lead → pode ligar. Quem desenha o botão é a raiz (App.tsx), via
      // LeadCallActionSlot; ele some sozinho sem número de voz ao alcance.
      acaoLigar={leadId && renderLigar ? renderLigar({ id: leadId, nome: data.nome }) : undefined}
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
