import { memo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { useResponsibleMembers } from "@/modules/identity";
import { useUpdateLead } from "../../../../hooks/useLeads";
import { useLogLeadAction } from "../../../../hooks/useLogLeadAction";
import { useOptimisticConflictHandler } from "@/shared/hooks/useOptimisticConflictHandler";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ResponsibleSlotProps {
  leadId: string;
  field: "pre_sale_responsible_id" | "sale_responsible_id";
  label: string;
  currentMember: { id: string; name: string; avatar_url?: string | null } | null;
  /**
   * Lead `updated_at` snapshot at render time. When provided, the
   * mutation runs with optimistic locking (#307) — a concurrent edit
   * triggers a toast + force-refetch instead of silent overwrite.
   */
  expectedUpdatedAt?: string | null;
}

function initials(name: string): string {
  return name.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function colorFromName(name: string): string {
  const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hue = hash % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

export const ResponsibleSlot = memo(function ResponsibleSlot({
  leadId,
  field,
  label,
  currentMember,
  expectedUpdatedAt,
}: ResponsibleSlotProps) {
  const members = useResponsibleMembers();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const handleConflict = useOptimisticConflictHandler();
  const { canReassign } = useLeadActionGates(leadId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const denied = !canReassign.allowed;

  const filtered = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = async (memberId: string | null) => {
    const next = memberId === currentMember?.id ? null : memberId;
    const newName = members.find((m) => m.id === next)?.name ?? "Nenhum";
    try {
      await updateLead.mutateAsync({
        id: leadId,
        [field]: next,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      } as Parameters<typeof updateLead.mutateAsync>[0]);
    } catch (err) {
      const handled = handleConflict(err, { leadId });
      if (handled) {
        setOpen(false);
        return;
      }
      toast.error("Falha ao atualizar responsável");
      throw err;
    }
    logAction({
      leadId,
      action: "field_updated",
      description: `${label} alterado para "${newName}"`,
    });
    toast.success(`${label}: ${newName}`);
    setOpen(false);
  };

  const hasMember = !!currentMember;

  return (
    <TooltipProvider delayDuration={300}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={denied}
                aria-label={`${label}${hasMember ? `: ${currentMember.name}` : " — adicionar"}`}
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all",
                  hasMember
                    ? "shadow-sm hover:scale-105"
                    : "border border-dashed border-border/60 hover:border-primary/60 hover:bg-primary/5",
                  denied && "opacity-50 cursor-not-allowed hover:scale-100",
                )}
                style={hasMember ? { backgroundColor: colorFromName(currentMember.name) } : undefined}
              >
                {hasMember ? (
                  currentMember.avatar_url ? (
                    <img src={currentMember.avatar_url} alt={currentMember.name}
                         className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-white">
                      {initials(currentMember.name)}
                    </span>
                  )
                ) : (
                  <Plus className="w-4 h-4 text-muted-foreground/70" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {denied
              ? "Sem permissão — peça acesso ao seu admin"
              : `${label}${hasMember ? `: ${currentMember.name}` : ""}`}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-64 p-2">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1">
              {label}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <Input
                placeholder="Buscar vendedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {hasMember && (
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-destructive hover:bg-destructive/10"
                >
                  <X className="w-3.5 h-3.5" /> Remover {currentMember.name}
                </button>
              )}
              {filtered.length === 0 && (
                <div className="text-xs text-muted-foreground/60 text-center py-3">
                  Nenhum vendedor encontrado
                </div>
              )}
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted",
                    currentMember?.id === m.id && "bg-muted"
                  )}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: colorFromName(m.name) }}
                  >
                    <span className="text-[9px] font-semibold text-white">{initials(m.name)}</span>
                  </div>
                  <span className="truncate">{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
});
