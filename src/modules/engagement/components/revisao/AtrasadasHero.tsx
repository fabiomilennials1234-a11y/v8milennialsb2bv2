import { useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlarmClockOff,
  Archive,
  CalendarClock,
  CalendarPlus,
  Check,
  ExternalLink,
  ListTodo,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FocusCard, FocusTile, InkRow, InkSplit } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { useNomeDoPipe } from "../../hooks/useNomeDoPipe";
import type { RevisionTask } from "./RevisionItem";

const PRIORIDADE: Record<string, string> = { urgent: "Urgente", high: "Alta", normal: "Normal", low: "Baixa" };

export interface AcoesDaRevisao {
  onComplete: (task: RevisionTask, notes?: string) => void;
  onCancel: (task: RevisionTask) => void;
  onArchive: (task: RevisionTask) => void;
  onDelete: (task: RevisionTask) => void;
  onReschedule: (task: RevisionTask, iso: string) => void;
  onOpenLead: (leadId: string) => void;
  onScheduleNew: (task: RevisionTask) => void;
  canDelete: boolean;
}

/**
 * O herói da Revisão: o que já venceu, em tinta, com o item escolhido no
 * cartão de ouro. As ações são as mesmas da linha da lista (`RevisionItem`) —
 * concluir, reagendar, abrir lead/conversa, arquivar, remover — mais "Adiar
 * para amanhã", que é o mesmo reagendar com a data pronta.
 */
export function AtrasadasHero({ tasks, acoes }: { tasks: RevisionTask[]; acoes: AcoesDaRevisao }) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = tasks.find((t) => `${t.type}-${t.id}` === selId) ?? tasks[0];
  if (!sel) return null;

  return (
    <InkSplit
      title="Atrasadas"
      count={`${tasks.length} ${tasks.length === 1 ? "item" : "itens"}`}
      actions={<span className="text-[11.5px] text-tinta-muted">Resolva primeiro o que venceu</span>}
      listClassName="max-h-[420px] overflow-y-auto"
      list={tasks.map((t) => {
        const key = `${t.type}-${t.id}`;
        const selected = key === `${sel.type}-${sel.id}`;
        const Icone = t.type === "scheduled-message" ? MessageSquare : ListTodo;
        return (
          <InkRow key={key} selected={selected} onClick={() => setSelId(key)}>
            <span
              className={cn(
                "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px]",
                selected ? "bg-primary-foreground/10" : "bg-white/10",
              )}
              aria-hidden
            >
              <Icone className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold">{t.title}</span>
              <span
                className={cn("block truncate text-[11.5px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}
              >
                {t.leadCompany || t.leadName} · venceu há {formatDistanceToNowStrict(t.scheduledAt, { locale: ptBR })}
              </span>
            </span>
          </InkRow>
        );
      })}
      detail={<FocoAtrasada key={`${sel.type}-${sel.id}`} task={sel} acoes={acoes} />}
    />
  );
}

const BOTAO_BRANCO = "border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90";
const BOTAO_TRANSLUCIDO = "border-transparent bg-[hsl(40_60%_8%/.1)] text-primary-foreground shadow-none hover:bg-[hsl(40_60%_8%/.16)]";
const ICONE = "h-10 w-10 rounded-full border-primary-foreground/20 bg-transparent text-primary-foreground shadow-none hover:bg-primary-foreground/10";

function FocoAtrasada({ task, acoes }: { task: RevisionTask; acoes: AcoesDaRevisao }) {
  const nomeDoPipe = useNomeDoPipe();
  const [notaAberta, setNotaAberta] = useState(false);
  const [nota, setNota] = useState("");
  const [reagendarAberto, setReagendarAberto] = useState(false);
  const isMessage = task.type === "scheduled-message";
  const hasPhone = !!formatPhoneForWhatsApp(task.leadPhone ?? undefined);

  const adiarParaAmanha = () => {
    // Amanhã, no mesmo horário que estava marcado.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(task.scheduledAt.getHours(), task.scheduledAt.getMinutes(), 0, 0);
    acoes.onReschedule(task, d.toISOString());
  };

  const contexto = [task.leadName, task.leadCompany, task.sourcePipe ? nomeDoPipe(task.sourcePipe) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <FocusCard className="gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="ink" className="gap-1">
          {isMessage ? <MessageSquare className="h-3 w-3" /> : <ListTodo className="h-3 w-3" />}
          {isMessage ? "Mensagem" : "Tarefa"}
        </Badge>
        {task.status === "failed" && <Badge variant="ink">Falhou</Badge>}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-bold tabular-nums">
          <AlarmClockOff className="h-4 w-4" aria-hidden />
          venceu {format(task.scheduledAt, "dd/MM · HH:mm")}
        </span>
      </div>

      <div>
        <p className="text-[1.4rem] font-extrabold leading-tight tracking-[-0.035em]">{task.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-primary-foreground/70">{contexto}</p>
      </div>

      {!isMessage && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <FocusTile>
            <p className="truncate text-[1rem] font-extrabold">{task.assignedToName ?? "—"}</p>
            <p className="text-[11px] font-semibold text-primary-foreground/70">responsável</p>
          </FocusTile>
          <FocusTile>
            <p className="truncate text-[1rem] font-extrabold">{PRIORIDADE[task.priority ?? "normal"] ?? "Normal"}</p>
            <p className="text-[11px] font-semibold text-primary-foreground/70">prioridade</p>
          </FocusTile>
          <FocusTile>
            <p className="truncate text-[1rem] font-extrabold">{task.isAutomated ? "Automática" : "Manual"}</p>
            <p className="text-[11px] font-semibold text-primary-foreground/70">origem</p>
          </FocusTile>
        </div>
      )}

      {(isMessage ? task.messageContent : task.description) && (
        <p className="flex items-start gap-2 rounded-2xl bg-[hsl(40_60%_8%/.1)] px-3 py-2.5 text-[13px] font-semibold leading-relaxed">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="line-clamp-3">{isMessage ? task.messageContent : task.description}</span>
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {isMessage ? (
          <Button type="button" variant="outline" className={BOTAO_TRANSLUCIDO} onClick={() => acoes.onCancel(task)}>
            <X />
            Cancelar envio
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" className={BOTAO_BRANCO} onClick={() => acoes.onComplete(task)}>
              <Check />
              Concluir
            </Button>
            <Button type="button" variant="outline" className={BOTAO_TRANSLUCIDO} onClick={adiarParaAmanha}>
              <CalendarClock />
              Adiar para amanhã
            </Button>
          </>
        )}
        <span className="flex-1" />
        {!isMessage && (
          <Popover open={reagendarAberto} onOpenChange={setReagendarAberto}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="icon" className={ICONE} aria-label="Reagendar">
                <CalendarPlus />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={task.scheduledAt}
                onSelect={(date) => {
                  if (!date) return;
                  acoes.onReschedule(task, date.toISOString());
                  setReagendarAberto(false);
                }}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                initialFocus
                locale={ptBR}
              />
            </PopoverContent>
          </Popover>
        )}
        {task.leadId && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={ICONE}
            aria-label="Ver lead"
            onClick={() => acoes.onOpenLead(task.leadId)}
          >
            <ExternalLink />
          </Button>
        )}
        {hasPhone && (
          <AbrirConversaButton
            leadId={task.leadId}
            phone={task.leadPhone}
            variant="outline"
            size="icon"
            className={ICONE}
            aria-label={`Abrir conversa com ${task.leadName}`}
          >
            <MessageCircle />
          </AbrirConversaButton>
        )}
        {!isMessage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" className={ICONE} aria-label="Mais ações da tarefa">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setNotaAberta(true)}>
                <StickyNote />
                Concluir com nota
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => acoes.onScheduleNew(task)}>
                <CalendarPlus />
                Novo follow-up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => acoes.onArchive(task)}>
                <Archive />
                Arquivar
              </DropdownMenuItem>
              {acoes.canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => acoes.onDelete(task)}>
                    <Trash2 />
                    Remover
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog open={notaAberta} onOpenChange={setNotaAberta}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Concluir com nota</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Notas de conclusão..."
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            className="min-h-[90px] resize-none"
          />
          <DialogFooter>
            <Button
              disabled={!nota.trim()}
              onClick={() => {
                acoes.onComplete(task, nota.trim());
                setNota("");
                setNotaAberta(false);
              }}
            >
              <Check />
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FocusCard>
  );
}
