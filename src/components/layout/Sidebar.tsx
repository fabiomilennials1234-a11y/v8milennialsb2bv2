import { useState, useRef, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Gauge,
  Fuel,
  Calendar,
  CalendarDays,
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
  Workflow,
  TrendingUp,
  Lock,
  Camera,
  Loader2,
  Plus,
  Heart,
  Briefcase,
  Star,
  ShoppingBag,
  Gift,
} from "lucide-react";
import torqueLogo from "@/assets/torque-logo.png";
import torqueIcon from "@/assets/torque-icon.png";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole, useJobTitle } from "@/hooks/useUserRole";
// useWhatsAppContacts/Realtime removidos da Sidebar para performance (eram no-op com instanceId=null)
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { SIDEBAR_FEATURE_MAP, type FeatureKey } from "@/lib/feature-registry";
import { UpgradeModal } from "@/components/shared/UpgradeModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AlertsDropdown } from "@/components/notifications/AlertsDropdown";
import { SidebarPerformanceWidget } from "./SidebarPerformanceWidget";
import { useCustomPipelines } from "@/hooks/useCustomPipelines";
import { CreatePipelineModal } from "@/components/custom-pipelines/CreatePipelineModal";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  { label: "Carteira", icon: TrendingUp, path: "/upsell" },
];

const navItems: NavItemWithChildren[] = [
  { label: "Central de Comando", icon: Gauge, path: "/" },
  { label: "Campanhas", icon: Target, path: "/campanhas" },
  { label: "Marketing", icon: BarChart2, path: "/marketing" },
  { label: "Chat", icon: Zap, path: "/chat" },
  { label: "Funis", icon: GitBranch, path: "/funis", children: funisSubItems },
  { label: "Agenda", icon: CalendarDays, path: "/agenda" },
  { label: "Revisão", icon: Wrench, path: "/follow-ups" },
  { label: "Combustível", icon: Fuel, path: "/leads" },
  { label: "Pódio", icon: Trophy, path: "/performance" },
  { label: "Comissões", icon: DollarSign, path: "/comissoes" },
  { label: "Copilot", icon: Bot, path: "/copilot" },
  { label: "Automações", icon: Workflow, path: "/automacoes" },
];

const adminNavItems: NavItem[] = [
  { label: "Pilotos", icon: Flag, path: "/equipe" },
  { label: "Produtos", icon: Package, path: "/produtos" },
  { label: "TV Dashboard", icon: Tv, path: "/tv" },
];

const bottomNavItems: NavItem[] = [
  { label: "Pitstop", icon: Settings, path: "/configuracoes" },
];

const FUNIS_PATHS = ["/pipe-whatsapp", "/pipe-confirmacao", "/pipe-propostas", "/upsell", "/funis", "/pipe/custom"] as const;

const CUSTOM_PIPE_ICON_MAP: Record<string, React.ElementType> = {
  kanban: Kanban,
  target: Target,
  users: UserCheck,
  "shopping-bag": ShoppingBag,
  heart: Heart,
  briefcase: Briefcase,
  star: Star,
  zap: Zap,
  gift: Gift,
};

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(
    () => {
      // Auto-expand Funis when on a funis page
      const path = window.location.pathname;
      const onFunis = FUNIS_PATHS.some((p) => path.startsWith(p));
      return onFunis ? ["Funis"] : [];
    }
  );
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; label: string; description?: string }>({ open: false, label: "" });
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const location = useLocation();
  const isOnFunisPage = FUNIS_PATHS.some((p) => location.pathname.startsWith(p));
  const open = isOnFunisPage ? !collapsed : !collapsed || hovered;
  const { user, signOut } = useAuth();
  const { data: userRole } = useUserRole();
  const { jobTitle } = useJobTitle();
  const { hasFeature } = useOrgFeatures();
  const [showCreatePipeline, setShowCreatePipeline] = useState(false);

  // Auto-expand Funis when navigating to a funis page
  useEffect(() => {
    if (isOnFunisPage && !expandedMenus.includes("Funis")) {
      setExpandedMenus(prev => [...prev, "Funis"]);
    }
  }, [location.pathname]);
  const { data: customPipelines = [] } = useCustomPipelines();
  const role = userRole?.role;

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

  // Badge de não lidas removido da sidebar global para performance
  // (useWhatsAppContacts(null) retornava [] pois instanceId=null, badge era sempre 0)
  const chatUnreadTotal = 0;

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const isParentActive = (children?: NavItem[], parentLabel?: string) => {
    if (!children) return false;
    if (children.some(child => isActive(child.path))) return true;
    // Check custom pipelines for "Funis" parent
    if (parentLabel === "Funis" && location.pathname.startsWith("/pipe/custom")) return true;
    return false;
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
    if (jobTitle) return jobTitle;
    if (role === "admin") return "Administrador";
    return "Membro";
  };

  // Avatar URL do user metadata
  const currentAvatarUrl = avatarUrl || user?.user_metadata?.avatar_url || null;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Por favor, selecione uma imagem");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5MB");
      return;
    }

    setIsUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `avatars/${user.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(path, file, { contentType: file.type, upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
      await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });

      setAvatarUrl(publicUrl);
      queryClient.invalidateQueries({ queryKey: ["avatar-map"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Foto de perfil atualizada!");
      setAvatarModalOpen(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao fazer upload da foto");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
        {/* Logo area - crossfade between icon (collapsed) and full logo (expanded) */}
        <div
          className="relative flex-shrink-0"
          style={{
            width: open ? 150 : 40,
            height: 40,
            transition: `width 0.55s ${sidebarEase}`,
          }}
        >
          {/* Collapsed: icon only */}
          <img
            src={torqueIcon}
            alt="Torque"
            className="absolute left-0 top-0 h-10 w-10 object-contain"
            style={{
              opacity: open ? 0 : 1,
              transition: `opacity 0.2s ease`,
              transitionDelay: open ? "0s" : "0.15s",
            }}
          />
          {/* Expanded: full horizontal logo, scaled to fit */}
          <img
            src={torqueLogo}
            alt="Torque CRM"
            className="absolute left-0 top-1/2 -translate-y-1/2 object-contain object-left"
            style={{
              width: 150,
              opacity: open ? 1 : 0,
              transition: `opacity 0.2s ease`,
              transitionDelay: open ? "0.15s" : "0s",
            }}
          />
        </div>

        {/* Alerts + collapse button (expanded) */}
        <div
          className="flex items-center gap-2 flex-shrink-0 ml-3 [&_button]:text-sidebar-foreground/80 [&_button]:hover:text-sidebar-foreground [&_button]:hover:bg-sidebar-accent"
          style={{
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: `opacity 0.35s ${sidebarEase}`,
          }}
        >
          <AlertsDropdown />
          <button
            onClick={() => setCollapsed(true)}
            className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-sidebar-foreground" />
          </button>
        </div>

        {/* Expand button (collapsed) */}
        {!open && (
          <button
            onClick={() => setCollapsed(false)}
            className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-sidebar-foreground" />
          </button>
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
                    isParentActive(item.children, item.label) ? "sidebar-item-active" : ""
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
                    {/* Funis customizados dinâmicos */}
                    {item.label === "Funis" && customPipelines.length > 0 && (
                      <div className="border-t border-sidebar-border/50 mt-1 pt-1">
                        {customPipelines.map((pipe) => {
                          const PipeIcon = CUSTOM_PIPE_ICON_MAP[pipe.icon] || Kanban;
                          const pipePath = `/pipe/custom/${pipe.slug}`;
                          return (
                            <NavLink
                              key={pipe.id}
                              to={pipePath}
                              className={`sidebar-item pl-4 ${
                                isActive(pipePath) ? "sidebar-item-active" : ""
                              }`}
                            >
                              <PipeIcon className="w-4 h-4 flex-shrink-0" style={{ color: pipe.color }} />
                              <span className="overflow-hidden whitespace-nowrap flex-1">
                                {pipe.name}
                              </span>
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                    {item.label === "Funis" && (
                      <button
                        onClick={() => setShowCreatePipeline(true)}
                        className="sidebar-item pl-4 w-full text-muted-foreground hover:text-foreground"
                      >
                        <Plus className="w-4 h-4 flex-shrink-0" />
                        <span className="overflow-hidden whitespace-nowrap flex-1 text-left text-xs">
                          Criar Funil
                        </span>
                      </button>
                    )}
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
                {open && (item.path === "/chat" ? chatUnreadTotal > 0 : item.badge) && (
                  <span
                    className={cn(
                      "text-xs font-semibold min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center",
                      item.path === "/chat"
                        ? "bg-amber-500 text-white"
                        : "bg-primary text-primary-foreground"
                    )}
                  >
                    {item.path === "/chat"
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
        {role === "admin" && (
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
          <div
            className="flex-shrink-0"
            onClick={() => setAvatarModalOpen(true)}
          >
            <UserAvatar
              name={getUserName()}
              avatarUrl={currentAvatarUrl}
              size="sm"
              fallbackClassName="bg-primary text-primary-foreground"
            />
          </div>
          <div
            className={cn(
              "overflow-hidden flex-1 min-w-0 transition-opacity duration-400 ease-out cursor-pointer",
              open ? "opacity-100" : "opacity-0"
            )}
            onClick={() => setAvatarModalOpen(true)}
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

      {/* Avatar Upload Modal */}
      <Dialog open={avatarModalOpen} onOpenChange={setAvatarModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Foto de Perfil</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="relative">
              <UserAvatar
                name={getUserName()}
                avatarUrl={currentAvatarUrl}
                size="2xl"
                fallbackClassName="bg-primary text-primary-foreground"
              />
              <button
                className="absolute bottom-0 right-0 p-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="text-center">
              <p className="font-medium">{getUserName()}</p>
              <p className="text-sm text-muted-foreground">{getRoleLabel()}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full gap-2"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              {isUploading ? "Enviando..." : "Escolher Foto"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Formatos aceitos: JPG, PNG, GIF. Tamanho máximo: 5MB.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      {/* Upgrade Modal */}
      <UpgradeModal
        open={upgradeModal.open}
        onOpenChange={(v) => setUpgradeModal((prev) => ({ ...prev, open: v }))}
        featureLabel={upgradeModal.label}
        featureDescription={upgradeModal.description}
      />

      <CreatePipelineModal
        open={showCreatePipeline}
        onOpenChange={setShowCreatePipeline}
      />
    </aside>
  );
}
