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
import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { useChatBubbleState } from "@/modules/communication/hooks/useChatBubbleState";
import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";
import { useWhatsAppMessagesRealtime } from "@/modules/communication/hooks/chat/useWhatsAppRealtime";
import { useChatBubbleContactsRealtime } from "@/modules/communication/hooks/chat/useChatBubbleContactsRealtime";
import { useResolveChatDeepLink } from "@/modules/communication/hooks/chat/useResolveChatDeepLink";
import { usePreferredInstance } from "@/modules/communication/hooks/usePreferredInstance";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import { normalizePhone } from "@/lib/normalizePhone";
import type { ChatContact, WhatsAppInstanceForUser } from "@/modules/communication/hooks/chat/types";

/**
 * Janela do badge de não-lidas. Mensagens recebidas mais antigas que isto não
 * contam no badge — uma não-lida de meses atrás é ruído, não sinal. Limita a
 * query a uma fatia recente em vez de varrer todo o histórico de incoming
 * (antes: SELECT sem LIMIT = full scan por instância × por usuário, ~57% do CPU
 * do banco). Casa com o índice parcial idx_whatsapp_msgs_org_inst_dir_ts.
 */
const UNREAD_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const UNREAD_BADGE_ROW_CAP = 3000; // teto defensivo por instância

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
  /**
   * Filtro visual da lista de conversas por instância. "all" = não filtrado.
   * Persistido por user em localStorage. Filtro é client-side — não afeta
   * `useQueries` cross-instance nem unread badge.
   */
  listInstanceFilter: string | "all";
  /** ID da instância preferida do user (banco). Usado pra badge "padrão" no switcher. */
  preferredInstanceId: string | null;

  // ações
  open: (args?: { phone?: string | null; instanceId?: string | null; leadName?: string | null }) => void;
  close: () => void;
  toggleMinimized: () => void;
  selectConversation: (phone: string, instanceId: string) => void;
  backToList: () => void;
  acknowledgeNeedsPhone: () => void;
  /** Marca conversa como "lida agora" (atualiza localStorage whatsapp_last_seen_*). */
  markAsRead: (phone: string, instanceId: string) => void;
  /** Define filtro visual da lista. Passe "all" pra resetar. */
  setListInstanceFilter: (next: string | "all") => void;
}

export const ChatBubbleContext = createContext<ChatBubbleContextValue | null>(null);

const LAST_SEEN_KEY_PREFIX = "whatsapp_last_seen_";
const LIST_FILTER_KEY_PREFIX = "chat-bubble:list-filter:";

function readListFilter(userId: string | null | undefined): string | "all" {
  if (!userId) return "all";
  if (typeof localStorage === "undefined") return "all";
  try {
    const raw = localStorage.getItem(`${LIST_FILTER_KEY_PREFIX}${userId}`);
    if (!raw) return "all";
    return raw === "all" ? "all" : raw;
  } catch {
    return "all";
  }
}

function writeListFilter(userId: string | null | undefined, value: string | "all"): void {
  if (!userId) return;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${LIST_FILTER_KEY_PREFIX}${userId}`, value);
  } catch {
    /* falha silenciosa */
  }
}

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

// V3 Fase 2: persiste read-state no servidor (conversation_read_state) ao ler
// uma conversa. Fire-and-forget; localStorage continua sendo o fallback.
function markReadServer(instanceId: string | null, phone: string): void {
  if (!instanceId) return;
  const norm = normalizePhone(phone);
  if (!norm) return;
  void supabase
    .rpc("mark_conversation_read", { p_instance_id: instanceId, p_normalized_phone: norm } as never)
    .then(undefined, () => {
      /* tabela/perm indisponível — localStorage cobre */
    });
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
  const [listInstanceFilter, setListInstanceFilterState] = useState<string | "all">(
    () => readListFilter(userId),
  );

  // Re-sincroniza filter quando userId muda (troca de usuário sem reload)
  useEffect(() => {
    setListInstanceFilterState(readListFilter(userId));
  }, [userId]);

  // Persiste filter por user
  useEffect(() => {
    writeListFilter(userId, listInstanceFilter);
  }, [userId, listInstanceFilter]);

  // ── Instâncias permitidas ──────────────────────────────────────────────────
  const { data: instances = [] } = useWhatsAppInstancesForUser();
  const instanceIds = useMemo(() => instances.map((i) => i.id), [instances]);

  // ── Instância preferida (banco + fallback localStorage) ───────────────────
  const { preferredInstanceId, setPreferredInstance } = usePreferredInstance(instances);
  const preferredAppliedRef = useRef(false);

  // Aplica preferência do banco como filtro inicial (uma vez, sem sobrescrever escolha manual)
  useEffect(() => {
    if (preferredAppliedRef.current) return;
    if (!preferredInstanceId) return;
    if (instances.length < 2) return;
    preferredAppliedRef.current = true;
    setListInstanceFilterState(preferredInstanceId);
    writeListFilter(userId, preferredInstanceId);
  }, [preferredInstanceId, instances.length, userId]);

  // Auto-reset filter quando instância filtrada some das permitidas
  useEffect(() => {
    if (listInstanceFilter === "all") return;
    if (instances.length === 0) return;
    const stillExists = instances.some((i) => i.id === listInstanceFilter);
    if (!stillExists) setListInstanceFilterState("all");
  }, [instances, listInstanceFilter]);

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

  // ── Unread total (V3 Fase 2): server-side via get_unread_total (DEFAULT ON) ──
  // Escape hatch: localStorage v3_server_unread='0' volta ao cálculo via localStorage.
  // (instanceIds já declarado acima — reutiliza.)
  const useServerUnread =
    typeof localStorage === "undefined" || localStorage.getItem("v3_server_unread") !== "0";

  // Seed 1x por device: migra last-seen do localStorage → conversation_read_state
  // (mapeando phone→instance via tabela-resumo no servidor). Evita o badge "explodir"
  // no corte, pois read_state passa a refletir o que o device já tinha como lido.
  useEffect(() => {
    if (!organizationId || typeof localStorage === "undefined") return;
    if (localStorage.getItem("v3_read_state_seeded") === "1") return;
    const seen = new Map<string, number>();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      let phone: string | null = null;
      if (k.startsWith(LAST_SEEN_KEY_PREFIX)) phone = k.slice(LAST_SEEN_KEY_PREFIX.length);
      else if (k.startsWith("chat-last-read:")) phone = k.slice(k.lastIndexOf(":") + 1);
      if (!phone) continue;
      const t = new Date(localStorage.getItem(k) || "").getTime();
      if (t > 0) seen.set(phone, Math.max(seen.get(phone) ?? 0, t));
    }
    const entries = Array.from(seen, ([phone, t]) => ({ phone, t }));
    if (entries.length === 0) {
      localStorage.setItem("v3_read_state_seeded", "1");
      return;
    }
    void supabase
      .rpc("seed_conversation_read_state", { p_entries: entries } as never)
      .then(
        () => localStorage.setItem("v3_read_state_seeded", "1"),
        () => {/* retry no próximo mount */ }
      );
  }, [organizationId]);

  // Badge server-side: 1 RPC pra todas as instâncias permitidas.
  const serverUnreadQuery = useQuery({
    queryKey: ["unread-total-server", organizationId, instanceIds],
    queryFn: async (): Promise<number> => {
      if (!organizationId || instanceIds.length === 0) return 0;
      const { data, error } = await supabase.rpc("get_unread_total", {
        p_instance_ids: instanceIds,
      } as never);
      if (error) throw error;
      return (data as number) ?? 0;
    },
    enabled: useServerUnread && !!organizationId && instanceIds.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Fallback localStorage (só quando flag desligada): caminho antigo intocado.
  const contactsQueries = useQueries({
    queries: useServerUnread
      ? []
      : instances.map((inst) => ({
          queryKey: chatQueryKeys.unreadBadge(organizationId, inst.id),
          queryFn: async (): Promise<ChatContact[]> => {
            if (!organizationId) return [];
            const sinceIso = new Date(Date.now() - UNREAD_LOOKBACK_MS).toISOString();
            const { data, error } = await supabase
              .from("whatsapp_messages")
              .select("phone_number, timestamp")
              .eq("organization_id", organizationId)
              .eq("instance_id", inst.id)
              .eq("direction", "incoming")
              .gte("timestamp", sinceIso)
              .order("timestamp", { ascending: false })
              .limit(UNREAD_BADGE_ROW_CAP);
            if (error) throw error;
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
            // Sem `as ChatContact[]`: o cast escondia DOIS campos obrigatórios que
            // este sítio nunca preencheu (`last_message_sent_source`, `is_group`).
            // O discriminador `channel` da união `InboxContact` é literal e
            // obrigatório justamente para que todo sítio de CONSTRUÇÃO apareça no
            // compilador — o cast anulava esse efeito neste, o único que constrói
            // ChatContact à mão fora da camada de dados.
            return Object.entries(unreadByPhone).map(([phone, unread]) => ({
              channel: "whatsapp" as const,
              // Esta query é POR instância (`enabled` amarra `inst.id`): a
              // origem é conhecida, mesmo o contato sendo sintético.
              instance_id: inst.id,
              phone_number: phone, push_name: null, last_message: null,
              last_message_time: new Date().toISOString(), last_message_direction: null,
              last_message_sent_source: null,
              unread_count: unread, lead_id: null, lead_name: null, conversation_id: null,
              archived_at: null, tags: [],
              // Este caminho conta badge de não-lidas por TELEFONE normalizado
              // (`normalizePhone`), e um remote_jid de grupo (@g.us) não sobrevive a
              // ele — nenhum destes contatos é grupo por construção.
              is_group: false,
            }));
          },
          enabled: !!organizationId && !!inst.id,
          staleTime: 5 * 60_000,
        })),
  });

  const unreadTotal = useMemo(() => {
    if (useServerUnread) return serverUnreadQuery.data ?? 0;
    let total = 0;
    for (const q of contactsQueries) {
      for (const c of q.data ?? []) total += c.unread_count ?? 0;
    }
    return total;
  }, [useServerUnread, serverUnreadQuery.data, contactsQueries]);

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
      const bubblePanel = document.getElementById("chat-bubble-panel");
      for (const el of Array.from(dialogs)) {
        if (el.id === "chat-bubble-panel") continue;
        // Popover/dropdown portals triggered from inside the bubble panel
        if (bubblePanel?.contains(el)) continue;
        // Radix Popover portals use data-radix-popper-content-wrapper or
        // aria-labelledby pointing to a trigger inside the bubble
        if (el.closest("[data-radix-popper-content-wrapper]")) continue;
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
      setListInstanceFilterState(args.instanceId);
      return;
    }

    if (args.phone && !args.instanceId) {
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
    markReadServer(instanceId, phone);
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

  const markAsRead = useCallback((phone: string, instanceId: string) => {
    writeLastSeen(phone);
    markReadServer(instanceId, phone);
  }, []);

  const setListInstanceFilter = useCallback((next: string | "all") => {
    setListInstanceFilterState(next);
    setPreferredInstance(next === "all" ? null : next);
  }, [setPreferredInstance]);

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
      listInstanceFilter,
      preferredInstanceId,
      open,
      close,
      toggleMinimized,
      selectConversation,
      backToList,
      acknowledgeNeedsPhone,
      markAsRead,
      setListInstanceFilter,
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
      listInstanceFilter,
      preferredInstanceId,
      open,
      close,
      toggleMinimized,
      selectConversation,
      backToList,
      acknowledgeNeedsPhone,
      markAsRead,
      setListInstanceFilter,
    ],
  );

  return <ChatBubbleContext.Provider value={value}>{children}</ChatBubbleContext.Provider>;
}
