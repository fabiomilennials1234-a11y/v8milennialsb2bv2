import { ReactNode, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TopNavigation } from "./TopNavigation";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { KeyboardShortcutsHelp } from "@/components/shared/KeyboardShortcutsHelp";
import { useGlobalShortcuts, type Shortcut } from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/utils";
import { useCopilotToggleRealtime } from "@/hooks/useCopilotToggleRealtime";
import { featureFlags } from "@/lib/feature-flags";
import { ChatBubbleProvider } from "@/contexts/ChatBubbleContext";
import { ChatBubble } from "@/components/chat/bubble";
import { WhatsAppUpdateModal } from "@/components/shared/WhatsAppUpdateModal";

// Rotas onde o checklist NÃO deve aparecer
const CHECKLIST_HIDDEN_PATTERNS = [
  /^\/auth/,
  /^\/signup/,
  /^\/reset-password/,
  /^\/_mockup/,
  /^\/master/,
  /^\/checkout/,
  /^\/tv/,
];

// Rotas full-bleed: chat ocupa viewport completo (sem padding/max-width)
const FULL_BLEED_PATTERNS = [
  /^\/chat(\/|$)/,
  /^\/chat-whatsapp/,
];

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  // Onda 2 U3: subscription único em phone_ai_preferences pra sincronizar
  // estado do switch copilot entre todas as telas + entre usuários da mesma org.
  useCopilotToggleRealtime();

  const toggleHelp = useCallback(() => setShortcutsHelpOpen((v) => !v), []);

  const globalShortcuts = useGlobalShortcuts({
    onNewLead: () => {
      // Dispatch custom event that pages can listen to
      window.dispatchEvent(new CustomEvent("v8:shortcut:new-lead"));
    },
    onGoDashboard: () => navigate("/dashboard"),
    onGoChat: () => navigate("/chat"),
    onGoFunis: () => navigate("/funis"),
    onShowHelp: toggleHelp,
  });

  const showChecklist = !CHECKLIST_HIDDEN_PATTERNS.some((pattern) =>
    pattern.test(location.pathname),
  );

  const isFullBleed = FULL_BLEED_PATTERNS.some((pattern) =>
    pattern.test(location.pathname),
  );

  const layout = (
    <div className="flex flex-col h-screen bg-background" data-layout="main">
      <TopNavigation />

      {/* Checklist de onboarding — pill fixado no top-right, abaixo do topnav */}
      {showChecklist && !isFullBleed && (
        <div
          className="fixed top-[3.75rem] right-4 z-40"
          aria-label="Onboarding"
        >
          <OnboardingChecklist />
        </div>
      )}

      <main
        className={cn(
          "flex-1 min-h-0",
          isFullBleed ? "overflow-hidden" : "overflow-auto",
        )}
      >
        <div
          className={cn(
            "w-full flex flex-col",
            isFullBleed
              ? "h-full px-0 py-0"
              : "px-6 lg:px-10 xl:px-12 py-6 lg:py-8 max-w-[1600px] mx-auto min-h-full",
          )}
        >
          {children}
        </div>
      </main>

      <KeyboardShortcutsHelp
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
        shortcuts={globalShortcuts}
      />

      {featureFlags.chatBubble && <ChatBubble />}

      <WhatsAppUpdateModal />
    </div>
  );

  if (featureFlags.chatBubble) {
    return <ChatBubbleProvider>{layout}</ChatBubbleProvider>;
  }
  return layout;
}
