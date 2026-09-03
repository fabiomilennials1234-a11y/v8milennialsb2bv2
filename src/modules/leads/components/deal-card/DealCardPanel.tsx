import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useViewport } from "@/shared/hooks/use-viewport";
import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import { useFeaturePermission } from "@/modules/identity";
import { useLeadCallAction } from "@/shared/components/LeadCallActionSlot";
import { useQueryClient } from "@tanstack/react-query";
import { useDealSheet } from "../deal-detail/deal-sheet-context";
import { useLeadSheet } from "../lead-detail/hooks/useLeadSheet";
import { useCrossPipeMove } from "../lead-detail/modal/pipes/useCrossPipeMove";
import {
  useCreateLeadComment,
  useDeleteLeadComment,
  useLeadComments,
  useUpdateLeadComment,
} from "../lead-detail/hooks/useLeadComments";
import { LeadCardContainer } from "../lead-card/LeadCardContainer";
import { LeadCardEtiquetas } from "../lead-card/LeadCardEtiquetas";
import { AdicionarProdutoDialog } from "./AdicionarProdutoDialog";
import { DealCard } from "./DealCard";
import { DealCardChecklists } from "./DealCardChecklists";
import { useDealCardData } from "./useDealCardData";
import { useExcluirNegocio } from "./useExcluirNegocio";
import {
  useAtualizarItemDoNegocio,
  useGarantirNegocioDaEntrada,
  useRemoverItemDoNegocio,
} from "./useItensDoNegocio";
import type { DealCardComentario, ItemEditado } from "./types";

/**
 * A casca do painel — diálogo de DUAS COLUNAS no desktop, folha no celular.
 *
 * Mesma separação de antes: `DealCard` desenha, `useDealCardData` busca, este
 * arquivo decide onde aparece. O que mudou é quantas colunas aparecem.
 *
 * ── DE DOIS PAINÉIS QUE SE EXCLUEM PARA UM DE DUAS COLUNAS ────────────────
 * Até aqui, clicar na pessoa FECHAVA o negócio e abria a ficha do lead. A
 * regra por trás era boa — "quem empilha passa a ter duas verdades na tela
 * sobre o mesmo lead" — mas o preço era alto: para conferir o telefone de quem
 * está do outro lado da proposta, perdia-se o negócio de vista.
 *
 * O print do DataCrazy resolve sem quebrar a regra: **não empilha, encosta**.
 * A pessoa ocupa uma coluna fixa de 356px à esquerda, o negócio ocupa o resto.
 * Continua havendo uma ficha de cada assunto; elas só passaram a caber juntas.
 *
 * A ficha INTEIRA do lead não morreu: o lápis e o "Ver ficha completa" da
 * coluna levam até ela, e a lista de Leads continua abrindo o lead direto.
 */
export const DealCardPanel = memo(function DealCardPanel() {
  const { isOpen, entryId, leadId, aba, close, openDeal } = useDealSheet();
  const renderLigar = useLeadCallAction();
  const { openLead } = useLeadSheet();
  const { isMobile } = useViewport();
  const queryClient = useQueryClient();

  const { data, isLoading, organizacaoId, membroId, souAdmin, resumoChecklists } =
    useDealCardData(entryId, leadId, isOpen);

  const [adicionandoProduto, setAdicionandoProduto] = useState(false);

  /**
   * Lançar produto exige a linha em `deals` — `deal_items.deal_id` é NOT NULL.
   *
   * 🚨 **Antes, quando ela não existia, o botão simplesmente não descia** e o
   * bloco imprimia *"Este card ainda não tem um negócio aberto"*. Medido em
   * prod: **9.258 de 48.138 entradas (19,2%)** — o cliente abria o card e não
   * tinha como lançar produto nenhum.
   *
   * Agora o botão desce SEMPRE, e o negócio é materializado no clique, por
   * `garantir_negocio_da_entrada` (idempotente). Ver `useGarantirNegocioDaEntrada`
   * para por que isso NÃO viola a decisão 3 da ADR-0023 — o clique é humano; o
   * que ela proíbe é ingest, integração e automação.
   *
   * ⚠️ O comentário que estava aqui dizia que a única porta era `abrir_negocio`
   * (que cria card NOVO) e que pendurar negócio numa entrada existente seria
   * "trabalho de RPC própria". **Caducou**: essa RPC passou a existir na
   * `20270904000000`, e o backfill da `20270908005010` já a usa.
   */
  const dealId = data?.dealId ?? null;
  const garantirNegocio = useGarantirNegocioDaEntrada(entryId);

  /**
   * O `deal_id` que a RPC acabou de criar.
   *
   * Serve para não esperar o refetch do painel: `invalidateQueries` volta com o
   * `dealId` novo, mas só depois da ida ao servidor, e o diálogo precisa do id
   * no mesmo gesto. Guardar o retorno abre o diálogo na hora; quando o refetch
   * chega, `data.dealId` passa a ser a mesma coisa e este estado deixa de
   * importar. Zerado ao trocar de card, senão o card seguinte herdaria o
   * negócio do anterior.
   */
  const [dealIdMaterializado, setDealIdMaterializado] = useState<string | null>(null);
  useEffect(() => setDealIdMaterializado(null), [entryId]);

  const dealIdParaProduto = dealId ?? dealIdMaterializado;

  /**
   * Abrir o "Adicionar produto" a partir de QUALQUER card.
   *
   * Com negócio, é o que sempre foi: abre o diálogo. Sem negócio, materializa
   * primeiro e só então abre — se a RPC falhar, o diálogo não abre e o toast do
   * hook explica, que é melhor que abrir um diálogo cujo INSERT vai falhar.
   */
  const adicionarProduto = useCallback(async () => {
    if (!dealIdParaProduto) {
      if (!entryId || garantirNegocio.isPending) return;
      try {
        setDealIdMaterializado(await garantirNegocio.mutateAsync(entryId));
      } catch {
        return; // o toast é do `onError` do hook
      }
    }
    setAdicionandoProduto(true);
  }, [dealIdParaProduto, entryId, garantirNegocio]);

  /**
   * Editar e remover item.
   *
   * Montados sempre (e não só quando há `dealId`) porque hook não pode ser
   * condicional — mas eles só **descem** para o card quando existe negócio,
   * pela mesma regra do "+ Adicionar produto": oferecer uma ação que falharia
   * é pior do que não oferecer. Custo de montá-los: dois `useMutation`
   * ociosos, que não disparam consulta nenhuma.
   *
   * As duas reerguem o erro de propósito. A linha da tabela usa o `throw` para
   * decidir se fecha o modo de edição: engolir aqui faria a linha fechar como
   * se tivesse salvado, apagando o que a pessoa digitou.
   */
  const atualizarItem = useAtualizarItemDoNegocio(entryId);
  const removerItem = useRemoverItemDoNegocio(entryId);

  const editarItem = useCallback(
    async (edicao: ItemEditado) => {
      await atualizarItem.mutateAsync(edicao);
    },
    [atualizarItem],
  );

  const removerItemDoNegocio = useCallback(
    async (itemId: string) => {
      await removerItem.mutateAsync(itemId);
      toast.success("Produto removido do negócio.");
    },
    [removerItem],
  );

  /**
   * Mover de etapa — inclusive ganhar e perder, que são movimentos para a
   * etapa terminal (ADR-0023 §5: a posição mora no card e é uma só).
   *
   * Reusa `useCrossPipeMove`, o mesmo motor do `StageRail` do card antigo:
   * ele já invalida o board que hospeda o modal, a camada de negócio que a
   * lista de Leads lê e o log de ação. Escrever mutação nova aqui criaria um
   * segundo caminho de escrita para a mesma coisa — e é assim que as duas
   * verdades voltam.
   */
  const { move, pendingStageKey } = useCrossPipeMove(leadId ?? "");

  const moverEtapa = useCallback(
    async (chave: string) => {
      if (!data || !entryId) return;
      const etapa = data.etapas.find((e) => e.chave === chave);
      if (!etapa) return;

      // SCRUM-637: discriminação por FAMÍLIA (`funilEhSystem`), não mais pelo
      // nome da view — funil de sistema com slug fora do trio agora move.
      if (data.funilEhSystem) {
        await move({ kind: "system", pipeId: entryId, stageKey: chave, stageLabel: etapa.nome });
      } else {
        await move({ kind: "custom", entryId, stageId: chave, stageLabel: etapa.nome });
      }
    },
    [data, entryId, move],
  );

  /**
   * ── Ganhar / perder ───────────────────────────────────────────────────────
   *
   * Desfecho é fato do NEGÓCIO (ADR-0023 Emenda 1). Não move o card: o
   * vendedor decide na etapa em que estiver, que é o que destrava os 283 funis
   * (71%) sem etapa terminal.
   *
   * Vai por RPC, não por `.update()`, por três razões — e a terceira decide:
   * `deals.outcome` ainda não existe em `types.ts`; a transição de `outcome` é
   * o que grava no caderno de vendas, append-only; e 26,6% das entradas não têm
   * linha em `deals`, que a RPC materializa na mesma transação.
   *
   * O ramo de `isMissingSchemaError` FICA mesmo com a migration já aplicada em
   * prod: branch efêmera e checkout local ficam atrás do ledger, e é lá que o
   * botão voltaria a estourar erro cru.
   */
  const [decidindo, setDecidindo] = useState(false);

  const definirDesfecho = useCallback(
    async (desfecho: "won" | "lost") => {
      if (!entryId || decidindo) return;
      setDecidindo(true);
      try {
        const { error } = await supabase.rpc("definir_desfecho_da_entrada", {
          p_entry_id: entryId,
          p_outcome: desfecho,
          p_loss_reason: undefined,
        });

        if (error) {
          // ── A migration ainda não rodou ────────────────────────────────────
          //
          // O front é mergeado antes do apply, por desenho. Sem este ramo, o
          // botão aparece e o clique cai num toast de erro — e para os 113
          // funis que TINHAM etapa terminal isso é regressão pura: eles
          // fechavam negócio ontem e parariam hoje.
          //
          // Então degrada para o comportamento anterior: mover para a etapa
          // terminal, quando ela existe. Some sozinho quando a RPC responder.
          if (isMissingSchemaError(error)) {
            const papel = desfecho === "won" ? "ganho" : "perdido";
            const terminal = data?.etapas.find((e) => e.papel === papel);
            if (terminal) {
              await moverEtapa(terminal.chave);
              return;
            }
            // Os 283 funis (71%) sem etapa terminal nunca tiveram este botão.
            // Dizer o que falta é melhor que um erro de banco cru.
            toast.error("Disponível assim que a atualização do funil for aplicada.");
            return;
          }
          throw new Error(error.message);
        }

        toast.success(desfecho === "won" ? "Negócio ganho" : "Negócio perdido");
        // `leads-deals` é de onde sai `estado` do card. Sem invalidar, o botão
        // some do jeito certo mas o cabeçalho segue dizendo "aberto".
        await queryClient.invalidateQueries({ queryKey: ["leads-deals"] });
        queryClient.invalidateQueries({ queryKey: ["deal-card-extras", entryId] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível registrar o desfecho");
      } finally {
        setDecidindo(false);
      }
    },
    [entryId, decidindo, queryClient, data, moverEtapa],
  );

  /**
   * ── Excluir o negócio ─────────────────────────────────────────────────────
   * A pergunta que o painel não sabia responder: "isto aqui não existe mais,
   * como eu tiro?". Não havia caminho nenhum — nem menu, nem botão. A única
   * porta era o `⋯` do card no kanban, que não existe em /leads nem depois que
   * o painel está aberto por cima do board.
   *
   * O sujeito é o NEGÓCIO. O lead sobrevive: continua na base, nos outros
   * funis e com a ficha dele intacta — por isso o texto da confirmação diz
   * isso com todas as letras. "Excluir" num painel que mostra a pessoa na
   * coluna da esquerda é ambíguo o bastante para merecer a frase inteira.
   *
   * ⚠️ O discriminador é `funilEhSystem` (`pipelines.type`) — desde a
   * SCRUM-637 é o MESMO critério do `moverEtapa` acima: nenhuma decisão sai
   * mais do nome da view. Ver `useExcluirNegocio` para o resto.
   */
  const { allowed: podeExcluirCard } = useFeaturePermission("pipeline.delete_cards");
  const { excluir, excluindo } = useExcluirNegocio();
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  const confirmarExclusao = useCallback(async () => {
    if (!data || !entryId || !leadId) return;
    const desfecho = await excluir({
      entryId,
      leadId,
      ehSystem: data.funilEhSystem,
      titulo: data.titulo,
      funil: data.funil,
    });

    /**
     * A caixa fecha nos desfechos em que não há mais o que decidir; nos outros
     * ela FICA. A versão anterior fechava sempre, o que anulava metade do
     * `preventDefault` logo abaixo: quem levava recusa da RLS via a caixa
     * sumir e o negócio continuar ali — de novo o "confirmei e não aconteceu
     * nada" que o `.select()` depois do DELETE existe para eliminar.
     *
     * `ja-nao-existia` fecha junto com o painel: o card já não está lá, e
     * manter a tela aberta sobre ele só produz uma segunda tentativa.
     */
    if (desfecho === "excluido" || desfecho === "ja-nao-existia") {
      setConfirmandoExclusao(false);
      close();
    }
  }, [data, entryId, leadId, excluir, close]);

  const salvarNota = useCallback(
    async (texto: string) => {
      if (!entryId) return;
      const { error } = await supabase
        .from("pipeline_entries")
        .update({ notes: texto })
        .eq("id", entryId);
      if (error) {
        toast.error("Não foi possível salvar a anotação. O texto continua na tela.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["deal-card-extras", entryId] });
    },
    [entryId, queryClient],
  );

  /**
   * ── Comentários ────────────────────────────────────────────────────────
   * A busca é por LEAD, e é de propósito: 2.885 comentários já existiam quando
   * a coluna `pipeline_entry_id` nasceu, todos sem negócio, e filtrar por
   * negócio faria o histórico inteiro sumir da tela onde ele voltou a ser
   * lido. Quem separa é o SELO — ver `deOutroNegocio` no mapeamento abaixo.
   *
   * Passa `null` quando o painel está fechado. `close()` já zera o `leadId` no
   * provider, mas a garantia não pode depender disso: o custo de errar é uma
   * consulta por negócio fechado, em cinco telas.
   */
  const { data: comentariosBrutos } = useLeadComments(isOpen ? leadId : null);
  const criarComentario = useCreateLeadComment();
  const atualizarComentario = useUpdateLeadComment();
  const removerComentario = useDeleteLeadComment();

  /**
   * `pipeline_entries.id` → título do negócio, para o selo.
   *
   * Não custa consulta: `outrosNegocios` é a lista de TODOS os negócios do
   * lead, este inclusive, que `useDealCardData` já tem em memória.
   */
  const tituloPorNegocio = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const n of data?.outrosNegocios ?? []) mapa.set(n.id, n.titulo);
    return mapa;
  }, [data?.outrosNegocios]);

  const comentarios = useMemo<DealCardComentario[]>(() => {
    return (comentariosBrutos ?? [])
      // Apagado é soft-delete e continua na tabela. A lápide "Comentário
      // apagado" do modal antigo virava ruído num bloco que agora divide
      // espaço com produtos e etapas — e a auditoria não se perde: o gatilho
      // `fn_log_lead_comment_event` grava `comment_deleted` em `lead_history`.
      .filter((c) => !c.deleted_at)
      .map((c) => {
        const nasceuEm = c.pipeline_entry_id ?? null;
        /**
         * Selo só quando o comentário veio de OUTRO negócio. Sem vínculo
         * (`null`) é comentário do lead: vale para todos os negócios dele, e
         * carimbar "de outro lugar" seria afirmar coisa que não aconteceu.
         */
        const deOutroNegocio =
          nasceuEm && nasceuEm !== entryId
            ? (tituloPorNegocio.get(nasceuEm) ?? "Outro negócio")
            : null;

        // Autoria pelo MEMBRO, não pelo usuário: `useAuth` lança fora do
        // provider e derrubaria o guarda que monta este painel sem ele.
        // Falha fechada — sem membro conhecido, ninguém edita nada.
        const souOAutor = !!membroId && c.author_team_member_id === membroId;

        return {
          id: c.id,
          corpo: c.body,
          autor: c.author?.name ?? "Usuário",
          autorAvatar: c.author?.avatar_url ?? null,
          criadoEm: c.created_at,
          editadoEm: c.updated_at ?? null,
          deOutroNegocio,
          podeEditar: souOAutor,
          podeApagar: souOAutor || !!souAdmin,
        };
      });
  }, [comentariosBrutos, entryId, tituloPorNegocio, membroId, souAdmin]);

  const comentar = useCallback(
    async (texto: string) => {
      if (!leadId || !organizacaoId) return;
      try {
        await criarComentario.mutateAsync({
          leadId,
          organizationId: organizacaoId,
          body: texto,
          // É isto que responde "em qual negócio isto foi dito".
          pipelineEntryId: entryId,
        });
      } catch {
        toast.error("Não foi possível publicar o comentário. O texto continua na caixa.");
        // Reergue para o bloco NÃO esvaziar a caixa — ver a regra 1 do
        // `DealCardComments`. Engolir aqui apagaria o que a pessoa escreveu.
        throw new Error("comentario-nao-publicado");
      }
    },
    [leadId, organizacaoId, entryId, criarComentario],
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
        throw new Error("comentario-nao-apagado");
      }
    },
    [leadId, removerComentario],
  );

  /**
   * Sem lead ou sem org não há onde gravar — `lead_comments.lead_id` e
   * `organization_id` são NOT NULL, e a policy de INSERT exige a org. O bloco
   * então some a caixa de escrever e fica só com o histórico, pela mesma regra
   * do "+ Adicionar produto" sem `deal_id`: oferecer uma ação cujo INSERT
   * falharia é pior do que não oferecer.
   */
  const podeComentar = !!leadId && !!organizacaoId;

  const abrirFicha = useCallback(() => {
    close();
    if (leadId) openLead(leadId);
  }, [close, openLead, leadId]);

  /**
   * Trocar de negócio pela aba "Negócios" sem fechar o painel.
   *
   * `openDeal` do mesmo provider que já está aberto só troca `entryId` — o
   * painel continua montado e a coluna do lead nem recarrega, porque o lead é o
   * mesmo. Fechar e reabrir aqui perderia a rolagem e piscaria a tela inteira
   * para trocar metade dela.
   */
  const trocarNegocio = useCallback(
    (id: string) => {
      if (leadId) openDeal(id, leadId);
    },
    [openDeal, leadId],
  );

  /**
   * ── A faixa de etiquetas tem UM lugar por vez ──────────────────────────
   * Etiqueta é do lead (`lead_tags` é a única junção do schema), então a casa
   * dela é a coluna da pessoa. Quando a coluna não cabe — o celular monta
   * `conteudo(false)` — ela migra para o cabeçalho do negócio, senão etiquetar
   * seria impossível no telefone. Nunca as duas: `deal-card.test.tsx` guarda a
   * regra de que a pessoa não é reestampada dentro do negócio.
   *
   * `souAdmin` decide se dá para CRIAR etiqueta nova, e não só pendurar uma
   * existente: `tags_insert_admin_only` exige `is_user_admin()` no INSERT em
   * `tags`. O painel já tem a resposta em mãos — perguntar de novo lá dentro
   * seria uma segunda consulta para um fato que ele acabou de ler.
   */
  const negocio = (comLead: boolean) =>
    isLoading ? (
      <div className="flex h-full flex-1 items-center justify-center bg-background">
        <span className="text-[13px] text-muted-foreground">Carregando…</span>
      </div>
    ) : data ? (
      <DealCard
        negocio={data}
        etiquetas={
          !comLead && leadId ? (
            <LeadCardEtiquetas leadId={leadId} podeCriar={!!souAdmin} />
          ) : undefined
        }
        /* Vê o negócio → vê o lead → pode ligar. Quem desenha o botão é a
           raiz (App.tsx), via LeadCallActionSlot. */
        acaoLigar={
          leadId && renderLigar ? renderLigar({ id: leadId, nome: data.lead.nome }) : undefined
        }
        onSaveNote={salvarNota}
        onMoverEtapa={moverEtapa}
        onDefinirDesfecho={definirDesfecho}
        decidindo={decidindo}
        onOpenDeal={trocarNegocio}
        onNewDeal={abrirFicha}
        /* Sempre — inclusive no card sem negócio, que é materializado no
           clique. Era esta linha que sumia o botão em 19,2% dos cards. */
        onAdicionarProduto={adicionarProduto}
        /* Estes dois seguem presos ao negócio, e isso NÃO esconde nada: o lápis
           e a lixeira são de item já lançado, e não há item sem negócio. */
        onEditarItem={dealIdParaProduto ? editarItem : undefined}
        onRemoverItem={dealIdParaProduto ? removerItemDoNegocio : undefined}
        movendo={pendingStageKey}
        comentarios={comentarios}
        onComentar={podeComentar ? comentar : undefined}
        onEditarComentario={podeComentar ? editarComentario : undefined}
        onApagarComentario={podeComentar ? apagarComentario : undefined}
        comentando={criarComentario.isPending}
        abaInicial={aba}
        resumoChecklists={resumoChecklists ?? null}
        /* O elemento é criado aqui, montado lá — e só quando a aba está aberta.
           Ver o bloco `painelChecklists` no `DealCard` para o porquê do slot. */
        painelChecklists={<DealCardChecklists leadId={leadId} entryId={entryId} />}
        onExcluir={podeExcluirCard ? () => setConfirmandoExclusao(true) : undefined}
        excluindo={excluindo}
      />
    ) : (
      <div className="flex h-full flex-1 items-center justify-center bg-background px-6 text-center">
        <span className="text-[13px] text-muted-foreground">Negócio não encontrado.</span>
      </div>
    );

  /**
   * `comLead` é o corte de largura, não de importância.
   *
   * No celular não há 356px de sobra para a coluna da pessoa sem espremer o
   * negócio a ponto de a régua de etapas virar textura. Lá o painel volta a ser
   * de uma coluna, e a pessoa continua a um toque pelo card do Lead.
   */
  const conteudo = (comLead: boolean) => (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-background">
      {/* A coluna da pessoa só existe quando há pessoa. Um negócio órfão de lead
          não deveria existir (ADR-0023 §2), mas se existir o painel abre com o
          negócio ocupando tudo em vez de com uma coluna vazia acusando falta. */}
      {comLead && leadId && (
        <LeadCardContainer
          leadId={leadId}
          isOpen={isOpen}
          forma="coluna"
          onAbrirFicha={abrirFicha}
          podeCriarEtiqueta={!!souAdmin}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">{negocio(comLead)}</div>
    </div>
  );

  if (!isOpen) return null;

  /**
   * O diálogo de produto fica FORA da casca, irmão dela.
   *
   * Aninhá-lo dentro do `DialogContent` empilharia dois overlays do Radix, que é
   * exatamente o que `cards-nunca-empilham.test.tsx` proíbe: o de dentro rouba o
   * foco, e fechar um fecha os dois. Como irmão, cada um tem seu portal e o
   * painel continua aberto por trás enquanto o produto é lançado.
   *
   * E ele só é MONTADO quando abre. Montá-lo junto com o painel — mesmo fechado —
   * põe `useOrganization` e a mutation para rodar em toda abertura de negócio,
   * por uma tela que ninguém pediu ainda. Mesma regra do painel logo acima
   * (`if (!isOpen) return null`).
   */
  const dialogoProduto = dealIdParaProduto && adicionandoProduto ? (
    <AdicionarProdutoDialog
      aberto={adicionandoProduto}
      aoFechar={() => setAdicionandoProduto(false)}
      /* Pode ser o negócio que já existia OU o que a RPC acabou de criar — o
         `adicionarProduto` só liga `adicionandoProduto` depois de ter um id. */
      dealId={dealIdParaProduto}
      entryId={entryId}
      itensAtuais={data?.itens ?? []}
    />
  ) : null;

  /**
   * A confirmação fica AQUI, irmã da casca, e não dentro do `DealCard`.
   *
   * ⚠️ Não pelo motivo que parece. A versão anterior deste bloco dizia que
   * aninhar "empilharia dois overlays do Radix, o de dentro roubando o foco e o
   * Esc fechando os dois" — copiado do diálogo de produto logo acima.
   * **Medido em 27/08/2026, aninhando de verdade: não reproduz.** O Radix
   * empilha as camadas (`DismissableLayer`) e o Esc dismissa só a de cima; nos
   * dois arranjos o painel sobrevive e o DOM é idêntico, porque o
   * `AlertDialogContent` sai por portal para o `body` de qualquer jeito.
   *
   * O motivo real é mais modesto, e é suficiente: o estado da confirmação
   * (`confirmandoExclusao`, `excluindo`) e quem sabe apagar vivem neste
   * arquivo. Deixar o diálogo junto deles evita descer duas props a mais e
   * mantém o `DealCard` sem nada além de desenho. É a mesma forma do
   * `AdicionarProdutoDialog`, e forma repetida é o que se lê rápido.
   *
   * ── `z-[60]` NÃO é enfeite ────────────────────────────────────────────────
   * Ser irmão resolve o roubo de foco por ANINHAMENTO; não resolve a ordem de
   * PINTURA. No celular o painel é um `Sheet`, e `SheetContent` carrega
   * `z-[51]` (ui/sheet.tsx) enquanto o overlay e o conteúdo do `AlertDialog`
   * são `z-50` (ui/alert-dialog.tsx). Portalizados como irmãos no mesmo
   * contexto de empilhamento, 51 vence 50 e a confirmação nasce ATRÁS do
   * painel — modal, com o resto em `pointer-events: none`, sem Esc no celular.
   * Ou seja: tela travada, saída só por recarregar a página. No desktop passa
   * despercebido porque `DialogContent` também é `z-50` e o desempate cai na
   * ordem do DOM. Subir os dois acima de 51 conserta o celular sem mexer em
   * primitivo compartilhado.
   *
   * ── O texto diz o que REALMENTE acontece ─────────────────────────────────
   * A versão anterior prometia "histórico e outros negócios intactos". Meia
   * verdade cara: apagar a entry cascateia em `pipe_proposta_items`,
   * `checklists` e `tinyerp_order_mappings` (o vínculo com a NF-e emitida), e
   * zera `commissions.pipeline_entry_id`. O que sobrevive é a PESSOA, não os
   * anexos do negócio — e é isso que a caixa passa a dizer.
   */
  const dialogoExclusao = data ? (
    <AlertDialog open={confirmandoExclusao} onOpenChange={setConfirmandoExclusao}>
      <AlertDialogContent
        overlayClassName="z-[60]"
        className="z-[60]"
        data-testid="deal-card-excluir-dialogo"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir "{data.titulo}"?</AlertDialogTitle>
          <AlertDialogDescription>
            O negócio sai do funil "{data.funil}" e leva junto o que está
            pendurado nele: produtos e itens do orçamento, checklists e o
            vínculo com a nota fiscal, se houver.{" "}
            <strong>{data.lead.nome} continua na base</strong>, com a ficha, a
            conversa e os outros negócios. <strong>Não há como desfazer</strong>
            {" "}— o negócio não vai para a lixeira.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            /* `preventDefault` porque o `AlertDialogAction` fecha o diálogo no
               clique: sem isto o "Excluindo…" nunca aparece e uma falha de RLS
               apagaria a mensagem junto com a tela. Quem fecha é o handler. */
            onClick={(e) => {
              e.preventDefault();
              void confirmarExclusao();
            }}
            disabled={excluindo}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="deal-card-excluir-confirmar"
          >
            {excluindo ? "Excluindo…" : "Excluir negócio"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  if (isMobile) {
    return (
      <>
        <Sheet open={isOpen} onOpenChange={(v) => !v && close()}>
          <SheetContent side="bottom" className="h-[92vh] p-0">
            {conteudo(false)}
          </SheetContent>
        </Sheet>
        {dialogoProduto}
        {dialogoExclusao}
      </>
    );
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(v) => !v && close()}>
      {/* Sem botão de fechar próprio: o `DialogContent` já desenha um
          `DialogPrimitive.Close` em `right-4 top-4` (ui/dialog.tsx:48-51).
          O botão que existia aqui ficava em `right-3 top-3` — 4px ao lado —
          e o resultado era DOIS "X" quase sobrepostos no canto.
          Fica o do primitivo: ele já traz rótulo `sr-only`, fecha no Esc e
          devolve o foco ao gatilho, e é o mesmo de todo diálogo do produto.

          A largura subiu de 900 para 1240: 356 da coluna da pessoa mais os
          ~880 que o negócio já usava. Abaixo disso a régua de etapas de 7 casas
          — o funil mais longo em prod — perde o nome embaixo de cada círculo. */}
      <DialogContent className="h-[88vh] max-w-[1240px] gap-0 overflow-hidden p-0">
        {conteudo(true)}
      </DialogContent>
    </Dialog>
    {dialogoProduto}
    {dialogoExclusao}
    </>
  );
});
