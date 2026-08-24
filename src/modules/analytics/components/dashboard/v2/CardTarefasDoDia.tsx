import { useMemo, useState, type FormEvent } from "react";
import { Check, Circle, CheckCircle2, ListChecks, Plus, X } from "lucide-react";
import {
  useAcoesDoDia,
  useCreateAcaoDoDia,
  useCompleteAcaoDoDia,
  useUncompleteAcaoDoDia,
  useDeleteAcaoDoDia,
} from "@/modules/engagement";
import { useOrganization, useTeamMembers } from "@/modules/identity";
import { classificarTarefas } from "@/modules/analytics/lib/tarefas-do-dia";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { cn } from "@/lib/utils";
import { ComandoCard } from "./ComandoCard";
import { DonoDaLinha } from "./DonoDaLinha";

/**
 * Bloco 3 — o que EU preciso fazer hoje.
 *
 * Reusa `acoes_do_dia` inteiro (tabela + 5 hooks de CRUD). Não nasceu sistema
 * paralelo de tarefa: essa é a única tabela do produto que é por USUÁRIO e de
 * texto livre — `checklists` é template por org preso a lead, e `follow_ups`
 * exige `lead_id` NOT NULL.
 *
 * ⚠️ ATRASADA SEM COLUNA DE PRAZO. `acoes_do_dia` não tem `due_date`; o prazo é
 * o próprio dia, que é o que o nome da tabela diz. Então atrasada = não
 * concluída E criada antes do começo de hoje. O corte usa o fuso da ORG
 * (`zonedDayStart`), não o do browser: um vendedor em Lisboa e outro em Manaus
 * têm de ver a MESMA lista de atrasadas da mesma org.
 *
 * A regra "não concluída + prazo no passado" é a de `RevisionItem.tsx`, que está
 * em produção — e não a de `FollowUpCard.tsx`, que diverge e não tem nenhum
 * importador.
 */

export function CardTarefasDoDia() {
  const { timezone } = useOrganization();
  const { isAdmin, meuUserId } = useComandoScope();
  // Admin pede a lista do time; todo o resto pede a própria. Quem GARANTE isso
  // é o RLS (`20270825000030`): pedir "tudo" sem ser admin devolve só as suas.
  const { data, isLoading, isError, refetch } = useAcoesDoDia(
    isAdmin ? "tudo" : "meu",
  );
  const criar = useCreateAcaoDoDia();
  const concluir = useCompleteAcaoDoDia();
  const desfazer = useUncompleteAcaoDoDia();
  const remover = useDeleteAcaoDoDia();

  const [texto, setTexto] = useState("");
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);

  const { pendentes, concluidasHoje, atrasadasCount } = useMemo(
    () => classificarTarefas(data, timezone),
    [data, timezone],
  );

  // `acoes_do_dia.user_id` é `auth.users.id` — a única coluna de pessoa da
  // tabela, e ela NÃO aponta para `team_members`. Não há FK, então o PostgREST
  // não consegue fazer embed do nome; a ponte é `team_members.user_id`, e é
  // resolvida aqui. (Um embed novo também reabriria o `PGRST201` que deixou
  // este hook 100% quebrado até 21/08 — melhor não tentar.)
  const { data: membros } = useTeamMembers();
  const nomePorUserId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const m of membros ?? []) {
      if (m.user_id && m.name) mapa.set(m.user_id, m.name);
    }
    return mapa;
  }, [membros]);

  /**
   * 🔴 Ver ≠ mexer.
   *
   * A migration `20270825000030` deu ao admin só a policy de SELECT: as de
   * UPDATE e DELETE continuam `auth.uid() = user_id`. Isso é de propósito — o
   * pedido é de VISIBILIDADE ("visão geral da produtividade e das pendências"),
   * e dar ao admin o poder de concluir a tarefa alheia seria escalada que
   * ninguém pediu.
   *
   * Mas isso obriga a UI a acompanhar: sem esta checagem, o admin clicaria em
   * "concluir" numa tarefa de outro, o RLS recusaria a linha em SILÊNCIO
   * (0 linhas afetadas, sem erro) e o hook ainda assim toastaria "Tarefa
   * concluída!". O botão precisa não existir, e não apenas não funcionar.
   */
  const souDono = (userId: string) => !!meuUserId && userId === meuUserId;

  const adicionar = (e: FormEvent) => {
    e.preventDefault();
    const titulo = texto.trim();
    if (!titulo || criar.isPending) return;
    // Otimismo controlado: limpa o campo já, porque o hook toasta o erro e a
    // lista se reconcilia sozinha na invalidação.
    setTexto("");
    criar.mutate({ title: titulo });
  };

  return (
    <ComandoCard
      icon={ListChecks}
      title="Tarefas do dia"
      count={pendentes.length}
      tone={atrasadasCount > 0 ? "urgent" : "default"}
      scopeHint={isAdmin ? "Equipe" : undefined}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      /* Nunca "vazio": o campo de adicionar É o estado vazio útil. */
      isEmpty={false}
      footer={
        concluidasHoje.length > 0 ? (
          <button
            type="button"
            onClick={() => setMostrarConcluidas((v) => !v)}
            className="text-[11px] font-semibold text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            {mostrarConcluidas ? "Esconder" : "Ver"}{" "}
            <span className="tabular-nums">{concluidasHoje.length}</span>{" "}
            {concluidasHoje.length === 1 ? "concluída hoje" : "concluídas hoje"}
          </button>
        ) : null
      }
    >
      <form onSubmit={adicionar} className="flex items-center gap-2 px-4 py-2.5">
        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ligar para o João…"
          aria-label="Nova tarefa do dia"
          disabled={criar.isPending}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40 disabled:opacity-50"
        />
        {texto.trim() && (
          <button
            type="submit"
            disabled={criar.isPending}
            className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {criar.isPending ? "…" : "Add"}
          </button>
        )}
      </form>

      {pendentes.length === 0 && concluidasHoje.length === 0 && (
        <p className="px-4 pb-3 text-[11px] text-muted-foreground/60">
          {isAdmin
            ? "Ninguém do time tem tarefa aberta. Escreva acima para criar a sua."
            : "Nenhuma tarefa. Escreva acima e aperte Enter."}
        </p>
      )}

      <ul className="divide-y divide-border/50">
        {pendentes.map(({ tarefa, atrasada }) => (
          <li
            key={tarefa.id}
            className="group flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-muted/40"
          >
            {souDono(tarefa.user_id) ? (
              <button
                type="button"
                onClick={() => concluir.mutate(tarefa.id)}
                disabled={concluir.isPending}
                aria-label={`Concluir ${tarefa.title}`}
                className="shrink-0 text-muted-foreground/40 transition-colors hover:text-primary disabled:opacity-50"
              >
                <Circle className="h-4 w-4" />
              </button>
            ) : (
              // Tarefa de outra pessoa: o admin acompanha, não executa.
              <Circle
                className="h-4 w-4 shrink-0 text-muted-foreground/20"
                aria-hidden
              />
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{tarefa.title}</span>
              {tarefa.description && (
                <span className="block truncate text-[11px] text-muted-foreground/60">
                  {tarefa.description}
                </span>
              )}
              {/* Só o admin: a lista do vendedor é inteira dele. */}
              {isAdmin && (
                <DonoDaLinha
                  nome={nomePorUserId.get(tarefa.user_id)}
                  className="mt-0.5"
                  semDonoLabel="Fora do time"
                />
              )}
            </span>

            {atrasada && (
              <span className="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] text-destructive">
                Atrasada
              </span>
            )}

            {souDono(tarefa.user_id) && (
              <button
                type="button"
                onClick={() => remover.mutate(tarefa.id)}
                aria-label={`Remover ${tarefa.title}`}
                className="shrink-0 text-muted-foreground/30 opacity-0 transition-all hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}

        {mostrarConcluidas &&
          concluidasHoje.map((tarefa) => (
            <li
              key={tarefa.id}
              className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-muted/40"
            >
              {souDono(tarefa.user_id) ? (
                <button
                  type="button"
                  onClick={() => desfazer.mutate(tarefa.id)}
                  disabled={desfazer.isPending}
                  aria-label={`Reabrir ${tarefa.title}`}
                  className="shrink-0 text-primary/70 transition-colors hover:text-primary disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              ) : (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-primary/25"
                  aria-hidden
                />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-[13px] text-muted-foreground/50",
                    "line-through",
                  )}
                >
                  {tarefa.title}
                </span>
                {isAdmin && (
                  <DonoDaLinha
                    nome={nomePorUserId.get(tarefa.user_id)}
                    semDonoLabel="Fora do time"
                  />
                )}
              </span>
              <Check className="h-3 w-3 shrink-0 text-muted-foreground/30" />
            </li>
          ))}
      </ul>
    </ComandoCard>
  );
}
