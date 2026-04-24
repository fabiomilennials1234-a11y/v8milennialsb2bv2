/**
 * CommandGroupRecents — grupo de comandos recentes no Command Palette.
 *
 * C26 (B3): localStorage user-scoped `cmd-palette-recent-${userId}`.
 * Renderiza no topo quando query vazia. Top 5 LRU.
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
  Moon,
  UserPlus,
  HistoryIcon,
} from "lucide-react";
import { CommandGroup, CommandItem } from "cmdk";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getRecent, pushRecent } from "../recentCommands";

interface CommandGroupRecentsProps {
  onClose: () => void;
}

// Mapa de id → config de item (label + icon + action type)
// Mantido sincronizado com Navigation e Actions
type RecoverableItem = {
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  type: "navigate" | "action";
  payload?: string;
};

const ITEM_MAP: Record<string, RecoverableItem> = {
  "nav-dashboard":      { label: "Dashboard",       Icon: LayoutDashboard, type: "navigate", payload: "/dashboard" },
  "nav-leads":          { label: "Leads",            Icon: Users,           type: "navigate", payload: "/leads" },
  "nav-chat":           { label: "Chat WhatsApp",    Icon: MessageSquare,   type: "navigate", payload: "/chat" },
  "nav-copilot":        { label: "Copilot IA",       Icon: Bot,             type: "navigate", payload: "/copilot" },
  "nav-agenda":         { label: "Agenda",           Icon: CalendarDays,    type: "navigate", payload: "/agenda" },
  "nav-analytics":      { label: "Analytics",        Icon: BarChart3,       type: "navigate", payload: "/analytics" },
  "nav-funis":          { label: "Funis & Pipes",    Icon: Megaphone,       type: "navigate", payload: "/funis" },
  "nav-automacoes":     { label: "Automações",       Icon: Zap,             type: "navigate", payload: "/automacoes" },
  "nav-produtos":       { label: "Produtos",         Icon: ShoppingBag,     type: "navigate", payload: "/produtos" },
  "nav-equipe":         { label: "Equipe",           Icon: Trophy,          type: "navigate", payload: "/equipe" },
  "nav-settings":       { label: "Configurações",    Icon: Settings,        type: "navigate", payload: "/configuracoes" },
  "action-toggle-theme": { label: "Toggle tema",    Icon: Moon,            type: "action" },
  "action-criar-lead":  { label: "Criar lead",       Icon: UserPlus,        type: "navigate", payload: "/leads?new=true" },
  "action-abrir-copilot": { label: "Abrir Copilot", Icon: Bot,             type: "navigate", payload: "/copilot" },
};

export function CommandGroupRecents({ onClose }: CommandGroupRecentsProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  if (!user?.id) return null;

  const recentIds = getRecent(user.id);
  const validRecents = recentIds
    .map((id) => ({ id, config: ITEM_MAP[id] }))
    .filter((r) => !!r.config)
    .slice(0, 5);

  if (validRecents.length === 0) return null;

  const handleSelect = (id: string, config: RecoverableItem) => {
    pushRecent(user.id!, id);
    if (config.type === "navigate" && config.payload) {
      navigate(config.payload);
    } else if (id === "action-toggle-theme") {
      setTheme(theme === "dark" ? "light" : "dark");
    }
    onClose();
  };

  return (
    <CommandGroup
      heading="Recentes"
      className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
    >
      {validRecents.map(({ id, config }) => {
        const { label, Icon } = config;
        return (
          <CommandItem
            key={id}
            value={`recent-${id} ${label}`}
            onSelect={() => handleSelect(id, config)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
              "cursor-default select-none",
              "aria-selected:bg-muted/60",
              "hover:bg-muted/40",
              "transition-colors duration-75"
            )}
          >
            <HistoryIcon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium leading-tight truncate text-foreground">
              {label}
            </span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
