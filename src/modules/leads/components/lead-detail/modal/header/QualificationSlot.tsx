import { memo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdateLead } from "../../../../hooks/useLeads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { QUALIFICATION_TIERS, type QualificationTier } from "../types";
import { QUALIFICATION_TIER_CONFIG } from "../qualification-config";

interface QualificationSlotProps {
  leadId: string;
  field: "pre_qualification_tier" | "qualification_tier";
  label: string;
  current: QualificationTier | null;
}

export const QualificationSlot = memo(function QualificationSlot({
  leadId,
  field,
  label,
  current,
}: QualificationSlotProps) {
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const { canEditField } = useLeadActionGates(leadId);
  const [open, setOpen] = useState(false);
  const denied = !canEditField.allowed;

  const config = current ? QUALIFICATION_TIER_CONFIG[current] : null;
  const Icon = config?.icon;

  const handleSelect = async (next: QualificationTier | null) => {
    const value = next === current ? null : next;
    // column added in migration 20260517000000, types regen pendente
    await updateLead.mutateAsync({ id: leadId, [field]: value } as Parameters<typeof updateLead.mutateAsync>[0]);
    const labelTier = value ? QUALIFICATION_TIER_CONFIG[value].label : "Nenhum";
    logAction({
      leadId,
      action: "field_updated",
      description: `${label} alterado para "${labelTier}"`,
    });
    toast.success(`${label}: ${labelTier}`);
    setOpen(false);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={denied}
                aria-label={`${label}${current ? `: ${config?.label}` : " — adicionar"}`}
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all border",
                  config
                    ? cn(config.bgClass, config.borderClass, "hover:scale-105")
                    : "border-dashed border-border/60 hover:border-primary/60 hover:bg-primary/5",
                  denied && "opacity-50 cursor-not-allowed hover:scale-100",
                )}
              >
                {Icon ? (
                  <Icon className={cn("w-4 h-4", config?.colorClass)} />
                ) : (
                  <Plus className="w-4 h-4 text-muted-foreground/70" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {denied
              ? "Sem permissão — peça acesso ao seu admin"
              : `${label}${config ? `: ${config.label}` : ""}`}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-52 p-1.5">
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-2 py-1">
              {label}
            </div>
            {QUALIFICATION_TIERS.map((tier) => {
              const c = QUALIFICATION_TIER_CONFIG[tier];
              const TierIcon = c.icon;
              const isActive = current === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  onClick={() => handleSelect(tier)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors",
                    isActive && "bg-muted"
                  )}
                >
                  <TierIcon className={cn("w-3.5 h-3.5", c.colorClass)} />
                  <span>{c.label}</span>
                </button>
              );
            })}
            {current && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-destructive hover:bg-destructive/10 border-t border-border/40 mt-1 pt-2"
              >
                <X className="w-3.5 h-3.5" /> Remover
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
});
