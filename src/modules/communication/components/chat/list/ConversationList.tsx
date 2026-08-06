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
import { Loader2, Search, MessageSquare, Archive, Settings } from "lucide-react";
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
import { InboxFilterBar } from "./InboxFilterBar";
import { DeletedConversationsPanel } from "./DeletedConversationsPanel";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";
import {
  applyInboxFilters,
  type InboxFilterState,
  type InboxFilterContext,
} from "@/modules/communication/lib/inboxFilter";
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
  contacts: ChatContact[];
  selectedPhone: string | null;
  onSelectContact: (phone: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
  instances?: WhatsAppInstanceForUser[];
  selectedInstanceId?: string | null;
  onSelectInstance?: (instanceId: string) => void;
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
}: ConversationListProps) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const { isMobile } = useViewport();
  const [mobileFilter, setMobileFilter] = useState<MobileChatFilter>("all");

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
    (c: ChatContact): string | null => {
      const first = c.funnels?.[0];
      if (!first) return null;
      return stageLabelIndex.get(first.pipelineId)?.get(first.stageKey) ?? null;
    },
    [stageLabelIndex],
  );

  // ── Desktop: engine puro. Mobile: header próprio (all/unread/groups + vendedor).
  const filteredContacts = useMemo(() => {
    if (!isMobile) {
      return applyInboxFilters(contacts, filter, filterCtx, { searchQuery, tab: activeTab });
    }
    const search = searchQuery.toLowerCase();
    return contacts.filter((c) => {
      if (filter.vendor !== "all") {
        const vendorId = resolveContactVendorId(c);
        if (filter.vendor === "mine") { if (vendorId !== currentTeamMemberId) return false; }
        else if (filter.vendor === "unassigned") { if (vendorId) return false; }
        else if (vendorId !== filter.vendor) return false;
      }
      if (mobileFilter === "groups") { if (!c.is_group) return false; }
      else if (mobileFilter === "unread") { if (c.is_group || c.unread_count <= 0) return false; }
      else if (c.is_group) return false;
      if (c.archived_at) return false;
      const name = contactDisplayName(c).toLowerCase();
      return c.phone_number.includes(searchQuery) || name.includes(search);
    });
  }, [isMobile, contacts, filter, filterCtx, searchQuery, activeTab, mobileFilter, resolveContactVendorId, currentTeamMemberId]);

  // Contagens reagem ao filtro aplicado (menos a própria tab).
  const activeCount = useMemo(
    () => (isMobile ? filteredContacts.length : applyInboxFilters(contacts, filter, filterCtx, { searchQuery, tab: "active" }).length),
    [isMobile, filteredContacts.length, contacts, filter, filterCtx, searchQuery],
  );
  const archivedCount = useMemo(
    () => applyInboxFilters(contacts, filter, filterCtx, { searchQuery, tab: "archived" }).length,
    [contacts, filter, filterCtx, searchQuery],
  );
  const unreadCount = useMemo(
    () => contacts.filter((c) => !c.is_group && !c.archived_at && c.unread_count > 0).length,
    [contacts],
  );

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
          vendorFilter={filter.vendor}
          onVendorFilterChange={(value) => patch({ vendor: value })}
          vendorOptions={vendorOptions}
          currentTeamMemberId={currentTeamMemberId}
          canSeeUnassigned={canSeeUnassigned}
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

        {/* ─── Filtro (modelo Linear) ──────────────────────────────────────── */}
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

        <p className="mt-2 text-xs text-muted-foreground">Total: {filteredContacts.length}</p>

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

        {/* Só admin: excluir conversa é gated por is_user_admin(), restaurar
            também. Montar só pra admin evita disparar as queries pros demais. */}
        {isAdmin && <DeletedConversationsPanel instanceId={instanceId} />}
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
                    stageLabel={stageLabelFor(contact)}
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
                  stageLabel={stageLabelFor(contact)}
                />
              ),
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
