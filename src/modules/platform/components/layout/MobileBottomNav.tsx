import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, LayoutList, Users, MoreHorizontal, Gauge, CalendarDays, Settings } from "lucide-react";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useMobileChatContext } from "@/contexts/MobileChatContext";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

// ─── Tab definitions ────────────────────────────────────────
interface Tab {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
}

const TABS: Tab[] = [
  { id: "chat", label: "Chat", icon: MessageSquare, path: "/chat-whatsapp" },
  { id: "pipeline", label: "Pipeline", icon: LayoutList, path: "/pipe-whatsapp" },
  { id: "leads", label: "Leads", icon: Users, path: "/leads" },
];

// Secondary nav items inside "Mais" sheet
interface SecondaryItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

const SECONDARY_ITEMS: SecondaryItem[] = [
  { label: "Dashboard", icon: Gauge, path: "/" },
  { label: "Agenda", icon: CalendarDays, path: "/agenda" },
  { label: "Configurações", icon: Settings, path: "/configuracoes" },
];

// ─── Route matching ─────────────────────────────────────────
function isTabActive(tabPath: string, pathname: string): boolean {
  if (tabPath === "/") return pathname === "/";
  return pathname.startsWith(tabPath);
}

// ─── Component ──────────────────────────────────────────────
export function MobileBottomNav() {
  const { isMobile } = useViewport();
  const location = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { isChatThreadOpen } = useMobileChatContext();

  if (!isMobile) return null;
  if (isChatThreadOpen) return null;

  const isAnyTabActive = TABS.some((t) => isTabActive(t.path, location.pathname));
  const isMaisActive = !isAnyTabActive && SECONDARY_ITEMS.some((s) => isTabActive(s.path, location.pathname));

  return (
    <>
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
            const active = isTabActive(tab.path, location.pathname);
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

          {/* Mais tab -- opens sheet */}
          <button
            data-testid="tab-mais"
            data-active={isMaisActive || sheetOpen}
            onClick={() => setSheetOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 flex-1 h-full",
              "transition-colors duration-150",
              "text-muted-foreground",
              (isMaisActive || sheetOpen) && "text-[hsl(47_100%_50%)]",
            )}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-tight">Mais</span>
          </button>
        </div>
      </nav>

      {/* Secondary nav sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className={cn(
            "rounded-t-2xl p-0",
            "pb-[env(safe-area-inset-bottom)]",
            "bg-background/98 backdrop-blur-xl",
            "[&>button]:hidden",
          )}
        >
          <SheetTitle className="sr-only">Menu adicional</SheetTitle>
          <div className="px-2 pt-3 pb-4">
            {/* Drag handle */}
            <div className="w-8 h-1 rounded-full bg-muted-foreground/20 mx-auto mb-4" />

            <div className="space-y-0.5">
              {SECONDARY_ITEMS.map((item) => {
                const active = isTabActive(item.path, location.pathname);
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      navigate(item.path);
                      setSheetOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 w-full px-4 py-3 rounded-xl",
                      "text-sm font-medium transition-colors",
                      "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      active && "text-[hsl(47_100%_50%)] bg-[hsl(47_100%_50%)]/5",
                    )}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
