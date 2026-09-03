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
import { definirConversaAberta, useFeatureFlag } from "@/modules/platform";
import { nomeDaConversa } from "@/modules/communication/lib/nomeDaConversa";
import { useResolveChatDeepLink } from "@/modules/communication/hooks/chat/useResolveChatDeepLink";
import { computeNeedsDeepLinkResolve } from "@/modules/communication/lib/computeNeedsDeepLinkResolve";
import { resolvePendingDeepLink } from "@/modules/communication/lib/resolvePendingDeepLink";
import {
  computeChatDeepLinkPlan,
  type ChatDeepLinkPlan,
} from "@/modules/communication/lib/computeChatDeepLinkPlan";
import { useLeadPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
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
import { ScheduledMessagesBanner } from "@/modules/communication/components/chat/ScheduledMessagesBanner";
import { MobileComposerContextual } from "@/modules/communication/components/chat/composer/MobileComposerContextual";
import { ContextPanel } from "@/modules/communication/components/chat/context-panel/ContextPanel";
import { LeadContactModal } from "@/modules/communication/components/chat/LeadContactModal";
import { ImagePreviewModal } from "@/modules/communication/components/chat/media/ImagePreviewModal";
import { SocialChatView } from "@/modules/communication/components/chat/social/SocialChatView";
import { SocialContextPanel } from "@/modules/communication/components/chat/social/SocialContextPanel";
import { useInboxBoxes } from "@/modules/communication/hooks/chat/useInboxBoxes";
import { useWhatsAppContacts } from "@/modules/communication/hooks/chat/useWhatsAppContacts";
import { useSocialContacts } from "@/modules/communication/hooks/chat/useSocialContacts";
import { useOfficialWhatsAppContacts } from "@/modules/communication/hooks/chat/useOfficialWhatsAppContacts";
import { useSendSocialMessage } from "@/modules/communication/hooks/chat/useSendSocialMessage";
import { useNotificameWhatsAppSend } from "@/modules/communication/hooks/chat/useNotificameWhatsAppSend";
import {
  directSender,
  officialWhatsAppSender,
} from "@/modules/communication/hooks/chat/social-sender";
import { boxUsesChannelMessages } from "@/modules/communication/hooks/chat/inbox-box-source";
import {
  chaveDeConversaOficial,
  contatoDeConversaNova,
} from "@/modules/communication/lib/official-conversation";
import { useSocialRealtime } from "@/modules/communication/hooks/chat/useSocialRealtime";
import { useWhatsAppMessages } from "@/modules/communication/hooks/chat/useWhatsAppMessages";
import { ChatThreadUnavailable } from "@/modules/communication/components/chat/ChatThreadUnavailable";
import { resolveThreadState } from "@/modules/communication/lib/resolveThreadState";
import { invalidateChipInstanceIds } from "@/modules/communication/lib/chipInstanceIds";
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
import { DEFAULT_INBOX_FILTER } from "@/modules/communication/lib/inboxFilter";
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
import type {
  ChatContact,
  FailedMessage,
  SocialContact,
} from "@/modules/communication/hooks/chat/types";
import type { DensityMode } from "@/modules/communication/hooks/chat/useChatDensity";

// ─── Tipos internos ──────────────────────────────────────────────────────────

/**
 * `"grupos"` só é alcançável na org com a flag `chat_abas_de_grupos` — a aba não
 * é renderizada sem ela, e o estado nasce sempre em `"active"` (não é
 * persistido). Ver `lib/inboxFilter.ts`.
 */
type ConversationTab = "active" | "archived" | "grupos";

/**
 * Monta a subscription de Realtime dos canais sociais SÓ enquanto a caixa
 * social está aberta.
 *
 * `useRealtimeSubscription` não aceita `enabled` — quem decide se o canal
 * postgres_changes existe é quem monta o hook. Um componente que renderiza
 * `null` é o gate mais barato possível, e mantém as ~30 orgs que só usam
 * WhatsApp sem pagar uma subscription por causa desta fatia.
 */
function SocialRealtimeMount() {
  useSocialRealtime();
  return null;
}

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

  /**
   * `chat_nome_do_whatsapp` — a org escolhe quem nomeia a conversa no topo: o
   * perfil do interlocutor (`push_name`) ou o nome curado no CRM.
   *
   * Lido AQUI, junto dos outros hooks, e não perto do uso: abaixo há o early
   * return de "Selecione uma conversa", e hook depois de return condicional
   * muda a ordem entre renders.
   *
   * Fail-closed enquanto carrega — a org flagada pinta a primeira frame com o
   * nome do CRM e troca quando a flag chega. Trocar o texto de um nome é melhor
   * que segurar a thread inteira num skeleton esperando a flag.
   */
  const { enabled: nomeDoWhatsappPrimeiro } = useFeatureFlag("chat_nome_do_whatsapp");

  // O sino não anuncia a conversa que já está sendo lida (#1891). Publicar
  // daqui é o único ponto que sabe qual lead está aberto.
  useEffect(() => {
    definirConversaAberta(effectiveLeadId ?? null);
    return () => definirConversaAberta(null);
  }, [effectiveLeadId]);

  const {
    data: messages = [],
    isLoading: messagesLoading,
    isError: messagesError,
    isFetching: messagesFetching,
    refetch: refetchMessages,
  } = useWhatsAppMessages(phoneNumber, instanceId);

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

  // A LISTA (`contactLabel`) já resolve `push_name → lead_name → telefone`. Aqui
  // era o inverso, e por isso a mesma conversa aparecia com dois nomes: o topo
  // com o do CRM, a linha com o do WhatsApp. A flag alinha as duas telas.
  const contactName = nomeDaConversa(
    {
      pushName: selectedContact?.push_name ?? null,
      nomeDoLead: effectiveLeadName,
      telefone: phoneNumber ?? null,
    },
    { nomeDoWhatsappPrimeiro },
  );

  // A lista já afirmou que existe mensagem com este contato. Se a thread volta
  // vazia mesmo assim, "Comece a conversa" seria uma afirmação falsa — ver
  // `resolveThreadState`.
  const threadState = resolveThreadState({
    isLoading: messagesLoading,
    isError: messagesError,
    messageCount: messages.length,
    failedCount: failedMessages.length,
    callCount: calls.length,
    lastMessageTime: selectedContact?.last_message_time,
  });

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
        {threadState === "loading" ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : threadState !== "list" ? (
          <ChatThreadUnavailable
            reason={threadState}
            contactName={contactName}
            onRetry={() => {
              // Sem descartar o cache do chip, o retry devolveria o mesmo
              // conjunto degradado — ver `invalidateChipInstanceIds`.
              invalidateChipInstanceIds(organizationId, instanceId);
              void refetchMessages();
            }}
            isRetrying={messagesFetching}
          />
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

      {/* O que já está agendado para ESTA conversa, logo acima de onde se
          escreve. Sem isto, a mensagem agendada só existia na Agenda e no card
          do lead: quem abria a conversa não tinha como saber que havia um envio
          a caminho, e mandava a mesma coisa de novo na mão.

          Depende de lead: a fila é indexada por `lead_id`, então conversa de
          número sem lead vinculado não tem o que listar. */}
      {effectiveLeadId && (
        <ScheduledMessagesBanner
          leadId={effectiveLeadId}
          leadName={contactName}
          phoneNumber={phoneNumber ?? ""}
          instanceId={instanceId ?? undefined}
        />
      )}

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

  // ── Caixas de entrada ───────────────────────────────────────────────────────
  // Números de WhatsApp ∪ canais sociais. Org sem canal social recebe exatamente
  // a lista de antes — nenhum gate de feature precisa ser plumbado até aqui.
  const { boxes, instances, isLoading: boxesLoading } = useInboxBoxes();

  const [selectedBoxId, setSelectedBoxIdRaw] = useState<string | null>(null);

  const { preferredInstanceId, setPreferredInstance } = usePreferredInstance(instances);

  const setSelectedBoxId = useCallback((id: string | null) => {
    setSelectedBoxIdRaw(id);
    // `team_members.preferred_whatsapp_instance_id` tem FK para
    // `whatsapp_instances`: gravar ali o id de um canal social violaria a
    // restrição e derrubaria a preferência de número que já funciona.
    if (id && instances.some((i) => i.id === id)) setPreferredInstance(id);
  }, [setPreferredInstance, instances]);

  const selectedBox = useMemo(
    () => boxes.find((b) => b.id === selectedBoxId) ?? null,
    [boxes, selectedBoxId],
  );
  /**
   * A caixa aberta lê `channel_messages`? O discriminador decide pelo PROVIDER, e
   * não pelo `kind`: o canal oficial é `kind: "whatsapp"` (mora em
   * `whatsapp_instances`) e mesmo assim recebe em `channel_messages`. Ausência de
   * provider significa o comportamento antigo — são ~30 orgs com instâncias
   * gravadas antes da coluna existir.
   */
  const isSocialBox = selectedBox ? boxUsesChannelMessages(selectedBox) : false;
  /** Dentro dessas, qual é a do canal oficial (a que envia por outra rota). */
  const isOfficialBox = isSocialBox && selectedBox?.kind === "whatsapp";

  /**
   * O id da caixa, desdobrado por canal. Os dois hooks de lista recebem `null`
   * quando não é a vez deles e já têm `enabled: !!id` — é isso que garante que a
   * RPC `get_whatsapp_conversation_list` NUNCA seja chamada com o uuid de um
   * canal social (ela levantaria 22023/42501) e vice-versa.
   */
  const selectedInstanceId = isSocialBox ? null : selectedBoxId;
  /**
   * Três eixos, e não dois, desde a caixa oficial:
   *   `selectedInstanceId`      → WhatsApp por QR, lê `whatsapp_messages`
   *   `selectedChannelId`       → Instagram, lê `channel_messages` por canal
   *   `selectedOfficialInstance`→ canal oficial, lê `channel_messages` por instância
   *
   * Cada hook recebe `null` quando não é a vez dele e já tem `enabled: !!id` — é
   * isso que garante que nenhuma das três RPCs seja chamada com o uuid do eixo
   * errado (as duas de lista levantam 42501 nesse caso, por desenho).
   */
  const selectedChannelId =
    selectedBox?.kind === "instagram" ? selectedBoxId : null;
  const selectedOfficialInstanceId = isOfficialBox ? selectedBoxId : null;

  // ── Deep-link (?phone=&instance=&box=&lead=) ────────────────────────────────
  // Lê params uma vez no mount; estado pendente impede que o auto-select de
  // caixa sobrescreva a resolução do link, e impede também que múltiplos
  // re-renders re-disparem a lógica.
  //
  // `?box=` é o param novo, e é o que o aviso de mensagem recebida usa para
  // levar à caixa onde a conversa existe. `?instance=` continua existindo e
  // continua significando WhatsApp — renomeá-lo quebraria todo link já enviado.
  //
  // `?lead=` existe porque a carteira navega conhecendo o lead, não o telefone
  // (CarteiraClientPreview, ClienteDetailPage, Upsell). A tradução lead→telefone
  // acontece aqui; daí pra frente o fluxo é idêntico ao de `?phone=`.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPlanRef = useRef<ChatDeepLinkPlan | null>(null);
  if (initialPlanRef.current === null) {
    initialPlanRef.current = computeChatDeepLinkPlan({
      phone: searchParams.get("phone"),
      instance: searchParams.get("instance"),
      box: searchParams.get("box"),
      lead: searchParams.get("lead"),
    });
  }
  const plan = initialPlanRef.current;

  const { data: leadPhone, isLoading: leadPhoneLoading } = useLeadPhone(
    plan.kind === "lead" ? plan.leadId : null,
  );
  // Lead sem telefone, fora da org, ou inexistente → não há conversa a abrir.
  const leadPlanPending = plan.kind === "lead" && leadPhoneLoading;

  const deepLink = useMemo(
    () => ({
      phone:
        plan.kind === "phone"
          ? plan.phone
          : plan.kind === "lead"
            ? (leadPhone ?? null)
            : null,
      instance: plan.instance,
      box: plan.box,
    }),
    [plan, leadPhone],
  );
  const hasDeepLinkPhone = !!deepLink.phone;

  // `?box=` sozinho: escolhe a caixa e sai da frente. Só aceita id que esteja na
  // lista permitida — a lista já é recortada por org e por membro, então isto é
  // a mesma defesa cross-tenant que o `?instance=` sempre teve.
  const [boxDeepLinkProcessed, setBoxDeepLinkProcessed] = useState(false);
  useEffect(() => {
    if (boxDeepLinkProcessed) return;
    if (!deepLink.box) { setBoxDeepLinkProcessed(true); return; }
    if (!boxes.length) return;
    if (boxes.some((b) => b.id === deepLink.box)) {
      setSelectedBoxId(deepLink.box);
    }
    setBoxDeepLinkProcessed(true);
  }, [deepLink.box, boxDeepLinkProcessed, boxes, setSelectedBoxId]);

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
      setSelectedBoxId(deepLink.instance);
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
      // ⚠️ A CAIXA OFICIAL NÃO PASSA PELO `pendingDeepLinkPhone`. Aquele
      // caminho procura o telefone entre os contatos de `whatsapp_messages`, e
      // esta caixa lê `channel_messages` — quem nunca trocou mensagem não tem
      // linha em NENHUMA das duas, e o lead do funil é justamente esse caso.
      // Aqui a chave é montada a partir do telefone, e a conversa nasce na tela.
      const alvo = instances.find((i) => i.id === deepLink.instance);
      if (alvo?.provider === "notificame") {
        const chave = chaveDeConversaOficial(alvo.id, deepLink.phone);
        if (chave) setSelectedKey(chave);
        setDeepLinkProcessed(true);
        return;
      }

      setPendingDeepLinkPhone(deepLink.phone);
      setDeepLinkProcessed(true);
      return;
    }

    // Caminho B: aguardando resolver server-side.
    if (!resolveFetched) return;

    if (resolved) {
      setSelectedBoxId(resolved.instanceId);
      setPendingDeepLinkPhone(resolved.phoneNumber);
    } else {
      // Lead sem mensagens — selecionar instância padrão e abrir chat vazio
      const connected = instances.find((i) => i.status === "connected");
      const escolhida = connected ?? instances[0];
      setSelectedBoxId(escolhida.id);

      // A caixa oficial identifica a conversa por `(instância, interlocutor)`, e
      // não por telefone solto: guardar o telefone cru aqui deixaria a tela sem
      // conversa nenhuma para abrir.
      if (escolhida.provider === "notificame") {
        const chave = chaveDeConversaOficial(escolhida.id, deepLink.phone);
        if (chave) setSelectedKey(chave);
      } else {
        const normalized = normalizePhone(deepLink.phone);
        if (normalized) setSelectedKey(normalized);
      }
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
    // `deepLinkProcessed` só é ligado pelo caminho de telefone — sem `?phone=`
    // ele fica falso para sempre. Exigi-lo aqui deixaria um `?box=` sozinho
    // grudado na URL até o próximo clique de navegação.
    if (hasDeepLinkPhone && !deepLinkProcessed) return;
    if (!boxDeepLinkProcessed) return;
    if (!searchParams.get("phone") && !searchParams.get("instance") && !searchParams.get("box") && !searchParams.get("lead")) return;
    setSearchParams({}, { replace: true });
  }, [hasDeepLinkPhone, deepLinkProcessed, boxDeepLinkProcessed, searchParams, setSearchParams]);

  // Auto-select: preferência do banco → primeiro número conectado → primeira
  // caixa da lista. A preferência e o "conectado" continuam sendo conceitos de
  // WhatsApp; a caixa social só entra como último recurso — que é exatamente o
  // caso de uma org que ainda não tem número nenhum. Não dispara se deep-link
  // pendente.
  useEffect(() => {
    if (selectedBoxId) return;
    if (!boxes.length) return;
    if (hasDeepLinkPhone && !deepLinkProcessed) return;
    if (deepLink.box && !boxDeepLinkProcessed) return;
    // Lead cujo telefone ainda está sendo buscado: escolher a caixa agora faria
    // a seleção pular quando o telefone chegasse.
    if (leadPlanPending) return;

    const preferredIsValid = preferredInstanceId
      ? instances.some((i) => i.id === preferredInstanceId)
      : false;

    if (preferredIsValid) {
      setSelectedBoxIdRaw(preferredInstanceId);
      return;
    }

    const connected = instances.find((i) => i.status === "connected");
    setSelectedBoxIdRaw(connected?.id ?? instances[0]?.id ?? boxes[0].id);
  }, [
    boxes,
    instances,
    selectedBoxId,
    hasDeepLinkPhone,
    deepLinkProcessed,
    deepLink.box,
    boxDeepLinkProcessed,
    preferredInstanceId,
    leadPlanPending,
  ]);

  // ── Filtro do inbox ─────────────────────────────────────────────────────────
  // Declarado antes dos contatos porque as dimensões vão junto na busca: a RPC
  // aplica o recorte ANTES do LIMIT (issue #1277), senão o filtro só enxergaria
  // a página de conversas mais recentes. Busca e tab seguem efêmeros e locais.
  const { filter, patch, toggleMulti, clearFilter } = useInboxFilterState();
  const { isMobile } = useViewport();

  /**
   * `chat_abas_de_grupos` — a org decide se a lista tem a aba de grupos. Lida
   * AQUI, e não na lista, porque a decisão tem duas pontas que precisam
   * concordar: o que a RPC traz (`p_include_groups`) e o que a UI oferece. Se só
   * a UI soubesse, a aba existiria sobre uma página sem uma linha de grupo.
   *
   * Fail-closed enquanto carrega: a primeira frame não tem a aba e a lista não
   * pede grupo. Quando a flag chega, a `queryKey` muda (a `cacheKey` carrega o
   * argumento) e a lista refaz a busca — uma vez, no load.
   */
  const { enabled: abasDeGrupos } = useFeatureFlag("chat_abas_de_grupos");

  // Mobile tem header próprio (all/unread/grupos + vendedor) e ignora o resto do
  // estado persistido — empurrar essas dimensões pro servidor sumiria com
  // conversa que a UI mobile deveria mostrar. Lá o recorte fica só no cliente.
  //
  // A exceção é o grupo, porque não é recorte e sim universo: o mobile precisa
  // mandar `p_include_groups` ou o chip "Grupos" filtraria uma página que nunca
  // teve grupo. Vai sozinho, sobre o filtro default — nenhuma outra dimensão
  // atravessa.
  const serverFilter = useMemo(
    () =>
      isMobile
        ? abasDeGrupos
          ? toServerFilter(DEFAULT_INBOX_FILTER, null, { incluirGrupos: true })
          : undefined
        : toServerFilter(filter, teamMember?.id ?? null, { incluirGrupos: abasDeGrupos }),
    [isMobile, filter, teamMember?.id, abasDeGrupos],
  );

  // ── Contatos ────────────────────────────────────────────────────────────────
  // Os dois hooks de lista são MUTUAMENTE EXCLUSIVOS por `enabled`: cada um
  // recebe `null` quando a caixa aberta não é a dele. Com isso a RPC de WhatsApp
  // (14 filtros, tabela-resumo, chip ids) não é tocada por esta fatia — o
  // caminho de WhatsApp segue byte a byte o de antes.
  //
  // `isError` importa porque a etiqueta é enriquecida DENTRO desta query: com
  // filtro de etiqueta ativo o hook deixa a falha subir em vez de devolver
  // `tags: []` (que o filtro trataria como verdade). Ver `useWhatsAppContacts`.
  const {
    data: contacts = [],
    isLoading: whatsappContactsLoading,
    isError: contactsError,
  } = useWhatsAppContacts(selectedInstanceId, serverFilter);

  // ── As duas listas de `channel_messages`, SEMPRE montadas ──────────────────
  //
  // Os dois hooks são chamados incondicionalmente e um deles recebe `null`.
  // Montar só o "da vez" mudaria a quantidade de hooks entre renders ao trocar
  // de caixa — o erro que derrubou a primeira tentativa desta fatia.
  const {
    data: directContacts = [],
    isLoading: directContactsLoading,
  } = useSocialContacts(selectedChannelId);

  const {
    data: officialContacts = [],
    isLoading: officialContactsLoading,
  } = useOfficialWhatsAppContacts(selectedOfficialInstanceId);

  const socialContacts = isOfficialBox ? officialContacts : directContacts;
  const socialContactsLoading = isOfficialBox
    ? officialContactsLoading
    : directContactsLoading;

  // ── As duas rotas de envio, também SEMPRE montadas ─────────────────────────
  //
  // `notificame-send-social` recusa WhatsApp por modelo (`channel_not_social`),
  // então o canal oficial sai pelo proxy de WhatsApp — que já resolve provider,
  // governor, janela e templates a partir da instância (#1640).
  const directMutation = useSendSocialMessage(selectedChannelId);
  const officialMutation = useNotificameWhatsAppSend(selectedOfficialInstanceId);
  const socialSender = useMemo(
    () =>
      isOfficialBox
        ? officialWhatsAppSender(officialMutation)
        : directSender(directMutation),
    [isOfficialBox, officialMutation, directMutation],
  );

  const contactsLoading = isSocialBox ? socialContactsLoading : whatsappContactsLoading;

  // ── Conversa selecionada ────────────────────────────────────────────────────
  // A identidade é `contactKey`: telefone no WhatsApp, `conversation_key` no
  // canal social. Um estado só, porque só existe uma conversa aberta por vez —
  // dois estados paralelos divergiriam na primeira troca de caixa.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Trocar de caixa fecha a conversa: a chave da caixa anterior não existe na
  // nova, e mantê-la deixaria o painel central preso no vazio.
  //
  // ⚠️ Só limpa numa troca ENTRE DUAS caixas. O primeiro `null → caixa` também é
  // uma mudança de `selectedBoxId`, e limpar ali apagaria a conversa que o
  // deep-link acabou de escolher: o caminho "lead sem mensagens" seta caixa e
  // chave no MESMO efeito, e este rodaria depois, zerando a chave.
  const prevBoxIdRef = useRef<string | null>(selectedBoxId);
  useEffect(() => {
    const prev = prevBoxIdRef.current;
    prevBoxIdRef.current = selectedBoxId;
    if (prev && selectedBoxId && prev !== selectedBoxId) setSelectedKey(null);
  }, [selectedBoxId]);

  // Reset selection when master user switches shadow org
  const prevOrgIdRef = useRef(organizationId);
  useEffect(() => {
    if (prevOrgIdRef.current && organizationId && prevOrgIdRef.current !== organizationId) {
      setSelectedBoxIdRaw(null);
      setSelectedKey(null);
    }
    prevOrgIdRef.current = organizationId;
  }, [organizationId]);

  // Quando contatos carregam, casa pendingDeepLinkPhone pelo phone normalizado
  // e seta a chave com o phone_number canônico do contato. Deep-link por
  // telefone é, por construção, WhatsApp.
  //
  // Contato fora da janela de contatos abre pelo telefone mesmo assim — decisão
  // em `resolvePendingDeepLink`, testada em tests/unit.
  useEffect(() => {
    if (!pendingDeepLinkPhone) return;
    const outcome = resolvePendingDeepLink({
      pendingPhone: pendingDeepLinkPhone,
      contacts,
      contactsLoading,
    });
    if (outcome.action === "wait") return;
    if (outcome.action === "select") setSelectedKey(outcome.contactKey);
    setPendingDeepLinkPhone(null);
  }, [contacts, contactsLoading, pendingDeepLinkPhone]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.phone_number === selectedKey) ?? null,
    [contacts, selectedKey],
  );

  /**
   * O telefone de uma conversa oficial que ainda não existe na lista.
   *
   * Serve para descobrir o LEAD antes da primeira mensagem: quem foi chamado a
   * partir do funil é conhecido do CRM, e a tela precisa mostrar o nome dele em
   * vez de um identificador. `null` fora desse caso — e o hook abaixo é chamado
   * sempre, com `null`, para a ordem dos hooks não mudar entre renders.
   */
  const telefoneDeConversaNova = useMemo(() => {
    if (!isOfficialBox || !selectedKey || !selectedBoxId) return null;
    const prefixo = `whatsapp_oficial:${selectedBoxId}:`;
    if (!selectedKey.startsWith(prefixo)) return null;
    const jaExiste = socialContacts.some((c) => c.conversation_key === selectedKey);
    return jaExiste ? null : selectedKey.slice(prefixo.length) || null;
  }, [isOfficialBox, selectedKey, selectedBoxId, socialContacts]);

  // Mesma queryKey do painel de contexto ⇒ o TanStack dedupa, sem rede extra.
  const { data: leadDeConversaNova } = useLeadByPhone(telefoneDeConversaNova);

  const selectedSocialContact = useMemo(() => {
    const existente = socialContacts.find((c) => c.conversation_key === selectedKey) ?? null;
    if (existente || !isOfficialBox) return existente;

    // CONVERSA QUE AINDA NÃO EXISTE. A lista da caixa oficial vem de uma RPC que
    // só devolve quem já trocou mensagem — o primeiro contato, vindo do funil,
    // não tem linha em lugar nenhum. O contato sintético existe só na tela, até a
    // primeira mensagem sair; depois o real toma o lugar, com a mesma chave.
    //
    // O NOME DO LEAD entra aqui. Sem ele a conversa nascia rotulada por um
    // identificador — e, pior, pelo fallback de Instagram, num canal que é
    // WhatsApp.
    return contatoDeConversaNova(
      selectedKey,
      selectedBoxId,
      leadDeConversaNova?.name ?? null,
    );
  }, [socialContacts, selectedKey, isOfficialBox, selectedBoxId, leadDeConversaNova]);

  /**
   * A lista da caixa social, com a conversa NOVA no topo quando ela existe só na
   * tela. Sem isto o chat abriria a conversa e a lista lateral não a mostraria —
   * o vendedor veria o composer aberto e nenhuma linha selecionada, que se lê
   * como tela quebrada.
   */
  const socialContactsComNova = useMemo(() => {
    if (!selectedSocialContact) return socialContacts;
    const jaEstaNaLista = socialContacts.some(
      (c) => c.conversation_key === selectedSocialContact.conversation_key,
    );
    return jaEstaNaLista ? socialContacts : [selectedSocialContact, ...socialContacts];
  }, [socialContacts, selectedSocialContact]);

  const handleSelectContact = useCallback((key: string) => {
    setSelectedKey(key);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedKey(null);
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
    if (!selectedKey || !selectedInstanceId) return;
    markConversationRead(selectedKey, selectedInstanceId);
  }, [selectedKey, selectedInstanceId, markConversationRead]);

  /**
   * Read-state do canal social.
   *
   * NÃO passa pela RPC `mark_conversation_read`: ela recebe
   * `(p_instance_id, p_normalized_phone)` e monta a chave `whatsapp:...`
   * sozinha — não há telefone nem instância aqui. O upsert direto é o mesmo que
   * a RLS de `conversation_read_state` já autoriza a `authenticated`
   * (`user_id = auth.uid()` + org do usuário), e a chave gravada é EXATAMENTE a
   * que a RPC social lê para calcular `unread_count`. Se as duas divergirem, o
   * badge nunca zera — foi assim que o unread de WhatsApp quebrou
   * (`useConversationReadState` grava `whatsapp:unknown:<phone>`, que a RPC de
   * WhatsApp nunca casa; defeito pré-existente, issue separada, NÃO consertado
   * aqui porque mexeria no comportamento de ~30 orgs em produção).
   */
  const markSocialConversationRead = useCallback(
    (conversationKey: string, channelId: string, externalUserId: string) => {
      if (!organizationId || !user?.id) return;
      queryClient.setQueriesData<SocialContact[]>(
        { queryKey: chatQueryKeys.socialContacts(organizationId, channelId) },
        (old) =>
          old?.map((c) =>
            c.external_user_id === externalUserId ? { ...c, unread_count: 0 } : c,
          ) ?? old,
      );
      void supabase
        .from("conversation_read_state")
        .upsert(
          {
            organization_id: organizationId,
            user_id: user.id,
            conversation_key: conversationKey,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,user_id,conversation_key" },
        )
        .then(undefined, () => {
          /* sem-op: o badge reconcilia no próximo refetch da lista */
        });
    },
    [queryClient, organizationId, user?.id],
  );

  useEffect(() => {
    if (!selectedSocialContact) return;
    markSocialConversationRead(
      selectedSocialContact.conversation_key,
      selectedSocialContact.messaging_channel_id,
      selectedSocialContact.external_user_id,
    );
  }, [selectedSocialContact, markSocialConversationRead]);

  // ── Realtime ────────────────────────────────────────────────────────────────
  // Com a caixa social aberta o patcher de WhatsApp recebe `null` nos dois
  // argumentos: ele continua montado (o canal é por org, não por conversa) mas
  // não tem alvo de cache para tocar. O canal social é montado à parte, e só
  // enquanto a caixa social está aberta — ver `SocialRealtimeMount`.
  useWhatsAppMessagesRealtime(isSocialBox ? null : selectedKey, selectedInstanceId);

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

  // Flag desligada com a aba aberta (rollback, ou troca de org na mesma sessão):
  // a aba some do topo e a lista ficaria presa num escopo sem botão de saída.
  useEffect(() => {
    if (!abasDeGrupos && activeTab === "grupos") setActiveTab("active");
  }, [abasDeGrupos, activeTab]);

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
      // A caixa social não avalia NENHUMA das dimensões do gate — nem funil, nem
      // vendedor, nem etiqueta, nem "pediu atendente". Deixar o gate de WhatsApp
      // decidir aqui faria a lista de Instagram ficar em "carregando" ou exibir
      // o aviso de enriquecimento por causa de um dado que ela nunca leu.
      isSocialBox
        ? "ok"
        : inboxFilterGate(
            filter,
            {
              meta: metaStatus,
              vendor: vendorStatus,
              tags: contactsError ? "error" : "ready",
              waitingHuman: waitingHumanError ? "error" : "ready",
            },
            { isMobile },
          ),
    [isSocialBox, filter, metaStatus, vendorStatus, contactsError, waitingHumanError, isMobile],
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
  if (boxesLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  // Não é mais "nenhuma instância WhatsApp": uma org pode ter só Instagram.
  if (!boxes.length) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2 text-muted-foreground">
        <WifiOff className="w-8 h-8 opacity-40" />
        <p className="text-sm">Nenhuma caixa de entrada disponível</p>
      </div>
    );
  }

  return (
    <>
      {isSocialBox && <SocialRealtimeMount />}
      <ShellComponent
        list={
          <ConversationList
            contacts={isSocialBox ? socialContactsComNova : enrichedContacts}
            selectedKey={selectedKey}
            onSelectContact={handleSelectContact}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isLoading={contactsLoading}
            boxes={boxes}
            selectedBoxId={selectedBoxId}
            onSelectBox={setSelectedBoxId}
            waitingHumanCount={waitingHumanCount}
            waitingHumanLeadIds={waitingHumanLeadIds}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            // A lista NÃO relê a flag: quem manda `p_include_groups` na busca é
            // este componente, e as duas pontas têm que ser a mesma leitura.
            abasDeGrupos={abasDeGrupos}
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
          // Dois componentes, e não um `ChatView` com ramos: o header de
          // WhatsApp carrega takeover, voz, sincronização de histórico, limites
          // e toggle de Copilot — tudo ancorado em telefone e instância uazapi.
          // Passar Instagram por ali seria desabilitar item por item no caminho
          // mais quente do produto.
          isSocialBox ? (
            <SocialChatView
              selectedContact={selectedSocialContact}
              boxChannel={isOfficialBox ? "whatsapp_oficial" : "instagram"}
              // Só a caixa oficial abre ficha de lead: lá o interlocutor É um
              // telefone. No Instagram é IGSID, e a ficha é montada por telefone.
              onOpenLead={isOfficialBox ? handleOpenLeadModal : undefined}
              sender={socialSender}
              channelName={selectedBox?.name ?? "Instagram"}
              organizationId={organizationId}
              mountTime={mountTimeRef.current}
              onBack={handleBack}
              density={density}
              isMobile={isMobile}
            />
          ) : (
            <ChatView
              selectedContact={selectedContact}
              selectedPhone={selectedKey}
              instanceId={selectedInstanceId}
              instanceName={selectedBox?.name ?? ""}
              organizationId={organizationId}
              mountTime={mountTimeRef.current}
              onBack={handleBack}
              onOpenLeadModal={handleOpenLeadModal}
              density={density}
              onDensityChange={setDensity}
              isMobile={isMobile}
            />
          )
        }
        context={
          selectedKey ? (
            // Duas colunas de contexto, e não uma com ramos: a de WhatsApp
            // resolve o lead pelo TELEFONE e é o caminho quente de 30 orgs; a
            // social resolve pelo vínculo em `lead_social_identities` e, quando
            // ele ainda não existe, oferece a ação de criá-lo em vez de exibir
            // uma frase sobre o que não dá para fazer.
            isOfficialBox ? (
              // O canal oficial usa a coluna de WhatsApp, e não a social: o
              // interlocutor É um telefone, que é o identificador forte do lead
              // neste produto (decisão Q8 do spec). A coluna social resolve por
              // `lead_social_identities`, chaveada por IGSID — vincular ali
              // gravaria o telefone num campo de id de rede social, e a lista,
              // que procura o lead POR TELEFONE, continuaria mostrando a conversa
              // sem ficha. O botão pareceria funcionar e não faria nada.
              selectedSocialContact ? (
                <ContextPanel
                  leadId={selectedSocialContact.lead_id ?? undefined}
                  phoneNumber={selectedSocialContact.external_user_id}
                  pushName={selectedSocialContact.display_name}
                />
              ) : undefined
            ) : isSocialBox ? (
              selectedSocialContact ? (
                <SocialContextPanel contact={selectedSocialContact} />
              ) : undefined
            ) : (
              <ContextPanel
                leadId={selectedContact?.lead_id ?? undefined}
                phoneNumber={selectedKey}
                pushName={selectedContact?.push_name ?? null}
              />
            )
          ) : undefined
        }
        selectedPhone={selectedKey}
        onBack={handleBack}
        density={density}
        densityCssVars={cssVars}
      />

      {/* Recebe `phoneNumber` e monta a ficha do lead a partir dele — um
          contato de Instagram não tem telefone, então o modal não existe lá. */}
      {selectedContact && !isSocialBox && (
        <LeadContactModal
          isOpen={leadModalOpen}
          onClose={handleCloseLeadModal}
          phoneNumber={selectedContact.phone_number}
          pushName={selectedContact.push_name ?? undefined}
        />
      )}

      {/* A caixa OFICIAL tem telefone — então tem ficha de lead, criação e
          vínculo, exatamente como o WhatsApp por QR. O `contact_external_id` é o
          telefone do interlocutor; `LeadDetailContent` normaliza por dentro e é
          o mesmo componente das outras conversas. Sem isto o vendedor via
          "Nenhum lead vinculado" sem nenhuma ação possível. */}
      {isOfficialBox && selectedSocialContact && (
        <LeadContactModal
          isOpen={leadModalOpen}
          onClose={handleCloseLeadModal}
          phoneNumber={selectedSocialContact.external_user_id}
          pushName={selectedSocialContact.display_name ?? undefined}
        />
      )}
    </>
  );
}
