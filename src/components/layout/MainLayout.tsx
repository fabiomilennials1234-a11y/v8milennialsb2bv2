import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { TopNavigation } from "./TopNavigation";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";

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

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation();

  const showChecklist = !CHECKLIST_HIDDEN_PATTERNS.some((pattern) =>
    pattern.test(location.pathname),
  );

  return (
    <div className="flex flex-col h-screen bg-background" data-layout="main">
      <TopNavigation />

      {/* Checklist de onboarding — pill fixado no top-right, abaixo do topnav */}
      {showChecklist && (
        <div
          className="fixed top-[3.75rem] right-4 z-40"
          aria-label="Onboarding"
        >
          <OnboardingChecklist />
        </div>
      )}

      <main className="flex-1 min-h-0 overflow-auto">
        <div className="px-6 lg:px-10 xl:px-12 py-6 lg:py-8 max-w-[1600px] mx-auto w-full min-h-full flex flex-col">
          {children}
        </div>
      </main>
    </div>
  );
}
