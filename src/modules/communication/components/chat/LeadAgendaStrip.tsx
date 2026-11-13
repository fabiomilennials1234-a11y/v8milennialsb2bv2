import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronDown, ChevronUp, Pencil, X } from "lucide-react";
import { EditMeetingDialog, useMeetings, useUpdateMeeting } from "@/modules/engagement";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
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
  // Trocar de conversa fecha qualquer edição/confirmação do lead anterior.
  return <LeadAgendaContent key={leadId} leadId={leadId} />;
}

function LeadAgendaContent({ leadId }: LeadAgendaStripProps) {
  const { data: reunioes = [] } = useMeetings({ leadId });
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const updateMeeting = useUpdateMeeting();

  const agenda = useMemo(() => resumirAgendaDoLead(reunioes), [reunioes]);

  const cancelling = agenda.itens.find((item) => item.id === cancellingId);
  const editing = agenda.itens.find((item) => item.id === editingId);

  if (agenda.itens.length === 0) return null;

  const { itens, atrasadas, proxima } = agenda;
  const resumo = [
    proxima ? `Próxima: ${format(proxima.start, "EEE dd/MM HH:mm", { locale: ptBR })}` : null,
    atrasadas > 0 ? `${atrasadas} em atraso` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-3 my-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-sm transition-colors hover:bg-muted"
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
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-1.5 text-xs shadow-relevo"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                {format(item.start, "dd/MM HH:mm", { locale: ptBR })}
              </span>
              <span
                className={`whitespace-nowrap font-semibold ${COR_DO_ROTULO[item.situacao]}`}
              >
                {item.situacao === "atrasada" && item.faltou ? "Não compareceu" : ROTULO[item.situacao]}
              </span>
              <div className="flex w-full flex-wrap gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={updateMeeting.isPending}
                  aria-label={`Editar reunião ${item.title}`} onClick={() => setEditingId(item.id)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />Editar
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={updateMeeting.isPending}
                  aria-label={`Cancelar reunião ${item.title}`} onClick={() => setCancellingId(item.id)}>
                  <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />Cancelar reunião
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <EditMeetingDialog meetingId={editing.id} open onOpenChange={(open) => {
        if (!open) setEditingId(null);
      }} />}
      <AlertDialog open={!!cancelling} onOpenChange={(open) => {
        if (!open && !updateMeeting.isPending) setCancellingId(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar reunião?</AlertDialogTitle>
            <AlertDialogDescription>
              A reunião “{cancelling?.title}” deixará de aparecer entre os agendamentos pendentes.
              O registro será preservado como cancelado na Agenda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateMeeting.isPending}>Manter reunião</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={updateMeeting.isPending || !cancelling}
              onClick={() => {
                if (!cancelling || updateMeeting.isPending) return;
                updateMeeting.mutate({ id: cancelling.id, status: "cancelled" }, {
                  onSuccess: () => setCancellingId(null),
                });
              }}>
              {updateMeeting.isPending ? "Cancelando…" : "Confirmar cancelamento"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
