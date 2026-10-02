/**
 * Navegação da área Master.
 *
 * V5 (onda "mais perto do mockup", 02/10): a lateral vermelha de 18 itens
 * virou uma pílula de 7 grupos (Dashboard · Organizações · Usuários · Planos ·
 * Saúde · Auditoria · Suporte) e, dentro do grupo, um segmentado com as
 * sub-páginas. Os destinos são EXATAMENTE os mesmos de antes, com os mesmos
 * filtros de permissão — só a forma mudou. O arquivo mantém o nome antigo para
 * não espalhar renomeação; o componente agora é `MasterNav`.
 *
 * Outbounder vê apenas Dashboard, Organizações e Usuários.
 * Master (all=true) vê tudo.
 */

import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  Activity,
  HeartPulse,
  LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMasterAuth } from "../hooks/useMasterAuth";

interface NavItem {
  label: string;
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

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

/** Os mesmos 18 destinos da lateral antiga, agrupados. */
const MASTER_GROUPS: NavGroup[] = [
  { label: "Dashboard", icon: LayoutDashboard, items: [{ label: "Dashboard", path: "/master" }] },
  {
    label: "Organizações",
    icon: Building2,
    items: [
      { label: "Organizações", path: "/master/organizations", permission: "organizations" },
      { label: "Onboarding", path: "/master/onboarding", permission: "features" },
      { label: "Meta — Ativos", path: "/master/meta-assets", permission: "features" },
      { label: "Etapas Won/Lost", path: "/master/stage-roles", permission: "audit" },
    ],
  },
  {
    label: "Usuários",
    icon: Users,
    items: [
      { label: "Usuários", path: "/master/users", permission: "users" },
      { label: "Usuários Ativos", path: "/master/usuarios-ativos", permission: "users", requiresFullMaster: true },
      { label: "Gestores", path: "/master/gestores", permission: "gestores" },
    ],
  },
  {
    label: "Planos",
    icon: CreditCard,
    items: [
      { label: "Planos", path: "/master/plans", permission: "billing" },
      { label: "Features", path: "/master/features", permission: "features" },
    ],
  },
  {
    label: "Saúde",
    icon: HeartPulse,
    items: [
      { label: "Operations", path: "/master/operations", permission: "audit" },
      { label: "Automation Health", path: "/master/automation-health", permission: "audit" },
      { label: "WhatsApp Health", path: "/master/whatsapp-health", permission: "audit" },
      { label: "Qualidade Oráculo", path: "/master/oraculo-feedback", permission: "audit", requiresFullMaster: true },
      { label: "Copilot Reasoning", path: "/master/copilot-reasoning", permission: "audit" },
    ],
  },
  {
    label: "Auditoria",
    icon: Activity,
    items: [
      { label: "Logs de Auditoria", path: "/master/audit-logs", permission: "audit" },
      { label: "Copilot Toggle Audit", path: "/master/copilot-toggle-audit", permission: "audit" },
    ],
  },
  { label: "Suporte", icon: LifeBuoy, items: [{ label: "Suporte", path: "/master/support-tickets", permission: "support" }] },
];

function pathCasa(atual: string, path: string) {
  return path === "/master" ? atual === "/master" || atual === "/master/" : atual === path || atual.startsWith(`${path}/`);
}

const PILL_ITEM =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function MasterNav({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const { permissions } = useMasterAuth();

  const pode = (item: NavItem) => {
    // Itens de frota inteira: só master pleno. Checado ANTES do resto, senão
    // o outbounder passaria pelo `permission: "users"` que ele possui.
    if (item.requiresFullMaster && !permissions.all) return false;
    if (!item.permission) return true; // Dashboard sempre visível
    if (permissions.all) return true; // Master full access
    return !!(permissions as Record<string, boolean>)[item.permission];
  };

  const grupos = MASTER_GROUPS.map((g) => ({ ...g, items: g.items.filter(pode) })).filter((g) => g.items.length > 0);
  const ativo = grupos.find((g) => g.items.some((i) => pathCasa(pathname, i.path))) ?? grupos[0];

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <nav
        aria-label="Seções do Master"
        className="inline-flex max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-full bg-tinta p-1 text-tinta-muted shadow-relevo-tinta scrollbar-hide"
      >
        {grupos.map((g) => {
          const isAtivo = g === ativo;
          return (
            <NavLink
              key={g.label}
              to={g.items[0].path}
              end={g.items[0].path === "/master"}
              aria-current={isAtivo ? "page" : undefined}
              className={cn(
                PILL_ITEM,
                isAtivo
                  ? "bg-destructive text-destructive-foreground shadow-[0_8px_24px_-10px_hsl(var(--destructive)/.8)]"
                  : "hover:text-tinta-foreground",
              )}
            >
              <g.icon className="h-3.5 w-3.5" aria-hidden />
              {g.label}
            </NavLink>
          );
        })}
      </nav>

      {ativo && ativo.items.length > 1 && (
        <nav
          aria-label={`Páginas de ${ativo.label}`}
          className="inline-flex max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-full bg-muted p-[3px] scrollbar-hide"
        >
          {ativo.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end
              className={({ isActive }) =>
                cn(
                  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
