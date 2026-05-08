/**
 * ChatBubblePanel — container do painel.
 *
 * Desktop ≥768px: popover fixed-position 380×min(560,calc(100dvh-7rem)).
 * Mobile <768px: Sheet bottom-up 88vh.
 *
 * Lazy-loaded (default export) — só baixa o chunk no primeiro open.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useChatBubble } from "@/hooks/useChatBubble";
import { ChatBubbleHeader } from "./ChatBubbleHeader";
import { ChatBubbleSearch } from "./ChatBubbleSearch";
import { ChatBubbleConversationList } from "./ChatBubbleConversationList";
import { ChatBubbleThread } from "./ChatBubbleThread";
import { ChatBubbleEmptyState } from "./ChatBubbleEmptyState";

const MOBILE_BREAKPOINT = 768;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

function PanelContent() {
  const {
    selectedPhone,
    selectedInstanceId,
    instances,
    close,
    toggleMinimized,
    selectConversation,
    backToList,
    isResolvingDeepLink,
    markAsRead,
    pendingLeadName,
  } = useChatBubble();

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebouncedValue(searchQuery, 200);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );

  const inThread = !!selectedPhone && !!selectedInstanceId && !!selectedInstance;

  // Esc: thread → volta lista; lista → fecha painel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (inThread) {
        backToList();
      } else {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inThread, backToList, close]);

  if (instances.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <ChatBubbleHeader
          mode="list"
          onBack={backToList}
          onMinimize={toggleMinimized}
          onClose={close}
        />
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <ChatBubbleEmptyState variant="no-instance" />
        </div>
      </div>
    );
  }

  if (inThread && selectedInstance && selectedPhone) {
    return (
      <div className="flex flex-col h-full">
        <ChatBubbleHeader
          mode="thread"
          contactName={pendingLeadName || selectedPhone}
          instanceName={selectedInstance.instance_name}
          showInstanceDot={instances.length > 1}
          instanceId={selectedInstanceId}
          onBack={backToList}
          onMinimize={toggleMinimized}
          onClose={close}
        />
        <ChatBubbleThread
          phoneNumber={selectedPhone}
          instanceId={selectedInstanceId!}
          instanceName={selectedInstance.instance_name}
          contactName={pendingLeadName || selectedPhone}
          onMarkAsRead={markAsRead}
        />
      </div>
    );
  }

  // Lista (modo default ou enquanto resolve deep-link)
  return (
    <div className="flex flex-col h-full">
      <ChatBubbleHeader
        mode="list"
        onBack={backToList}
        onMinimize={toggleMinimized}
        onClose={close}
      />
      <ChatBubbleSearch value={searchQuery} onChange={setSearchQuery} />
      {isResolvingDeepLink ? (
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-center">
          <p className="text-xs text-muted-foreground">Localizando conversa…</p>
        </div>
      ) : (
        <ChatBubbleConversationList
          instances={instances}
          searchQuery={debouncedQuery}
          selectedPhone={selectedPhone}
          selectedInstanceId={selectedInstanceId}
          onSelect={selectConversation}
        />
      )}
    </div>
  );
}

interface ChatBubblePanelProps {
  isOpen: boolean;
}

function ChatBubblePanel({ isOpen }: ChatBubblePanelProps) {
  const isMobile = useIsMobile();
  const { close } = useChatBubble();
  // pathname watcher fecha em rotas de chat (defesa em profundidade — ChatBubble já tem guard)
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === "/chat" || pathname.startsWith("/chat-whatsapp")) {
      // Não fechar — apenas o ChatBubble (wrapper) some. Estado preservado.
    }
  }, [pathname]);

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
        <SheetContent
          side="bottom"
          id="chat-bubble-panel"
          className="h-[88vh] p-0 rounded-t-2xl bg-popover border-t border-border/60 flex flex-col"
        >
          <PanelContent />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <motion.div
      id="chat-bubble-panel"
      role="dialog"
      aria-label="WhatsApp"
      data-state="open"
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 8 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="
        fixed bottom-24 right-6 z-50
        w-[380px] max-w-[calc(100vw-3rem)]
        h-[min(560px,calc(100dvh-7rem))]
        flex flex-col
        bg-popover text-popover-foreground
        rounded-2xl
        ring-1 ring-border/60
        chat-bubble-panel-shadow
        overflow-hidden
        motion-reduce:!transition-none
      "
    >
      <PanelContent />
    </motion.div>
  );
}

export default ChatBubblePanel;
