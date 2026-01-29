import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
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
} from "lucide-react";
import logoDark from "@/assets/logo-light.png";
import v8Logo from "@/assets/v8-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useWhatsAppContacts, useWhatsAppMessagesRealtime } from "@/hooks/useWhatsAppChat";
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

// Subitens do menu Funis
const funisSubItems: NavItem[] = [
  { label: "Qualificação", icon: MessageSquare, path: "/pipe-whatsapp" },
  { label: "Propostas", icon: Kanban, path: "/pipe-propostas" },
  { label: "Confirmação", icon: Calendar, path: "/pipe-confirmacao" },
];

const navItems: NavItemWithChildren[] = [
  { label: "Central de Comando", icon: Gauge, path: "/" },
  { label: "Campanhas", icon: Target, path: "/campanhas" },
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

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(["Funis"]); // Funis aberto por padrão
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { data: userRole } = useUserRole();

  // Subscription realtime ativa em qualquer página para atualizar contagem de não lidas
  useWhatsAppMessagesRealtime(null);
  const { data: chatContacts = [] } = useWhatsAppContacts();
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

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 260 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="h-screen bg-sidebar flex flex-col border-r border-sidebar-border sticky top-0"
      data-sidebar
    >
      {/* Logo */}
      <div className="p-4 flex items-center justify-between border-b border-sidebar-border min-h-[80px]">
        {collapsed ? (
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
        {navItems.map((item) => (
          <div key={item.path}>
            {item.children ? (
              // Item com submenu
              <>
                <button
                  onClick={() => toggleMenu(item.label)}
                  className={`sidebar-item w-full ${
                    isParentActive(item.children) ? "sidebar-item-active" : ""
                  }`}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <motion.span
                    animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
                    className="overflow-hidden whitespace-nowrap flex-1 text-left"
                  >
                    {item.label}
                  </motion.span>
                  {!collapsed && (
                    <motion.div
                      animate={{ rotate: expandedMenus.includes(item.label) ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </motion.div>
                  )}
                </button>
                <AnimatePresence>
                  {expandedMenus.includes(item.label) && !collapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden ml-4 border-l border-sidebar-border"
                    >
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              // Item simples
              <NavLink
                to={item.path}
                className={`sidebar-item ${
                  isActive(item.path) ? "sidebar-item-active" : ""
                }`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <motion.span
                  animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
                  className="overflow-hidden whitespace-nowrap flex-1"
                >
                  {item.label}
                </motion.span>
                {!collapsed && (item.path === "/chat-whatsapp" ? chatUnreadTotal > 0 : item.badge) && (
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
        ))}
        
        {/* Admin Navigation */}
        {userRole?.role === "admin" && (
          <>
            {!collapsed && (
              <div className="pt-3 pb-1">
                <span className="text-xs text-sidebar-foreground/50 uppercase font-medium">Admin</span>
              </div>
            )}
            {adminNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={`sidebar-item ${
                  isActive(item.path) ? "sidebar-item-active" : ""
                }`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <motion.span
                  animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
                  className="overflow-hidden whitespace-nowrap flex-1"
                >
                  {item.label}
                </motion.span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Performance Widget */}
      <SidebarPerformanceWidget collapsed={collapsed} />

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
            <motion.span
              animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
              className="overflow-hidden whitespace-nowrap"
            >
              {item.label}
            </motion.span>
          </NavLink>
        ))}
      </div>

      {/* User Section */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="sidebar-item cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-primary-foreground">{getUserInitials()}</span>
          </div>
          <motion.div
            animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : "auto" }}
            className="overflow-hidden flex-1"
          >
            <p className="text-sm font-medium text-sidebar-foreground truncate">{getUserName()}</p>
            <p className="text-xs text-sidebar-foreground/60">{getRoleLabel()}</p>
          </motion.div>
          {!collapsed && (
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
    </motion.aside>
  );
}
