import { useState } from "react";
import { AlertTriangle, CheckCircle2, Hourglass, Info, ReceiptText, ScrollText, Target, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FocusCard, FocusTile, IconChip, InkRow, InkSplit, KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { useCommissionSummaries, type CommissionSummary } from "@/modules/engagement/hooks/useCommissions";

import { Dinheiro, FAIXAS_ACELERADOR, formatBRL, multiplicadorDaMeta } from "./comissoes-format";

export interface PessoaComissao {
  id: string;
  name: string;
  /** Cargo (job_title) ou a função quando não há cargo. */
  papel: string;
  avatarUrl?: string;
}

interface TimeComissoesProps {
  pessoas: PessoaComissao[];
  month: number;
  year: number;
  /** "setembro" — vai nos rótulos. */
  mesLabel: string;
  /** "Time de venda" / "Time de pré-venda". */
  titulo: string;
  metrica: "sales" | "meetings";
  canViewAll: boolean;
  /** Valores do mês registrados como pagos/pendentes (a org inteira — como antes). */
  totalPago: number;
  totalPendente: number;
  qtdPendentes: number;
  onVerExtrato: (memberId: string) => void;
  onAbrirRegras: () => void;
}

type Linha = {
  pessoa: PessoaComissao;
  data: CommissionSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

/**
 * Comissões do V5: a grade de cartões por pessoa vira o herói "fila + foco" —
 * a lista do time em tinta à esquerda e a apuração da pessoa escolhida no
 * cartão de ouro. Os números são os mesmos de antes (`useCommissionSummary`),
 * agora pedidos de uma vez pela lista para os KPIs somarem o time.
 */
export function TimeComissoes({
  pessoas,
  month,
  year,
  mesLabel,
  titulo,
  metrica,
  canViewAll,
  totalPago,
  totalPendente,
  qtdPendentes,
  onVerExtrato,
  onAbrirRegras,
}: TimeComissoesProps) {
  const queries = useCommissionSummaries(
    pessoas.map((p) => p.id),
    month,
    year,
  );
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);

  const linhas: Linha[] = pessoas.map((pessoa, i) => ({
    pessoa,
    data: queries[i]?.data,
    isLoading: !!queries[i]?.isLoading,
    isError: !!queries[i]?.isError,
    refetch: () => void queries[i]?.refetch(),
  }));
  const carregando = linhas.some((l) => l.isLoading);

  // Ordena por ganhos só quando tudo chegou — ordenar a cada resposta fazia a
  // lista pular enquanto carregava. Listas de até ~20 pessoas: sem memo.
  const ordenadas = carregando
    ? linhas
    : [...linhas].sort((a, b) => (b.data?.totalEarnings ?? -1) - (a.data?.totalEarnings ?? -1));

  const selecionada = ordenadas.find((l) => l.pessoa.id === selecionadoId) ?? ordenadas[0];

  const prontas = linhas.filter((l): l is Linha & { data: CommissionSummary } => !!l.data);
  const comMeta = prontas.filter((l) => l.data.goalConfigured);
  const resumo = {
    total: prontas.reduce((s, l) => s + (l.data.totalEarnings ?? 0), 0),
    pendentes: prontas.filter((l) => l.data.totalEarnings == null).length,
    comMeta: comMeta.length,
    media: comMeta.length ? comMeta.reduce((s, l) => s + l.data.goalProgress, 0) / comMeta.length : null,
  };

  const pagoPct = totalPago + totalPendente > 0 ? (totalPago / (totalPago + totalPendente)) * 100 : 0;
  const unidade = metrica === "sales" ? "vendas" : "reuniões";

  return (
    <div className="space-y-5">
      {canViewAll && (
        <KpiRow cols={4}>
          <KpiTile
            className="h-full"
            label="Total do mês"
            icon={Wallet}
            tone="gold"
            loading={carregando}
            value={<Dinheiro value={resumo.total} />}
            note={
              resumo.pendentes > 0
                ? `${resumo.pendentes} com apuração pendente`
                : `ganhos de ${mesLabel} · ${pessoas.length} ${pessoas.length === 1 ? "pessoa" : "pessoas"}`
            }
          />
          <KpiTile
            className="h-full"
            label="Comissões pagas"
            icon={CheckCircle2}
            tone="good"
            value={<Dinheiro value={totalPago} />}
            note="registradas como pagas no mês"
          >
            <Barra pct={pagoPct} className="bg-success" />
          </KpiTile>
          <KpiTile
            className="h-full"
            label="Comissões pendentes"
            icon={Hourglass}
            tone="info"
            value={<Dinheiro value={totalPendente} />}
            note={qtdPendentes > 0 ? `${qtdPendentes} ${qtdPendentes === 1 ? "comissão a pagar" : "comissões a pagar"}` : "nada a pagar"}
          />
          <KpiTile
            className="h-full"
            label="Progresso da meta"
            icon={Target}
            tone="gold"
            loading={carregando}
            value={
              resumo.media == null ? (
                "—"
              ) : (
                <>
                  {Math.round(resumo.media)}
                  <ValueUnit>%</ValueUnit>
                </>
              )
            }
            note={
              resumo.media == null
                ? "nenhuma meta configurada"
                : `média de ${resumo.comMeta} ${resumo.comMeta === 1 ? "pessoa" : "pessoas"} com meta`
            }
          >
            {resumo.media != null && <Barra pct={Math.min(resumo.media, 100)} className="bg-primary" />}
          </KpiTile>
        </KpiRow>
      )}

      <InkSplit
        title={titulo}
        count="OTE = salário base + variável alvo"
        actions={
          ordenadas.length > 1 ? <span className="text-[11.5px] text-tinta-muted">Clique numa pessoa</span> : undefined
        }
        list={
          <>
            {ordenadas.map((l) => (
              <LinhaPessoa
                key={l.pessoa.id}
                linha={l}
                unidade={unidade}
                selected={l.pessoa.id === selecionada?.pessoa.id}
                onSelect={() => setSelecionadoId(l.pessoa.id)}
              />
            ))}
            <p className="mt-2 flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[.05] px-3 py-2.5 text-[11.5px] leading-relaxed text-tinta-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Total = base fixa + bônus da meta × acelerador + comissão de recorrência e de projeto + bônus de campanhas.
            </p>
          </>
        }
        detail={
          selecionada ? (
            <FocoPessoa
              linha={selecionada}
              mesLabel={mesLabel}
              unidade={unidade}
              onVerExtrato={() => onVerExtrato(selecionada.pessoa.id)}
            />
          ) : null
        }
      />

      <AceleradoresCard
        pessoas={linhas
          .filter((l) => l.data?.goalConfigured)
          .map((l) => ({ ...l.pessoa, progresso: l.data!.goalProgress }))}
        carregando={carregando}
        onAbrirRegras={onAbrirRegras}
      />
    </div>
  );
}

function Barra({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={cn("h-full rounded-full", className)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

function LinhaPessoa({
  linha,
  unidade,
  selected,
  onSelect,
}: {
  linha: Linha;
  unidade: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { pessoa, data, isLoading, isError } = linha;
  const mult = data?.goalConfigured ? multiplicadorDaMeta(data.goalProgress) : null;
  const sub = isLoading
    ? "apurando…"
    : isError
      ? "apuração indisponível"
      : data
        ? [
            data.goalConfigured ? `${Math.round(data.goalProgress)}% da meta` : "sem meta",
            unidade === "vendas" ? formatBRL(data.salesRevenue) : `${data.goalCurrent} ${unidade}`,
          ].join(" · ")
        : "";

  return (
    <InkRow selected={selected} onClick={onSelect} aria-label={`Ver comissão de ${pessoa.name}`}>
      <UserAvatar
        name={pessoa.name}
        avatarUrl={pessoa.avatarUrl}
        size="sm"
        className="h-[34px] w-[34px]"
        fallbackClassName={cn(
          "text-[11px]",
          selected ? "bg-primary-foreground text-primary" : "bg-white/10 text-tinta-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold">{pessoa.name}</span>
        <span
          className={cn(
            "block truncate text-[11.5px]",
            selected ? "text-primary-foreground/70" : isError ? "text-destructive" : "text-tinta-muted",
          )}
        >
          {sub}
        </span>
      </span>
      {mult && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
            selected ? "bg-tinta text-tinta-foreground" : "bg-white/10 text-tinta-foreground",
          )}
        >
          {mult.rotulo}
        </span>
      )}
      <span className="shrink-0 text-right text-[13px] font-extrabold tabular-nums">
        {isLoading ? (
          <Skeleton className="h-4 w-16 bg-white/10" />
        ) : data?.totalEarnings != null ? (
          <Dinheiro
            value={data.totalEarnings}
            centsClassName={selected ? "text-primary-foreground/70" : "text-tinta-muted"}
          />
        ) : data ? (
          <span className={cn("text-[11.5px] font-bold", selected ? "text-primary-foreground/80" : "text-warning-strong")}>
            pendente
          </span>
        ) : null}
      </span>
    </InkRow>
  );
}

function FocoPessoa({
  linha,
  mesLabel,
  unidade,
  onVerExtrato,
}: {
  linha: Linha;
  mesLabel: string;
  unidade: string;
  onVerExtrato: () => void;
}) {
  const { pessoa, data: s, isLoading, isError, refetch } = linha;

  if (isLoading) {
    return (
      <FocusCard className="min-h-[300px]">
        <Skeleton className="h-10 w-48 bg-primary-foreground/10" />
        <Skeleton className="h-14 w-64 bg-primary-foreground/10" />
        <Skeleton className="h-20 w-full bg-primary-foreground/10" />
      </FocusCard>
    );
  }
  if (isError || !s) {
    return (
      <FocusCard className="items-start">
        <p className="flex items-center gap-2 text-[15px] font-extrabold">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Apuração indisponível
        </p>
        <p className="text-[13px] text-primary-foreground/75">Não foi possível apurar a comissão de {pessoa.name}.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refetch}
          className="border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
        >
          Tentar novamente
        </Button>
      </FocusCard>
    );
  }

  const mult = multiplicadorDaMeta(s.goalProgress);
  const ote = s.oteBase + s.oteBonus;
  const pctOte = s.totalEarnings != null && ote > 0 ? (s.totalEarnings / ote) * 100 : null;
  // Régua 0 → 130% do OTE, com a marca no OTE (100%).
  const ESCALA = 130;
  const pendente = s.commissionStatus === "pending";

  return (
    <FocusCard className="gap-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <UserAvatar
          name={pessoa.name}
          avatarUrl={pessoa.avatarUrl}
          size="md"
          className="h-12 w-12"
          fallbackClassName="bg-tinta text-tinta-foreground text-sm"
        />
        <div className="min-w-0 flex-1 basis-[11rem]">
          <p className="truncate text-[1.4rem] font-extrabold leading-tight tracking-[-0.035em]">{pessoa.name}</p>
          <p className="truncate text-[13px] text-primary-foreground/70">
            {pessoa.papel}
            {s.goalConfigured ? ` · ${Math.round(s.goalProgress)}% da meta` : " · meta não configurada"}
          </p>
        </div>
        {s.goalConfigured && (
          <Badge variant="ink" className="shrink-0 tabular-nums">
            Acelerador {mult.rotulo}
          </Badge>
        )}
      </div>

      <div>
        <p className="text-[12px] font-bold text-primary-foreground/70">Ganhos de {mesLabel} · base + variável</p>
        {s.totalEarnings != null ? (
          <p className="text-[clamp(2.2rem,5vw,3.2rem)] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
            <Dinheiro value={s.totalEarnings} centsClassName="text-primary-foreground/70" />
          </p>
        ) : (
          <p className="mt-1 text-[1.6rem] font-extrabold leading-tight tracking-[-0.03em]">Apuração pendente</p>
        )}
        {pctOte != null && (
          <p className="mt-1 text-[13px] font-semibold text-primary-foreground/75 tabular-nums">
            OTE de {formatBRL(ote)} · {pctOte.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do alvo
          </p>
        )}
      </div>

      {pctOte != null && (
        <div>
          <div className="relative h-2 rounded-full bg-primary-foreground/15">
            <div
              className="h-full rounded-full bg-tinta"
              style={{ width: `${Math.min(pctOte, ESCALA) / ESCALA * 100}%` }}
            />
            <span
              className="absolute -top-1 h-4 w-0.5 rounded-full bg-primary-foreground/60"
              style={{ left: `${(100 / ESCALA) * 100}%` }}
              aria-hidden
            />
          </div>
          <div className="relative mt-1 h-4 text-[10.5px] font-semibold text-primary-foreground/60">
            <span className="absolute left-0">R$ 0</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${(100 / ESCALA) * 100}%` }}>
              OTE
            </span>
            <span className="absolute right-0">{ESCALA}%</span>
          </div>
        </div>
      )}

      {pendente && (
        <p className="rounded-2xl bg-[hsl(40_60%_8%/.1)] px-3 py-2 text-[12.5px] font-semibold">
          {s.pendingCount} {s.pendingCount === 1 ? "venda" : "vendas"}, total de {formatBRL(s.pendingRevenue)}, aguardando
          conferência da comissão.
        </p>
      )}
      {!s.goalConfigured && (
        <p className="rounded-2xl bg-[hsl(40_60%_8%/.1)] px-3 py-2 text-[12.5px] font-semibold">
          Realizado no período: {s.goalCurrent} {unidade}. Configure a meta para apurar o bônus.
        </p>
      )}

      {/* auto-fit: o foco tem largura variável (lista ao lado, painéis do shell) —
          quatro colunas quando cabem, duas quando não. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
        <Tile valor={formatBRL(s.oteBase)} rotulo="Base fixa" />
        <Tile
          valor={!s.goalConfigured && s.oteBonus > 0 ? "Pendente" : formatBRL(s.calculatedBonus)}
          rotulo={s.goalConfigured ? `Bônus da meta (${mult.rotulo})` : "Bônus por meta"}
        />
        <Tile valor={pendente ? "Pendente" : formatBRL(s.commissionMRR)} rotulo="Comissão recorrência" />
        <Tile valor={pendente ? "Pendente" : formatBRL(s.commissionProjeto)} rotulo="Comissão projeto" />
      </div>

      {s.campaignBonuses > 0 && (
        <FocusTile className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <span className="font-bold">Bônus de campanhas</span>
          <span className="text-primary-foreground/70">{s.campaignBonusList.map((c) => c.campaignName).join(" · ")}</span>
          <span className="ml-auto font-extrabold tabular-nums">{formatBRL(s.campaignBonuses)}</span>
        </FocusTile>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          onClick={onVerExtrato}
          className="border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
        >
          <ReceiptText />
          Ver extrato
        </Button>
        {unidade === "vendas" && (
          <span className="text-[12px] font-semibold text-primary-foreground/70 tabular-nums">
            Vendas do mês {formatBRL(s.salesRevenue)} · Rec. {formatBRL(s.totalMRR)} · Projeto {formatBRL(s.totalProjeto)}
          </span>
        )}
      </div>
    </FocusCard>
  );
}

function Tile({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <FocusTile>
      <p className="truncate text-[1rem] font-extrabold tabular-nums">{valor}</p>
      <p className="truncate text-[11px] font-semibold text-primary-foreground/70">{rotulo}</p>
    </FocusTile>
  );
}

/**
 * Trilho dos aceleradores: as faixas reais do produto (0x · 0,7x · 1,0x ·
 * 1,2x) e cada pessoa com meta na posição do próprio % da meta.
 */
function AceleradoresCard({
  pessoas,
  carregando,
  onAbrirRegras,
}: {
  pessoas: (PessoaComissao & { progresso: number })[];
  carregando: boolean;
  onAbrirRegras: () => void;
}) {
  const MAX = FAIXAS_ACELERADOR[FAIXAS_ACELERADOR.length - 1].ate;
  const pos = (v: number) => (Math.min(Math.max(v, 0), MAX) / MAX) * 100;

  // Duas pessoas perto demais se sobrepõem: o rótulo desce um degrau
  // (avatar + nome ocupam ~46 px). Com 3 degraus cabe um grupo de 3 empatados.
  const DEGRAU = 46;
  const marcadores = [...pessoas]
    .sort((a, b) => a.progresso - b.progresso)
    .reduce<{ p: PessoaComissao & { progresso: number }; left: number; nivel: number }[]>((acc, p) => {
      const left = pos(p.progresso);
      const ant = acc[acc.length - 1];
      const nivel = ant && left - ant.left < 11 ? (ant.nivel + 1) % 3 : 0;
      acc.push({ p, left, nivel });
      return acc;
    }, []);
  const maxNivel = marcadores.reduce((m, x) => Math.max(m, x.nivel), 0);
  const tons = ["bg-muted", "bg-primary/35", "bg-primary/65", "bg-primary"];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start gap-3 space-y-0 pb-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
            <IconChip icon={Target} tone="gold" />
            Aceleradores de comissão
          </CardTitle>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            O multiplicador do bônus depende de quanto da meta individual foi atingido.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAbrirRegras}>
          <ScrollText />
          Regras
        </Button>
      </CardHeader>
      <CardContent>
        <div className="-mx-2 overflow-x-auto px-2 pb-1">
          <div className="min-w-0 sm:min-w-[620px]">
            <div className="flex">
              {FAIXAS_ACELERADOR.map((f) => (
                <div key={f.mult} className="min-w-0 pr-2" style={{ width: `${((f.ate - f.de) / MAX) * 100}%` }}>
                  <p className="text-[1.05rem] font-extrabold tabular-nums">{f.mult}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{f.faixa}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex h-2.5 gap-1">
              {FAIXAS_ACELERADOR.map((f, i) => (
                <div
                  key={f.mult}
                  className={cn("h-full rounded-full", tons[i])}
                  style={{ width: `${((f.ate - f.de) / MAX) * 100}%` }}
                />
              ))}
            </div>
            <div className="relative" style={{ height: marcadores.length ? 58 + maxNivel * DEGRAU : 24 }}>
              {carregando ? (
                <Skeleton className="mt-3 h-6 w-40" />
              ) : marcadores.length === 0 ? (
                <p className="pt-3 text-[12.5px] text-muted-foreground">Ninguém com meta configurada neste mês.</p>
              ) : (
                marcadores.map(({ p, left, nivel }) => {
                  // Nas bordas o rótulo encosta para dentro — centrado ele saía do cartão.
                  const ancora = left < 8 ? "inicio" : left > 92 ? "fim" : "meio";
                  return (
                    <div key={p.id} className="absolute top-0 w-0" style={{ left: `${left}%` }}>
                      <span
                        className="absolute left-0 top-0 w-px bg-foreground/25"
                        style={{ height: 8 + nivel * DEGRAU }}
                        aria-hidden
                      />
                      <span className="absolute -translate-x-1/2" style={{ top: 8 + nivel * DEGRAU }}>
                        <UserAvatar
                          name={p.name}
                          avatarUrl={p.avatarUrl}
                          size="xs"
                          className="h-7 w-7 ring-2 ring-card"
                          fallbackClassName="bg-primary-soft text-primary-soft-foreground"
                        />
                      </span>
                      <span
                        className={cn(
                          "absolute whitespace-nowrap text-[11px] font-bold tabular-nums",
                          ancora === "inicio" ? "left-[-6px]" : ancora === "fim" ? "right-[-6px]" : "-translate-x-1/2",
                        )}
                        style={{ top: 8 + nivel * DEGRAU + 30 }}
                      >
                        {p.name.split(" ")[0]} · {Math.round(p.progresso)}%
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            <div className="relative h-4 text-[10.5px] text-muted-foreground tabular-nums">
              {[0, 70, 100, 120].map((v) => (
                <span key={v} className={cn("absolute", v > 0 && "-translate-x-1/2")} style={{ left: `${pos(v)}%` }}>
                  {v}%
                </span>
              ))}
              <span className="absolute right-0">{MAX}%+</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
