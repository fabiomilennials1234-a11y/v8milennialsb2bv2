import { useState, useRef, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Gauge,
  Fuel,
  CalendarDays,
  Wrench,
  Trophy,
  DollarSign,
  Settings,
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
  Menu,
  Calendar,
  X,
  MoreHorizontal,
  Sun,
  Moon,
  ListChecks,
  FileText,
  Copy,
  Trash2,
  Instagram,
} from "lucide-react";
import torqueLogo from "@/assets/torque-logo.png";
import torqueLogoDark from "@/assets/torque-logo-dark.png";
import torqueIcon from "@/assets/torque-icon.png";
import { useTheme } from "next-themes";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import { useAuth } from "@/modules/identity";
import { useUserRole, useJobTitle, useFeaturePermissions } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useMetaPages } from "@/modules/communication/hooks/chat-meta/useMetaPages";
import { SIDEBAR_FEATURE_MAP } from "@/modules/platform/lib/feature-registry";
import { UpgradeModal } from "@/shared/components/UpgradeModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AlertsDropdown } from "@/modules/platform/components/notifications/AlertsDropdown";
import { usePermanentCustomFunnels, useActiveTemporaryFunnels, usePipelineDisplayConfig, CreateFunilOuCampanhaModal, usePrefetchPipes } from "@/modules/pipelines";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { OrgSwitcher } from "./OrgSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

// ─── Nav Item Types ─────────────────────────────────────────
interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  badge?: number;
  masterOnly?: boolean;
  /** Optional runtime gate key — filtered by the component when false. */
  gate?: "meta_pages_connected";
}

interface NavItemWithChildren extends NavItem {
  children?: NavItem[];
}

// ─── Nav Data ───────────────────────────────────────────────
// funisSubItems is now dynamic — built inside the component from usePipelineDisplayConfig

const PIPE_ICON_MAP: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  confirmacao: Calendar,
  propostas: Kanban,
  upsell: TrendingUp,
};
const PIPE_PATH_MAP: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
  upsell: "/upsell",
};

const turboSubItems: NavItem[] = [
  { label: "Copilot", icon: Bot, path: "/copilot" },
  { label: "Automações", icon: Workflow, path: "/automacoes" },
];

// Primary items — always visible in the top bar
const primaryNavItems: NavItemWithChildren[] = [
  { label: "Comando", icon: Gauge, path: "/" },
  { label: "Chat", icon: Zap, path: "/chat" },
  { label: "Mensagens Meta", icon: Instagram, path: "/atendimento/meta", gate: "meta_pages_connected" },
  { label: "Funis", icon: GitBranch, path: "/funis", children: [] }, // children set dynamically via displayConfig
  { label: "Turbo", icon: Zap, path: "/turbo", children: turboSubItems },
  { label: "Agenda", icon: CalendarDays, path: "/agenda" },
  { label: "Ranking", icon: Trophy, path: "/performance" },
  { label: "Comissões", icon: DollarSign, path: "/comissoes" },
];

// Secondary items — go inside "Mais" overflow menu
const moreNavItems: NavItemWithChildren[] = [
  { label: "Revisão", icon: Wrench, path: "/follow-ups" },
  { label: "Combustível", icon: Fuel, path: "/leads" },
  { label: "Negócios", icon: Briefcase, path: "/negocios" },
  { label: "Checklists", icon: ListChecks, path: "/checklists" },
  { label: "Templates", icon: FileText, path: "/templates" },
  { label: "Duplicatas", icon: Copy, path: "/duplicatas" },
  { label: "Lixeira", icon: Trash2, path: "/lixeira" },
];

// All items combined for mobile
const allNavItems: NavItemWithChildren[] = [
  { label: "Comando", icon: Gauge, path: "/" },
  { label: "Agenda", icon: CalendarDays, path: "/agenda" },
  { label: "Revisão", icon: Wrench, path: "/follow-ups" },
  { label: "Chat", icon: Zap, path: "/chat" },
  { label: "Mensagens Meta", icon: Instagram, path: "/atendimento/meta", gate: "meta_pages_connected" },
  { label: "Funis", icon: GitBranch, path: "/funis", children: [] },
  { label: "Combustível", icon: Fuel, path: "/leads" },
  { label: "Negócios", icon: Briefcase, path: "/negocios" },
  { label: "Ranking", icon: Trophy, path: "/performance" },
  { label: "Comissões", icon: DollarSign, path: "/comissoes" },
  { label: "Turbo", icon: Zap, path: "/turbo", children: turboSubItems },
  { label: "Checklists", icon: ListChecks, path: "/checklists" },
  { label: "Templates", icon: FileText, path: "/templates" },
  { label: "Duplicatas", icon: Copy, path: "/duplicatas" },
  { label: "Lixeira", icon: Trash2, path: "/lixeira" },
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
const TURBO_PATHS = ["/copilot", "/automacoes"] as const;

const OUTBOUND_MEMBER_ALLOWED_PATHS = [
  "/",
  "/chat",
  "/pipe-whatsapp",
  "/pipe-confirmacao",
  "/pipe-propostas",
  "/funis",
  "/follow-ups",
] as const;

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

const NAV_VIEW_PERMISSIONS: Record<string, string> = {
  "/campanhas": "campaigns.view",
  "/marketing": "marketing.view",
  "/chat": "whatsapp.view",
  "/pipe-whatsapp": "pipeline.view",
  "/pipe-confirmacao": "pipeline.view",
  "/pipe-propostas": "pipeline.view",
  "/upsell": "upsell.view",
  "/agenda": "agenda.view",
  "/follow-ups": "followups.view",
  "/leads": "leads.view",
  "/checklists": "checklists.view",
  "/templates": "message_templates.view",
  "/duplicatas": "leads.view",
  "/lixeira": "leads.view",
  "/performance": "performance.view",
  "/comissoes": "commissions.view",
  "/copilot": "copilot.view",
  "/automacoes": "workflows.view",
  "/equipe": "team.view",
  "/produtos": "products.view",
  "/negocios": "deals.view",
  "/configuracoes": "settings.view",
};

// ─── Component ──────────────────────────────────────────────
export function TopNavigation() {
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; label: string; description?: string }>({ open: false, label: "" });
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showCreatePipeline, setShowCreatePipeline] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const themeTransition = useThemeTransition();
  const { user, signOut } = useAuth();
  const { data: userRole } = useUserRole();
  const { jobTitle } = useJobTitle();
  const { hasFeature } = useOrgFeatures();
  const { data: displayConfig } = usePipelineDisplayConfig();
  const { data: permanentPipelines = [] } = usePermanentCustomFunnels();
  const { data: temporaryFunnels = [] } = useActiveTemporaryFunnels();
  const prefetchPipes = usePrefetchPipes();
  const { data: metaPages } = useMetaPages();
  const showMetaNav = (metaPages?.pages.length ?? 0) > 0;

  // Build dynamic funnel sub-items from display config
  const dynamicFunisChildren: NavItem[] = (displayConfig ?? [])
    .filter((c) => c.is_visible)
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      label: c.display_name,
      icon: PIPE_ICON_MAP[c.pipe_type] ?? GitBranch,
      path: PIPE_PATH_MAP[c.pipe_type] ?? "/",
    }));

  // Inject dynamic children into the Funis nav items
  const funisItemPrimary = primaryNavItems.find((n) => n.path === "/funis");
  if (funisItemPrimary) funisItemPrimary.children = dynamicFunisChildren;
  const funisItemAll = allNavItems.find((n) => n.path === "/funis");
  if (funisItemAll) funisItemAll.children = dynamicFunisChildren;
  const { data: featurePerms } = useFeaturePermissions();
  const { isAdmin, isMaster } = useIdentity();
  const role = userRole?.role;
  const { orgType } = useOrganization();
  const isOutboundMember = orgType === "outbound" && role === "member";

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // ─── Permission Helpers ────────────────────────────────────
  const canViewRoute = (path: string): boolean => {
    if (isMaster || isAdmin) return true;
    const permKey = NAV_VIEW_PERMISSIONS[path];
    if (!permKey) return true;
    return featurePerms?.[permKey] !== false;
  };

  const isLocked = (path: string): boolean => {
    if (isMaster || isAdmin) return false;
    if (path === "/turbo") {
      return turboSubItems.every((child) => {
        const featureKey = SIDEBAR_FEATURE_MAP[child.path];
        return featureKey ? !hasFeature(featureKey) : false;
      });
    }
    const featureKey = SIDEBAR_FEATURE_MAP[path];
    if (!featureKey) return false;
    return !hasFeature(featureKey);
  };

  const handleLockedClick = (e: React.MouseEvent, label: string) => {
    e.preventDefault();
    e.stopPropagation();
    setUpgradeModal({ open: true, label, description: `O módulo "${label}" não está disponível no seu plano atual.` });
  };

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const isTurboActive = () => TURBO_PATHS.some((p) => location.pathname.startsWith(p));
  const isFunisActive = () => FUNIS_PATHS.some((p) => location.pathname.startsWith(p));

  const getUserName = () => {
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    return user?.email?.split("@")[0] || "Usuário";
  };

  const getRoleLabel = () => {
    if (jobTitle) return jobTitle;
    if (role === "admin") return "Administrador";
    return "Membro";
  };

  const getUserInitials = () => {
    const name = getUserName();
    return name.substring(0, 2).toUpperCase();
  };

  const currentAvatarUrl = avatarUrl || user?.user_metadata?.avatar_url || null;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (!file.type.startsWith("image/")) { toast.error("Por favor, selecione uma imagem"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("A imagem deve ter no máximo 5MB"); return; }

    setIsUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `avatars/${user.id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("media").upload(path, file, { contentType: file.type, upsert: true });
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

  // ─── Visibility Filters ────────────────────────────────────
  const filterByOutbound = (items: NavItemWithChildren[]) => {
    if (!isOutboundMember) return items;
    return items.filter((item) =>
      OUTBOUND_MEMBER_ALLOWED_PATHS.some(
        (p) => item.path === p || item.children?.some((c) => OUTBOUND_MEMBER_ALLOWED_PATHS.includes(c.path as any))
      )
    );
  };

  const filterByMaster = (items: NavItemWithChildren[]) =>
    items.filter((item) => !item.masterOnly || isMaster);

  const filterByGate = (items: NavItemWithChildren[]) =>
    items.filter((item) => {
      if (item.gate === "meta_pages_connected") return showMetaNav;
      return true;
    });

  const filterByPermission = (items: NavItemWithChildren[]) =>
    items.filter((item) => {
      if (item.children) {
        const visibleChildren = item.children.filter((c) => canViewRoute(c.path));
        return visibleChildren.length > 0 || canViewRoute(item.path);
      }
      return canViewRoute(item.path);
    });

  const visiblePrimary = filterByPermission(filterByGate(filterByMaster(filterByOutbound(primaryNavItems))));
  const visibleMore = filterByPermission(filterByGate(filterByMaster(filterByOutbound(moreNavItems))));
  const visibleAll = filterByPermission(filterByGate(filterByMaster(filterByOutbound(allNavItems))));
  const visibleAdminItems = isOutboundMember ? [] : adminNavItems.filter((item) => canViewRoute(item.path));
  const visibleBottomItems = isOutboundMember ? [] : bottomNavItems.filter((item) => canViewRoute(item.path));
  const visibleFunisSubItems = isOutboundMember
    ? dynamicFunisChildren.filter((s) => OUTBOUND_MEMBER_ALLOWED_PATHS.includes(s.path as any))
    : dynamicFunisChildren;

  // Check if any "Mais" item or admin item is currently active
  const isMoreActive = visibleMore.some((item) => isActive(item.path)) ||
    visibleAdminItems.some((item) => isActive(item.path)) ||
    visibleBottomItems.some((item) => isActive(item.path));

  // ─── Desktop Dropdown Popover (Funis / Turbo) ──────────────
  function renderDropdownNav(item: NavItemWithChildren) {
    const locked = isLocked(item.path);

    if (locked) {
      return (
        <button
          key={item.path}
          onClick={(e) => handleLockedClick(e, item.label)}
          className="topnav-item topnav-item-locked"
        >
          <span>{item.label}</span>
          <Lock className="w-3 h-3 text-amber-500/70" />
        </button>
      );
    }

    const isFunis = item.path === "/funis";
    const isTurbo = item.path === "/turbo";
    const parentActive = isFunis ? isFunisActive() : isTurbo ? isTurboActive() : false;

    return (
      <Popover key={item.path} onOpenChange={(open) => { if (open && isFunis) prefetchPipes(); }}>
        <PopoverTrigger asChild>
          <button className={cn("topnav-item group/dd", parentActive && "topnav-item-active")}>
            <span>{item.label}</span>
            <ChevronDown className="w-3 h-3 opacity-40 transition-transform duration-200 group-data-[state=open]/dd:rotate-180" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="topnav-popover"
        >
          {(isFunis ? visibleFunisSubItems : item.children!).filter((c) => canViewRoute(c.path)).map((child) => {
            const childLocked = isLocked(child.path);
            if (childLocked) {
              return (
                <button
                  key={child.path}
                  onClick={(e) => handleLockedClick(e, child.label)}
                  className="topnav-dropdown-item topnav-dropdown-locked"
                >
                  <child.icon className="w-4 h-4 flex-shrink-0 opacity-50" />
                  <span className="flex-1 text-left">{child.label}</span>
                  <Lock className="w-3 h-3 text-amber-500/70" />
                </button>
              );
            }
            return (
              <NavLink
                key={child.path}
                to={child.path}
                className={cn(
                  "topnav-dropdown-item",
                  isActive(child.path) && "topnav-dropdown-item-active"
                )}
              >
                <child.icon className="w-4 h-4 flex-shrink-0 opacity-60" />
                <span className="flex-1">{child.label}</span>
              </NavLink>
            );
          })}

          {/* Custom pipelines — permanent */}
          {isFunis && !isOutboundMember && permanentPipelines.length > 0 && (
            <>
              <div className="h-px bg-border/40 my-1.5" />
              {permanentPipelines.map((pipe) => {
                const PipeIcon = CUSTOM_PIPE_ICON_MAP[pipe.icon] || Kanban;
                const pipePath = `/pipe/custom/${pipe.slug}`;
                return (
                  <NavLink
                    key={pipe.id}
                    to={pipePath}
                    className={cn("topnav-dropdown-item", isActive(pipePath) && "topnav-dropdown-item-active")}
                  >
                    <PipeIcon className="w-4 h-4 flex-shrink-0" style={{ color: pipe.color }} />
                    <span className="flex-1">{pipe.name}</span>
                  </NavLink>
                );
              })}
            </>
          )}
          {/* Custom pipelines — temporary (with deadline) */}
          {isFunis && !isOutboundMember && temporaryFunnels.length > 0 && (
            <>
              <div className="h-px bg-border/40 my-1.5" />
              {temporaryFunnels.map((pipe) => {
                const pipePath = `/pipe/custom/${pipe.slug}`;
                return (
                  <NavLink
                    key={pipe.id}
                    to={pipePath}
                    className={cn("topnav-dropdown-item", isActive(pipePath) && "topnav-dropdown-item-active")}
                  >
                    <Target className="w-4 h-4 flex-shrink-0 text-purple-400" />
                    <span className="flex-1">{pipe.name}</span>
                  </NavLink>
                );
              })}
            </>
          )}
          {isFunis && !isOutboundMember && (
            <>
              <div className="h-px bg-border/40 my-1.5" />
              <button
                onClick={() => setShowCreatePipeline(true)}
                className="topnav-dropdown-item w-full text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left text-xs">Criar Funil</span>
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  // ─── Desktop Simple Nav Item ────────────────────────────────
  function renderSimpleNav(item: NavItemWithChildren) {
    const locked = isLocked(item.path);

    if (locked) {
      return (
        <button
          key={item.path}
          onClick={(e) => handleLockedClick(e, item.label)}
          className="topnav-item topnav-item-locked"
        >
          <span>{item.label}</span>
          <Lock className="w-3 h-3 text-amber-500/70" />
        </button>
      );
    }

    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={cn("topnav-item", isActive(item.path) && "topnav-item-active")}
      >
        <span>{item.label}</span>
      </NavLink>
    );
  }

  // ─── Desktop Nav Item Router ────────────────────────────────
  function renderDesktopNavItem(item: NavItemWithChildren) {
    if (item.children) return renderDropdownNav(item);
    return renderSimpleNav(item);
  }

  // ─── Mobile Nav Item ────────────────────────────────────────
  function renderMobileNavItem(item: NavItemWithChildren) {
    if (item.masterOnly && !isMaster) return null;
    const locked = isLocked(item.path);

    if (item.children) {
      const visibleChildren = item.children.filter((c) => canViewRoute(c.path));
      if (visibleChildren.length === 0 && !canViewRoute(item.path)) return null;

      if (locked) {
        return (
          <button
            key={item.path}
            onClick={(e) => handleLockedClick(e, item.label)}
            className="mobile-nav-item opacity-40 cursor-not-allowed"
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            <span className="flex-1 text-left">{item.label}</span>
            <Lock className="w-4 h-4 text-amber-500" />
          </button>
        );
      }

      const isFunis = item.path === "/funis";
      const isTurbo = item.path === "/turbo";
      const parentActive = isFunis ? isFunisActive() : isTurbo ? isTurboActive() : false;

      return (
        <div key={item.path}>
          <div className={cn("mobile-nav-group-label", parentActive && "text-primary")}>
            <item.icon className="w-4 h-4 flex-shrink-0 opacity-50" />
            <span>{item.label}</span>
          </div>
          <div className="ml-6 space-y-0.5 mb-2">
            {(isFunis ? visibleFunisSubItems : item.children!).filter((c) => canViewRoute(c.path)).map((child) => {
              const childLocked = isLocked(child.path);
              if (childLocked) {
                return (
                  <button
                    key={child.path}
                    onClick={(e) => handleLockedClick(e, child.label)}
                    className="mobile-nav-item opacity-40 cursor-not-allowed text-sm"
                  >
                    <child.icon className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left">{child.label}</span>
                    <Lock className="w-3 h-3 text-amber-500" />
                  </button>
                );
              }
              return (
                <NavLink
                  key={child.path}
                  to={child.path}
                  onClick={() => setMobileOpen(false)}
                  className={cn("mobile-nav-item text-[13px]", isActive(child.path) && "mobile-nav-item-active")}
                >
                  <child.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">{child.label}</span>
                </NavLink>
              );
            })}
            {isFunis && !isOutboundMember && permanentPipelines.length > 0 && permanentPipelines.map((pipe) => {
              const PipeIcon = CUSTOM_PIPE_ICON_MAP[pipe.icon] || Kanban;
              const pipePath = `/pipe/custom/${pipe.slug}`;
              return (
                <NavLink
                  key={pipe.id}
                  to={pipePath}
                  onClick={() => setMobileOpen(false)}
                  className={cn("mobile-nav-item text-[13px]", isActive(pipePath) && "mobile-nav-item-active")}
                >
                  <PipeIcon className="w-4 h-4 flex-shrink-0" style={{ color: pipe.color }} />
                  <span className="flex-1">{pipe.name}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      );
    }

    if (!canViewRoute(item.path)) return null;

    if (locked) {
      return (
        <button
          key={item.path}
          onClick={(e) => handleLockedClick(e, item.label)}
          className="mobile-nav-item opacity-40 cursor-not-allowed"
        >
          <item.icon className="w-5 h-5 flex-shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <Lock className="w-4 h-4 text-amber-500" />
        </button>
      );
    }

    return (
      <NavLink
        key={item.path}
        to={item.path}
        onClick={() => setMobileOpen(false)}
        className={cn("mobile-nav-item", isActive(item.path) && "mobile-nav-item-active")}
      >
        <item.icon className="w-5 h-5 flex-shrink-0" />
        <span className="flex-1">{item.label}</span>
      </NavLink>
    );
  }

  // ─── Render ────────────────────────────────────────────────
  return (
    <>
      <header className="topnav-header" data-topnav>
        {/* ── Left: Logo ── */}
        <NavLink to="/" className="flex items-center flex-shrink-0" title="Central de Comando">
          <img src={torqueIcon} alt="Torque" className="h-7 w-7 object-contain xl:hidden" />
          <img src={isDark ? torqueLogo : torqueLogoDark} alt="Torque CRM" className="h-7 object-contain object-left hidden xl:block" style={{ width: 110 }} />
        </NavLink>

        {/* ── Center: Desktop Navigation (text-only, Clint-style) ── */}
        <nav className="hidden xl:flex items-center gap-1 ml-10">
          {visiblePrimary.map(renderDesktopNavItem)}

          {/* "Mais" overflow menu */}
          {(visibleMore.length > 0 || (role === "admin" && visibleAdminItems.length > 0) || visibleBottomItems.length > 0) && (
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("topnav-item topnav-mais group/mais", isMoreActive && "topnav-item-active")}>
                  <MoreHorizontal className="w-4 h-4 opacity-50" />
                  <span>Mais</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={4} className="topnav-popover w-52">
                {visibleMore.map((item) => {
                  const locked = isLocked(item.path);
                  if (locked) {
                    return (
                      <button
                        key={item.path}
                        onClick={(e) => handleLockedClick(e, item.label)}
                        className="topnav-dropdown-item topnav-dropdown-locked"
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0 opacity-50" />
                        <span className="flex-1 text-left">{item.label}</span>
                        <Lock className="w-3 h-3 text-amber-500/70" />
                      </button>
                    );
                  }
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={cn("topnav-dropdown-item", isActive(item.path) && "topnav-dropdown-item-active")}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0 opacity-60" />
                      <span className="flex-1">{item.label}</span>
                    </NavLink>
                  );
                })}

                {/* Admin items inside Mais */}
                {role === "admin" && visibleAdminItems.length > 0 && (
                  <>
                    <div className="h-px bg-border/40 my-1.5" />
                    <div className="px-3 py-1">
                      <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-semibold">Admin</span>
                    </div>
                    {visibleAdminItems.map((item) => {
                      const adminLocked = isLocked(item.path);
                      if (adminLocked) {
                        return (
                          <button
                            key={item.path}
                            onClick={(e) => handleLockedClick(e, item.label)}
                            className="topnav-dropdown-item topnav-dropdown-locked"
                          >
                            <item.icon className="w-4 h-4 flex-shrink-0 opacity-50" />
                            <span className="flex-1 text-left">{item.label}</span>
                            <Lock className="w-3 h-3 text-amber-500/70" />
                          </button>
                        );
                      }
                      return (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          className={cn("topnav-dropdown-item", isActive(item.path) && "topnav-dropdown-item-active")}
                        >
                          <item.icon className="w-4 h-4 flex-shrink-0 opacity-60" />
                          <span className="flex-1">{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </>
                )}

                {/* Settings inside Mais */}
                {visibleBottomItems.length > 0 && (
                  <>
                    <div className="h-px bg-border/40 my-1.5" />
                    {visibleBottomItems.map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        className={cn("topnav-dropdown-item", isActive(item.path) && "topnav-dropdown-item-active")}
                      >
                        <item.icon className="w-4 h-4 flex-shrink-0 opacity-60" />
                        <span className="flex-1">{item.label}</span>
                      </NavLink>
                    ))}
                  </>
                )}
              </PopoverContent>
            </Popover>
          )}
        </nav>

        {/* ── Right: Actions ── */}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
          <div className="hidden sm:block">
            <OrgSwitcher />
          </div>

          <AlertsDropdown />

          {/* User avatar + dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="topnav-avatar-trigger">
                <UserAvatar
                  name={getUserName()}
                  avatarUrl={currentAvatarUrl}
                  size="sm"
                  fallbackClassName="bg-primary/90 text-primary-foreground text-xs font-semibold"
                />
                <ChevronDown className="w-3 h-3 text-muted-foreground/50 hidden sm:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1.5 rounded-xl">
              <DropdownMenuLabel className="px-3 py-2.5">
                <p className="text-sm font-medium truncate">{getUserName()}</p>
                <p className="text-xs text-muted-foreground">{getRoleLabel()}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAvatarModalOpen(true)} className="gap-2.5 px-3 py-2 cursor-pointer rounded-lg">
                <Camera className="w-4 h-4 opacity-60" />
                <span>Foto de Perfil</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e: Event) => e.preventDefault()}
                className="gap-2.5 px-3 py-2 cursor-pointer rounded-lg"
                onClick={() => {
                  const next = isDark ? "light" : "dark";
                  if (themeTransition) themeTransition.requestThemeChange(next);
                }}
              >
                {isDark ? <Sun className="w-4 h-4 opacity-60" /> : <Moon className="w-4 h-4 opacity-60" />}
                <span className="flex-1">{isDark ? "Tema Claro" : "Tema Escuro"}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="gap-2.5 px-3 py-2 cursor-pointer rounded-lg text-destructive focus:text-destructive">
                <LogOut className="w-4 h-4 opacity-60" />
                <span>Sair</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="xl:hidden h-9 w-9">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(300px,85vw)] p-0 bg-background/98 backdrop-blur-xl border-l border-border/30 [&>button]:hidden">
              <div className="flex flex-col h-full">
                {/* Mobile sheet header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
                  <img src={isDark ? torqueLogo : torqueLogoDark} alt="Torque CRM" className="h-6 object-contain" style={{ width: 90 }} />
                  <SheetClose asChild>
                    <button className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </SheetClose>
                </div>

                {/* OrgSwitcher mobile */}
                <div className="px-5 py-3 border-b border-border/20 sm:hidden">
                  <OrgSwitcher />
                </div>

                {/* Mobile nav */}
                <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
                  {visibleAll.map(renderMobileNavItem)}

                  {role === "admin" && visibleAdminItems.length > 0 && (
                    <>
                      <div className="pt-4 pb-1 px-3">
                        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-semibold">Admin</span>
                      </div>
                      {visibleAdminItems.map((item) => {
                        const adminLocked = isLocked(item.path);
                        if (adminLocked) {
                          return (
                            <button
                              key={item.path}
                              onClick={(e) => handleLockedClick(e, item.label)}
                              className="mobile-nav-item opacity-40 cursor-not-allowed"
                            >
                              <item.icon className="w-5 h-5 flex-shrink-0" />
                              <span className="flex-1 text-left">{item.label}</span>
                              <Lock className="w-4 h-4 text-amber-500" />
                            </button>
                          );
                        }
                        return (
                          <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => setMobileOpen(false)}
                            className={cn("mobile-nav-item", isActive(item.path) && "mobile-nav-item-active")}
                          >
                            <item.icon className="w-5 h-5 flex-shrink-0" />
                            <span className="flex-1">{item.label}</span>
                          </NavLink>
                        );
                      })}
                    </>
                  )}

                  {visibleBottomItems.length > 0 && (
                    <>
                      <div className="h-px bg-border/20 my-3" />
                      {visibleBottomItems.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          onClick={() => setMobileOpen(false)}
                          className={cn("mobile-nav-item", isActive(item.path) && "mobile-nav-item-active")}
                        >
                          <item.icon className="w-5 h-5 flex-shrink-0" />
                          <span className="flex-1">{item.label}</span>
                        </NavLink>
                      ))}
                    </>
                  )}
                </nav>

                {/* Mobile user footer */}
                <div className="px-5 py-4 border-t border-border/30 space-y-3">
                  <button
                    onClick={() => {
                      const next = isDark ? "light" : "dark";
                      if (themeTransition) themeTransition.requestThemeChange(next);
                    }}
                    className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    {isDark ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
                    <span className="text-sm font-medium">{isDark ? "Tema Claro" : "Tema Escuro"}</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      name={getUserName()}
                      avatarUrl={currentAvatarUrl}
                      size="sm"
                      fallbackClassName="bg-primary/90 text-primary-foreground text-xs"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{getUserName()}</p>
                      <p className="text-[11px] text-muted-foreground">{getRoleLabel()}</p>
                    </div>
                    <button
                      onClick={signOut}
                      className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Avatar Upload Modal */}
      <Dialog open={avatarModalOpen} onOpenChange={setAvatarModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Foto de Perfil</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="relative">
              <UserAvatar name={getUserName()} avatarUrl={currentAvatarUrl} size="2xl" fallbackClassName="bg-primary text-primary-foreground" />
              <button
                className="absolute bottom-0 right-0 p-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-center">
              <p className="font-medium">{getUserName()}</p>
              <p className="text-sm text-muted-foreground">{getRoleLabel()}</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="w-full gap-2">
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {isUploading ? "Enviando..." : "Escolher Foto"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">Formatos aceitos: JPG, PNG, GIF. Tamanho máximo: 5MB.</p>
          </div>
        </DialogContent>
      </Dialog>

      <UpgradeModal
        open={upgradeModal.open}
        onOpenChange={(v) => setUpgradeModal((prev) => ({ ...prev, open: v }))}
        featureLabel={upgradeModal.label}
        featureDescription={upgradeModal.description}
      />

      <CreateFunilOuCampanhaModal open={showCreatePipeline} onOpenChange={setShowCreatePipeline} />
    </>
  );
}
