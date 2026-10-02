/**
 * Sidebar específica para área Master Admin
 *
 * Outbounder vê apenas Dashboard, Organizações e Usuários.
 * Master (all=true) vê tudo.
 */

import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Shield,
  LayoutDashboard,
  Building2,
  Users,
  UserCog,
  CreditCard,
  Activity,
  Flag,
  ArrowLeft,
  Monitor,
  Heart,
  Brain,
  ToggleLeft,
  MessageSquare,
  Rocket,
  Megaphone,
  CircleDollarSign,
  LifeBuoy,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMasterAuth } from "../hooks/useMasterAuth";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Se definido, o item só aparece quando a permissão existir (ou all=true) */
  permission?: string;
  /**
   * Item exige master PLENO (`permissions.all`). Usar em telas que expõem
   * dados de TODOS os clientes — o outbounder tem linha em master_users mas
   * é perfil restrito e não pode ver a frota inteira.
   */
  requiresFullMaster?: boolean;
}

const allNavItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/master" },
  { label: "Organizações", icon: Building2, path: "/master/organizations", permission: "organizations" },
  { label: "Usuários", icon: Users, path: "/master/users", permission: "users" },
  { label: "Usuários Ativos", icon: Radio, path: "/master/usuarios-ativos", permission: "users", requiresFullMaster: true },
  { label: "Gestores", icon: UserCog, path: "/master/gestores", permission: "gestores" },
  { label: "Planos", icon: CreditCard, path: "/master/plans", permission: "billing" },
  { label: "Features", icon: Flag, path: "/master/features", permission: "features" },
  { label: "Suporte", icon: LifeBuoy, path: "/master/support-tickets", permission: "support" },
  { label: "Logs de Auditoria", icon: Activity, path: "/master/audit-logs", permission: "audit" },
  { label: "Operations", icon: Monitor, path: "/master/operations", permission: "audit" },
  { label: "Automation Health", icon: Heart, path: "/master/automation-health", permission: "audit" },
  { label: "WhatsApp Health", icon: MessageSquare, path: "/master/whatsapp-health", permission: "audit" },
  { label: "Qualidade Oráculo", icon: Brain, path: "/master/oraculo-feedback", permission: "audit", requiresFullMaster: true },
  { label: "Copilot Reasoning", icon: Brain, path: "/master/copilot-reasoning", permission: "audit" },
  { label: "Copilot Toggle Audit", icon: ToggleLeft, path: "/master/copilot-toggle-audit", permission: "audit" },
  { label: "Etapas Won/Lost", icon: CircleDollarSign, path: "/master/stage-roles", permission: "audit" },
  { label: "Onboarding", icon: Rocket, path: "/master/onboarding", permission: "features" },
  { label: "Meta — Ativos", icon: Megaphone, path: "/master/meta-assets", permission: "features" },
];

export function MasterSidebar() {
  const navigate = useNavigate();
  const { masterUser, permissions, isOutbounder } = useMasterAuth();

  // Filtrar nav items baseado nas permissões
  const navItems = allNavItems.filter((item) => {
    // Itens de frota inteira: só master pleno. Checado ANTES do resto, senão
    // o outbounder passaria pelo `permission: "users"` que ele possui.
    if (item.requiresFullMaster && !permissions.all) return false;
    if (!item.permission) return true; // Dashboard sempre visível
    if (permissions.all) return true; // Master full access
    return !!(permissions as Record<string, boolean>)[item.permission];
  });

  // V5: tinta flutuante, igual à lateral do app (Sidebar.tsx). O acento da
  // área Master é VERMELHO — o ouro fica para o produto; aqui o ativo ganha
  // ícone e trilho em `destructive` (ou `insights` para o outbounder), para
  // ninguém confundir as duas lateralidades num relance.
  const accentText = isOutbounder ? "text-insights" : "text-destructive";

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="m-3 mr-0 flex h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col overflow-hidden rounded-panel border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-relevo-tinta"
    >
      {/* Header */}
      <div className="border-b border-sidebar-border px-4 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
              isOutbounder ? "bg-insights/15" : "bg-destructive/15",
            )}
          >
            <Shield className={cn("h-[18px] w-[18px]", accentText)} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold tracking-tight text-sidebar-foreground">
              {isOutbounder ? "Painel Outbound" : "Master Admin"}
            </h2>
            <p className="truncate text-xs text-sidebar-foreground/55">
              {isOutbounder ? "Gestão de Outbound" : "Acesso Total"}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/master"}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
                isActive
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Trilho de 3px colado na borda da lateral, com brilho. */}
                {isActive && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -left-2.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full",
                      isOutbounder
                        ? "bg-insights shadow-[0_0_12px_hsl(var(--insights)/.65)]"
                        : "bg-destructive shadow-[0_0_12px_hsl(var(--destructive)/.65)]"
                    )}
                  />
                )}
                <item.icon className={cn("h-[17px] w-[17px] shrink-0", isActive && accentText)} />
                <span className="flex-1 truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="space-y-2 border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          className="w-full justify-start rounded-xl border border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao App
        </Button>

        <div className="px-2.5 py-1.5 text-xs text-sidebar-foreground/55">
          <p className="truncate font-medium text-sidebar-foreground/80">{masterUser?.notes || "Master User"}</p>
          <p>Todas as ações são logadas</p>
        </div>
      </div>
    </motion.aside>
  );
}
