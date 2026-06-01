import { memo } from "react";
import { MessageSquare, CheckSquare } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LeadCardChecklistPopover } from "./LeadCardChecklistPopover";

/**
 * Métricas inline do LeadCard — comments, checklists,
 * mini avatares dos responsáveis (Pré-Venda + Venda).
 *
 * Estilo Trello: ícone + número compacto. Faded quando zero.
 *
 * Anexos: ícone omitido enquanto não existe a feature (sem tabela
 * `lead_attachments`) — não exibir contagem falsa.
 */

interface ResponsibleMini {
  name: string | null;
  avatar_url?: string | null;
}

interface LeadCardMetricsProps {
  /** UUID do lead (lead.leadId). Habilita o popover clicável de checklists. */
  leadId?: string;
  commentsCount?: number;
  checklistsCompleted?: number;
  checklistsTotal?: number;
  preSaleResponsible?: ResponsibleMini | null;
  saleResponsible?: ResponsibleMini | null;
  className?: string;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function colorFromName(name?: string | null): string {
  if (!name) return "hsl(0, 0%, 40%)";
  const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${hash % 360}, 60%, 45%)`;
}

function MiniResponsible({ member, label }: { member: ResponsibleMini | null | undefined; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "w-5 h-5 rounded-full flex items-center justify-center border border-card",
            !member && "bg-muted/40",
          )}
          style={member ? { backgroundColor: colorFromName(member.name) } : undefined}
        >
          {member ? (
            member.avatar_url ? (
              <img src={member.avatar_url} alt={member.name ?? ""} className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="text-[8px] font-semibold text-white">{initials(member.name)}</span>
            )
          ) : (
            <span className="text-[10px] text-muted-foreground/40">·</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10px]">
        {label}{member?.name ? `: ${member.name}` : ": —"}
      </TooltipContent>
    </Tooltip>
  );
}

export const LeadCardMetrics = memo(function LeadCardMetrics({
  leadId,
  commentsCount = 0,
  checklistsCompleted = 0,
  checklistsTotal = 0,
  preSaleResponsible,
  saleResponsible,
  className,
}: LeadCardMetricsProps) {
  const checklistDone = checklistsTotal > 0 && checklistsCompleted === checklistsTotal;
  const hasComments = commentsCount > 0;
  const hasChecklists = checklistsTotal > 0;
  // Badge vira popover clicável só quando há lead + checklists. Senão, chip passivo.
  const checklistInteractive = !!leadId && hasChecklists;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("flex items-center gap-2.5 text-[11px]", className)}>
        {/* Comments */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("flex items-center gap-1", hasComments ? "text-foreground/70" : "text-muted-foreground/40")}>
              <MessageSquare className="w-3 h-3" />
              <span>{commentsCount}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[10px]">
            {commentsCount === 0 ? "Sem comentários" : `${commentsCount} comentário${commentsCount > 1 ? "s" : ""}`}
          </TooltipContent>
        </Tooltip>

        {/* Checklists — popover clicável quando há lead + checklists; senão chip passivo */}
        {checklistInteractive ? (
          <LeadCardChecklistPopover
            leadId={leadId}
            completed={checklistsCompleted}
            total={checklistsTotal}
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "flex items-center gap-1 px-1 py-px rounded",
                  checklistDone
                    ? "bg-emerald-500/15 text-emerald-400"
                    : hasChecklists
                    ? "text-foreground/70"
                    : "text-muted-foreground/40",
                )}
              >
                <CheckSquare className="w-3 h-3" />
                <span>{checklistsCompleted}/{checklistsTotal}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              {checklistsTotal === 0
                ? "Sem checklists"
                : checklistDone
                ? "Checklist completo"
                : `${checklistsCompleted} de ${checklistsTotal} itens`}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Responsibles — empilhados levemente */}
        <div className="flex items-center -space-x-1.5 ml-auto">
          <MiniResponsible member={preSaleResponsible ?? null} label="Pré-Venda" />
          <MiniResponsible member={saleResponsible ?? null} label="Venda" />
        </div>
      </div>
    </TooltipProvider>
  );
});
