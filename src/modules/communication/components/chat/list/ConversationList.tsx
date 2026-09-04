/**
 * ConversationList — coluna esquerda do chat: seletor de instance, busca, filtros, tabs e lista.
 *
 * Extraído de WhatsAppChat.tsx ContactList (C5).
 *
 * C23: virtualização para >50 contatos via @tanstack/react-virtual.
 * Lista plana (sem grouping) → estimateSize via CSS var --chat-list-row-height.
 * Mobile fallback: render plain sempre.
 *
 * Filtro (2026-07): desktop usa o modelo Linear (InboxFilterBar + chips) sobre o
 * engine puro `lib/inboxFilter.ts`. Mobile mantém seu header próprio (all/unread/
 * groups) compartilhando só o filtro de vendedor.
 */
import { useRef, useCallback, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Search, MessageSquare, Archive, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { boxUsesChannelMessages } from "@/modules/communication/hooks/chat/inbox-box-source";
import { useViewport } from "@/shared/hooks/use-viewport";
import type { ChatContact } from "@/modules/communication/hooks/useWhatsAppChat";
import {
  contactKey,
  isWhatsAppContact,
  type InboxBox,
  type InboxContact,
} from "@/modules/communication/hooks/chat/types";
import { ConversationListItem, contactDisplayName } from "./ConversationListItem";
import { SeletorDeCaixas } from "./SeletorDeCaixas";
import type { CaixaDaLinha } from "@/modules/communication/lib/caixaUnificada";
import type { NaoLidasDaCaixa } from "@/modules/communication/hooks/chat/useNaoLidasPorCaixa";
import { MobileConversationRow } from "./MobileConversationRow";
import { MobileChatListHeader, type MobileChatFilter } from "./MobileChatListHeader";
import { InboxFilterBar } from "./InboxFilterBar";
import { InboxEnrichmentNotice } from "./InboxEnrichmentNotice";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";
import {
  applyInboxFilters,
  type InboxFilterState,
  type InboxFilterContext,
  type InboxTab,
} from "@/modules/communication/lib/inboxFilter";
import type { InboxFilterGate } from "@/modules/communication/lib/inboxEnrichment";
import type { FunnelOption } from "@/modules/communication/hooks/chat/useInboxFunnelOptions";

// ─── Config ───────────────────────────────────────────────────────────────────

const VIRTUALIZE_THRESHOLD = 50;

/** Altura estimada por item baseada em density CSS vars de useChatDensity. */
function estimateItemHeight(density: DensityMode): number {
  switch (density) {
    case "compact": return 56;
    case "spacious": return 88;
    default: return 72;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationListProps {
  contacts: InboxContact[];
  /** Identidade da conversa aberta — `contactKey`, não telefone. */
  selectedKey: string | null;
  onSelectContact: (key: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
  /**
   * As caixas de entrada disponíveis: números de WhatsApp ∪ canais sociais.
   * Antes era `instances` — o seletor deixou de ser "escolha o número".
   */
  boxes?: InboxBox[];
  /**
   * Ids das caixas MARCADAS. Nunca vazio quando há caixa — ver
   * `useCaixasSelecionadas`. Com um id só o seletor se comporta como o de antes.
   */
  marcadas?: string[];
  onAlternarCaixa?: (boxId: string) => void;
  onSomenteCaixa?: (boxId: string) => void;
  onTodasAsCaixas?: () => void;
  /**
   * Não lidas por caixa, INCLUSIVE as desmarcadas — é o que faz o seletor
   * apontar onde está o que a lista não mostra (D8).
   */
  naoLidasPorCaixa?: Map<string, NaoLidasDaCaixa>;
  /**
   * Caixa de origem e "fio" de cada linha, por `contactKey`.
   *
   * Vem pronto do motor (`unificarCaixas`), e não é derivado aqui: a lista
   * recebe `InboxContact[]` de consumidores diferentes, e só o shell da caixa
   * unificada sabe quais caixas estão em jogo. Ausente = modo de sempre.
   */
  metaPorLinha?: Map<string, { caixa: CaixaDaLinha; tambemEm: CaixaDaLinha[] }>;
  activeTab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  /**
   * Flag por org `chat_abas_de_grupos`, resolvida no shell (é lá que ela também
   * decide o `p_include_groups` da busca). Falsa = a aba "Grupos" não existe, o
   * chip do mobile não existe, e nenhuma linha de grupo chega — o comportamento
   * de #1632, intacto para toda org que não pediu a aba.
   */
  abasDeGrupos?: boolean;
  /**
   * A CAIXA da linha vai junto: `whatsapp_conversations` é por (instância,
   * telefone), e no modo unificado a linha clicada pode não ser da caixa da
   * conversa aberta. Opcional para não quebrar quem chama sem ela.
   */
  onArchive: (phone: string, instanceId?: string | null) => void;
  onUnarchive: (conversationId: string) => void;
  onDelete: (phone: string, instanceId?: string | null) => void;
  isAdmin: boolean;
  instanceId: string | null;
  organizationId: string | null;
  allTags: { id: string; name: string; color: string }[];
  onAddTag: (phone: string, tagId: string, instanceId?: string | null) => void;
  onRemoveTag: (conversationId: string, tagId: string) => void;
  onOpenInstances?: () => void;
  /** Modo de densidade para altura estimada dos itens. */
  density?: DensityMode;
  // ─── Filtro (modelo Linear) ─────────────────────────────────────────────────
  filter: InboxFilterState;
  patch: (partial: Partial<InboxFilterState>) => void;
  toggleMulti: (key: "funnels" | "stages" | "tags" | "tiers", value: string) => void;
  clearFilter: () => void;
  funnelOptions: FunnelOption[];
  vendorOptions: { id: string; name: string }[];
  resolveContactVendorId: (contact: ChatContact) => string | null;
  currentTeamMemberId: string | null;
  canSeeUnassigned: boolean;
  waitingHumanLeadIds?: Set<string>;
  waitingHumanCount: number;
  /**
   * O dado que as dimensões client-side (funil/etapa/qualificação/vendedor) usam
   * já chegou? `"pending"` = ainda carregando, `"error"` = falhou. Em ambos os
   * casos a lista filtrada e os contadores seriam ficção — ver `inboxEnrichment`.
   */
  filterGate: InboxFilterGate;
  onRetryEnrichment: () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ConversationList({
  contacts,
  selectedKey,
  onSelectContact,
  searchQuery,
  onSearchChange,
  isLoading,
  boxes,
  marcadas,
  onAlternarCaixa,
  onSomenteCaixa,
  onTodasAsCaixas,
  naoLidasPorCaixa,
  metaPorLinha,
  activeTab,
  onTabChange,
  abasDeGrupos = false,
  onArchive,
  onUnarchive,
  onDelete,
  isAdmin,
  instanceId,
  organizationId,
  allTags,
  onAddTag,
  onRemoveTag,
  onOpenInstances,
  density = "comfortable",
  filter,
  patch,
  toggleMulti,
  clearFilter,
  funnelOptions,
  vendorOptions,
  resolveContactVendorId,
  currentTeamMemberId,
  canSeeUnassigned,
  waitingHumanLeadIds,
  waitingHumanCount,
  filterGate,
  onRetryEnrichment,
}: ConversationListProps) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const { isMobile } = useViewport();
  const [mobileFilter, setMobileFilter] = useState<MobileChatFilter>("all");

  // A caixa que o header MOBILE nomeia. Com várias marcadas é a primeira da
  // ordem do seletor: o mobile não tem multi-seleção nesta onda (ele cicla), e
  // nomear "3 caixas" no lugar do número não ajudaria quem está ciclando.
  const selectedBox = boxes?.find((b) => marcadas?.includes(b.id)) ?? boxes?.[0] ?? null;
  /**
   * Caixa social muda o REGIME da lista, não só o ícone. Funil, etapa,
   * qualificação, vendedor, etiqueta, arquivadas e "pediu atendente" são todos
   * conceitos ancorados em lead ou em `whatsapp_conversations`; a RPC social não
   * aplica nenhum deles. Mostrá-los inertes seria mentir sobre o recorte —
   * o usuário clicaria num chip e a lista não mudaria.
   */
  /**
   * Mais de uma caixa marcada. A lista passa a misturar os dois regimes, e é o
   * ÚNICO ramo novo desta tela — com uma caixa só, tudo abaixo se comporta
   * exatamente como antes, que é o que 42 das 62 organizações vão ver.
   */
  const modoUnificado = (marcadas?.length ?? 0) > 1;

  const isSocialBox =
    !modoUnificado && selectedBox ? boxUsesChannelMessages(selectedBox) : false;

  /**
   * A metade de WhatsApp da lista. O engine de filtro, os contadores e o
   * enriquecimento falam `ChatContact`; estreitar aqui, uma vez, é o que
   * mantém esse caminho inteiro sem um único `as`.
   */
  const whatsappContacts = useMemo(
    () => contacts.filter(isWhatsAppContact),
    [contacts],
  );

  const filterCtx: InboxFilterContext = useMemo(
    () => ({
      currentTeamMemberId,
      resolveVendorId: resolveContactVendorId,
      waitingHumanLeadIds: waitingHumanLeadIds ?? new Set<string>(),
    }),
    [currentTeamMemberId, resolveContactVendorId, waitingHumanLeadIds],
  );

  // Índice pipelineId → (stageKey → rótulo), pra mostrar a etapa na linha.
  const stageLabelIndex = useMemo(() => {
    const idx = new Map<string, Map<string, string>>();
    for (const f of funnelOptions) {
      const inner = new Map<string, string>();
      for (const s of f.stages) inner.set(s.stageKey, s.label);
      idx.set(f.pipelineId, inner);
    }
    return idx;
  }, [funnelOptions]);

  // Etapa do primeiro funil em que o lead está (com rótulo resolvido).
  const stageLabelFor = useCallback(
    (c: InboxContact): string | null => {
      // Etapa é posição do LEAD num funil. Conversa social não tem lead nesta
      // fatia, então não tem etapa — e "nenhuma" é null, não um rótulo vazio.
      if (c.channel !== "whatsapp") return null;
      const first = c.funnels?.[0];
      if (!first) return null;
      return stageLabelIndex.get(first.pipelineId)?.get(first.stageKey) ?? null;
    },
    [stageLabelIndex],
  );

  // ── Caixa social: só busca local. ─────────────────────────────────────────
  // Nenhuma das dimensões do filtro tem dado para avaliar aqui, e o `activeTab`
  // não existe (não há arquivamento). Uma lista curta e honesta.
  const socialContacts = useMemo(() => {
    // No modo unificado as linhas do canal oficial chegam MISTURADAS com as de
    // Chip; estreitar aqui é o que dá a elas a mesma busca local que teriam na
    // caixa isolada, sem submetê-las a dimensões que a RPC delas não aplica.
    const universo = modoUnificado
      ? contacts.filter((c) => !isWhatsAppContact(c))
      : isSocialBox
        ? contacts
        : ([] as InboxContact[]);
    if (universo.length === 0) return universo;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return universo;
    return universo.filter((c) => contactDisplayName(c).toLowerCase().includes(q));
  }, [isSocialBox, modoUnificado, contacts, searchQuery]);

  // ── Desktop: engine puro. Mobile: header próprio (all/unread/groups + vendedor).
  const whatsappFiltered = useMemo(() => {
    if (!isMobile) {
      return applyInboxFilters(whatsappContacts, filter, filterCtx, { searchQuery, tab: activeTab });
    }
    const search = searchQuery.toLowerCase();
    return whatsappContacts.filter((c) => {
      if (filter.vendor !== "all") {
        const vendorId = resolveContactVendorId(c);
        if (filter.vendor === "mine") { if (vendorId !== currentTeamMemberId) return false; }
        else if (filter.vendor === "unassigned") { if (vendorId) return false; }
        else if (vendorId !== filter.vendor) return false;
      }
      // Grupo só no chip "Grupos", que só existe na org flagada. Nos outros dois
      // chips a recusa é a de #1632.
      if (mobileFilter === "grupos") {
        if (!c.is_group) return false;
      } else if (c.is_group) {
        return false;
      }
      if (mobileFilter === "unread" && c.unread_count <= 0) return false;
      if (c.archived_at) return false;
      const name = contactDisplayName(c).toLowerCase();
      return c.phone_number.includes(searchQuery) || name.includes(search);
    });
  }, [isMobile, whatsappContacts, filter, filterCtx, searchQuery, activeTab, mobileFilter, resolveContactVendorId, currentTeamMemberId]);

  /**
   * A lista final.
   *
   * No modo unificado o recorte é feito nas duas metades e depois REAPLICADO
   * sobre `contacts` — que já chega ordenado pelo motor. Concatenar as metades e
   * reordenar aqui seria uma segunda implementação da regra de recência, e a
   * primeira divergência entre as duas apareceria como linha fora de ordem sem
   * ninguém saber qual das duas está certa.
   */
  const filteredContacts: InboxContact[] = useMemo(() => {
    if (!modoUnificado) return isSocialBox ? socialContacts : whatsappFiltered;
    const sobreviventes = new Set(
      [...whatsappFiltered, ...socialContacts].map((c) => contactKey(c)),
    );
    return contacts.filter((c) => sobreviventes.has(contactKey(c)));
  }, [modoUnificado, isSocialBox, socialContacts, whatsappFiltered, contacts]);

  // Contagens reagem ao filtro aplicado (menos a própria tab).
  const activeCount = useMemo(
    () => (isMobile ? whatsappFiltered.length : applyInboxFilters(whatsappContacts, filter, filterCtx, { searchQuery, tab: "active" }).length),
    [isMobile, whatsappFiltered.length, whatsappContacts, filter, filterCtx, searchQuery],
  );
  const archivedCount = useMemo(
    () => applyInboxFilters(whatsappContacts, filter, filterCtx, { searchQuery, tab: "archived" }).length,
    [whatsappContacts, filter, filterCtx, searchQuery],
  );
  /**
   * Org sem a flag não paga nem a varredura: a lista dela não tem grupo nenhum e
   * o número seria sempre 0.
   *
   * O mobile conta por fora do engine porque o mobile FILTRA por fora dele — lá
   * só o vendedor atravessa, e usar o engine aqui daria um número menor que a
   * lista que o chip abre (as dimensões persistidas do desktop cortariam a
   * contagem sem cortar a lista).
   */
  const gruposCount = useMemo(() => {
    if (!abasDeGrupos) return 0;
    if (isMobile) return whatsappContacts.filter((c) => c.is_group && !c.archived_at).length;
    return applyInboxFilters(whatsappContacts, filter, filterCtx, { searchQuery, tab: "grupos" }).length;
  }, [abasDeGrupos, isMobile, whatsappContacts, filter, filterCtx, searchQuery]);
  const unreadCount = useMemo(() => {
    const doWhatsApp = whatsappContacts.filter(
      (c) => !c.is_group && !c.archived_at && c.unread_count > 0,
    ).length;
    if (isSocialBox) return socialContacts.filter((c) => c.unread_count > 0).length;
    // No modo unificado o número soma as duas metades: ele conta o que está NA
    // LISTA, e a lista agora tem as duas. (O contador que segue o ACESSO, e não
    // a seleção, é outro — vive no seletor de caixas.)
    if (!modoUnificado) return doWhatsApp;
    return doWhatsApp + socialContacts.filter((c) => c.unread_count > 0).length;
  }, [isSocialBox, modoUnificado, socialContacts, whatsappContacts]);

  // Com o gate fechado o recorte não é confiável — número exibido seria invenção.
  const fmtCount = useCallback(
    (n: number) => (filterGate === "ok" ? String(n) : "—"),
    [filterGate],
  );

  /**
   * O menu de ações da linha só conhece dois estados, e é o certo: na aba de
   * grupos a conversa está ATIVA (arquivada some dali), então arquivar e
   * excluir continuam valendo e "desarquivar" não teria o que desfazer.
   */
  const tabDoMenu: "active" | "archived" = activeTab === "archived" ? "archived" : "active";

  const shouldVirtualize = filteredContacts.length > VIRTUALIZE_THRESHOLD;

  const getScrollElement = useCallback(() => {
    return scrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]"
    ) ?? null;
  }, []);

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? filteredContacts.length : 0,
    getScrollElement,
    estimateSize: () => estimateItemHeight(density),
    overscan: 3,
  });

  return (
    <div className={cn(
      "flex flex-col h-full min-h-0 bg-muted/20",
      !isMobile && "border-r border-border/60",
    )}>
      {/* ─── Header: mobile vs desktop ─────────────────────────────────────── */}
      {isMobile ? (
        <MobileChatListHeader
          instanceName={selectedBox?.name ?? "WhatsApp"}
          instanceConnected={selectedBox?.status === "connected"}
          channel={selectedBox?.kind ?? "whatsapp"}
          showFilters={!isSocialBox}
          onOpenInstanceSelector={() => {
            // O mobile cicla entre as caixas em vez de abrir um seletor. Com o
            // Instagram na roda, ciclar continua sendo a interação certa: são
            // poucas caixas e o nome no header diz em qual você está.
            // No mobile ciclar é a interação, e ciclar significa TROCAR de
            // caixa — não acrescentar ao conjunto. Um toque que somasse caixas
            // deixaria o vendedor com uma lista crescente sem nunca ter pedido
            // a caixa unificada.
            const trocar = onSomenteCaixa ?? onAlternarCaixa;
            if (boxes && boxes.length > 1 && trocar) {
              const idx = boxes.findIndex((b) => b.id === selectedBox?.id);
              const next = boxes[(idx + 1) % boxes.length];
              trocar(next.id);
            }
          }}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          activeFilter={mobileFilter}
          onFilterChange={setMobileFilter}
          unreadCount={unreadCount}
          mostrarGrupos={abasDeGrupos}
          gruposCount={gruposCount}
          vendorFilter={filter.vendor}
          onVendorFilterChange={(value) => patch({ vendor: value })}
          vendorOptions={vendorOptions}
          currentTeamMemberId={currentTeamMemberId}
          canSeeUnassigned={canSeeUnassigned}
        />
      ) : (
      <div className="p-3 border-b bg-background shrink-0">
        {boxes && boxes.length > 0 && marcadas && onAlternarCaixa && (
          <SeletorDeCaixas
            caixas={boxes}
            marcadas={marcadas}
            onAlternar={onAlternarCaixa}
            onSomente={onSomenteCaixa ?? onAlternarCaixa}
            onTodas={onTodasAsCaixas ?? (() => {})}
            naoLidas={naoLidasPorCaixa}
            isAdmin={isAdmin}
            onOpenInstances={onOpenInstances}
          />
        )}

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Inbox
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 bg-background"
          />
        </div>

        {/* ─── Filtro (modelo Linear) ──────────────────────────────────────── */}
        {/* Some inteiro na caixa social: funil, etapa, qualificação, vendedor e
            etiqueta são dimensões de lead, e a RPC social não aplica nenhuma.
            Um chip que não recorta nada é pior que chip nenhum. */}
        {!isSocialBox && (
          <InboxFilterBar
            filter={filter}
            patch={patch}
            toggleMulti={toggleMulti}
            clearFilter={clearFilter}
            unreadCount={unreadCount}
            waitingHumanCount={waitingHumanCount}
            funnelOptions={funnelOptions}
            vendorOptions={vendorOptions}
            currentTeamMemberId={currentTeamMemberId}
            canSeeUnassigned={canSeeUnassigned}
            allTags={allTags}
          />
        )}

        <p className="mt-2 text-xs text-muted-foreground">
          Total: {isSocialBox ? filteredContacts.length : fmtCount(filteredContacts.length)}
        </p>

        {/* Arquivamento vive em `whatsapp_conversations`; não há equivalente
            para canal social, então as abas não nascem em vez de nascerem
            mortas. */}
        {!isSocialBox && (
          <div className="flex mt-2 bg-muted rounded-md p-0.5">
            <button
              type="button"
              onClick={() => onTabChange("active")}
              className={cn(
                "flex-1 text-xs py-1.5 rounded-sm transition-colors font-medium",
                activeTab === "active"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Ativas ({fmtCount(activeCount)})
            </button>
            <button
              type="button"
              onClick={() => onTabChange("archived")}
              className={cn(
                "flex-1 text-xs py-1.5 rounded-sm transition-colors font-medium",
                activeTab === "archived"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Arquivadas ({fmtCount(archivedCount)})
            </button>
            {/* Terceira aba, e não um chip no "+ Filtro": grupo não se soma às
                dimensões, ele TROCA o universo da lista. Nasce só na org com a
                flag — para as outras o topo continua com duas abas. */}
            {abasDeGrupos && (
              <button
                type="button"
                onClick={() => onTabChange("grupos")}
                className={cn(
                  "flex-1 text-xs py-1.5 rounded-sm transition-colors font-medium",
                  activeTab === "grupos"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Grupos ({fmtCount(gruposCount)})
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* ─── Lista ──────────────────────────────────────────────────────────── */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        {isLoading || filterGate === "pending" ? (
          // `pending` conta como carregando: sem o enriquecimento a lista filtrada
          // seria vazia por falta de dado, e "Total: 0" piscaria a cada troca de
          // chip (queryKey nova = cache frio) em qualquer org.
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filterGate === "error" ? (
          <InboxEnrichmentNotice onRetry={onRetryEnrichment} onClear={clearFilter} />
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            {!isSocialBox && activeTab === "archived" ? (
              <>
                <Archive className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">Nenhuma conversa arquivada</p>
              </>
            ) : !isSocialBox && activeTab === "grupos" ? (
              <>
                <Users className="w-12 h-12 text-muted-foreground/50 mb-4" />
                {/* Vazio aqui quase nunca é "não há grupo": é `capture_groups`
                    desligada na org, e aí o webhook derruba a mensagem de grupo
                    antes de gravar. Dizer só "nenhum grupo" mandaria o vendedor
                    procurar no aparelho o que o servidor nunca guardou. */}
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? "Nenhum grupo encontrado" : "Nenhuma conversa de grupo ainda"}
                </p>
                {!searchQuery && (
                  <p className="mt-1 text-xs text-muted-foreground/70 max-w-[240px]">
                    Se a organização não captura mensagens de grupo, elas não chegam a
                    ser gravadas — fale com o suporte para ligar a captura.
                  </p>
                )}
              </>
            ) : (
              <>
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? "Nenhuma conversa encontrada"
                    : isSocialBox
                      ? selectedBox?.kind === "instagram"
                        ? "Nenhuma mensagem no Instagram ainda"
                        : "Nenhuma mensagem neste número ainda"
                      : "Nenhuma conversa ainda"}
                </p>
              </>
            )}
          </div>
        ) : shouldVirtualize ? (
          // ── Modo virtualizado ──────────────────────────────────────────────
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
            className="divide-y divide-border/60"
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const contact = filteredContacts[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <ConversationListItem
                    contact={contact}
                    isSelected={selectedKey === contactKey(contact)}
                    onSelect={onSelectContact}
                    waitingHumanLeadIds={waitingHumanLeadIds}
                    activeTab={tabDoMenu}
                    isAdmin={isAdmin}
                    instanceId={instanceId}
                    organizationId={organizationId}
                    allTags={allTags}
                    onArchive={onArchive}
                    onUnarchive={onUnarchive}
                    onDelete={onDelete}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
                    stageLabel={stageLabelFor(contact)}
                    caixa={metaPorLinha?.get(contactKey(contact))?.caixa}
                    tambemEm={metaPorLinha?.get(contactKey(contact))?.tambemEm}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          // ── Modo plain (≤50 contatos ou fallback) ─────────────────────────
          <div className={cn(!isMobile && "divide-y divide-border/60")}>
            {filteredContacts.map((contact) =>
              isMobile ? (
                <MobileConversationRow
                  key={contactKey(contact)}
                  contact={contact}
                  isSelected={selectedKey === contactKey(contact)}
                  onPress={onSelectContact}
                />
              ) : (
                <ConversationListItem
                  key={contactKey(contact)}
                  contact={contact}
                  isSelected={selectedKey === contactKey(contact)}
                  onSelect={onSelectContact}
                  waitingHumanLeadIds={waitingHumanLeadIds}
                  activeTab={tabDoMenu}
                  isAdmin={isAdmin}
                  instanceId={instanceId}
                  organizationId={organizationId}
                  allTags={allTags}
                  onArchive={onArchive}
                  onUnarchive={onUnarchive}
                  onDelete={onDelete}
                  onAddTag={onAddTag}
                  onRemoveTag={onRemoveTag}
                  stageLabel={stageLabelFor(contact)}
                  caixa={metaPorLinha?.get(contactKey(contact))?.caixa}
                  tambemEm={metaPorLinha?.get(contactKey(contact))?.tambemEm}
                />
              ),
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
