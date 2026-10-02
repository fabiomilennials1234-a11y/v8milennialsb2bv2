import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Edit2, Gift, Plus, Sparkles, Trash2, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FocusCard, FocusTile, InkPanel, InkRow, InkSplit } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import type { Competition } from "@/modules/engagement/hooks/useCompetitions";
import type { Goal } from "@/modules/engagement/hooks/useGoals";

export type VisaoRanking = "venda" | "pre";

/** Alternador Venda / Pré-venda — escuro na tinta, claro no cartão. */
export function AlternadorVisao({
  value,
  onChange,
  naTinta = false,
}: {
  value: VisaoRanking;
  onChange: (v: VisaoRanking) => void;
  naTinta?: boolean;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as VisaoRanking)}>
      <TabsList
        variant="segmented"
        aria-label="Visão do ranking"
        className={naTinta ? "bg-white/10 [&>[data-state=inactive]]:text-tinta-muted" : undefined}
      >
        <TabsTrigger value="venda">Venda</TabsTrigger>
        <TabsTrigger value="pre">Pré-venda</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function brl(v: number) {
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

function brlCompacto(v: number) {
  return v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Herói: pódio + competição, numa tinta só
// ─────────────────────────────────────────────────────────────────────────────

export interface LinhaCompeticao {
  id: string;
  name: string;
  value: number;
}

export interface PremioCompeticao {
  position: number;
  prize_name: string;
  prize_icon: string;
  prize_value: number | null;
}

export function PodioHero({
  titulo,
  count,
  actions,
  podio,
  lateral,
}: {
  titulo: string;
  count: string;
  actions?: ReactNode;
  podio: ReactNode;
  lateral: ReactNode;
}) {
  return (
    <InkPanel title={titulo} count={count} actions={actions}>
      <div className="grid items-end gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div className="min-w-0 px-1">{podio}</div>
        <div className="min-w-0 self-stretch">{lateral}</div>
      </div>
    </InkPanel>
  );
}

const VIDRO = "flex h-full flex-col gap-3 rounded-[22px] border border-tinta-line bg-tinta-2 p-4";

/** O vidro "Competição" ao lado do pódio — o que antes era o cabeçalho da competição. */
export function VidroCompeticao({
  competition,
  participantes,
  premios,
  top3,
}: {
  competition: Competition;
  participantes: number;
  premios: PremioCompeticao[];
  top3: LinhaCompeticao[];
}) {
  const diasRestantes = Math.max(
    0,
    Math.ceil((new Date(competition.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );
  const ordenados = [...premios].sort((a, b) => a.position - b.position);
  const primeiro = ordenados[0];
  const max = Math.max(1, ...top3.map((t) => t.value));
  const vendas = competition.metric_type === "sales";

  return (
    <div className={VIDRO}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold">
          <Trophy className="h-3.5 w-3.5" aria-hidden />
          Competição
        </span>
        <span className="ml-auto text-[11.5px] font-semibold text-tinta-muted">
          {diasRestantes === 0 ? "encerra hoje" : `encerra em ${diasRestantes} ${diasRestantes === 1 ? "dia" : "dias"}`}
        </span>
      </div>
      <div>
        <p className="text-[11.5px] text-tinta-muted">
          {vendas ? "Vendas" : "Reuniões"} · {competition.criteria === "absolute_value" ? "valor absoluto" : "% da meta"}
        </p>
        <p className="truncate text-[1.25rem] font-extrabold tracking-[-0.03em]">{competition.name}</p>
      </div>
      {primeiro && (
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10" aria-hidden>
            <Gift className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold">
              1º lugar: {primeiro.prize_icon} {primeiro.prize_name}
            </p>
            {ordenados.length > 1 && (
              <p className="truncate text-[11.5px] text-tinta-muted">
                {ordenados
                  .slice(1)
                  .map((p) => `${p.position}º ${p.prize_name}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}
      {top3.length > 0 && (
        <ul className="space-y-2">
          {top3.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 text-[12.5px]">
              <span className="w-20 shrink-0 truncate font-semibold">{t.name.split(" ")[0]}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <span
                  className={cn("block h-full rounded-full", i === 0 ? "bg-primary" : "bg-white/50")}
                  style={{ width: `${(t.value / max) * 100}%` }}
                />
              </span>
              <span className="w-20 shrink-0 text-right font-bold tabular-nums">
                {vendas ? brlCompacto(t.value) : `${t.value} reun.`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto grid grid-cols-3 gap-2">
        {[
          [diasRestantes, diasRestantes === 1 ? "dia restante" : "dias restantes"],
          [participantes, "competidores"],
          [premios.length, premios.length === 1 ? "prêmio" : "prêmios"],
        ].map(([n, r]) => (
          <div key={String(r)} className="rounded-2xl bg-white/[.06] px-2 py-2.5 text-center">
            <p className="text-[1.25rem] font-extrabold leading-none tabular-nums">{n}</p>
            <p className="mt-1 text-[10.5px] text-tinta-muted">{r}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sem competição ativa: o mesmo convite de antes, agora no vidro ao lado do pódio. */
export function VidroSemCompeticao({
  onCriar,
  onDemo,
  criandoDemo,
}: {
  onCriar: () => void;
  onDemo?: () => void;
  criandoDemo?: boolean;
}) {
  return (
    <div className={cn(VIDRO, "items-center justify-center text-center")}>
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10" aria-hidden>
        <Trophy className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[15px] font-bold">Nenhuma competição ativa</p>
        <p className="mx-auto mt-1 max-w-[300px] text-[12.5px] text-tinta-muted">
          Crie uma competição para engajar seu time com ranking, metas e prêmios em tempo real.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onCriar} className="h-9">
          <Plus />
          Criar Competição
        </Button>
        {onDemo && (
          <Button
            onClick={onDemo}
            variant="outline"
            disabled={criandoDemo}
            className="h-9 border-white/15 bg-transparent text-tinta-foreground shadow-none hover:bg-white/10"
          >
            <Sparkles />
            {criandoDemo ? "Criando..." : "Criar Competição Demo"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Classificação completa (tabela)
// ─────────────────────────────────────────────────────────────────────────────

export interface LinhaClassificacao {
  id: string;
  name: string;
  sub?: string;
  avatarUrl?: string;
  position: number;
  value: number;
  conversions?: number;
  meetingsBooked?: number;
  goal?: number;
  goalProgress: number;
  /** Movimento desde a última leitura (só em competição). */
  delta?: number;
}

export function ClassificacaoCompleta({
  linhas,
  metrica,
  subtitulo,
  alternador,
  mostrarPosicao,
}: {
  linhas: LinhaClassificacao[];
  metrica: "sales" | "meetings";
  subtitulo: string;
  alternador?: ReactNode;
  mostrarPosicao?: boolean;
}) {
  const vendas = metrica === "sales";
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 pb-3">
        <div className="min-w-[12rem] flex-1">
          <CardTitle className="text-[15px] tracking-[-0.02em]">Classificação completa</CardTitle>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{subtitulo}</p>
        </div>
        {alternador}
      </CardHeader>
      <CardContent className="p-0">
        {linhas.length === 0 ? (
          <p className="px-6 pb-8 pt-2 text-center text-[13px] text-muted-foreground">
            {vendas ? "Nenhum membro de vendas com faturamento." : "Nenhum membro de reuniões com dados."}
          </p>
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16 pl-6">Pos.</TableHead>
                <TableHead>Pessoa</TableHead>
                {vendas ? (
                  <>
                    <TableHead className="text-right">Vendido</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Ticket médio</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="text-right">Realizadas</TableHead>
                    <TableHead className="text-right">Marcadas</TableHead>
                  </>
                )}
                <TableHead className="w-[260px]">Meta</TableHead>
                {mostrarPosicao && <TableHead className="pr-6">Posição</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const ticket = vendas && l.conversions ? l.value / l.conversions : null;
                const pct = Math.round(l.goalProgress);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="py-3 pl-6">
                      <span
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded-full text-[11px] font-extrabold tabular-nums",
                          l.position === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {l.position}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <UserAvatar name={l.name} avatarUrl={l.avatarUrl} size="sm" fallbackClassName="bg-muted text-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-bold">{l.name}</span>
                          {l.sub && <span className="block truncate text-[11.5px] text-muted-foreground">{l.sub}</span>}
                        </span>
                      </span>
                    </TableCell>
                    {vendas ? (
                      <>
                        <TableCell className="py-3 text-right text-[13px] font-bold tabular-nums">{brl(l.value)}</TableCell>
                        <TableCell className="py-3 text-right text-[13px] tabular-nums">{l.conversions ?? 0}</TableCell>
                        <TableCell className="py-3 text-right text-[13px] tabular-nums text-muted-foreground">
                          {ticket != null ? brl(ticket) : "—"}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="py-3 text-right text-[13px] font-bold tabular-nums">{l.value}</TableCell>
                        <TableCell className="py-3 text-right text-[13px] tabular-nums">{l.meetingsBooked ?? "—"}</TableCell>
                      </>
                    )}
                    <TableCell className="py-3">
                      {l.goal ? (
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className={cn(
                                  "block h-full rounded-full",
                                  pct >= 100 ? "bg-success" : pct >= 70 ? "bg-foreground" : "bg-foreground/50",
                                )}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </span>
                            <span className="w-11 text-right text-[12px] font-bold tabular-nums">{pct}%</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                            meta {vendas ? brl(l.goal) : l.goal}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">sem meta</span>
                      )}
                    </TableCell>
                    {mostrarPosicao && (
                      <TableCell className="py-3 pr-6">
                        {l.delta ? (
                          <Badge variant={l.delta < 0 ? "success" : "warning"} className="gap-0.5 tabular-nums">
                            {l.delta < 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                            {Math.abs(l.delta)}
                          </Badge>
                        ) : (
                          <Badge variant="soft">=</Badge>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gestão: metas do time com anel, metas individuais em tinta + foco
// ─────────────────────────────────────────────────────────────────────────────

/** Anel de % — o realizado sobre a meta. */
function Anel({ pct, size = 64 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(pct, 100));
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          className={pct >= 100 ? "stroke-success" : "stroke-foreground"}
        />
      </svg>
      <span className="absolute text-[14px] font-extrabold tabular-nums">{Math.round(pct)}</span>
    </span>
  );
}

export interface MetaComRealizado {
  goal: Goal;
  rotulo: string;
  /** null = o produto não mede este tipo no mês — mostra só o alvo. */
  realizado: number | null;
  formatar: (v: number) => string;
}

export function MetasDoTime({ metas, onEditar }: { metas: MetaComRealizado[]; onEditar: (g: Goal) => void }) {
  if (metas.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metas.map(({ goal, rotulo, realizado, formatar }) => {
        const pct = realizado != null && goal.target_value > 0 ? (realizado / goal.target_value) * 100 : null;
        const faltam = realizado != null ? Math.max(goal.target_value - realizado, 0) : null;
        return (
          <div
            key={goal.id}
            className="flex min-w-0 flex-col gap-3 rounded-card border border-card-border bg-card p-[18px] shadow-relevo"
          >
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground/80">
                {goal.name || rotulo}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full"
                aria-label="Editar meta"
                onClick={() => onEditar(goal)}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-3">
              {pct != null && <Anel pct={pct} />}
              <div className="min-w-0">
                <p className="truncate text-[1.45rem] font-extrabold leading-tight tracking-[-0.04em] tabular-nums">
                  {realizado != null ? formatar(realizado) : formatar(goal.target_value)}
                </p>
                <p className="truncate text-[11.5px] text-muted-foreground tabular-nums">
                  {realizado != null
                    ? `de ${formatar(goal.target_value)} · ${faltam! > 0 ? `faltam ${formatar(faltam!)}` : "meta batida"}`
                    : `meta · ${rotulo}`}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface PessoaComMetas {
  id: string;
  name: string;
  sub?: string;
  avatarUrl?: string;
  /** Do ranking do mês (o mesmo número do pódio). */
  progresso: number | null;
  realizadoTexto?: string;
  metas: { goal: Goal; rotulo: string; alvo: string }[];
}

export function MetasIndividuais({
  pessoas,
  onNova,
  onEditar,
  onExcluir,
}: {
  pessoas: PessoaComMetas[];
  onNova: () => void;
  onEditar: (g: Goal) => void;
  onExcluir: (id: string) => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = pessoas.find((p) => p.id === selId) ?? pessoas[0];
  const acao = (
    <Button
      variant="outline"
      size="sm"
      onClick={onNova}
      className="h-8 border-white/15 bg-white/[.06] text-tinta-foreground shadow-none hover:bg-white/10"
    >
      <Plus />
      Meta individual
    </Button>
  );

  if (!sel) {
    return (
      <InkPanel title="Metas Individuais" count="0 pessoas" actions={acao}>
        <p className="px-2 pb-6 pt-2 text-center text-[13px] text-tinta-muted">
          Nenhuma meta individual configurada para este mês.
        </p>
      </InkPanel>
    );
  }

  return (
    <InkSplit
      title="Metas Individuais"
      count={`${pessoas.length} ${pessoas.length === 1 ? "pessoa" : "pessoas"}`}
      actions={acao}
      list={pessoas.map((p) => {
        const selected = p.id === sel.id;
        const pct = p.progresso;
        return (
          <InkRow key={p.id} selected={selected} onClick={() => setSelId(p.id)}>
            <UserAvatar
              name={p.name}
              avatarUrl={p.avatarUrl}
              size="sm"
              className="h-[34px] w-[34px]"
              fallbackClassName={selected ? "bg-primary-foreground text-primary text-[11px]" : "bg-white/10 text-tinta-foreground text-[11px]"}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold">{p.name}</span>
              {pct != null ? (
                <span className={cn("mt-1 block h-1.5 overflow-hidden rounded-full", selected ? "bg-primary-foreground/15" : "bg-white/10")}>
                  <span
                    className={cn("block h-full rounded-full", selected ? "bg-tinta" : "bg-primary")}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </span>
              ) : (
                <span className={cn("block text-[11.5px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                  {p.metas.length} {p.metas.length === 1 ? "meta" : "metas"}
                </span>
              )}
            </span>
            {pct != null && <span className="shrink-0 text-[13px] font-extrabold tabular-nums">{Math.round(pct)}%</span>}
          </InkRow>
        );
      })}
      detail={
        <FocusCard className="gap-3.5">
          <div className="flex flex-wrap items-start gap-3">
            <UserAvatar
              name={sel.name}
              avatarUrl={sel.avatarUrl}
              size="md"
              className="h-12 w-12"
              fallbackClassName="bg-tinta text-tinta-foreground text-sm"
            />
            <div className="min-w-0 flex-1 basis-[11rem]">
              <p className="truncate text-[1.4rem] font-extrabold leading-tight tracking-[-0.035em]">{sel.name}</p>
              <p className="truncate text-[13px] text-primary-foreground/70">
                {[sel.sub, `${sel.metas.length} ${sel.metas.length === 1 ? "meta" : "metas"} no mês`].filter(Boolean).join(" · ")}
              </p>
            </div>
            {sel.progresso != null && sel.progresso >= 100 && (
              <Badge variant="ink" className="gap-1">
                <Trophy className="h-3 w-3" />
                Meta batida
              </Badge>
            )}
          </div>
          {sel.progresso != null && (
            <FocusTile>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-bold">Realizado no ranking</span>
                <span className="text-[13px] font-extrabold tabular-nums">
                  {sel.realizadoTexto} · {Math.round(sel.progresso)}%
                </span>
              </div>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-primary-foreground/15">
                <span className="block h-full rounded-full bg-tinta" style={{ width: `${Math.min(sel.progresso, 100)}%` }} />
              </span>
            </FocusTile>
          )}
          <div className="space-y-2">
            {sel.metas.map(({ goal, rotulo, alvo }) => (
              <FocusTile key={goal.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{goal.name || rotulo}</span>
                  <span className="block truncate text-[11.5px] text-primary-foreground/70">{rotulo}</span>
                </span>
                <span className="shrink-0 text-[14px] font-extrabold tabular-nums">{alvo}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-primary-foreground/10"
                  aria-label="Editar meta"
                  onClick={() => onEditar(goal)}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-primary-foreground/10"
                  aria-label="Excluir meta"
                  onClick={() => onExcluir(goal.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </FocusTile>
            ))}
          </div>
          <div className="mt-auto pt-1">
            <Button
              variant="outline"
              onClick={() => onEditar(sel.metas[0].goal)}
              className="border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
            >
              <Edit2 />
              Ajustar meta
            </Button>
          </div>
        </FocusCard>
      }
    />
  );
}

