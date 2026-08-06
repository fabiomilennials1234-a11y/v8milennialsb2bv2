/**
 * ChatShellWithContext — consumer real do ChatShell 3-col.
 *
 * Componente principal de chat em /chat (legacy WhatsAppChat removido).
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
import { useResolveChatDeepLink } from "@/modules/communication/hooks/chat/useResolveChatDeepLink";
import { computeNeedsDeepLinkResolve } from "@/modules/communication/lib/computeNeedsDeepLinkResolve";
import { useCopilotToggle } from "@/modules/copilot/hooks/useCopilotToggle";
import { useCopilotPause } from "@/modules/copilot/hooks/useCopilotPause";
import { ChatShell } from "@/modules/communication/components/chat/layout/ChatShell";
import { MobileChatLayout } from "@/modules/communication/components/chat/layout/MobileChatLayout";
import { useViewport } from "@/shared/hooks/use-viewport";
import { ConversationList } from "@/modules/communication/components/chat/list/ConversationList";
import { ChatHeader } from "@/modules/communication/components/chat/view/ChatHeader";
import { MobileChatThreadHeader } from "@/modules/communication/components/chat/view/MobileChatThreadHeader";
import { MessageList } from "@/modules/communication/components/chat/view/MessageList";
import { ChatComposer } from "@/modules/communication/components/chat/composer/ChatComposer";
import { MobileComposerContextual } from "@/modules/communication/components/chat/composer/MobileComposerContextual";
import { ContextPanel } from "@/modules/communication/components/chat/context-panel/ContextPanel";
import { LeadContactModal } from "@/modules/communication/components/chat/LeadContactModal";
import { ImagePreviewModal } from "@/modules/communication/components/chat/media/ImagePreviewModal";
import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";
import { useWhatsAppContacts } from "@/modules/communication/hooks/chat/useWhatsAppContacts";
import { useWhatsAppMessages } from "@/modules/communication/hooks/chat/useWhatsAppMessages";
import { useAutoReadReceipt } from "@/modules/communication/hooks/chat/useAutoReadReceipt";
import { useWhatsAppMessagesRealtime } from "@/modules/communication/hooks/chat/useWhatsAppRealtime";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import { useFailedMessages, useRetryMessage } from "@/modules/communication/hooks/chat/useWhatsAppSend";
import { useConversationCalls } from "@/modules/communication/hooks/chat/useConversationCalls";
import { useChatDensity } from "@/modules/communication/hooks/chat/useChatDensity";
import { useTakeover } from "@/modules/communication/hooks/chat/useTakeover";
import { useIdentity } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useCurrentTeamMember } from "@/modules/identity";
import { useResponsibleMembers } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
import { useLeadResponsibleMap } from "@/modules/communication/hooks/chat/useLeadResponsibleMap";
import { useLeadInboxMeta } from "@/modules/communication/hooks/chat/useLeadInboxMeta";
import { useInboxFunnelOptions } from "@/modules/communication/hooks/chat/useInboxFunnelOptions";
import { useInboxFilterState } from "@/modules/communication/hooks/chat/useInboxFilterState";
import { toServerFilter } from "@/modules/communication/lib/inboxFilterServer";
import { inboxFilterGate } from "@/modules/communication/lib/inboxEnrichment";
import {
  useArchiveConversation,
  useUnarchiveConversation,
  useDeleteConversation,
  useAddConversationTag,
  useRemoveConversationTag,
} from "@/modules/communication/hooks/useWhatsAppConversations";
import { supabase } from "@/integrations/supabase/client";
import { usePreferredInstance } from "@/modules/communication/hooks/usePreferredInstance";
import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { resolveEffectiveLead } from "@/modules/communication/lib/resolveEffectiveLead";
import type { ChatContact, FailedMessage } from "@/modules/communication/hooks/chat/types";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";

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
  isMobile: boolean;
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
  isMobile,
}: ChatViewProps) {
  const phoneNumber = selectedContact?.phone_number ?? selectedPhone;
  const conversationId = selectedContact?.conversation_id ?? null;

  // Fallback de vínculo lead↔conversa. A lista de contatos deriva o `lead_id`
  // de `whatsapp_messages.lead_id` (gravado no ingest da mensagem). Dois casos
  // deixam o contato sem lead apesar de existir um lead com o mesmo telefone:
  //   1. mensagens órfãs (lead criado/migrado DEPOIS das mensagens → lead_id null);
  //   2. lead sem nenhuma mensagem WhatsApp (sem contato na lista).
  // Resolvemos por telefone via `leads.normalized_phone` — mesmo padrão que o
  // ContextPanel já usa — pra header/composer/toggle ficarem consistentes com o
  // painel. Mesma queryKey → TanStack dedupa, sem custo de rede extra.
  const { data: leadByPhone } = useLeadByPhone(
    selectedContact?.lead_id ? null : phoneNumber,
  );
  const { leadId: effectiveLeadId, leadName: effectiveLeadName } =
    resolveEffectiveLead(selectedContact, leadByPhone);

  const { data: messages = [], isLoading: messagesLoading } = useWhatsAppMessages(
    phoneNumber,
    instanceId,
  );

  // Tique azul para o contato. Complementa `markConversationRead` (que só zera o
  // badge interno do CRM e nunca falou com o WhatsApp).
  useAutoReadReceipt({
    instanceId,
    phone: phoneNumber,
    messages,
    isGroup: selectedContact?.is_group === true,
  });

  const failedMessages = useFailedMessages(phoneNumber, instanceId);
  const retryFn = useRetryMessage();

  // Ligações da mesma conversa, para entrarem na linha do tempo junto das
  // mensagens. Uma requisição por conversa aberta, cacheada — sem poll.
  const { data: calls = [] } = useConversationCalls(phoneNumber, effectiveLeadId);

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
    leadId: effectiveLeadId,
  });
  // Human pause state — countdown + reactivate
  const copilotPause = useCopilotPause({
    conversationId,
    organizationId,
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
    effectiveLeadName ?? selectedContact?.push_name ?? phoneNumber ?? "";

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

      {isMobile ? (
        <MobileChatThreadHeader
          contactName={contactName}
          phoneNumber={phoneNumber ?? ""}
          hasLead={!!effectiveLeadId}
          leadId={effectiveLeadId ?? undefined}
          onBack={onBack}
          onTapContact={onOpenLeadModal}
        />
      ) : (
        <ChatHeader
          phoneNumber={phoneNumber ?? ""}
          contactName={contactName}
          hasLead={!!effectiveLeadId}
          leadId={effectiveLeadId ?? undefined}
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
          humanPaused={copilotPause.isPaused}
          humanPausedUntil={copilotPause.pausedUntil}
          onReactivateCopilot={copilotPause.reactivate}
          isReactivating={copilotPause.isReactivating}
        />
      )}

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
            calls={calls}
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

      {isMobile ? (
        <MobileComposerContextual
          conversationKey={conversationKey}
          phoneNumber={phoneNumber ?? ""}
          contactName={contactName}
          instanceName={instanceName}
          instanceId={instanceId}
          leadId={effectiveLeadId ?? undefined}
          canReply
          selectedContact={{
            push_name: selectedContact?.push_name ?? null,
            lead_name: effectiveLeadName,
            phone_number: phoneNumber ?? "",
            lead_id: effectiveLeadId,
          }}
        />
      ) : (
        <ChatComposer
          conversationKey={conversationKey}
          phoneNumber={phoneNumber ?? ""}
          contactName={contactName}
          instanceName={instanceName}
          instanceId={instanceId}
          leadId={effectiveLeadId ?? undefined}
          canReply
          density={density}
          selectedContact={{
            push_name: selectedContact?.push_name ?? null,
            lead_name: effectiveLeadName,
            phone_number: phoneNumber ?? "",
            lead_id: effectiveLeadId,
          }}
        />
      )}

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
  const { isAdmin } = useIdentity();
  const { data: allTags = [] } = useTags();
  const queryClient = useQueryClient();

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

  // ── Filtro do inbox ─────────────────────────────────────────────────────────
  // Declarado antes dos contatos porque as dimensões vão junto na busca: a RPC
  // aplica o recorte ANTES do LIMIT (issue #1277), senão o filtro só enxergaria
  // a página de conversas mais recentes. Busca e tab seguem efêmeros e locais.
  const { filter, patch, toggleMulti, clearFilter } = useInboxFilterState();
  const { isMobile } = useViewport();

  // Mobile tem header próprio (all/unread/groups + vendedor) e ignora o resto do
  // estado persistido — empurrar essas dimensões pro servidor sumiria com
  // conversa que a UI mobile deveria mostrar. Lá o recorte fica só no cliente.
  const serverFilter = useMemo(
    () => (isMobile ? undefined : toServerFilter(filter, teamMember?.id ?? null)),
    [isMobile, filter, teamMember?.id],
  );

  // ── Contatos ────────────────────────────────────────────────────────────────
  // `isError` importa porque a etiqueta é enriquecida DENTRO desta query: com
  // filtro de etiqueta ativo o hook deixa a falha subir em vez de devolver
  // `tags: []` (que o filtro trataria como verdade). Ver `useWhatsAppContacts`.
  const {
    data: contacts = [],
    isLoading: contactsLoading,
    isError: contactsError,
  } = useWhatsAppContacts(selectedInstanceId, serverFilter);

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

  // ── Read-state: zera "não lida" ao abrir a conversa ─────────────────────────
  // O badge de unread é server-side (get_whatsapp_conversation_list lê de
  // conversation_read_state). Sem gravar read-state, `last_read_at` fica vazio e
  // a RPC conta as incoming dos últimos 7 dias pra sempre → conversa nunca sai de
  // "não lida". Espelha o padrão que o chat-bubble flutuante já usa
  // (ChatBubbleContext.markReadServer). Otimista no cache + RPC fire-and-forget.
  const markConversationRead = useCallback(
    (phone: string, instanceId: string) => {
      const norm = normalizePhone(phone);
      if (!norm) return;
      // Prefixo: zera o badge em todas as variantes filtradas (issue #1277).
      queryClient.setQueriesData<ChatContact[]>(
        { queryKey: chatQueryKeys.contactsPrefix(organizationId, instanceId) },
        (old) =>
          old?.map((c) =>
            c.phone_number === phone ? { ...c, unread_count: 0 } : c,
          ) ?? old,
      );
      void supabase
        .rpc("mark_conversation_read", {
          p_instance_id: instanceId,
          p_normalized_phone: norm,
        })
        .then(undefined, () => {
          /* tabela/perm indisponível — sem-op, backstop cobre no próximo refetch */
        });
    },
    [queryClient, organizationId],
  );

  useEffect(() => {
    if (!selectedPhone || !selectedInstanceId) return;
    markConversationRead(selectedPhone, selectedInstanceId);
  }, [selectedPhone, selectedInstanceId, markConversationRead]);

  // ── Realtime ────────────────────────────────────────────────────────────────
  useWhatsAppMessagesRealtime(selectedPhone, selectedInstanceId);

  // ── Waiting human — leads com state WAITING_HUMAN em conversations ──────────
  // Este Set é a fonte do chip "Pediu atendente". Descartar o `error` (como fazia
  // antes) devolvia um Set vazio indistinguível de "ninguém na fila" — e aí
  // `matchesNeedsHuman` reprovava a página inteira e a tela dizia "Total: 0" como
  // se fosse resposta. O erro precisa subir pro gate poder enxergá-lo.
  const {
    data: waitingHumanLeadIds = new Set<string>(),
    isError: waitingHumanError,
  } = useQuery({
    queryKey: ["waiting-human-leads", organizationId],
    queryFn: async () => {
      if (!organizationId) return new Set<string>();
      const { data, error } = await supabase
        .from("conversations")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .eq("state", "WAITING_HUMAN");
      if (error) throw error;
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
  // Busca e tab são efêmeros (não persistem). As dimensões do filtro vivem em
  // useInboxFilterState (persistido por org+usuário, escopado pela chave).
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ConversationTab>("active");

  // ── Filtro por vendedor ─────────────────────────────────────────────────────
  // Conversa não tem vendedor próprio: deriva do responsável do lead
  // (leads.responsible_id). "all" = todos; "mine" = do usuário; "unassigned" =
  // sem vendedor (só admin/master); <id> = de um vendedor específico.
  const responsibleMembers = useResponsibleMembers();
  const vendorOptions = useMemo(
    () => responsibleMembers.map((m) => ({ id: m.id, name: m.name })),
    [responsibleMembers],
  );
  const leadIds = useMemo(
    () => [...new Set(contacts.map((c) => c.lead_id).filter((id): id is string => !!id))],
    [contacts],
  );
  const { map: leadResponsibleMap, status: vendorStatus } = useLeadResponsibleMap(
    leadIds,
    organizationId,
  );
  const resolveContactVendorId = useCallback(
    (c: ChatContact): string | null =>
      c.lead_id ? leadResponsibleMap.get(c.lead_id) ?? null : null,
    [leadResponsibleMap],
  );

  // ── Enrichment do inbox: funis (+ etapa) e qualificação por lead ─────────────
  const { map: inboxMeta, status: metaStatus } = useLeadInboxMeta(leadIds, organizationId);
  const funnelOptions = useInboxFunnelOptions();
  const enrichedContacts = useMemo(
    () =>
      contacts.map((c) => {
        const m = c.lead_id ? inboxMeta.get(c.lead_id) : undefined;
        return m ? { ...c, funnels: m.funnels, qualification_tier: m.qualificationTier } : c;
      }),
    [contacts, inboxMeta],
  );

  // O engine do filtro não sabe distinguir "esse lead não está em funil nenhum"
  // de "o enriquecimento não chegou" — nos dois casos `funnels` é []. O gate faz
  // essa distinção FORA do engine, pra UI não exibir uma lista vazia como se
  // fosse resposta (incidente Goletric Pinheiros, 2026-07-31).
  // Etiqueta e "pediu atendente" não têm hook de enriquecimento próprio: a
  // primeira vive dentro da query de contatos, a segunda na query de handoff
  // aqui em cima. Sem `pending` porque nos dois casos o carregamento já é o
  // `isLoading` que a lista respeita — o que faltava era o ramo de ERRO.
  const filterGate = useMemo(
    () =>
      inboxFilterGate(
        filter,
        {
          meta: metaStatus,
          vendor: vendorStatus,
          tags: contactsError ? "error" : "ready",
          waitingHuman: waitingHumanError ? "error" : "ready",
        },
        { isMobile },
      ),
    [filter, metaStatus, vendorStatus, contactsError, waitingHumanError, isMobile],
  );

  // Precisa alcançar as QUATRO fontes que o gate lê. Invalidar só os dois hooks
  // de lead deixaria "Tentar de novo" sem efeito justamente nas dimensões cujo
  // dado mora nas outras duas queries.
  const retryEnrichment = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["lead-inbox-meta"] });
    void queryClient.invalidateQueries({ queryKey: ["lead-responsible-map"] });
    void queryClient.invalidateQueries({ queryKey: ["waiting-human-leads"] });
    void queryClient.invalidateQueries({
      queryKey: chatQueryKeys.contactsPrefix(organizationId, selectedInstanceId),
    });
  }, [queryClient, organizationId, selectedInstanceId]);

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

  // ── Viewport: mobile <768px usa MobileChatLayout (isMobile lido lá em cima) ──
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
            contacts={enrichedContacts}
            selectedPhone={selectedPhone}
            onSelectContact={handleSelectContact}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isLoading={contactsLoading}
            instances={instances}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={setSelectedInstanceId}
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
            filter={filter}
            patch={patch}
            toggleMulti={toggleMulti}
            clearFilter={clearFilter}
            funnelOptions={funnelOptions}
            vendorOptions={vendorOptions}
            resolveContactVendorId={resolveContactVendorId}
            currentTeamMemberId={teamMember?.id ?? null}
            canSeeUnassigned={isAdmin}
            filterGate={filterGate}
            onRetryEnrichment={retryEnrichment}
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
            isMobile={isMobile}
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
