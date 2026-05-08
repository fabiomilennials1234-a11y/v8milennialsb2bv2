/**
 * ChatBubble — wrapper raiz montado em MainLayout.
 *
 * Responsável por:
 *   - Pathname guard (auto-hide em /chat e /chat-whatsapp/*; só renderiza em /pipe/**)
 *   - Feature flag check (chatBubble)
 *   - Lazy-load do painel via React.lazy — chunk só desce no primeiro open
 *   - Controle do FAB + AnimatePresence do painel + toast "sem telefone"
 */
import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { useLocation } from "react-router-dom";
import { featureFlags } from "@/lib/feature-flags";
import { useChatBubble } from "@/hooks/useChatBubble";
import { useToast } from "@/hooks/use-toast";
import { ChatBubbleFab } from "./ChatBubbleFab";

const LazyChatBubblePanel = lazy(() => import("./ChatBubblePanel"));

const PIPE_PREFIX = "/pipe";
const HIDE_ROUTES = ["/chat", "/chat-whatsapp"];

function shouldRenderForPath(pathname: string): boolean {
  if (HIDE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return false;
  }
  return pathname.startsWith(PIPE_PREFIX);
}

export function ChatBubble() {
  const { pathname } = useLocation();
  const {
    isOpen,
    isMinimized,
    unreadTotal,
    open,
    close,
    needsPhoneHint,
    acknowledgeNeedsPhone,
  } = useChatBubble();
  const { toast } = useToast();

  // Toast quando CTA do drawer Lead chama open() sem phone
  useEffect(() => {
    if (needsPhoneHint) {
      toast({
        title: "Adicione um telefone do lead pra abrir a conversa.",
        duration: 4000,
      });
      acknowledgeNeedsPhone();
    }
  }, [needsPhoneHint, toast, acknowledgeNeedsPhone]);

  if (!featureFlags.chatBubble) return null;
  if (!shouldRenderForPath(pathname)) return null;

  const handleFabClick = () => {
    if (isOpen && !isMinimized) {
      close();
    } else {
      open();
    }
  };

  const showPanel = isOpen && !isMinimized;

  return (
    <>
      <ChatBubbleFab
        isOpen={showPanel}
        unreadTotal={unreadTotal}
        onClick={handleFabClick}
      />
      <AnimatePresence>
        {showPanel && (
          <Suspense fallback={null}>
            <LazyChatBubblePanel isOpen={showPanel} />
          </Suspense>
        )}
      </AnimatePresence>
    </>
  );
}
