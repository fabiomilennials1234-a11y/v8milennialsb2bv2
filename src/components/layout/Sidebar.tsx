import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Gauge,
  Fuel,
  Calendar,
  Wrench,
  Trophy,
  DollarSign,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  Kanban,
  UserCheck,
  LogOut,
  Zap,
  Flag,
  Tv,
  Target,
  Package,
  Bot,
  GitBranch,
  BarChart2,
  Lock,
} from "lucide-react";
import logoDark from "@/assets/logo-light.png";
import v8Logo from "@/assets/v8-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useWhatsAppContacts, useWhatsAppMessagesRealtime } from "@/hooks/useWhatsAppChat";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { SIDEBAR_FEATURE_MAP, type FeatureKey } from "@/lib/feature-registry";
import { UpgradeModal } from "@/components/shared/UpgradeModal";
import { Button } from "@/components/ui/button";
import { AlertsDropdown } from "@/components/notifications/AlertsDropdown";
import { SidebarPerformanceWidget } from "./SidebarPerformanceWidget";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  badge?: number;
}

interface NavItemWithChildren extends NavItem {
  children?: NavItem[];
}

// Subitens do menu Funis (ordem: Qualificação > Confirmação > Propostas)
const funisSubItems: NavItem[] = [
  { label: "Qualificação", icon: MessageSquare, path: "/pipe-whatsapp" },
  { label: "Confirmação", icon: Calendar, path: "/pipe-confirmacao" },
  { label: "Propostas", icon: Kanban, path: "/pipe-propostas" },
];

const navItems: NavItemWithChildren[] = [
  { label: "Central de Comando", icon: Gauge, path: "/" },
  { label: "Campanhas", icon: Target, path: "/campanhas" },
  { label: "Marketing", icon: BarChart2, path: "/marketing" },
  { label: "Chat", icon: Zap, path: "/chat-whatsapp" },
  { label: "Funis", icon: GitBranch, path: "/funis", children: funisSubItems },
  { label: "Revisão", icon: Wrench, path: "/follow-ups" },
  { label: "Combustível", icon: Fuel, path: "/leads" },
  { label: "Pódio", icon: Trophy, path: "/performance" },
  { label: "Comissões", icon: DollarSign, path: "/comissoes" },
  { label: "Copilot", icon: Bot, path: "/copilot" },
];

const adminNavItems: NavItem[] = [
  { label: "Pilotos", icon: Flag, path: "/equipe" },
  { label: "Produtos", icon: Package, path: "/produtos" },
  { label: "TV Dashboard", icon: Tv, path: "/tv" },
];

const bottomNavItems: NavItem[] = [
  { label: "Pitstop", icon: Settings, path: "/configuracoes" },
];

const FUNIS_PATHS = ["/pipe-whatsapp", "/pipe-confirmacao", "/pipe-propostas", "/funis"] as const;

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>([]);
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; label: string; description?: string }>({ open: false, label: "" });
  const location = useLocation();
  const isOnFunisPage = FUNIS_PATHS.some((p) => location.pathname.startsWith(p));
  const open = isOnFunisPage ? !collapsed : !collapsed || hovered;
  const { user, signOut } = useAuth();
  const { data: userRole } = useUserRole();
  const { hasFeature } = useOrgFeatures();

  /** Verifica se um nav item está bloqueado pela feature flag */
  const isLocked = (path: string): boolean => {
    const featureKey = SIDEBAR_FEATURE_MAP[path];
    if (!featureKey) return false;
    return !hasFeature(featureKey);
  };

  /** Abre modal de upgrade para uma feature bloqueada */
  const handleLockedClick = (e: React.MouseEvent, label: string) => {
    e.preventDefault();
    e.stopPropagation();
    setUpgradeModal({ open: true, label, description: `O módulo "${label}" não está disponível no seu plano atual.` });
  };

  // Subscription realtime ativa em qualquer página para atualizar contagem de não lidas
  useWhatsAppMessagesRealtime(null);
  const { data: chatContacts = [] } = useWhatsAppContacts(null);
  const chatUnreadTotal = chatContacts.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const isParentActive = (children?: NavItem[]) => {
    if (!children) return false;
    return children.some(child => isActive(child.path));
  };

  const toggleMenu = (label: string) => {
    setExpandedMenus(prev => 
      prev.includes(label) 
        ? prev.filter(l => l !== label) 
        : [...prev, label]
    );
  };

  const getUserInitials = () => {
    if (!user?.email) return "??";
    const email = user.email;
    return email.substring(0, 2).toUpperCase();
  };

  const getUserName = () => {
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    return user?.email?.split("@")[0] || "Usuário";
  };

  const getRoleLabel = () => {
    if (!userRole?.role) return "Piloto";
    const labels: Record<string, string> = {
      admin: "Chefe de Equipe",
      sdr: "Piloto SDR",
      closer: "Piloto Closer",
    };
    return labels[userRole.role] || "Piloto";
  };

  const sidebarEase = "cubic-bezier(0.32, 0.72, 0, 1)";

  return (
    <aside
      style={{
        width: open ? 260 : 80,
        transition: `width 0.55s ${sidebarEase}`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="h-screen bg-sidebar flex flex-col border-r border-sidebar-border sticky top-0 group/sidebar overflow-x-hidden shrink-0"
      data-sidebar
    >
      {/* Logo */}
      <div className="p-4 flex items-center justify-between border-b border-sidebar-border min-h-[80px]">
        {!open ? (
          <div className="flex flex-col items-center w-full gap-2">
            <img src={v8Logo} alt="V8" className="h-10 w-10 object-contain" />
            <button
              onClick={() => setCollapsed(false)}
              className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-sidebar-foreground" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <img src={v8Logo} alt="V8" className="h-12 w-12 object-contain flex-shrink-0" />
              <span className="text-sidebar-foreground/60 text-xs flex-shrink-0">by</span>
              <img src={logoDark} alt="Millennials B2B" className="h-6 object-contain" />
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <AlertsDropdown />
              <button
                onClick={() => setCollapsed(true)}
                className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-sidebar-foreground" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const locked = isLocked(item.path);

          return (
          <div key={item.path}>
            {item.children ? (
              // Item com submenu
              locked ? (
                // Bloqueado — mostra com cadeado
                <button
                  onClick={(e) => handleLockedClick(e, item.label)}
                  className="sidebar-item w-full opacity-50 cursor-not-allowed"
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap flex-1 text-left text-sm min-w-0 transition-opacity duration-400 ease-out",
                      open ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {item.label}
                  </span>
                  {open && <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                </button>
              ) : (
              <>
                <button
                  onClick={() => toggleMenu(item.label)}
                  className={`sidebar-item w-full ${
                    isParentActive(item.children) ? "sidebar-item-active" : ""
                  }`}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap flex-1 text-left text-sm min-w-0 transition-opacity duration-400 ease-out group-hover/sidebar:translate-x-0.5 transition-transform",
                      open ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {item.label}
                  </span>
                  {open && (
                    <span
                      className="inline-block transition-transform duration-400 ease-out"
                      style={{
                        transform: expandedMenus.includes(item.label) ? "rotate(180deg)" : "rotate(0deg)",
                        transitionTimingFunction: sidebarEase,
                      }}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </span>
                  )}
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ml-4 border-l border-sidebar-border",
                    expandedMenus.includes(item.label) && open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        className={`sidebar-item pl-4 ${
                          isActive(child.path) ? "sidebar-item-active" : ""
                        }`}
                      >
                        <child.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="overflow-hidden whitespace-nowrap flex-1">
                          {child.label}
                        </span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              </>
              )
            ) : locked ? (
              // Item simples bloqueado — mostra com cadeado
              <button
                onClick={(e) => handleLockedClick(e, item.label)}
                className="sidebar-item w-full opacity-50 cursor-not-allowed"
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap flex-1 text-left text-sm min-w-0 transition-opacity duration-400 ease-out",
                    open ? "opacity-100" : "opacity-0"
                  )}
                >
                  {item.label}
                </span>
                {open && <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />}
              </button>
            ) : (
              // Item simples desbloqueado
              <NavLink
                to={item.path}
                className={`sidebar-item ${
                  isActive(item.path) ? "sidebar-item-active" : ""
                }`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap flex-1 text-sm min-w-0 transition-opacity duration-400 ease-out group-hover/sidebar:translate-x-0.5 transition-transform",
                    open ? "opacity-100" : "opacity-0"
                  )}
                >
                  {item.label}
                </span>
                {open && (item.path === "/chat-whatsapp" ? chatUnreadTotal > 0 : item.badge) && (
                  <span
                    className={cn(
                      "text-xs font-semibold min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center",
                      item.path === "/chat-whatsapp"
                        ? "bg-amber-500 text-white"
                        : "bg-primary text-primary-foreground"
                    )}
                  >
                    {item.path === "/chat-whatsapp"
                      ? (chatUnreadTotal > 99 ? "99+" : chatUnreadTotal)
                      : item.badge}
                  </span>
                )}
              </NavLink>
            )}
          </div>
          );
        })}
        
        {/* Admin Navigation */}
        {userRole?.role === "admin" && (
          <>
            {open && (
              <div className="pt-3 pb-1">
                <span className="text-xs text-sidebar-foreground/50 uppercase font-medium">Admin</span>
              </div>
            )}
            {adminNavItems.map((item) => {
              const adminLocked = isLocked(item.path);
              return adminLocked ? (
                <button
                  key={item.path}
                  onClick={(e) => handleLockedClick(e, item.label)}
                  className="sidebar-item w-full opacity-50 cursor-not-allowed"
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap flex-1 text-left text-sm min-w-0 transition-opacity duration-400 ease-out",
                      open ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {item.label}
                  </span>
                  {open && <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                </button>
              ) : (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`sidebar-item ${
                    isActive(item.path) ? "sidebar-item-active" : ""
                  }`}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span
                    className={cn(
                      "overflow-hidden whitespace-nowrap flex-1 text-sm min-w-0 transition-opacity duration-400 ease-out group-hover/sidebar:translate-x-0.5 transition-transform",
                      open ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {item.label}
                  </span>
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

      {/* Performance Widget */}
      <SidebarPerformanceWidget collapsed={!open} />

      {/* Bottom Navigation */}
      <div className="p-3 border-t border-sidebar-border space-y-1">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={`sidebar-item ${
              isActive(item.path) ? "sidebar-item-active" : ""
            }`}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap text-sm min-w-0 transition-opacity duration-400 ease-out group-hover/sidebar:translate-x-0.5 transition-transform",
                open ? "opacity-100" : "opacity-0"
              )}
            >
              {item.label}
            </span>
          </NavLink>
        ))}
      </div>

      {/* User Section */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="sidebar-item cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-primary-foreground">{getUserInitials()}</span>
          </div>
          <div
            className={cn(
              "overflow-hidden flex-1 min-w-0 transition-opacity duration-400 ease-out",
              open ? "opacity-100" : "opacity-0"
            )}
          >
            <p className="text-sm font-medium text-sidebar-foreground truncate">{getUserName()}</p>
            <p className="text-xs text-sidebar-foreground/60">{getRoleLabel()}</p>
          </div>
          {open && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={signOut}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      {/* Upgrade Modal */}
      <UpgradeModal
        open={upgradeModal.open}
        onOpenChange={(v) => setUpgradeModal((prev) => ({ ...prev, open: v }))}
        featureLabel={upgradeModal.label}
        featureDescription={upgradeModal.description}
      />
    </aside>
  );
}
