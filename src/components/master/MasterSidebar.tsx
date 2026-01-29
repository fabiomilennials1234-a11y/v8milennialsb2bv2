/**
 * Sidebar específica para área Master Admin
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
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useMasterAuth } from "@/hooks/useMasterAuth";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/master" },
  { label: "Organizações", icon: Building2, path: "/master/organizations" },
  { label: "Usuários", icon: Users, path: "/master/users" },
  { label: "Planos", icon: CreditCard, path: "/master/plans" },
  { label: "Features", icon: Flag, path: "/master/features" },
  { label: "Logs de Auditoria", icon: Activity, path: "/master/audit-logs" },
];

export function MasterSidebar() {
  const navigate = useNavigate();
  const { masterUser } = useMasterAuth();

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="w-64 h-screen bg-card border-r flex flex-col"
    >
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10">
            <Shield className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Master Admin</h2>
            <p className="text-xs text-muted-foreground">Acesso Total</p>
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
                  ? "bg-red-500/10 text-red-600"
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
