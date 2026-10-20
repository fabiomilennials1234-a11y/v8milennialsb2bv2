import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronDown, ChevronUp } from "lucide-react";
import { useMeetings } from "@/modules/engagement";
import {
  resumirAgendaDoLead,
  type SituacaoNaAgenda,
} from "@/modules/communication/lib/agenda-do-lead";

interface LeadAgendaStripProps {
  /** Obrigatório: `useMeetings` sem `leadId` traria as reuniões da org inteira. */
  leadId: string;
}

const ROTULO: Record<SituacaoNaAgenda, string> = {
  atrasada: "Em atraso",
  hoje: "Hoje",
  proxima: "Agendada",
};

/**
 * Par de escala `x dark:y`, e não `text-destructive`: o token é de
 * preenchimento e não passa de 3:1 como texto no tema claro (medição em
 * `AgendaOutcomeToggle`).
 */
const COR_DO_ROTULO: Record<SituacaoNaAgenda, string> = {
  atrasada: "text-red-800 dark:text-red-200",
  hoje: "text-foreground",
  proxima: "text-muted-foreground",
};

/**
 * Agenda simplificada do lead, logo acima do composer: quem está conversando vê
 * a reunião marcada (ou a que ficou em atraso) sem sair do chat. Mesma forma do
 * banner de mensagens agendadas ao lado.
 */
export function LeadAgendaStrip({ leadId }: LeadAgendaStripProps) {
  const { data: reunioes = [] } = useMeetings({ leadId });
  const [expanded, setExpanded] = useState(false);

  const agenda = useMemo(() => resumirAgendaDoLead(reunioes), [reunioes]);

  if (agenda.itens.length === 0) return null;

  const { itens, atrasadas, proxima } = agenda;
  const resumo = [
    proxima ? `Próxima: ${format(proxima.start, "EEE dd/MM HH:mm", { locale: ptBR })}` : null,
    atrasadas > 0 ? `${atrasadas} em atraso` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-4 mb-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted"
      >
        <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{resumo}</span>
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <ul className="mt-1 space-y-1">
          {itens.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
            >
              <span className="flex-1 truncate text-foreground">{item.title}</span>
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                {format(item.start, "dd/MM HH:mm", { locale: ptBR })}
              </span>
              <span
                className={`whitespace-nowrap font-semibold ${COR_DO_ROTULO[item.situacao]}`}
              >
                {item.situacao === "atrasada" && item.faltou ? "Não compareceu" : ROTULO[item.situacao]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
