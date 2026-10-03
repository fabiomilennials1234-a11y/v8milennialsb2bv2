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

/* `initials` saiu junto com o `MiniResponsible` que a usava — a pílula mostra
   o nome curto, não a inicial. Quem precisa de inicial hoje é o card compacto,
   que tem a sua própria. */

function colorFromName(name?: string | null): string {
  if (!name) return "hsl(0, 0%, 40%)";
  const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${hash % 360}, 60%, 45%)`;
}

/** Primeiro nome + sobrenome abreviado, para caber na largura da coluna. */
function nomeCurto(nome?: string | null): string {
  if (!nome) return "";
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes[0]} ${partes[partes.length - 1][0].toUpperCase()}.`;
}

function NomeResponsavel({ member, label }: { member: ResponsibleMini | null | undefined; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex min-w-0 items-center gap-1",
            member ? "text-foreground/80" : "text-muted-foreground/50",
          )}
        >
          <i
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: member ? colorFromName(member.name) : "hsl(var(--muted-foreground) / 0.4)" }}
            aria-hidden
          />
          <span className="truncate">{member ? nomeCurto(member.name) : "—"}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10px]">
        {label}{member?.name ? `: ${member.name}` : ": —"}
      </TooltipContent>
    </Tooltip>
  );
}

/* `MiniResponsible` (bolinha de 20px com a inicial) vivia aqui e foi removido:
   o commit do card DataCrazy o substituiu pela pílula com NOME logo acima, e
   ele ficou órfão — sem chamador, mas ainda compilando. O ratchet de tipos o
   acusou como erro INTRODUZIDO por esta branch, e estava certo. */

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
  // Basta ter lead. Antes exigia `checklistsTotal > 0`, e isso criava um ponto
  // cego real: lead SEM checklist não tinha por onde abrir o painel — logo não
  // tinha por onde APLICAR um. Pior, checklist criado com zero itens conta 0/0,
  // então ele existia no banco e era invisível na tela.
  const checklistInteractive = !!leadId;

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

        {/* Responsáveis — os DOIS nomes, escritos.
            Eram dois avatares de 20px empilhados, com o nome só no tooltip: em
            um board com 30 cards ninguém passa o mouse, então na prática o card
            não dizia de quem era o lead. O dado (`name`) já chegava aqui.
            Quem estiver vazio vira um traço discreto, sem ocupar espaço. */}
        <div className="flex min-w-0 items-center gap-1 ml-auto">
          <NomeResponsavel member={preSaleResponsible ?? null} label="Pré-Venda" />
          <span className="text-muted-foreground/40" aria-hidden>·</span>
          <NomeResponsavel member={saleResponsible ?? null} label="Venda" />
        </div>
      </div>
    </TooltipProvider>
  );
});
