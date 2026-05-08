/**
 * ChatBubbleContext — estado global do Chat Bubble Kanban (PR3).
 *
 * Provider monta:
 *   - Singleton realtime da thread aberta via useWhatsAppMessagesRealtime
 *     (patcheia messages do chat ativo + contacts da instância selecionada).
 *   - Realtime cross-instâncias via useChatBubbleContactsRealtime
 *     (canal próprio, patcheia contacts de TODAS instâncias permitidas).
 *   - Auto-resolve de instância quando open({ phone }) é chamado sem instanceId,
 *     usando useResolveChatDeepLink (last8 + RLS-safe).
 *   - Auto-minimize quando drawer Lead (ou outro Radix Dialog) está aberto:
 *     observer de mutations em [data-state="open"][role="dialog"] no DOM.
 *
 * NÃO persiste selectedPhone/selectedInstanceId — apenas isOpen/isMinimized
 * (via useChatBubbleState → localStorage chave `chat-bubble:${userId}`).
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useChatBubbleState } from "@/hooks/useChatBubbleState";
import { useWhatsAppInstancesForUser } from "@/hooks/chat/useWhatsAppInstances";
import { useWhatsAppMessagesRealtime } from "@/hooks/chat/useWhatsAppRealtime";
import { useChatBubbleContactsRealtime } from "@/hooks/chat/useChatBubbleContactsRealtime";
import { useResolveChatDeepLink } from "@/hooks/chat/useResolveChatDeepLink";
import { chatQueryKeys } from "@/hooks/chat/shared/queryKeys";
import { normalizePhone } from "@/lib/normalizePhone";
import type { ChatContact, WhatsAppInstanceForUser } from "@/hooks/chat/types";

export interface ChatBubbleContextValue {
  // estado
  isOpen: boolean;
  isMinimized: boolean;
  selectedPhone: string | null;
  selectedInstanceId: string | null;
  /** Nome do lead pré-fornecido pelo CTA (drawer Lead) — usado em fallback "sem telefone". */
  pendingLeadName: string | null;
  unreadTotal: number;
  /** Lista de instâncias permitidas (pra UI mostrar empty/list). */
  instances: WhatsAppInstanceForUser[];
  /** Loading da resolução de deep-link (open com phone sem instanceId). */
  isResolvingDeepLink: boolean;
  /** Flag pra UI mostrar toast "adicione telefone" quando aberto sem phone. */
  needsPhoneHint: boolean;
  /** True quando channel realtime está em CHANNEL_ERROR ou TIMED_OUT. */
  isReconnecting: boolean;

  // ações
  open: (args?: { phone?: string | null; instanceId?: string | null; leadName?: string | null }) => void;
  close: () => void;
  toggleMinimized: () => void;
  selectConversation: (phone: string, instanceId: string) => void;
  backToList: () => void;
  acknowledgeNeedsPhone: () => void;
  /** Marca conversa como "lida agora" (atualiza localStorage whatsapp_last_seen_*). */
  markAsRead: (phone: string, instanceId: string) => void;
}

export const ChatBubbleContext = createContext<ChatBubbleContextValue | null>(null);

const LAST_SEEN_KEY_PREFIX = "whatsapp_last_seen_";

function writeLastSeen(phone: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const norm = normalizePhone(phone);
    if (!norm) return;
    localStorage.setItem(`${LAST_SEEN_KEY_PREFIX}${norm}`, new Date().toISOString());
  } catch {
    /* falha silenciosa */
  }
}

interface ChatBubbleProviderProps {
  children: ReactNode;
}

export function ChatBubbleProvider({ children }: ChatBubbleProviderProps) {
  const { data: teamMember } = useCurrentTeamMember();
  const userId = teamMember?.user_id ?? teamMember?.id ?? null;
  const organizationId = teamMember?.organization_id ?? null;

  const { isOpen, isMinimized, setOpen, setMinimized, toggleMinimized } =
    useChatBubbleState(userId);

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [pendingLeadName, setPendingLeadName] = useState<string | null>(null);
  const [pendingPhoneToResolve, setPendingPhoneToResolve] = useState<string | null>(null);
  const [needsPhoneHint, setNeedsPhoneHint] = useState(false);

  // ── Instâncias permitidas ──────────────────────────────────────────────────
  const { data: instances = [] } = useWhatsAppInstancesForUser();
  const instanceIds = useMemo(() => instances.map((i) => i.id), [instances]);

  // ── Realtime ───────────────────────────────────────────────────────────────
  // (1) Singleton da thread aberta + contacts da instância selecionada.
  useWhatsAppMessagesRealtime(selectedPhone, selectedInstanceId);
  // (2) Cross-instâncias contacts (canal próprio, zero risco /chat).
  const { isReconnecting } = useChatBubbleContactsRealtime(instanceIds, selectedPhone);

  // ── Deep-link resolver: open({ phone }) sem instanceId ─────────────────────
  const deepLink = useResolveChatDeepLink({
    phone: pendingPhoneToResolve,
    allowedInstances: instances,
    enabled: !!pendingPhoneToResolve,
  });

  useEffect(() => {
    if (!pendingPhoneToResolve) return;
    if (deepLink.isLoading) return;
    if (deepLink.data) {
      setSelectedPhone(deepLink.data.phoneNumber);
      setSelectedInstanceId(deepLink.data.instanceId);
      setPendingPhoneToResolve(null);
    } else if (!deepLink.isFetching) {
      // Sem match — limpa pending e mantém Bubble aberto na lista.
      setPendingPhoneToResolve(null);
    }
  }, [deepLink.data, deepLink.isLoading, deepLink.isFetching, pendingPhoneToResolve]);

  // ── Unread total: soma unread_count de cada instância permitida ────────────
  const contactsQueries = useQueries({
    queries: instances.map((inst) => ({
      queryKey: chatQueryKeys.contacts(organizationId, inst.id),
      queryFn: async (): Promise<ChatContact[]> => {
        if (!organizationId) return [];
        // Reusa cache populado por useWhatsAppContacts. Se não houver cache,
        // executa fetch leve apenas das colunas necessárias para badge.
        // Mantém RLS — query filtra org/instance.
        const { data, error } = await supabase
          .from("whatsapp_messages")
          .select("phone_number, direction, timestamp")
          .eq("organization_id", organizationId)
          .eq("instance_id", inst.id)
          .eq("direction", "incoming")
          .order("timestamp", { ascending: false });
        if (error) throw error;

        // Compõe ChatContact mínimo apenas pra calcular unread (sem enriquecimento).
        // useWhatsAppContacts montado pela UI da lista substitui esse cache com dados completos.
        if (typeof localStorage === "undefined") return [];
        const lastSeenMap: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(LAST_SEEN_KEY_PREFIX)) {
            const p = k.slice(LAST_SEEN_KEY_PREFIX.length);
            lastSeenMap[p] = localStorage.getItem(k) || "";
          }
        }

        const unreadByPhone: Record<string, number> = {};
        for (const m of data || []) {
          const norm = normalizePhone(m.phone_number) ?? "";
          if (!norm) continue;
          const lastSeen = lastSeenMap[norm] ? new Date(lastSeenMap[norm]).getTime() : 0;
          if (new Date(m.timestamp).getTime() > lastSeen) {
            unreadByPhone[norm] = (unreadByPhone[norm] ?? 0) + 1;
          }
        }

        // Stub mínimo de ChatContact apenas para somatório do badge —
        // queryKey é compartilhado mas o consumer (lista no painel) escreve
        // dados completos via useWhatsAppContacts (se cache existir, prevalece).
        return Object.entries(unreadByPhone).map(([phone, unread]) => ({
          phone_number: phone,
          push_name: null,
          last_message: null,
          last_message_time: new Date().toISOString(),
          last_message_direction: null,
          unread_count: unread,
          lead_id: null,
          lead_name: null,
          conversation_id: null,
          archived_at: null,
          tags: [],
        })) as ChatContact[];
      },
      enabled: !!organizationId && !!inst.id,
      // Cache curto pra não brigar com useWhatsAppContacts cheio:
      // se a lista já abriu uma vez, useWhatsAppContacts vai sobrescrever
      // o cache com dados ricos e o badge passa a ler de lá.
      staleTime: 30_000,
    })),
  });

  const unreadTotal = useMemo(() => {
    let total = 0;
    for (const q of contactsQueries) {
      const data = q.data;
      if (!data) continue;
      for (const c of data) {
        total += c.unread_count ?? 0;
      }
    }
    return total;
  }, [contactsQueries]);

  // ── Auto-minimize quando drawer Lead (ou outro Radix Dialog) abre ─────────
  // Drawer do shadcn/Radix renderiza com [role="dialog"][data-state="open"].
  // Observamos mutations e minimizamos o Bubble, preservando estado.
  const wasOpenBeforeDialogRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isAnyDialogOpen = (): boolean => {
      const dialogs = document.querySelectorAll(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      );
      // Filtra o painel do próprio Bubble (id="chat-bubble-panel")
      for (const el of Array.from(dialogs)) {
        if (el.id === "chat-bubble-panel") continue;
        return true;
      }
      return false;
    };

    const apply = () => {
      const dialogOpen = isAnyDialogOpen();
      if (dialogOpen && isOpen && !isMinimized) {
        wasOpenBeforeDialogRef.current = true;
        setMinimized(true);
      } else if (!dialogOpen && wasOpenBeforeDialogRef.current && isMinimized) {
        wasOpenBeforeDialogRef.current = null;
        setMinimized(false);
      }
    };

    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-state"],
      subtree: true,
    });
    apply();

    return () => observer.disconnect();
  }, [isOpen, isMinimized, setMinimized]);

  // ── Ações expostas ─────────────────────────────────────────────────────────
  const open = useCallback<ChatBubbleContextValue["open"]>((args) => {
    setOpen(true);
    setMinimized(false);
    setNeedsPhoneHint(false);
    setPendingLeadName(args?.leadName ?? null);

    if (!args || (!args.phone && !args.instanceId)) {
      // Abrir só na lista global — limpa seleção
      setSelectedPhone(null);
      setSelectedInstanceId(null);
      setPendingPhoneToResolve(null);
      // Caller indicou intenção de conversa mas não tem phone? marca hint
      if (args?.leadName && !args.phone) setNeedsPhoneHint(true);
      return;
    }

    if (args.phone && args.instanceId) {
      setSelectedPhone(args.phone);
      setSelectedInstanceId(args.instanceId);
      setPendingPhoneToResolve(null);
      return;
    }

    if (args.phone && !args.instanceId) {
      // Resolver via useResolveChatDeepLink (effect cuida da atribuição)
      setPendingPhoneToResolve(args.phone);
      setSelectedPhone(null);
      setSelectedInstanceId(null);
      return;
    }
  }, [setMinimized, setOpen]);

  const close = useCallback(() => {
    setOpen(false);
    setMinimized(false);
    setSelectedPhone(null);
    setSelectedInstanceId(null);
    setPendingLeadName(null);
    setPendingPhoneToResolve(null);
    setNeedsPhoneHint(false);
  }, [setMinimized, setOpen]);

  const selectConversation = useCallback((phone: string, instanceId: string) => {
    setSelectedPhone(phone);
    setSelectedInstanceId(instanceId);
    setPendingPhoneToResolve(null);
    setPendingLeadName(null);
    setNeedsPhoneHint(false);
    writeLastSeen(phone);
  }, []);

  const backToList = useCallback(() => {
    setSelectedPhone(null);
    setSelectedInstanceId(null);
    setPendingLeadName(null);
    setPendingPhoneToResolve(null);
  }, []);

  const acknowledgeNeedsPhone = useCallback(() => {
    setNeedsPhoneHint(false);
  }, []);

  const markAsRead = useCallback((phone: string, _instanceId: string) => {
    writeLastSeen(phone);
  }, []);

  const value = useMemo<ChatBubbleContextValue>(
    () => ({
      isOpen,
      isMinimized,
      selectedPhone,
      selectedInstanceId,
      pendingLeadName,
      unreadTotal,
      instances,
      isResolvingDeepLink: !!pendingPhoneToResolve && deepLink.isLoading,
      needsPhoneHint,
      isReconnecting,
      open,
      close,
      toggleMinimized,
      selectConversation,
      backToList,
      acknowledgeNeedsPhone,
      markAsRead,
    }),
    [
      isOpen,
      isMinimized,
      selectedPhone,
      selectedInstanceId,
      pendingLeadName,
      unreadTotal,
      instances,
      pendingPhoneToResolve,
      deepLink.isLoading,
      needsPhoneHint,
      isReconnecting,
      open,
      close,
      toggleMinimized,
      selectConversation,
      backToList,
      acknowledgeNeedsPhone,
      markAsRead,
    ],
  );

  return <ChatBubbleContext.Provider value={value}>{children}</ChatBubbleContext.Provider>;
}
