import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, GitBranch, Users, CalendarDays, MoreHorizontal, Lock } from "lucide-react";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useMobileChatContext } from "@/contexts/MobileChatContext";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import { SIDEBAR_FEATURE_MAP } from "@/modules/platform/lib/feature-registry";
import { UpgradeModal } from "@/shared/components/UpgradeModal";
import { cn } from "@/lib/utils";

// ─── Tab definitions ────────────────────────────────────────
interface Tab {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
  /** Prefixos extras que mantêm a tab ativa (ex.: Funis cobre os pipes). */
  match?: string[];
}

const TABS: Tab[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, path: "/chat-whatsapp", match: ["/chat"] },
  {
    id: "funis",
    label: "Funis",
    icon: GitBranch,
    path: "/funis",
    match: ["/pipe-", "/custom-pipeline", "/upsell"],
  },
  { id: "leads", label: "Leads", icon: Users, path: "/leads" },
  { id: "agenda", label: "Agenda", icon: CalendarDays, path: "/agenda" },
];

// ─── Route matching ─────────────────────────────────────────
function isTabActive(tab: Tab, pathname: string): boolean {
  if (pathname.startsWith(tab.path)) return true;
  return (tab.match ?? []).some((p) => pathname.startsWith(p));
}

// ─── Component ──────────────────────────────────────────────
export function MobileBottomNav() {
  const { isMobile } = useViewport();
  const location = useLocation();
  const navigate = useNavigate();
  const orgFeatures = useOrgFeaturesOptional();
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; label: string }>({ open: false, label: "" });

  const { isChatThreadOpen } = useMobileChatContext();

  // Plan gating — mesma semântica do TopNavigation.isLocked (master recebe
  // todas as features true da RPC, então hasFeature basta).
  const isTabLocked = (tab: Tab): boolean => {
    if (!orgFeatures) return false;
    const featureKey = SIDEBAR_FEATURE_MAP[tab.path];
    return featureKey ? !orgFeatures.hasFeature(featureKey) : false;
  };

  if (!isMobile) return null;
  if (isChatThreadOpen) return null;

  const isAnyTabActive = TABS.some((t) => isTabActive(t, location.pathname));

  // "Mais" abre o Sheet de navegação full do TopNavigation (fonte única,
  // já filtrada por permissão + OrgSwitcher p/ master).
  const openFullNav = () =>
    window.dispatchEvent(new CustomEvent("v8:open-mobile-nav"));

  return (
    <nav
      className={cn(
        "fixed bottom-0 inset-x-0 z-[60]",
        "bg-background/95 backdrop-blur-xl",
        "border-t border-border/30",
        "pb-[env(safe-area-inset-bottom)]",
      )}
      data-testid="mobile-bottom-nav"
      role="navigation"
      aria-label="Navegação principal mobile"
    >
      <div className="flex items-center justify-around h-14">
        {TABS.map((tab) => {
          const active = isTabActive(tab, location.pathname);
          const locked = isTabLocked(tab);
          return (
            <button
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              data-active={active}
              data-locked={locked}
              onClick={() =>
                locked
                  ? setUpgradeModal({ open: true, label: tab.label })
                  : navigate(tab.path)
              }
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full",
                "transition-colors duration-150",
                "text-muted-foreground",
                active && !locked && "text-[hsl(47_100%_50%)]",
                locked && "opacity-50",
              )}
            >
              <span className="relative">
                <tab.icon className="w-5 h-5" />
                {locked && (
                  <Lock className="absolute -top-1 -right-1.5 w-3 h-3 text-amber-500" />
                )}
              </span>
              <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
            </button>
          );
        })}

        {/* Mais -- abre o Sheet de nav full do TopNavigation */}
        <button
          data-testid="tab-mais"
          data-active={!isAnyTabActive}
          onClick={openFullNav}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 flex-1 h-full",
            "transition-colors duration-150",
            "text-muted-foreground",
            !isAnyTabActive && "text-[hsl(47_100%_50%)]",
          )}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] font-medium leading-tight">Mais</span>
        </button>
      </div>

      <UpgradeModal
        open={upgradeModal.open}
        onOpenChange={(v) => setUpgradeModal((prev) => ({ ...prev, open: v }))}
        featureLabel={upgradeModal.label}
        featureDescription={`O módulo "${upgradeModal.label}" não está disponível no seu plano atual.`}
      />
    </nav>
  );
}
