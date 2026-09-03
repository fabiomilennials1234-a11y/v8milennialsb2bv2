import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, GitBranch, Users, CalendarDays, MoreHorizontal } from "lucide-react";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useMobileChatContext } from "@/contexts/MobileChatContext";
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
    // SCRUM-637 (flip): todo funil vive em /funil/:slug; /pipe-* são só
    // redirects e /custom-pipeline segue por bookmark antigo.
    match: ["/funil", "/pipe-", "/custom-pipeline", "/upsell"],
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

  const { isChatThreadOpen } = useMobileChatContext();

  if (!isMobile) return null;
  if (isChatThreadOpen) return null;

  const isAnyTabActive = TABS.some((t) => isTabActive(t, location.pathname));

  // "Mais" abre a gaveta de navegação (SidebarMobileDrawer) — fonte única,
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
          return (
            <button
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              data-active={active}
              onClick={() => navigate(tab.path)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full",
                "transition-colors duration-150",
                "text-muted-foreground",
                active && "text-[hsl(47_100%_50%)]",
              )}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
            </button>
          );
        })}

        {/* Mais — abre a gaveta de nav full (SidebarMobileDrawer) */}
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
    </nav>
  );
}
