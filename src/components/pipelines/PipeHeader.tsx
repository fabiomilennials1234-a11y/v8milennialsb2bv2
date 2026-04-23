import { motion } from "framer-motion";
import { Settings2, Plus, ChevronDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface PipeHeaderAction {
  id: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: "default" | "primary";
}

export interface PipeHeaderProps {
  title: string;
  subtitle?: string;
  count?: number;
  countLabel?: string;
  onOpenSettings?: () => void;
  /** Primary actions grouped under a single "+ Novo" dropdown. First action is the default/primary. */
  primaryActions?: PipeHeaderAction[];
  /** Secondary controls (view toggle, etc) rendered between settings and primary */
  rightSlot?: React.ReactNode;
}

export function PipeHeader({
  title,
  subtitle,
  count,
  countLabel,
  onOpenSettings,
  primaryActions,
  rightSlot,
}: PipeHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="font-display text-[28px] font-extrabold tracking-[-0.035em] leading-[0.95]"
        >
          {title}
        </motion.h1>
        <div className="flex items-center gap-2 mt-2 text-[13px] text-muted-foreground">
          {typeof count === "number" && (
            <span className="font-mono-num font-semibold text-foreground/85">
              {count.toLocaleString("pt-BR")}
              {countLabel ? ` ${countLabel}` : ""}
            </span>
          )}
          {typeof count === "number" && subtitle && <span className="text-muted-foreground/40">·</span>}
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {rightSlot}

        {onOpenSettings && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9"
                  onClick={onOpenSettings}
                  aria-label="Configurações do funil"
                >
                  <Settings2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Configurações do funil</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {primaryActions && primaryActions.length > 0 && (
          primaryActions.length === 1 ? (
            <Button size="sm" className="gradient-gold h-9 font-semibold shadow-[0_2px_12px_hsl(var(--primary)/0.3)]" onClick={primaryActions[0].onClick}>
              <Plus className="w-4 h-4 mr-1.5" strokeWidth={2.5} />
              {primaryActions[0].label}
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gradient-gold h-9 font-semibold shadow-[0_2px_12px_hsl(var(--primary)/0.3)]">
                  <Plus className="w-4 h-4 mr-1.5" strokeWidth={2.5} />
                  Novo
                  <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs uppercase text-muted-foreground font-medium tracking-wider">
                  Adicionar ao funil
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {primaryActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    onClick={action.onClick}
                    className="flex items-start gap-2.5 cursor-pointer py-2.5"
                  >
                    {action.icon && <action.icon className="w-4 h-4 mt-0.5 shrink-0 text-primary" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">{action.label}</p>
                      {action.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                          {action.description}
                        </p>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
      </div>
    </div>
  );
}
