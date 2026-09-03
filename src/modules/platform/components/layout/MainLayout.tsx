import { ReactNode, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { SidebarMobileDrawer } from "./SidebarMobileDrawer";
import { MobileBottomNav } from "./MobileBottomNav";
import { OnboardingChecklist } from "@/modules/platform/components/onboarding/OnboardingChecklist";
import { KeyboardShortcutsHelp } from "@/shared/components/KeyboardShortcutsHelp";
import { useGlobalShortcuts, type Shortcut } from "@/modules/platform/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/utils";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useCopilotToggleRealtime } from "@/modules/copilot/hooks/useCopilotToggleRealtime";
import { useIncomingMessageToast } from "@/modules/communication/hooks/useIncomingMessageToast";
import { featureFlags } from "@/modules/platform/lib/feature-flags";
import { ChatBubbleProvider } from "@/contexts/ChatBubbleContext";
import { MobileChatProvider, useMobileChatContext } from "@/contexts/MobileChatContext";
import { ChatBubble } from "@/modules/communication/components/chat/bubble";
import { FloatingDock } from "@/modules/platform/components/dock/FloatingDock";
import { SupportFab } from "@/modules/platform/components/support/SupportFab";
import { SessionDeadBanner } from "@/modules/communication/components/whatsapp/SessionDeadBanner";
import { QuickBlastProgressPanel } from "@/modules/leads/components/bulk-actions/QuickBlastProgressPanel";

// Rotas onde o checklist NÃO deve aparecer
const CHECKLIST_HIDDEN_PATTERNS = [
  /^\/auth/,
  /^\/signup/,
  /^\/reset-password/,
  /^\/_mockup/,
  /^\/master/,
  /^\/tv/,
  /^\/chat(\/|$)/,
  /^\/chat-whatsapp/,
];

// Rotas full-bleed: canvas/chat ocupam o viewport completo (sem padding, sem
// max-width e SEM scroll de página). O editor de automação é um canvas full-
// screen (xyflow) — sem full-bleed, o `-m-6`/`h-[calc(100vh-64px)]` dele briga
// com o padding do <main> e sobra ~8px, revelando um scroll lateral fantasma.
// Regex casa o editor (`/automacoes/novo` e `/automacoes/:id`) mas NÃO a lista
// (`/automacoes`) nem as execuções (`/automacoes/:id/execucoes`).
const FULL_BLEED_PATTERNS = [
  /^\/chat(\/|$)/,
  /^\/chat-whatsapp/,
  /^\/automacoes\/[^/]+$/,
];

// Rotas de chat: no mobile escondem a navbar p/ imersão total. O canvas de
// automação é full-bleed mas MANTÉM a navbar (não é uma conversa).
const CHAT_PATTERNS = [
  /^\/chat(\/|$)/,
  /^\/chat-whatsapp/,
];

// Rotas wide: kanbans ocupam largura quase total (sem max-w-[1600px])
const WIDE_LAYOUT_PATTERNS = [
  // SCRUM-637 (flip): kanbans vivem na rota única `/funil/:slug`.
  /^\/funil(\/|$)/,
  /^\/leads(\/|$)/,
  /^\/custom-pipeline/,
  /^\/campanhas/,
  /^\/upsell/,
  /^\/follow-ups/,
  // Estúdio de Métricas: o painel ganha com largura, como os kanbans. Wide, NÃO
  // full-bleed — a página mantém o padding e o cabeçalho padrão do <main>, e a
  // top bar continua sendo a do produto.
  /^\/metricas/,
];

interface MainLayoutProps {
  children: ReactNode;
}

function MainLayoutInner({ children }: MainLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile } = useViewport();
  const { isChatThreadOpen } = useMobileChatContext();
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  useCopilotToggleRealtime();
  useIncomingMessageToast();

  const toggleHelp = useCallback(() => setShortcutsHelpOpen((v) => !v), []);

  const globalShortcuts = useGlobalShortcuts({
    onNewLead: () => {
      window.dispatchEvent(new CustomEvent("v8:shortcut:new-lead"));
    },
    onGoDashboard: () => navigate("/dashboard"),
    onGoChat: () => navigate("/chat-whatsapp"),
    onGoFunis: () => navigate("/funis"),
    onShowHelp: toggleHelp,
  });

  const showChecklist = !CHECKLIST_HIDDEN_PATTERNS.some((pattern) =>
    pattern.test(location.pathname),
  );

  const isFullBleed = FULL_BLEED_PATTERNS.some((pattern) =>
    pattern.test(location.pathname),
  );
  const isWide = WIDE_LAYOUT_PATTERNS.some((pattern) =>
    pattern.test(location.pathname),
  );

  const isChatRoute = CHAT_PATTERNS.some((p) => p.test(location.pathname));
  const hideNavbar = isMobile && isChatRoute;
  const hideBottomNav = isChatThreadOpen;

  // A lateral é uma coluna irmã do conteúdo, não uma faixa acima dele: por isso
  // o eixo do layout virou horizontal no desktop. No celular não há lateral —
  // a gaveta cobre a navegação e o eixo continua vertical.
  const layout = (
    <div className="flex h-screen bg-background md:flex-row flex-col" data-layout="main">
      {!isMobile && <Sidebar />}

      <div className="flex min-w-0 flex-1 flex-col">
        {isMobile && !hideNavbar && <SidebarMobileDrawer />}

        <SessionDeadBanner />

        {showChecklist && !isFullBleed && (
          <div
            className="fixed right-4 top-4 z-40 hidden sm:block"
            aria-label="Onboarding"
          >
            <OnboardingChecklist />
          </div>
        )}

        <main
          className={cn(
            "flex-1 min-h-0",
          // Mobile guard: clip horizontal overflow no eixo X (mata scroll lateral
          // da página inteira); desktop mantém overflow-x auto p/ kanban/tabelas largas.
            isFullBleed
              ? "overflow-hidden"
              : "overflow-y-auto overflow-x-hidden md:overflow-x-auto",
            isMobile && !hideBottomNav && "pb-16",
          )}
        >
          <div
            className={cn(
              "w-full flex flex-col min-w-0 max-w-full",
              isFullBleed
                ? "h-full px-0 py-0"
                : isWide
                ? "px-4 lg:px-6 py-5 lg:py-6 min-h-full"
                : "px-4 sm:px-6 lg:px-10 xl:px-12 py-5 sm:py-6 lg:py-8 max-w-[1600px] mx-auto min-h-full",
            )}
          >
            {children}
          </div>
        </main>
      </div>

      <KeyboardShortcutsHelp
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
        shortcuts={globalShortcuts}
      />

      {/* Um lugar só para os botões flutuantes. Antes, três componentes de três
          módulos disputavam `fixed bottom-6 right-6` — ver FloatingDock.tsx. */}
      <FloatingDock />
      <SupportFab />
      {featureFlags.chatBubble && <ChatBubble />}

      <QuickBlastProgressPanel />

      <MobileBottomNav />
    </div>
  );

  if (featureFlags.chatBubble) {
    return <ChatBubbleProvider>{layout}</ChatBubbleProvider>;
  }
  return layout;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <MobileChatProvider>
      <MainLayoutInner>{children}</MainLayoutInner>
    </MobileChatProvider>
  );
}
