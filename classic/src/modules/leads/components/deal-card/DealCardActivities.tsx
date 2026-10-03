import { Bot, CalendarClock, Check, Mail, MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealCardActivity } from "./types";

/**
 * Atividades do lead — a aba de mesmo nome no print.
 *
 * ── POR QUE ELA VALE UMA ABA E A MOVIMENTAÇÃO NÃO BASTA ───────────────────
 * `pipeline_stage_events` responde "por onde o negócio andou". `activities`
 * responde "o que foi FEITO com a pessoa" — ligação, reunião, e-mail, nota —
 * e é a única das duas que tem `due_date`: atividade é a coisa que ainda está
 * marcada para acontecer. Uma diz o passado do card, a outra diz a agenda dele.
 *
 * A linha inteira é passiva de propósito. Concluir, remarcar e criar atividade
 * moram na agenda e nos checklists, que já têm as regras de dono, prazo e
 * gamificação penduradas. Um segundo lugar de escrita aqui seria um segundo
 * conjunto dessas regras.
 *
 * ── O QUE ENTROU EM 25/08 ─────────────────────────────────────────────────
 * Follow-up e ação do dia passaram a ser DO NEGÓCIO (decisão do CTO, mesma
 * regra do checklist). Eles chegam aqui na mesma lista, com `tipo: "task"`,
 * porque as duas coisas respondem à mesma pergunta do vendedor: o que já foi
 * feito e o que ainda falta neste negócio.
 *
 * Importa registrar por que a aba precisava disso: `activities` tem **0 linhas
 * em produção**. A aba abria vazia para todo mundo, todos os dias, desde que
 * nasceu — uma aba que nunca mostra nada ensina a não clicar em aba nenhuma.
 */

/** `activities.type` é texto livre no banco — o mapa cobre o que a org usa. */
const ICONE: Record<string, typeof Phone> = {
  // `task` é o follow-up / ação do dia do NEGÓCIO — a única linha desta aba que
  // ainda vai acontecer, e não um registro do que já aconteceu.
  task: Check,
  call: Phone,
  ligacao: Phone,
  meeting: Users,
  reuniao: Users,
  email: Mail,
  whatsapp: MessageCircle,
  message: MessageCircle,
  note: StickyNote,
  nota: StickyNote,
  tarefa: Check,
};

function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DealCardActivities({ atividades }: { atividades: DealCardActivity[] }) {
  if (atividades.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-8 text-center text-[12.5px] text-muted-foreground">
        Nenhuma tarefa ou atividade neste negócio.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1">
      {atividades.map((a) => {
        const Icone = ICONE[a.tipo.toLowerCase()] ?? CalendarClock;
        return (
          <li
            key={a.id}
            className="flex gap-3 rounded-lg px-2 py-2 -mx-2 transition-colors hover:bg-muted/40"
          >
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1",
                a.concluida
                  ? "bg-success/10 text-success ring-success/25"
                  : "bg-muted text-muted-foreground ring-border",
              )}
              aria-hidden="true"
            >
              <Icone className="size-3.5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-[13px] font-medium">{a.titulo}</span>
                {/* Pendente é o estado que pede ação — por isso ele é que ganha
                    tinta, e não o concluído. */}
                {!a.concluida && (
                  <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10.5px] font-semibold text-amber-400">
                    pendente
                  </span>
                )}
                {a.automatica && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground/70"
                    title="Registrada por automação"
                  >
                    <Bot className="size-3" />
                    automação
                  </span>
                )}
              </div>

              {a.descricao && (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                  {a.descricao}
                </p>
              )}

              <div className="mt-0.5 text-[11.5px] text-muted-foreground/75">
                {quando(a.quando)}
                {a.resultado && ` · ${a.resultado}`}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
