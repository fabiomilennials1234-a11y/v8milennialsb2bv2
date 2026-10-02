import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Target } from "lucide-react";
import {
  useCreateGoal,
  useIndividualGoals,
  useTeamGoals,
} from "@/modules/engagement";
import { useCurrentTeamMember, useFeaturePermission } from "@/modules/identity";
import { useDashboardMetrics } from "@/modules/analytics/hooks/useDashboardMetrics";
import { useComandoScope } from "@/modules/analytics/hooks/useComandoScope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ComandoCard } from "./ComandoCard";
import { RealVsExpectedChart } from "./RealVsExpectedChart";

/**
 * Metas do mês — da equipe e de cada vendedor.
 *
 * Reusa `useIndividualGoals` inteiro. É importante saber DE ONDE vem o número,
 * porque há duas fontes possíveis e elas discordam:
 *
 * - `goals.current_value` é uma coluna GRAVADA, e `syncTeamFaturamentoGoal` só
 *   atualiza `target_value` — ou seja, o `current_value` da meta de equipe pode
 *   estar velho. NÃO é usado aqui.
 * - `useIndividualGoals` RECALCULA o atingido lendo `pipe_propostas`
 *   (status vendido) e `pipe_confirmacao` (status compareceu) dentro do mês.
 *   É esse que usamos, e o total da equipe é a soma dos vendedores — assim a
 *   linha da equipe nunca discorda da soma que está logo abaixo dela.
 *
 * ⚠️ Crédito de reunião é exclusivo do SDR (`pre_sale_responsible_id ?? sdr_id`).
 * O hook já trata isso; não replicar a regra aqui.
 *
 * 🔒 QUEM VÊ A META DE QUEM. A rota `/performance` — a única tela que mostrava
 * meta por pessoa até aqui — é guardada por `PermissionProtectedRoute
 * featureKey="performance.view"`. Trazer a mesma lista para o `/dashboard`, que
 * é aberto, seria abrir uma segunda porta sem fechadura para o mesmo dado.
 * Então o gate vem junto, com a MESMA chave que o Estúdio de Métricas usa para
 * "ver por pessoa": sem `performance.view`, o vendedor vê só a PRÓPRIA meta —
 * nem a lista da equipe, nem o total dela (que denuncia a soma).
 */

type MetricaMeta = "sales" | "meetings";

interface LinhaMeta {
  id: string;
  name: string;
  current: number;
  goal: number;
  percentage: number;
}

function pct(current: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.round((current / goal) * 100);
}

function formatarValor(valor: number, metrica: MetricaMeta): string {
  return metrica === "sales" ? formatBRL(valor) : String(valor);
}

export function CardMetas() {
  const { data, isLoading, isError, refetch } = useIndividualGoals();
  const { data: teamMember } = useCurrentTeamMember();
  const { allowed: podeVerEquipe } = useFeaturePermission("performance.view");
  const { isAdmin } = useComandoScope();
  const meuId = teamMember?.id ?? null;

  const grupos = useMemo(() => {
    const montar = (linhas: LinhaMeta[] | undefined, metrica: MetricaMeta) => {
      // Sem permissão de ver por pessoa, o recorte é só o próprio vendedor —
      // e como o total da equipe é a soma DESTA lista, ele também encolhe
      // sozinho para a própria meta, em vez de denunciar o resto.
      const todas = (linhas ?? []).filter(
        (l) => podeVerEquipe || (meuId != null && l.id === meuId),
      );
      // Vendedor sem meta definida vira ruído: uma fileira de 0% que não diz
      // nada. Sai da lista e vira contagem no rodapé, que é acionável.
      const comMeta = todas
        .filter((l) => l.goal > 0)
        .sort((a, b) => b.percentage - a.percentage);
      const alvo = comMeta.reduce((s, l) => s + l.goal, 0);
      const feito = comMeta.reduce((s, l) => s + l.current, 0);
      return {
        metrica,
        linhas: comMeta,
        semMeta: todas.length - comMeta.length,
        alvo,
        feito,
        percentual: pct(feito, alvo),
      };
    };

    return [
      montar(data?.salesGoals as LinhaMeta[] | undefined, "sales"),
      montar(data?.meetingsGoals as LinhaMeta[] | undefined, "meetings"),
    ].filter((g) => g.linhas.length > 0);
  }, [data, podeVerEquipe, meuId]);

  // Só conta o que o usuário PODE ver: para quem não tem `performance.view`,
  // "3 vendedores sem meta" já seria informação da equipe.
  const semMetaTotal = useMemo(
    () => grupos.reduce((soma, g) => soma + g.semMeta, 0),
    [grupos],
  );

  // Alguém já tem meta individual de vendas? Muda o que a org pode prometer:
  // `syncTeamFaturamentoGoal` RECALCULA a meta de faturamento como a soma
  // dessas, então um valor digitado à mão aqui seria substituído no próximo
  // salvamento de meta individual. A UI avisa em vez de deixar sumir.
  const temMetasIndividuaisDeVendas = useMemo(
    () =>
      ((data?.salesGoals ?? []) as LinhaMeta[]).some((l) => (l.goal ?? 0) > 0),
    [data],
  );

  const vendas = grupos.find((g) => g.metrica === "sales");
  const top3 = (vendas?.linhas ?? []).slice(0, 3);

  return (
    <ComandoCard
      icon={Target}
      title="Metas do mês"
      /* Sem `performance.view` a rota devolve tela de bloqueio — não oferecer
         a porta é melhor que oferecer e barrar. */
      action={podeVerEquipe ? { label: "Gerir metas", to: "/performance" } : undefined}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      /* Quem enxerga a equipe nunca mais cai no estado vazio: a faixa da meta
         da organização ocupa o lugar dele, e é ela que oferece o campo para
         definir a meta sem sair da tela. */
      isEmpty={grupos.length === 0 && !podeVerEquipe}
      emptyTitle={
        podeVerEquipe ? "Nenhuma meta definida" : "Você não tem meta este mês"
      }
      emptyHint={
        podeVerEquipe
          ? "Ninguém tem meta para este mês. Defina em Performance › Gestão e o acompanhamento aparece aqui sozinho."
          : "Assim que a sua meta do mês for definida, o acompanhamento aparece aqui."
      }
      footer={
        semMetaTotal > 0 || podeVerEquipe ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {semMetaTotal > 0 && (
              <span>
                <span className="font-bold tabular-nums">{semMetaTotal}</span>{" "}
                {semMetaTotal === 1 ? "vendedor ainda sem meta" : "vendedores ainda sem meta"}
              </span>
            )}
            {/* V5: o Comando mostra o resumo (top 3); a lista inteira de vendas e
                reuniões por pessoa mora em Performance › Gestão. */}
            {podeVerEquipe && (
              <Link to="/performance" className="ml-auto inline-flex items-center gap-1 font-semibold text-foreground hover:underline">
                Ver todos em Performance
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        ) : null
      }
    >
      <div className="grid items-center gap-x-6 gap-y-5 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {podeVerEquipe ? (
            <MetaDaOrganizacao
              podeEditar={isAdmin}
              derivadaDeIndividuais={temMetasIndividuaisDeVendas}
            />
          ) : (
            /* Sem ver a equipe, só as próprias metas — e nenhum total que
               denuncie a soma dos outros. */
            <ul className="space-y-4">
              {grupos.map((g) => (
                <li key={g.metrica}>
                  <span className="cmd-lbl">{g.metrica === "sales" ? "Vendas · minha meta" : "Reuniões · minha meta"}</span>
                  <p className="mt-1 text-[1.65rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
                    {formatarValor(g.feito, g.metrica)}
                    <span className="ml-1.5 text-[12px] font-semibold tracking-normal text-muted-foreground">
                      de {formatarValor(g.alvo, g.metrica)}
                    </span>
                  </p>
                  <Barra percentual={g.percentual} destaque />
                  <p className="mt-1 text-[12px] font-bold tabular-nums">{g.percentual}%</p>
                </li>
              ))}
            </ul>
          )}

          {podeVerEquipe && top3.length > 0 && (
            <>
              <div className="my-4 h-px bg-border/60" />
              <ul className="space-y-2.5" aria-label="Três vendedores mais adiantados na meta">
                {top3.map((linha) => {
                  const souEu = meuId != null && linha.id === meuId;
                  return (
                    <li key={linha.id} className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-tinta text-[9px] font-bold text-tinta-foreground"
                      >
                        {linha.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("")}
                      </span>
                      <span className={cn("w-[120px] min-w-0 truncate text-[12.5px]", souEu ? "font-bold" : "font-semibold")}>
                        {linha.name}
                      </span>
                      <span className="flex-1">
                        <Barra percentual={linha.percentage} />
                      </span>
                      <span
                        className={cn(
                          "w-[42px] shrink-0 text-right text-[12px] font-bold tabular-nums",
                          linha.percentage >= 100 ? "text-success-strong" : "text-foreground",
                        )}
                      >
                        {linha.percentage}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* O gráfico é da receita da ORGANIZAÇÃO — só para quem vê a equipe. */}
        {podeVerEquipe && <GraficoDoMes />}
      </div>
    </ComandoCard>
  );
}

/** Realizado × esperado no mês — o mesmo gráfico do Estúdio, sem moldura. */
function GraficoDoMes() {
  const agora = new Date();
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();
  const { data: metasDaOrg } = useTeamGoals(mes, ano);
  const { data: metrics } = useDashboardMetrics(mes, ano, null);
  const meta = (metasDaOrg ?? []).find((g) => g.type === "faturamento");
  const alvo = Number(meta?.target_value ?? 0);
  if (alvo <= 0) return null;
  return (
    <div className="flex h-full min-h-[220px] min-w-0 flex-col">
      <RealVsExpectedChart dailySales={metrics?.dailySales ?? []} goalTarget={alvo} month={mes} year={ano} />
    </div>
  );
}

/**
 * A meta de FATURAMENTO da organização no mês — e, quando ela não existe, o
 * campo para definir ali mesmo.
 *
 * É a MESMA linha que o `/performance` chama de "🏢 Meta do Time": tabela
 * `goals`, `type = 'faturamento'`, `team_member_id = null`. Gravar aqui é
 * gravar lá — não há segunda entidade, nem cópia.
 *
 * ⚠️ ESSE VALOR PODE SER RECALCULADO. `syncTeamFaturamentoGoal` roda a cada
 * salvamento de meta individual de vendas e sobrescreve o alvo da org com a
 * SOMA dessas metas. É comportamento do `/performance`, anterior a este campo,
 * e mantê-lo é o que faz "gravar aqui = gravar lá" ser verdade. O que muda é
 * que agora a tela DIZ isso, em vez de deixar o número sumir sem explicação.
 *
 * 🔒 Só admin/master escreve: a RLS de `goals` exige `is_user_admin()`. Quem
 * tem `performance.manage_goals` sem ser admin veria o campo e tomaria erro do
 * banco — por isso o gate aqui é o mesmo do banco, e não a chave de feature.
 */
function MetaDaOrganizacao({
  podeEditar,
  derivadaDeIndividuais,
}: {
  podeEditar: boolean;
  derivadaDeIndividuais: boolean;
}) {
  const agora = new Date();
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();

  const { data: metasDaOrg, isLoading } = useTeamGoals(mes, ano);
  // `null` explícito no filtro de membro: sem ele o hook recorta pelo próprio
  // usuário quando ele não é admin, e a barra rotulada "organização" mostraria
  // a receita de uma pessoa só. Quem chega aqui já passou por
  // `performance.view` — a mesma chave que libera ver a equipe no /performance.
  const { data: metrics } = useDashboardMetrics(mes, ano, null);
  const criarMeta = useCreateGoal();
  const [rascunho, setRascunho] = useState("");

  const meta = (metasDaOrg ?? []).find((g) => g.type === "faturamento");
  const alvo = Number(meta?.target_value ?? 0);
  const realizado = metrics?.vendaTotal ?? 0;
  const percentual = pct(realizado, alvo);
  // Ritmo linear do mês: no dia 15 de um mês de 30, o esperado é 50%.
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const diasRestantes = diasNoMes - agora.getDate();
  const esperado = Math.round((agora.getDate() / diasNoMes) * 100);

  const valorDigitado = Number(rascunho.replace(/\./g, "").replace(",", "."));
  const podeSalvar =
    Number.isFinite(valorDigitado) && valorDigitado > 0 && !criarMeta.isPending;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!podeSalvar) return;
    await criarMeta.mutateAsync({
      name: "Faturamento",
      type: "faturamento",
      target_value: valorDigitado,
      // Coluna depreciada (o progresso é recalculado), mas NOT NULL-ável e
      // escrita pelo `/performance` do mesmo jeito. Divergir aqui criaria duas
      // formas de linha para a mesma meta.
      current_value: 0,
      month: mes,
      year: ano,
      team_member_id: null,
    });
    setRascunho("");
  }

  if (isLoading) return null;

  return (
    <div className="px-5 py-4">
      <span className="cmd-lbl">Faturamento · organização</span>
      {/* V5: o realizado é o número da tela — grande; o alvo e o prazo embaixo. */}
      {alvo > 0 && (
        <div className="mb-2 mt-1.5">
          <p className="text-[2rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums">
            {formatBRL(realizado)}
          </p>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground tabular-nums">
            de {formatBRL(alvo)} ·{" "}
            {diasRestantes <= 0 ? "último dia do mês" : `${diasRestantes} ${diasRestantes === 1 ? "dia restante" : "dias restantes"}`}
          </p>
        </div>
      )}

      {alvo > 0 ? (
        <>
          <Barra percentual={percentual} destaque />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[13px] font-extrabold tabular-nums">{percentual}%</span>
            {percentual < esperado ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning-strong">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                esperado {esperado}% hoje
              </span>
            ) : (
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success-strong">
                no ritmo · esperado {esperado}%
              </span>
            )}
          </div>
          {derivadaDeIndividuais && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/60">
              Este alvo é recalculado como a soma das metas individuais de
              vendas. Editar por Performance › Gestão.
            </p>
          )}
        </>
      ) : podeEditar ? (
        <form onSubmit={salvar} className="mt-2 flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted-foreground/60">
              R$
            </span>
            <Input
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              aria-label="Meta de faturamento da organização para este mês"
              className="h-8 pl-8 text-[12px] tabular-nums"
            />
          </div>
          <Button type="submit" size="sm" className="h-8" disabled={!podeSalvar}>
            {criarMeta.isPending ? "Salvando…" : "Definir meta"}
          </Button>
        </form>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          A organização ainda não tem meta de faturamento para este mês.
        </p>
      )}

      {alvo <= 0 && podeEditar && derivadaDeIndividuais && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/60">
          Há metas individuais de vendas neste mês: ao salvar a próxima delas, o
          alvo da organização passa a ser a soma dessas metas.
        </p>
      )}
    </div>
  );
}

/** Barra de progresso chapada — estoura em 100% sem vazar da caixa. */
function Barra({
  percentual,
  destaque = false,
}: {
  percentual: number;
  destaque?: boolean;
}) {
  const largura = Math.min(100, Math.max(0, percentual));
  return (
    <div
      className={cn(
        "mt-1 w-full overflow-hidden rounded-full bg-muted",
        destaque ? "h-1.5" : "h-1",
      )}
      role="progressbar"
      aria-valuenow={percentual}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          percentual >= 100 ? "bg-primary" : "bg-primary/60",
        )}
        style={{ width: `${largura}%` }}
      />
    </div>
  );
}
