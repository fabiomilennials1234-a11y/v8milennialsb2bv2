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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { ChatShell } from "@/components/chat/layout/ChatShell";
import { ConversationList } from "@/components/chat/list/ConversationList";
import { ChatHeader } from "@/components/chat/view/ChatHeader";
import { MessageList } from "@/components/chat/view/MessageList";
import { ChatComposer } from "@/components/chat/composer/ChatComposer";
import { ContextPanel } from "@/components/chat/context-panel/ContextPanel";
import { LeadContactModal } from "@/components/chat/LeadContactModal";
import { useWhatsAppInstancesForUser } from "@/hooks/chat/useWhatsAppInstances";
import { useWhatsAppContacts } from "@/hooks/chat/useWhatsAppContacts";
import { useWhatsAppMessages } from "@/hooks/chat/useWhatsAppMessages";
import { useWhatsAppMessagesRealtime } from "@/hooks/chat/useWhatsAppRealtime";
import { useFailedMessages } from "@/hooks/chat/useWhatsAppSend";
import { useChatDensity } from "@/hooks/chat/useChatDensity";
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
import type { ChatContact } from "@/hooks/chat/types";
import type { DensityMode } from "@/hooks/chat/useChatDensity";

// ─── Tipos internos ──────────────────────────────────────────────────────────

type ConversationTab = "active" | "archived";

// ─── ChatView — coluna central (header + messages + composer) ────────────────

interface ChatViewProps {
  selectedContact: ChatContact | null;
  instanceId: string | null;
  instanceName: string;
  organizationId: string | null;
  mountTime: number;
  isWaitingHuman: boolean;
  onBack: () => void;
  onOpenLeadModal: () => void;
  density: DensityMode;
  onDensityChange: (d: DensityMode) => void;
}

function ChatView({
  selectedContact,
  instanceId,
  instanceName,
  organizationId,
  mountTime,
  isWaitingHuman,
  onBack,
  onOpenLeadModal,
  density,
  onDensityChange,
}: ChatViewProps) {
  const phoneNumber = selectedContact?.phone_number ?? null;

  const { data: messages = [], isLoading: messagesLoading } = useWhatsAppMessages(
    phoneNumber,
    instanceId,
  );

  const failedMessages = useFailedMessages(phoneNumber, instanceId);

  // AI toggle — lê estado atual do lead, grava via update direto
  const { data: aiStatus } = useQuery({
    queryKey: ["lead-ai-status", selectedContact?.lead_id],
    queryFn: async () => {
      if (!selectedContact?.lead_id) return null;
      const { data } = await supabase
        .from("leads")
        .select("ai_disabled")
        .eq("id", selectedContact.lead_id)
        .single();
      return data;
    },
    enabled: !!selectedContact?.lead_id,
  });

  const aiDisabled = aiStatus?.ai_disabled ?? false;

  const qc = useQueryClient();
  const toggleAiMutation = useMutation({
    mutationFn: async (checked: boolean) => {
      if (!selectedContact?.lead_id) return;
      const { error } = await supabase
        .from("leads")
        .update({ ai_disabled: !checked })
        .eq("id", selectedContact.lead_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-ai-status", selectedContact?.lead_id] });
    },
    onError: () => toast.error("Falha ao alterar IA"),
  });

  if (!selectedContact || !instanceId) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground bg-muted/10">
        <WifiOff className="w-10 h-10 opacity-30" />
        <p className="text-sm">Selecione uma conversa</p>
      </div>
    );
  }

  const contactName =
    selectedContact.lead_name ?? selectedContact.push_name ?? selectedContact.phone_number;

  const conversationKey = `${instanceId}:${phoneNumber}`;

  return (
    <div className="flex flex-col h-full min-h-0">
      <ChatHeader
        phoneNumber={selectedContact.phone_number}
        contactName={contactName}
        hasLead={!!selectedContact.lead_id}
        leadId={selectedContact.lead_id ?? undefined}
        conversationId={selectedContact.conversation_id ?? null}
        aiDisabled={aiDisabled}
        isWaitingHuman={isWaitingHuman}
        szChatSession={null}
        organizationId={organizationId}
        onBack={onBack}
        onOpenLeadModal={onOpenLeadModal}
        onToggleAi={(checked) => toggleAiMutation.mutate(checked)}
        onTransferToSzChatTeam={() => {
          // SZ.chat transfer — Onda 5
        }}
        toggleAiPending={toggleAiMutation.isPending}
        transferPending={false}
        density={density}
        onDensityChange={onDensityChange}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
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
            onImagePreview={() => {
              // Image preview — Onda 5
            }}
            onRetry={() => {
              // Retry failed message — Onda 5
            }}
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
        phoneNumber={selectedContact.phone_number}
        contactName={contactName}
        instanceName={instanceName}
        instanceId={instanceId}
        leadId={selectedContact.lead_id ?? undefined}
        canReply
        density={density}
        selectedContact={{
          push_name: selectedContact.push_name ?? null,
          lead_name: selectedContact.lead_name ?? null,
          phone_number: selectedContact.phone_number,
          lead_id: selectedContact.lead_id ?? null,
        }}
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

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // Auto-select primeira instância conectada ao carregar
  useEffect(() => {
    if (selectedInstanceId) return;
    if (!instances.length) return;
    const connected = instances.find((i) => i.status === "connected");
    setSelectedInstanceId(connected?.id ?? instances[0].id);
  }, [instances, selectedInstanceId]);

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
      <ChatShell
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
            instanceId={selectedInstanceId}
            instanceName={selectedInstance?.instance_name ?? ""}
            organizationId={organizationId}
            mountTime={mountTimeRef.current}
            isWaitingHuman={isSelectedContactWaitingHuman}
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
