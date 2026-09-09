/**
 * ChatBubble — wrapper raiz montado em MainLayout.
 *
 * Responsável por:
 *   - Pathname guard (auto-hide em /chat e /chat-whatsapp/*; só renderiza nas
 *     Pipe pages canônicas: /funil/:slug (rota única pós-SCRUM-637),
 *     /follow-ups e /pipe/custom/:slug)
 *   - Feature flag check (chatBubble)
 *   - Lazy-load do painel via React.lazy — chunk só desce no primeiro open
 *   - Controle do FAB + AnimatePresence do painel + toast "sem telefone"
 */
import { lazy, Suspense, useCallback, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { useLocation } from "react-router-dom";
import { featureFlags } from "@/modules/platform/lib/feature-flags";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import { useChatBubble } from "@/modules/communication/hooks/useChatBubble";
import { useToast } from "@/hooks/use-toast";
import { useViewport } from "@/shared/hooks/use-viewport";
import { DockItem, DockOrder } from "@/modules/platform/components/dock/FloatingDock";
import { ChatBubbleFab } from "./ChatBubbleFab";

const LazyChatBubblePanel = lazy(() => import("./ChatBubblePanel"));

const HIDE_ROUTES = ["/chat", "/chat-whatsapp"];
// Match real routes do projeto (ver src/App.tsx). Usar prefixos exatos pra
// evitar falso-positivo (ex: /pipeline-x acidentalmente bater em /pipe).
const PIPE_PATH_PATTERNS: RegExp[] = [
  // SCRUM-637 (flip): TODO funil (sistema e custom) vive em /funil/:slug —
  // a bolha agora também aparece nos boards custom, que /pipe/custom nunca
  // cobria depois do redirect da 632.
  /^\/funil(\/|$)/,
  /^\/follow-ups(\/|$)/,
];

function shouldRenderForPath(pathname: string): boolean {
  if (HIDE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return false;
  }
  return PIPE_PATH_PATTERNS.some((re) => re.test(pathname));
}

export function ChatBubble() {
  const { isMobile } = useViewport();
  const { pathname } = useLocation();
  const orgFeatures = useOrgFeaturesOptional();
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

  // Identidade estável do handler — evita invalidar memo do FAB durante
  // re-renders do Provider/parent (importante durante drag-and-drop do Kanban).
  const handleFabClick = useCallback(() => {
    if (isOpen && !isMinimized) {
      close();
    } else {
      open();
    }
  }, [isOpen, isMinimized, close, open]);

  // Gate: no bubble on mobile — avoids lazy-loading the panel chunk entirely
  if (isMobile) return null;
  if (!featureFlags.chatBubble) return null;
  // Plan gate: chat é feature de plano — sem ela, nada de painel de conversa
  // in-place nas pipe pages (a rota /chat já é bloqueada pelo route guard).
  if (orgFeatures && !orgFeatures.hasFeature("chat")) return null;
  if (!shouldRenderForPath(pathname)) return null;

  const showPanel = isOpen && !isMinimized;

  return (
    <>
      <DockItem order={DockOrder.chat}>
        <ChatBubbleFab
          isOpen={showPanel}
          unreadTotal={unreadTotal}
          onClick={handleFabClick}
        />
      </DockItem>
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
