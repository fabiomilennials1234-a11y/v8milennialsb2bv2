/**
 * CommandGroupNavigation — grupo de navegação do Command Palette.
 *
 * C25: rotas estáticas com ícone Lucide + label.
 * onClick: navigate(path) + close().
 */
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Bot,
  CalendarDays,
  BarChart3,
  Megaphone,
  Zap,
  Settings,
  ShoppingBag,
  Trophy,
} from "lucide-react";
import { CommandGroup, CommandItem } from "cmdk";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { pushRecent } from "../recentCommands";

interface CommandGroupNavigationProps {
  onClose: () => void;
}

const NAV_ITEMS = [
  { id: "nav-dashboard",   label: "Dashboard",      path: "/dashboard",      Icon: LayoutDashboard },
  { id: "nav-leads",       label: "Leads",           path: "/leads",          Icon: Users },
  { id: "nav-chat",        label: "Chat WhatsApp",   path: "/chat",           Icon: MessageSquare },
  { id: "nav-copilot",     label: "Copilot IA",      path: "/copilot",        Icon: Bot },
  { id: "nav-agenda",      label: "Agenda",          path: "/agenda",         Icon: CalendarDays },
  { id: "nav-analytics",   label: "Analytics",       path: "/analytics",      Icon: BarChart3 },
  { id: "nav-funis",       label: "Funis & Pipes",   path: "/funis",          Icon: Megaphone },
  { id: "nav-automacoes",  label: "Automações",      path: "/automacoes",     Icon: Zap },
  { id: "nav-produtos",    label: "Produtos",        path: "/produtos",       Icon: ShoppingBag },
  { id: "nav-equipe",      label: "Equipe",          path: "/equipe",         Icon: Trophy },
  { id: "nav-settings",   label: "Configurações",   path: "/configuracoes",  Icon: Settings },
];

export function CommandGroupNavigation({ onClose }: CommandGroupNavigationProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleSelect = (id: string, path: string) => {
    if (user?.id) pushRecent(user.id, id);
    navigate(path);
    onClose();
  };

  return (
    <CommandGroup
      heading="Navegação"
      className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
    >
      {NAV_ITEMS.map(({ id, label, path, Icon }) => (
        <CommandItem
          key={id}
          value={`${id} ${label}`}
          onSelect={() => handleSelect(id, path)}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
            "cursor-default select-none",
            "aria-selected:bg-muted/60",
            "hover:bg-muted/40",
            "transition-colors duration-75"
          )}
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium leading-tight truncate text-foreground">
            {label}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
