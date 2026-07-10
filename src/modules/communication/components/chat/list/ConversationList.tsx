/**
 * ConversationList — coluna esquerda do chat: seletor de instance, busca, filtros, tabs e lista.
 *
 * Extraído de WhatsAppChat.tsx ContactList (C5).
 *
 * C23: virtualização para >50 contatos via @tanstack/react-virtual.
 * Lista plana (sem grouping) → estimateSize via CSS var --chat-list-row-height.
 * Mobile fallback: render plain sempre.
 */
import { useRef, useCallback, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Search, Filter, UserPlus, MessageSquare, Archive, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useViewport } from "@/shared/hooks/use-viewport";
import type { ChatContact, WhatsAppInstanceForUser } from "@/modules/communication/hooks/useWhatsAppChat";
import { ConversationListItem, contactDisplayName } from "./ConversationListItem";
import { MobileConversationRow } from "./MobileConversationRow";
import { MobileChatListHeader, type MobileChatFilter } from "./MobileChatListHeader";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";

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
  contacts: ChatContact[];
  selectedPhone: string | null;
  onSelectContact: (phone: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
  instances?: WhatsAppInstanceForUser[];
  selectedInstanceId?: string | null;
  onSelectInstance?: (instanceId: string) => void;
  showOnlyWithLead: boolean;
  onToggleShowOnlyWithLead: () => void;
  showOnlyWaitingHuman: boolean;
  onToggleShowOnlyWaitingHuman: () => void;
  waitingHumanCount: number;
  waitingHumanLeadIds?: Set<string>;
  activeTab: "active" | "archived";
  onTabChange: (tab: "active" | "archived") => void;
  onArchive: (phone: string) => void;
  onUnarchive: (conversationId: string) => void;
  onDelete: (phone: string) => void;
  isAdmin: boolean;
  instanceId: string | null;
  organizationId: string | null;
  allTags: { id: string; name: string; color: string }[];
  onAddTag: (phone: string, tagId: string) => void;
  onRemoveTag: (conversationId: string, tagId: string) => void;
  onOpenInstances?: () => void;
  /** Modo de densidade para altura estimada dos itens. */
  density?: DensityMode;
  // ─── Filtro por vendedor ────────────────────────────────────────────────────
  /** Valor atual: "all" | "mine" | "unassigned" | <teamMemberId>. */
  vendorFilter: string;
  onVendorFilterChange: (value: string) => void;
  /** Vendedores selecionáveis (membros ativos da org). */
  vendorOptions: { id: string; name: string }[];
  /** Resolve a qual vendedor (team_member id) a conversa pertence — via lead. */
  resolveContactVendorId: (contact: ChatContact) => string | null;
  /** team_member id do usuário logado — habilita a opção "Minhas conversas". */
  currentTeamMemberId: string | null;
  /** Só admin/master enxerga a opção "Não atribuídas". */
  canSeeUnassigned: boolean;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ConversationList({
  contacts,
  selectedPhone,
  onSelectContact,
  searchQuery,
  onSearchChange,
  isLoading,
  instances,
  selectedInstanceId,
  onSelectInstance,
  showOnlyWithLead,
  onToggleShowOnlyWithLead,
  showOnlyWaitingHuman,
  onToggleShowOnlyWaitingHuman,
  waitingHumanCount,
  waitingHumanLeadIds,
  activeTab,
  onTabChange,
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
  vendorFilter,
  onVendorFilterChange,
  vendorOptions,
  resolveContactVendorId,
  currentTeamMemberId,
  canSeeUnassigned,
}: ConversationListProps) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const { isMobile } = useViewport();
  const [showGroups, setShowGroups] = useState(false);
  const [mobileFilter, setMobileFilter] = useState<MobileChatFilter>("all");

  const filteredContacts = contacts.filter((c) => {
    // Filtro por vendedor (aplica em mobile e desktop). "all" = sem filtro.
    if (vendorFilter !== "all") {
      const vendorId = resolveContactVendorId(c);
      if (vendorFilter === "mine") {
        if (vendorId !== currentTeamMemberId) return false;
      } else if (vendorFilter === "unassigned") {
        if (vendorId) return false;
      } else if (vendorId !== vendorFilter) {
        return false;
      }
    }
    // Mobile filter mapping
    if (isMobile) {
      if (mobileFilter === "groups") {
        if (!c.is_group) return false;
      } else if (mobileFilter === "unread") {
        if (c.is_group) return false;
        if (c.unread_count <= 0) return false;
      } else {
        if (c.is_group) return false;
      }
      if (c.archived_at) return false;
    } else {
      if (showGroups) {
        if (!c.is_group) return false;
      } else {
        if (c.is_group) return false;
      }
      if (showOnlyWithLead && !c.lead_id) return false;
      if (showOnlyWaitingHuman && !(c.lead_id && waitingHumanLeadIds?.has(c.lead_id))) return false;
      if (activeTab === "active" && c.archived_at) return false;
      if (activeTab === "archived" && !c.archived_at) return false;
    }
    const name = contactDisplayName(c).toLowerCase();
    return (
      c.phone_number.includes(searchQuery) ||
      name.includes(searchQuery.toLowerCase())
    );
  });

  const activeCount = contacts.filter((c) => !c.is_group && !c.archived_at).length;
  const archivedCount = contacts.filter((c) => !c.is_group && !!c.archived_at).length;
  const groupCount = contacts.filter((c) => c.is_group).length;
  const unreadCount = contacts.filter((c) => !c.is_group && !c.archived_at && c.unread_count > 0).length;

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

  const selectedInst = instances?.find((i) => i.id === selectedInstanceId);

  return (
    <div className={cn(
      "flex flex-col h-full min-h-0 bg-muted/20",
      !isMobile && "border-r border-border/60",
    )}>
      {/* ─── Header: mobile vs desktop ─────────────────────────────────────── */}
      {isMobile ? (
        <MobileChatListHeader
          instanceName={selectedInst?.instance_name ?? "WhatsApp"}
          instanceConnected={selectedInst?.status === "connected"}
          onOpenInstanceSelector={() => {
            // Cycle through instances on mobile (simple pill tap)
            if (instances && instances.length > 1 && onSelectInstance) {
              const idx = instances.findIndex((i) => i.id === selectedInstanceId);
              const next = instances[(idx + 1) % instances.length];
              onSelectInstance(next.id);
            }
          }}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          activeFilter={mobileFilter}
          onFilterChange={setMobileFilter}
          unreadCount={unreadCount}
        />
      ) : (
      <div className="p-3 border-b bg-background shrink-0">
        {instances && instances.length > 0 && onSelectInstance && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Número / Inbox
              </p>
              {isAdmin && onOpenInstances && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenInstances}
                  className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground px-2"
                  title="Gerenciar instâncias WhatsApp"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Instâncias
                </Button>
              )}
            </div>
            <Select value={selectedInstanceId || ""} onValueChange={onSelectInstance}>
              <SelectTrigger className="h-9 w-full bg-background">
                <SelectValue placeholder="Escolha o número..." />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          inst.status === "connected"
                            ? "bg-emerald-500"
                            : inst.status === "connecting"
                              ? "bg-amber-500"
                              : "bg-muted-foreground/40",
                        )}
                      />
                      {inst.instance_name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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

        {/* ─── Filtro por vendedor ─────────────────────────────────────────── */}
        <div className="mt-2">
          <Select value={vendorFilter} onValueChange={onVendorFilterChange}>
            <SelectTrigger
              className={cn(
                "h-9 w-full bg-background",
                vendorFilter !== "all" && "border-primary/50 text-primary",
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Users className="w-3.5 h-3.5 shrink-0" />
                <SelectValue placeholder="Vendedor" />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vendedores</SelectItem>
              {currentTeamMemberId && (
                <SelectItem value="mine">Minhas conversas</SelectItem>
              )}
              {vendorOptions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
              {canSeeUnassigned && (
                <SelectItem value="unassigned">Não atribuídas</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">Total: {filteredContacts.length}</p>
          <button
            type="button"
            onClick={onToggleShowOnlyWithLead}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
              showOnlyWithLead
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted",
            )}
            title={
              showOnlyWithLead ? "Mostrando apenas com lead" : "Clique para filtrar só com lead"
            }
          >
            <Filter className="w-3 h-3" />
            {showOnlyWithLead ? "Com lead" : "Todos"}
          </button>
          <button
            type="button"
            onClick={onToggleShowOnlyWaitingHuman}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
              showOnlyWaitingHuman
                ? "bg-amber-500/15 text-amber-600 font-medium"
                : "text-muted-foreground hover:bg-muted",
            )}
            title={
              showOnlyWaitingHuman
                ? "Mostrando apenas aguardando humano"
                : "Filtrar aguardando humano"
            }
          >
            <UserPlus className="w-3 h-3" />
            Humano
            {waitingHumanCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 tabular-nums">
                {waitingHumanCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowGroups((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
              showGroups
                ? "bg-sky-500/15 text-sky-500 font-medium"
                : "text-muted-foreground hover:bg-muted",
            )}
            title={showGroups ? "Mostrando apenas grupos" : "Mostrar grupos"}
          >
            <Users className="w-3 h-3" />
            Grupos
            {groupCount > 0 && (
              <span className={cn(
                "text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 tabular-nums",
                showGroups ? "bg-sky-500 text-white" : "bg-muted-foreground/20 text-muted-foreground",
              )}>
                {groupCount}
              </span>
            )}
          </button>
        </div>

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
            Ativas ({activeCount})
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
            Arquivadas ({archivedCount})
          </button>
        </div>
      </div>
      )}

      {/* ─── Lista ──────────────────────────────────────────────────────────── */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            {activeTab === "archived" ? (
              <>
                <Archive className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">Nenhuma conversa arquivada</p>
              </>
            ) : (
              <>
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? "Nenhuma conversa encontrada" : "Nenhuma conversa ainda"}
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
                    isSelected={selectedPhone === contact.phone_number}
                    onSelect={onSelectContact}
                    waitingHumanLeadIds={waitingHumanLeadIds}
                    activeTab={activeTab}
                    isAdmin={isAdmin}
                    instanceId={instanceId}
                    organizationId={organizationId}
                    allTags={allTags}
                    onArchive={onArchive}
                    onUnarchive={onUnarchive}
                    onDelete={onDelete}
                    onAddTag={onAddTag}
                    onRemoveTag={onRemoveTag}
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
                  key={contact.phone_number}
                  contact={contact}
                  isSelected={selectedPhone === contact.phone_number}
                  onPress={onSelectContact}

                />
              ) : (
                <ConversationListItem
                  key={contact.phone_number}
                  contact={contact}
                  isSelected={selectedPhone === contact.phone_number}
                  onSelect={onSelectContact}
                  waitingHumanLeadIds={waitingHumanLeadIds}
                  activeTab={activeTab}
                  isAdmin={isAdmin}
                  instanceId={instanceId}
                  organizationId={organizationId}
                  allTags={allTags}
                  onArchive={onArchive}
                  onUnarchive={onUnarchive}
                  onDelete={onDelete}
                  onAddTag={onAddTag}
                  onRemoveTag={onRemoveTag}
                />
              ),
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
