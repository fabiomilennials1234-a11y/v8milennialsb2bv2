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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useMasterAuth } from "../hooks/useMasterAuth";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Se definido, o item só aparece quando a permissão existir (ou all=true) */
  permission?: string;
}

const allNavItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/master" },
  { label: "Organizações", icon: Building2, path: "/master/organizations", permission: "organizations" },
  { label: "Usuários", icon: Users, path: "/master/users", permission: "users" },
  { label: "Planos", icon: CreditCard, path: "/master/plans", permission: "billing" },
  { label: "Features", icon: Flag, path: "/master/features", permission: "features" },
  { label: "Logs de Auditoria", icon: Activity, path: "/master/audit-logs", permission: "audit" },
  { label: "Operations", icon: Monitor, path: "/master/operations", permission: "audit" },
  { label: "Automation Health", icon: Heart, path: "/master/automation-health", permission: "audit" },
  { label: "WhatsApp Health", icon: MessageSquare, path: "/master/whatsapp-health", permission: "audit" },
  { label: "Copilot Reasoning", icon: Brain, path: "/master/copilot-reasoning", permission: "audit" },
  { label: "Copilot Toggle Audit", icon: ToggleLeft, path: "/master/copilot-toggle-audit", permission: "audit" },
  { label: "Onboarding", icon: Rocket, path: "/master/onboarding", permission: "features" },
  { label: "Meta — Ativos", icon: Megaphone, path: "/master/meta-assets", permission: "features" },
];

export function MasterSidebar() {
  const navigate = useNavigate();
  const { masterUser, permissions, isOutbounder } = useMasterAuth();

  // Filtrar nav items baseado nas permissões
  const navItems = allNavItems.filter((item) => {
    if (!item.permission) return true; // Dashboard sempre visível
    if (permissions.all) return true; // Master full access
    return !!(permissions as Record<string, boolean>)[item.permission];
  });

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="w-64 h-screen bg-card border-r flex flex-col"
    >
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", isOutbounder ? "bg-blue-500/10" : "bg-red-500/10")}>
            <Shield className={cn("w-6 h-6", isOutbounder ? "text-blue-500" : "text-red-500")} />
          </div>
          <div>
            <h2 className="font-bold text-lg">
              {isOutbounder ? "Painel Outbound" : "Master Admin"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isOutbounder ? "Gestão de Outbound" : "Acesso Total"}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/master"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? isOutbounder
                    ? "bg-blue-500/10 text-blue-600"
                    : "bg-red-500/10 text-red-600"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <Separator />

      {/* Footer */}
      <div className="p-4 space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar ao App
        </Button>

        <div className="px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium">{masterUser?.notes || "Master User"}</p>
          <p>Todas as ações são logadas</p>
        </div>
      </div>
    </motion.aside>
  );
}
