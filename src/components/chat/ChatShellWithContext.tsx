/**
 * ChatShellWithContext — consumer real do ChatShell 3-col.
 *
 * Ativa sob feature flag VITE_CHAT_ONDA_2B=true em /chat.
 * Onda 2b, C3.
 *
 * Wires hooks reais → ChatShell:
 *   - useWhatsAppInstancesForUser   → seletor de instância (lista slot header)
 *   - useWhatsAppContacts           → ConversationList no slot `list`
 *   - useWhatsAppMessages           → ChatView no slot `view`
 *   - useWhatsAppMessagesRealtime   → patches incrementais sem refetch
 *   - ContextPanel                  → slot `context` (leadId + phoneNumber)
 *   - useChatDensity                → densityCssVars + toggle no ChatHeader
 *
 * Stop-gap Onda 2b:
 *   - AI toggle: usa RPC simples via supabase.from("leads").update({ai_disabled}).
 *   - waiting_human: derivado de query em `conversations` com state=WAITING_HUMAN.
 *   - SZ.chat transfer, history-sync, mass-send → Onda 5.
 *   - Image preview inline e retry de mensagens falhas → Onda 5.
 *
 * Responsive: viewport <780px → WhatsAppChat legacy mantém seu layout stack.
 * prefers-reduced-motion: respeitado via Framer Motion no ChatShell + bubbles.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, WifiOff, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { normalizePhone } from "@/lib/normalizePhone";
import { useResolveChatDeepLink } from "@/hooks/chat/useResolveChatDeepLink";
import { computeNeedsDeepLinkResolve } from "@/lib/computeNeedsDeepLinkResolve";
import { useCopilotToggle } from "@/hooks/useCopilotToggle";
import { ChatShell } from "@/components/chat/layout/ChatShell";
import { MobileChatLayout } from "@/components/chat/layout/MobileChatLayout";
import { useViewport } from "@/hooks/use-viewport";
import { ConversationList } from "@/components/chat/list/ConversationList";
import { ChatHeader } from "@/components/chat/view/ChatHeader";
import { MessageList } from "@/components/chat/view/MessageList";
import { ChatComposer } from "@/components/chat/composer/ChatComposer";
import { ContextPanel } from "@/components/chat/context-panel/ContextPanel";
import { LeadContactModal } from "@/components/chat/LeadContactModal";
import { ImagePreviewModal } from "@/components/chat/media/ImagePreviewModal";
import { useWhatsAppInstancesForUser } from "@/hooks/chat/useWhatsAppInstances";
import { useWhatsAppContacts } from "@/hooks/chat/useWhatsAppContacts";
import { useWhatsAppMessages } from "@/hooks/chat/useWhatsAppMessages";
import { useWhatsAppMessagesRealtime } from "@/hooks/chat/useWhatsAppRealtime";
import { useFailedMessages, useRetryMessage } from "@/hooks/chat/useWhatsAppSend";
import { useChatDensity } from "@/hooks/chat/useChatDensity";
import { useTakeover } from "@/hooks/chat/useTakeover";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useTags } from "@/hooks/useTags";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useAuth } from "@/contexts/AuthContext";
import {
  useArchiveConversation,
  useUnarchiveConversation,
  useDeleteConversation,
  useAddConversationTag,
  useRemoveConversationTag,
} from "@/hooks/useWhatsAppConversations";
import { supabase } from "@/integrations/supabase/client";
import { usePreferredInstance } from "@/hooks/usePreferredInstance";
import type { ChatContact, FailedMessage } from "@/hooks/chat/types";
import type { DensityMode } from "@/hooks/chat/useChatDensity";

// ─── Tipos internos ──────────────────────────────────────────────────────────

type ConversationTab = "active" | "archived";

// ─── ChatView — coluna central (header + messages + composer) ────────────────

interface ChatViewProps {
  selectedContact: ChatContact | null;
  selectedPhone: string | null;
  instanceId: string | null;
  instanceName: string;
  organizationId: string | null;
  mountTime: number;
  onBack: () => void;
  onOpenLeadModal: () => void;
  density: DensityMode;
  onDensityChange: (d: DensityMode) => void;
}

function ChatView({
  selectedContact,
  selectedPhone,
  instanceId,
  instanceName,
  organizationId,
  mountTime,
  onBack,
  onOpenLeadModal,
  density,
  onDensityChange,
}: ChatViewProps) {
  const phoneNumber = selectedContact?.phone_number ?? selectedPhone;
  const conversationId = selectedContact?.conversation_id ?? null;

  const { data: messages = [], isLoading: messagesLoading } = useWhatsAppMessages(
    phoneNumber,
    instanceId,
  );

  const failedMessages = useFailedMessages(phoneNumber, instanceId);
  const retryFn = useRetryMessage();

  // ── C1: useTakeover real — FSM ia_state da conversa ──────────────────────
  const {
    state: takeoverState,
    isMutating: takeoverMutating,
    markHumanActive,
  } = useTakeover(conversationId);

  const isWaitingHuman = takeoverState === "WAITING_HUMAN";
  const isHumanActive  = takeoverState === "HUMAN_ACTIVE";

  // Image preview state (C6)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Onda 2 U4 (2026-04-26): hook unificado. Phone+leadId, query key única
  // ["copilot-toggle", orgId, normalizedPhone], realtime via MainLayout.
  const copilotToggle = useCopilotToggle({
    phone: phoneNumber,
    leadId: selectedContact?.lead_id ?? null,
  });
  const aiDisabled = copilotToggle.aiDisabled;
  const toggleAiMutation = {
    mutate: (checked: boolean) => copilotToggle.toggle(!checked),
    isPending: copilotToggle.isPending,
  };

  const handleRetry = useCallback(
    (msg: FailedMessage) => {
      void retryFn(msg);
    },
    [retryFn],
  );

  if ((!selectedContact && !selectedPhone) || !instanceId) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground bg-muted/10">
        <WifiOff className="w-10 h-10 opacity-30" />
        <p className="text-sm">Selecione uma conversa</p>
      </div>
    );
  }

  const contactName =
    selectedContact?.lead_name ?? selectedContact?.push_name ?? phoneNumber ?? "";

  const conversationKey = `${instanceId}:${phoneNumber}`;

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* C1 — Banner WAITING_HUMAN */}
      {isWaitingHuman && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-700 dark:text-amber-300 shrink-0"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserPlus className="w-4 h-4 shrink-0" aria-hidden />
            IA pediu ajuda. Assuma a conversa.
          </div>
          <button
            type="button"
            className="text-xs font-semibold underline underline-offset-2 hover:no-underline shrink-0 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 rounded"
            onClick={() => { void markHumanActive(); }}
            disabled={takeoverMutating}
          >
            {takeoverMutating ? "..." : "Assumir"}
          </button>
        </div>
      )}

      <ChatHeader
        phoneNumber={phoneNumber ?? ""}
        contactName={contactName}
        hasLead={!!selectedContact?.lead_id}
        leadId={selectedContact?.lead_id ?? undefined}
        conversationId={conversationId}
        instanceId={instanceId ?? undefined}
        aiDisabled={aiDisabled || isHumanActive}
        isWaitingHuman={isWaitingHuman}
        szChatSession={null}
        organizationId={organizationId}
        onBack={onBack}
        onOpenLeadModal={onOpenLeadModal}
        onToggleAi={(checked) => {
          if (isHumanActive) return;
          toggleAiMutation.mutate(checked);
        }}
        onTransferToSzChatTeam={() => {
          // SZ.chat transfer — Onda 6
        }}
        toggleAiPending={toggleAiMutation.isPending || isHumanActive}
        transferPending={false}
        density={density}
        onDensityChange={onDensityChange}
      />

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
        {messagesLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <MessageList
            messages={messages}
            transferEvents={[]}
            failedMessages={failedMessages}
            isLoading={messagesLoading}
            contactName={contactName}
            instanceName={instanceName}
            lastReadAt={0}
            mountTime={mountTime}
            onImagePreview={(url) => setPreviewUrl(url)}
            onRetry={handleRetry}
            onOpenTemplates={() => {
              // Templates abertos via slash command no composer
            }}
            density={density}
            instanceId={instanceId}
            enableActions
          />
        )}
      </div>

      <ChatComposer
        conversationKey={conversationKey}
        phoneNumber={phoneNumber ?? ""}
        contactName={contactName}
        instanceName={instanceName}
        instanceId={instanceId}
        leadId={selectedContact?.lead_id ?? undefined}
        canReply
        density={density}
        selectedContact={{
          push_name: selectedContact?.push_name ?? null,
          lead_name: selectedContact?.lead_name ?? null,
          phone_number: phoneNumber ?? "",
          lead_id: selectedContact?.lead_id ?? null,
        }}
      />

      {/* C6 — Image preview inline */}
      <ImagePreviewModal
        isOpen={!!previewUrl}
        imageUrl={previewUrl}
        onClose={() => setPreviewUrl(null)}
      />
    </div>
  );
}

// ─── ChatShellWithContext — root ─────────────────────────────────────────────

export function ChatShellWithContext() {
  const { user } = useAuth();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const { isAdmin } = useIsAdmin();
  const { data: allTags = [] } = useTags();

  // ── Instâncias ──────────────────────────────────────────────────────────────
  const { data: instances = [], isLoading: instancesLoading } = useWhatsAppInstancesForUser();

  const [selectedInstanceId, setSelectedInstanceIdRaw] = useState<string | null>(null);

  const { preferredInstanceId, setPreferredInstance } = usePreferredInstance(instances);

  const setSelectedInstanceId = useCallback((id: string | null) => {
    setSelectedInstanceIdRaw(id);
    if (id) setPreferredInstance(id);
  }, [setPreferredInstance]);

  // ── Deep-link (?phone=&instance=) ───────────────────────────────────────────
  // Lê params uma vez no mount; estado pendente impede que o auto-select de
  // instância sobrescreva a resolução do link, e impede também que múltiplos
  // re-renders re-disparem a lógica.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDeepLinkRef = useRef<{ phone: string | null; instance: string | null } | null>(null);
  if (initialDeepLinkRef.current === null) {
    initialDeepLinkRef.current = {
      phone: searchParams.get("phone"),
      instance: searchParams.get("instance"),
    };
  }
  const deepLink = initialDeepLinkRef.current;
  const hasDeepLinkPhone = !!deepLink.phone;

  const [deepLinkProcessed, setDeepLinkProcessed] = useState(false);
  const [pendingDeepLinkPhone, setPendingDeepLinkPhone] = useState<string | null>(null);

  // Caminho rápido: instance veio na URL e está na lista permitida → seleciona.
  // Caso contrário, ignoramos (defesa cross-tenant + restrição de membro).
  useEffect(() => {
    if (deepLinkProcessed) return;
    if (!instances.length) return;
    if (!deepLink.instance) return;
    const allowed = instances.some((i) => i.id === deepLink.instance);
    if (allowed) {
      setSelectedInstanceId(deepLink.instance);
    }
  }, [deepLink.instance, deepLinkProcessed, instances]);

  // Resolver server-side: encontra instância permitida onde existe conversa
  // para o phone alvo. Só roda quando temos phone na URL e ainda não resolvemos.
  // Lógica extraída em `computeNeedsDeepLinkResolve` para ser pure-testable.
  const needsResolve = computeNeedsDeepLinkResolve({
    hasDeepLinkPhone,
    deepLinkProcessed,
    instancesCount: instances.length,
    deepLinkInstance: deepLink.instance,
    allowedInstanceIds: instances.map((i) => i.id),
  });

  const { data: resolved, isFetched: resolveFetched } = useResolveChatDeepLink({
    phone: deepLink.phone,
    allowedInstances: instances,
    enabled: needsResolve,
  });

  useEffect(() => {
    if (deepLinkProcessed) return;
    if (!hasDeepLinkPhone) return;
    if (!instances.length) return;

    // Caminho A: instance da URL já foi setada acima — só precisamos achar o
    // phone real dentro dos contatos quando carregarem (handler abaixo).
    if (deepLink.instance && instances.some((i) => i.id === deepLink.instance)) {
      setPendingDeepLinkPhone(deepLink.phone);
      setDeepLinkProcessed(true);
      return;
    }

    // Caminho B: aguardando resolver server-side.
    if (!resolveFetched) return;

    if (resolved) {
      setSelectedInstanceId(resolved.instanceId);
      setPendingDeepLinkPhone(resolved.phoneNumber);
    } else {
      // Lead sem mensagens — selecionar instância padrão e abrir chat vazio
      const connected = instances.find((i) => i.status === "connected");
      setSelectedInstanceId(connected?.id ?? instances[0].id);
      const normalized = normalizePhone(deepLink.phone);
      if (normalized) setSelectedPhone(normalized);
    }
    setDeepLinkProcessed(true);
  }, [
    deepLinkProcessed,
    hasDeepLinkPhone,
    deepLink.instance,
    deepLink.phone,
    instances,
    resolveFetched,
    resolved,
  ]);

  // Limpa query params depois de processar (sucesso ou desistência).
  useEffect(() => {
    if (!deepLinkProcessed) return;
    if (!searchParams.get("phone") && !searchParams.get("instance")) return;
    setSearchParams({}, { replace: true });
  }, [deepLinkProcessed, searchParams, setSearchParams]);

  // Auto-select: preferência do banco → primeira conectada → primeira da lista.
  // Não dispara se deep-link pendente.
  useEffect(() => {
    if (selectedInstanceId) return;
    if (!instances.length) return;
    if (hasDeepLinkPhone && !deepLinkProcessed) return;

    const preferredIsValid = preferredInstanceId
      ? instances.some((i) => i.id === preferredInstanceId)
      : false;

    if (preferredIsValid) {
      setSelectedInstanceIdRaw(preferredInstanceId);
      return;
    }

    const connected = instances.find((i) => i.status === "connected");
    setSelectedInstanceIdRaw(connected?.id ?? instances[0].id);
  }, [instances, selectedInstanceId, hasDeepLinkPhone, deepLinkProcessed, preferredInstanceId]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  // ── Contatos ────────────────────────────────────────────────────────────────
  const { data: contacts = [], isLoading: contactsLoading } = useWhatsAppContacts(
    selectedInstanceId,
  );

  // ── Conversa selecionada ────────────────────────────────────────────────────
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  // Reset selection when master user switches shadow org
  const prevOrgIdRef = useRef(organizationId);
  useEffect(() => {
    if (prevOrgIdRef.current && organizationId && prevOrgIdRef.current !== organizationId) {
      setSelectedInstanceIdRaw(null);
      setSelectedPhone(null);
    }
    prevOrgIdRef.current = organizationId;
  }, [organizationId]);

  // Quando contatos carregam, casa pendingDeepLinkPhone pelo phone normalizado
  // e seta selectedPhone com o phone_number canônico do contato.
  useEffect(() => {
    if (!pendingDeepLinkPhone) return;
    if (!contacts.length) return;
    const target = normalizePhone(pendingDeepLinkPhone);
    if (!target) {
      setPendingDeepLinkPhone(null);
      return;
    }
    const match = contacts.find((c) => normalizePhone(c.phone_number) === target);
    if (match) {
      setSelectedPhone(match.phone_number);
      setPendingDeepLinkPhone(null);
    }
  }, [contacts, pendingDeepLinkPhone]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.phone_number === selectedPhone) ?? null,
    [contacts, selectedPhone],
  );

  const handleSelectContact = useCallback((phone: string) => {
    setSelectedPhone(phone);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedPhone(null);
  }, []);

  // ── Realtime ────────────────────────────────────────────────────────────────
  useWhatsAppMessagesRealtime(selectedPhone, selectedInstanceId);

  // ── Waiting human — leads com state WAITING_HUMAN em conversations ──────────
  const { data: waitingHumanLeadIds = new Set<string>() } = useQuery({
    queryKey: ["waiting-human-leads", organizationId],
    queryFn: async () => {
      if (!organizationId) return new Set<string>();
      const { data } = await supabase
        .from("conversations")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .eq("state", "WAITING_HUMAN");
      return new Set((data ?? []).map((c) => c.lead_id as string));
    },
    enabled: !!organizationId,
    refetchInterval: 30_000,
  });

  const waitingHumanCount = waitingHumanLeadIds.size;

  const isSelectedContactWaitingHuman =
    selectedContact?.lead_id != null
      ? waitingHumanLeadIds.has(selectedContact.lead_id)
      : false;

  // ── Filtros / Busca ─────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyWithLead, setShowOnlyWithLead] = useState(false);
  const [showOnlyWaitingHuman, setShowOnlyWaitingHuman] = useState(false);
  const [activeTab, setActiveTab] = useState<ConversationTab>("active");

  // ── Archive / Delete / Tags ─────────────────────────────────────────────────
  const archiveConversation = useArchiveConversation();
  const unarchiveConversation = useUnarchiveConversation();
  const deleteConversation = useDeleteConversation();
  const addTag = useAddConversationTag();
  const removeTag = useRemoveConversationTag();

  const handleArchive = useCallback(
    (phone: string) => {
      if (!selectedInstanceId) return;
      archiveConversation.mutate({ instanceId: selectedInstanceId, phoneNumber: phone });
    },
    [selectedInstanceId, archiveConversation],
  );

  const handleUnarchive = useCallback(
    (conversationId: string) => {
      unarchiveConversation.mutate({ conversationId });
    },
    [unarchiveConversation],
  );

  const handleDelete = useCallback(
    (phone: string) => {
      if (!selectedInstanceId || !organizationId) return;
      deleteConversation.mutate({
        instanceId: selectedInstanceId,
        phoneNumber: phone,
        organizationId,
      });
    },
    [selectedInstanceId, organizationId, deleteConversation],
  );

  const handleAddTag = useCallback(
    (phone: string, tagId: string) => {
      if (!selectedInstanceId) return;
      addTag.mutate({ instanceId: selectedInstanceId, phoneNumber: phone, tagId });
    },
    [selectedInstanceId, addTag],
  );

  const handleRemoveTag = useCallback(
    (conversationId: string, tagId: string) => {
      removeTag.mutate({ conversationId, tagId });
    },
    [removeTag],
  );

  // ── Lead modal ──────────────────────────────────────────────────────────────
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  const handleOpenLeadModal = useCallback(() => setLeadModalOpen(true), []);
  const handleCloseLeadModal = useCallback(() => setLeadModalOpen(false), []);

  // ── Density ─────────────────────────────────────────────────────────────────
  const { density, setDensity, cssVars } = useChatDensity(user?.id);

  // ── mountTime estável (capturado uma vez no mount) ───────────────────────────
  const mountTimeRef = useRef(Date.now());

  // ── Viewport: mobile <768px usa MobileChatLayout ─────────────────────────────
  const { isMobile } = useViewport();
  const ShellComponent = isMobile ? MobileChatLayout : ChatShell;

  // ── Loading state ────────────────────────────────────────────────────────────
  if (instancesLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!instances.length) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2 text-muted-foreground">
        <WifiOff className="w-8 h-8 opacity-40" />
        <p className="text-sm">Nenhuma instância WhatsApp disponível</p>
      </div>
    );
  }

  return (
    <>
      <ShellComponent
        list={
          <ConversationList
            contacts={contacts}
            selectedPhone={selectedPhone}
            onSelectContact={handleSelectContact}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isLoading={contactsLoading}
            instances={instances}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={setSelectedInstanceId}
            showOnlyWithLead={showOnlyWithLead}
            onToggleShowOnlyWithLead={() => setShowOnlyWithLead((v) => !v)}
            showOnlyWaitingHuman={showOnlyWaitingHuman}
            onToggleShowOnlyWaitingHuman={() => setShowOnlyWaitingHuman((v) => !v)}
            waitingHumanCount={waitingHumanCount}
            waitingHumanLeadIds={waitingHumanLeadIds}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
            onDelete={handleDelete}
            isAdmin={isAdmin}
            instanceId={selectedInstanceId}
            organizationId={organizationId}
            allTags={allTags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            density={density}
          />
        }
        view={
          <ChatView
            selectedContact={selectedContact}
            selectedPhone={selectedPhone}
            instanceId={selectedInstanceId}
            instanceName={selectedInstance?.instance_name ?? ""}
            organizationId={organizationId}
            mountTime={mountTimeRef.current}
            onBack={handleBack}
            onOpenLeadModal={handleOpenLeadModal}
            density={density}
            onDensityChange={setDensity}
          />
        }
        context={
          selectedPhone ? (
            <ContextPanel
              leadId={selectedContact?.lead_id ?? undefined}
              phoneNumber={selectedPhone}
              pushName={selectedContact?.push_name ?? null}
            />
          ) : undefined
        }
        selectedPhone={selectedPhone}
        onBack={handleBack}
        density={density}
        densityCssVars={cssVars}
      />

      {selectedContact && (
        <LeadContactModal
          isOpen={leadModalOpen}
          onClose={handleCloseLeadModal}
          phoneNumber={selectedContact.phone_number}
          pushName={selectedContact.push_name ?? undefined}
        />
      )}
    </>
  );
}
