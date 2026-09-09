import { useMemo, useState, type FormEvent } from "react";
import { Target } from "lucide-react";
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
        semMetaTotal > 0 ? (
          <p className="text-[11px] text-muted-foreground/70">
            <span className="font-bold tabular-nums">{semMetaTotal}</span>{" "}
            {semMetaTotal === 1
              ? "vendedor ainda sem meta"
              : "vendedores ainda sem meta"}
          </p>
        ) : null
      }
    >
      <div className="divide-y divide-border/50">
        {podeVerEquipe && (
          <MetaDaOrganizacao
            podeEditar={isAdmin}
            derivadaDeIndividuais={temMetasIndividuaisDeVendas}
          />
        )}
        {grupos.map((g) => (
          <div key={g.metrica} className="px-4 py-3">
            {/* Linha da equipe: é a soma exata do que está logo abaixo. */}
            <div className="mb-2.5">
              <div className="flex items-baseline gap-2">
                <span className="cmd-lbl">
                  {g.metrica === "sales" ? "Vendas" : "Reuniões"}
                  {podeVerEquipe ? " · equipe" : " · minha meta"}
                </span>
                <span className="ml-auto text-[12px] font-semibold tabular-nums">
                  {formatarValor(g.feito, g.metrica)}
                  <span className="font-normal text-muted-foreground/60">
                    {" / "}
                    {formatarValor(g.alvo, g.metrica)}
                  </span>
                </span>
                <span
                  className={cn(
                    "w-[38px] shrink-0 text-right text-[12px] font-bold tabular-nums",
                    g.percentual >= 100 ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {g.percentual}%
                </span>
              </div>
              <Barra percentual={g.percentual} destaque />
            </div>

            {/* Sem equipe visível, a lista teria UMA linha repetindo a faixa
                acima. A faixa já diz "minha meta" — a lista some. */}
            <ul className={cn("space-y-2", !podeVerEquipe && "hidden")}>
              {g.linhas.map((linha) => {
                const souEu = meuId != null && linha.id === meuId;
                return (
                  <li key={`${g.metrica}:${linha.id}`}>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          "min-w-0 truncate text-[12px]",
                          souEu ? "font-bold" : "font-medium",
                        )}
                      >
                        {linha.name}
                        {souEu && (
                          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-primary">
                            você
                          </span>
                        )}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                        {formatarValor(linha.current, g.metrica)}
                        {" / "}
                        {formatarValor(linha.goal, g.metrica)}
                      </span>
                      <span
                        className={cn(
                          "w-[38px] shrink-0 text-right text-[11px] font-bold tabular-nums",
                          linha.percentage >= 100
                            ? "text-primary"
                            : "text-muted-foreground/70",
                        )}
                      >
                        {linha.percentage}%
                      </span>
                    </div>
                    <Barra percentual={linha.percentage} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </ComandoCard>
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
    <div className="px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="cmd-lbl">Faturamento · organização</span>
        {alvo > 0 && (
          <>
            <span className="ml-auto text-[12px] font-semibold tabular-nums">
              {formatBRL(realizado)}
              <span className="font-normal text-muted-foreground/60">
                {" / "}
                {formatBRL(alvo)}
              </span>
            </span>
            <span
              className={cn(
                "w-[38px] shrink-0 text-right text-[12px] font-bold tabular-nums",
                percentual >= 100 ? "text-primary" : "text-muted-foreground",
              )}
            >
              {percentual}%
            </span>
          </>
        )}
      </div>

      {alvo > 0 ? (
        <>
          <Barra percentual={percentual} destaque />
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
