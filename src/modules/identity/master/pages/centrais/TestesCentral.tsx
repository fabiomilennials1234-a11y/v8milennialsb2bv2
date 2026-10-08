/**
 * Testes — o laboratório dos copilots (regras TE-1…TE-6). Absorve Qualidade
 * do Oráculo, Raciocínio do Copilot e Liga/desliga IA, que viram abas.
 *
 * Esta aba é a nota do avaliador automático (TE-5): `evaluate-agent-conversation`
 * já avalia cada resposta dos copilots e grava — nenhuma tela mostrava. É o
 * ponto de partida do teste em massa: os piores turnos são os candidatos a
 * caso de teste (TE-1), e a nota é a régua que vai travar o prompt que piora
 * (TE-4) quando o golden set existir.
 */

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { Bot, Gauge, Loader2, TrendingDown, Users } from "lucide-react";
import { DeltaChip, FocusCard, FocusTile, InkRow, InkSplit, KpiRow, KpiTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { MasterPageHeader } from "../../components/MasterPageHeader";
import { useCopilotEvalSummary, useWorstTurns } from "../../hooks/useCopilotEvaluations";

const JANELAS = [7, 30, 90] as const;

type Summary = NonNullable<ReturnType<typeof useCopilotEvalSummary>["data"]>[number];

const nota = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const tone = (v: number | null | undefined) =>
  v == null ? "" : v >= 8 ? "text-success-strong" : v >= 6 ? "text-warning-strong" : "text-destructive";

export default function TestesCentral() {
  const [dias, setDias] = useState<(typeof JANELAS)[number]>(30);
  const { data: agentes = [], isLoading, error } = useCopilotEvalSummary(dias);
  const [selId, setSelId] = useState<string | null>(null);
  const selected = agentes.find((a) => a.agent_id === selId) ?? agentes[0] ?? null;

  const total = agentes.reduce((acc, a) => acc + a.evaluations, 0);
  const abaixo6 = agentes.reduce((acc, a) => acc + a.below_6, 0);
  const media = total
    ? agentes.reduce((acc, a) => acc + Number(a.avg_overall ?? 0) * a.evaluations, 0) / total
    : null;
  const piorando = agentes.filter(
    (a) => a.previous_avg_overall != null && a.avg_overall != null && a.avg_overall < a.previous_avg_overall - 0.5,
  );

  return (
    <div className="space-y-5">
      <MasterPageHeader
        title="Testes"
        subtitle="A nota que o avaliador automático já dá a cada resposta dos copilots. Os piores turnos são os próximos casos de teste."
        actions={
          <nav aria-label="Janela" className="inline-flex items-center gap-0.5 rounded-full bg-muted p-[3px]">
            {JANELAS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={dias === d}
                onClick={() => setDias(d)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
                  dias === d ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d} dias
              </button>
            ))}
          </nav>
        }
      />

      <KpiRow cols={4}>
        <KpiTile label="Nota média" value={nota(media)} icon={Gauge} tone="gold" loading={isLoading} note="ponderada por resposta, 0 a 10" />
        <KpiTile label="Respostas avaliadas" value={total.toLocaleString("pt-BR")} icon={Users} tone="info" loading={isLoading} note={`${agentes.length} copilots`} />
        <KpiTile
          label="Abaixo de 6"
          value={total ? `${Math.round((abaixo6 / total) * 100)}%` : "—"}
          icon={TrendingDown}
          tone={abaixo6 > 0 ? "warn" : "good"}
          loading={isLoading}
          note={`${abaixo6.toLocaleString("pt-BR")} respostas`}
        />
        <KpiTile
          label="Copilots piorando"
          value={piorando.length}
          icon={Bot}
          tone={piorando.length > 0 ? "bad" : "good"}
          loading={isLoading}
          note="caíram mais de 0,5 ponto"
        />
      </KpiRow>

      {error ? (
        <p role="alert" className="rounded-card border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Não deu para carregar as avaliações. A migration 20271105000300 já foi aplicada neste ambiente?
        </p>
      ) : isLoading ? (
        <div className="grid place-items-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando avaliações" />
        </div>
      ) : agentes.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card p-10 text-center text-sm text-muted-foreground shadow-relevo">
          Nenhuma resposta avaliada nos últimos {dias} dias.
        </p>
      ) : (
        <InkSplit
          title="Copilots, da pior nota para a melhor"
          count={agentes.length}
          listClassName="max-h-[680px] overflow-y-auto pr-1"
          list={agentes.map((a) => (
            <InkRow key={a.agent_id} selected={selected?.agent_id === a.agent_id} onClick={() => setSelId(a.agent_id)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{a.agent_name ?? "Copilot removido"}</span>
                <span className="block truncate text-[11px] opacity-70">
                  {a.org_name ?? "—"} · {a.evaluations} respostas
                </span>
              </span>
              <span className="shrink-0 text-base font-extrabold tabular-nums">{nota(a.avg_overall)}</span>
            </InkRow>
          ))}
          detail={selected ? <AgentFocus agent={selected} dias={dias} /> : null}
        />
      )}
    </div>
  );
}

function AgentFocus({ agent: a, dias }: { agent: Summary; dias: number }) {
  const { data: piores = [], isLoading } = useWorstTurns(a.agent_id, dias);
  const delta =
    a.avg_overall != null && a.previous_avg_overall != null ? Number(a.avg_overall) - Number(a.previous_avg_overall) : null;

  return (
    <div className="space-y-3">
      <FocusCard>
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="min-w-0 flex-1 text-2xl font-extrabold leading-tight tracking-tight">{a.agent_name ?? "Copilot removido"}</h3>
          <span className="text-4xl font-extrabold tabular-nums tracking-[-0.04em]">{nota(a.avg_overall)}</span>
        </div>
        <p className="-mt-2 text-sm opacity-80">
          {a.org_name} · última avaliação {formatDistanceToNow(new Date(a.last_evaluated_at), { addSuffix: true, locale: ptBR })}
          {delta != null && (
            <>
              {" · "}
              <DeltaChip
                value={delta}
                format={(v) => Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                label={`vs ${dias} dias antes`}
                className="text-primary-foreground [&_span]:text-primary-foreground/70"
              />
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["Relevância", a.avg_relevance],
              ["Tom", a.avg_tone],
              ["Objetivo", a.avg_goal_align],
              ["Concisão", a.avg_conciseness],
            ] as const
          ).map(([label, v]) => (
            <FocusTile key={label}>
              <p className="text-[11px] font-semibold opacity-70">{label}</p>
              <p className="text-xl font-extrabold tabular-nums">{nota(v)}</p>
            </FocusTile>
          ))}
        </div>
      </FocusCard>

      <section className="space-y-2 rounded-card border border-card-border bg-card p-4 text-card-foreground shadow-relevo">
        <h4 className="text-sm font-bold">Piores respostas — candidatas a caso de teste</h4>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando" />
        ) : (
          <ul className="space-y-3">
            {piores.map((t) => (
              <li key={t.id} className="space-y-1.5 border-t border-border/60 pt-3 first:border-0 first:pt-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className={cn("font-extrabold tabular-nums", tone(t.score_overall))}>{nota(t.score_overall)}</span>
                  <span className="text-muted-foreground">
                    {t.evaluated_at && formatDistanceToNow(new Date(t.evaluated_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm">
                  <span className="font-semibold">Cliente:</span> {t.user_message}
                </p>
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Copilot:</span> {t.agent_response}
                </p>
                {t.weaknesses && <p className="text-xs text-destructive">{t.weaknesses}</p>}
                {t.suggestion && <p className="text-xs text-muted-foreground">Sugestão: {t.suggestion}</p>}
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/master/copilot-reasoning"
          className="inline-block pt-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Ver o raciocínio dos turnos
        </Link>
      </section>
    </div>
  );
}
