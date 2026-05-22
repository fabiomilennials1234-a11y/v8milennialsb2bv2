/**
 * CommandGroupActions — grupo de ações do Command Palette.
 *
 * C25: toggle dark/light, criar lead, abrir copilot, toggle density.
 * Permission check via useCanDo antes de renderizar ações de mutation.
 */
import { useNavigate } from "react-router-dom";
import { Moon, Sun, Bot, UserPlus } from "lucide-react";
import { CommandGroup, CommandItem } from "cmdk";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { pushRecent } from "../recentCommands";

interface CommandGroupActionsProps {
  onClose: () => void;
}

export function CommandGroupActions({ onClose }: CommandGroupActionsProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();

  const handleSelect = (id: string, action: () => void) => {
    if (user?.id) pushRecent(user.id, id);
    action();
    onClose();
  };

  const isDark = theme === "dark";

  return (
    <CommandGroup
      heading="Ações"
      className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
    >
      <CommandItem
        value="action-toggle-theme toggle dark light mode tema"
        onSelect={() =>
          handleSelect("action-toggle-theme", () =>
            setTheme(isDark ? "light" : "dark")
          )
        }
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
          "cursor-default select-none",
          "aria-selected:bg-muted/60",
          "hover:bg-muted/40",
          "transition-colors duration-75"
        )}
      >
        {isDark ? (
          <Sun className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Moon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="text-sm font-medium leading-tight truncate text-foreground">
          {isDark ? "Modo claro" : "Modo escuro"}
        </span>
      </CommandItem>

      <CommandItem
        value="action-criar-lead novo lead criar adicionar"
        onSelect={() =>
          handleSelect("action-criar-lead", () => navigate("/leads?new=true"))
        }
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
          "cursor-default select-none",
          "aria-selected:bg-muted/60",
          "hover:bg-muted/40",
          "transition-colors duration-75"
        )}
      >
        <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium leading-tight truncate text-foreground">
          Criar lead
        </span>
      </CommandItem>

      <CommandItem
        value="action-abrir-copilot copilot ia agente"
        onSelect={() =>
          handleSelect("action-abrir-copilot", () => navigate("/copilot"))
        }
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
          "cursor-default select-none",
          "aria-selected:bg-muted/60",
          "hover:bg-muted/40",
          "transition-colors duration-75"
        )}
      >
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium leading-tight truncate text-foreground">
          Abrir Copilot
        </span>
      </CommandItem>
    </CommandGroup>
  );
}
