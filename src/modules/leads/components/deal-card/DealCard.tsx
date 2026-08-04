import { useEffect, useState } from "react";
import {
  AlarmClock,
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  Check,
  Package,
  Trophy,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { DealCardStages } from "./DealCardStages";
import { DealCardTimeline } from "./DealCardTimeline";
import type { DealCardData } from "./types";

/**
 * O Card do Negócio — o segundo e último card do Torque.
 *
 * ── POR QUE O TEMPO LIDERA E O DINHEIRO NÃO ───────────────────────────────
 * Medido em prod 04/08/2026: `sale_value` existe em **1,1%** dos 38.739
 * negócios. Um card construído em torno do valor seria um card vazio em 99%
 * das aberturas. Já o tempo existe para 100% — e diz o que fazer: o negócio
 * mediano está parado há **42 dias**, e 22.060 dos 38.403 abertos passaram de
 * 30. O pipeline não é um rio, é um estacionamento; a função do card é tornar
 * impossível não ver há quanto tempo o carro está ali.
 *
 * ── O ALERTA COMPARA COM A ORG, NÃO COM UM NÚMERO ─────────────────────────
 * A 30 dias fixos, 57% da carteira acenderia — alarme que toca sempre não é
 * alarme. O aviso sai quando o negócio passa do **dobro da mediana da própria
 * etapa naquela org**, que é o que separa "demorado" de "esquecido".
 *
 * ── O LEAD É LINK, NÃO CONTEÚDO ───────────────────────────────────────────
 * Nome, empresa e telefone existem aqui só para saber de quem é o negócio e
 * chegar na pessoa. Etiquetas, campos, histórico e métricas de compra são do
 * card do Lead — o que sobrevive à venda mora lá.
 */

function Ladrilho({
  icone: Icone,
  cor,
  rotulo,
  valor,
  sufixo,
  alerta,
}: {
  icone: typeof Wallet;
  cor: string;
  rotulo: string;
  valor: string;
  sufixo?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2.5",
        alerta ? "border-destructive/40 bg-destructive/[0.07]" : "border-border bg-card",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "flex size-[22px] shrink-0 items-center justify-center rounded-md border",
            alerta ? "border-destructive/35 bg-destructive/10 text-destructive" : cor,
          )}
          aria-hidden="true"
        >
          <Icone className="size-3" />
        </span>
        <span className="text-[10.5px] font-medium uppercase leading-[1.25] tracking-[0.06em] text-muted-foreground">
          {rotulo}
        </span>
      </div>
      <span
        className={cn(
          "text-[17px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
          alerta ? "text-destructive" : "text-foreground",
        )}
      >
        {valor}
        {sufixo && (
          <span className="ml-0.5 text-[11.5px] font-medium text-muted-foreground">{sufixo}</span>
        )}
      </span>
    </div>
  );
}

function AcaoPrimaria({
  icone: Icone,
  rotulo,
  tom,
  onClick,
}: {
  icone: typeof Check;
  rotulo: string;
  tom: "ganho" | "perda" | "neutro";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        tom === "ganho" &&
          "border-success/40 text-success hover:bg-success/10",
        tom === "perda" &&
          "border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive",
        tom === "neutro" && "border-border text-foreground hover:bg-muted",
      )}
    >
      <Icone className="size-3.5" />
      {rotulo}
    </button>
  );
}

export function DealCard({
  negocio,
  onOpenLead,
  onSaveNote,
}: {
  negocio: DealCardData;
  onOpenLead?: (leadId: string) => void;
  onSaveNote?: (texto: string) => void;
}) {
  const [nota, setNota] = useState(negocio.nota);
  useEffect(() => setNota(negocio.nota), [negocio.id, negocio.nota]);

  const aberto = negocio.estado === "aberto";
  const estagnado =
    aberto &&
    negocio.diasNaEtapa !== null &&
    negocio.medianaDaEtapa !== null &&
    negocio.diasNaEtapa > negocio.medianaDaEtapa * 2;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 border-b border-border px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate text-[19px] font-semibold tracking-[-0.02em]">
                {negocio.titulo}
              </h1>
              {negocio.estado === "ganho" && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[12px] font-semibold text-success">
                  <Trophy className="size-3" />
                  Ganho
                </span>
              )}
              {negocio.estado === "perdido" && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/35 bg-destructive/[0.08] px-2 py-0.5 text-[12px] font-semibold text-destructive">
                  <X className="size-3" />
                  Perdido
                </span>
              )}
            </div>

            {/* A pessoa: identificação e porta. O conteúdo dela é do outro card. */}
            <button
              type="button"
              onClick={() => onOpenLead?.(negocio.lead.id)}
              className={cn(
                "group mt-1.5 flex max-w-full items-center gap-1.5 rounded text-left",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="truncate text-[13.5px] text-muted-foreground group-hover:text-foreground">
                {negocio.lead.empresa ?? negocio.lead.nome}
              </span>
              {negocio.lead.relacao === "cliente" && (
                <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 text-[10.5px] font-semibold text-primary">
                  Cliente
                </span>
              )}
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: negocio.funilCor }}
                  aria-hidden="true"
                />
                {negocio.funil}
              </span>
              {negocio.dono ? (
                <span>{negocio.dono}</span>
              ) : (
                <span className="text-muted-foreground/70">sem dono</span>
              )}
            </div>
          </div>

          {aberto && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <AcaoPrimaria icone={Check} rotulo="Ganhou" tom="ganho" />
              <AcaoPrimaria icone={X} rotulo="Perdeu" tom="perda" />
            </div>
          )}
        </div>

        <DealCardStages
          etapas={negocio.etapas}
          atual={negocio.etapaAtual}
          cor={negocio.funilCor}
        />
      </header>

      {/* ── Corpo ─────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-6">
          {/* Tempo — a manchete, e só enquanto o negócio está vivo. */}
          {aberto ? (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Tempo</h2>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {estagnado
                    ? "Parado muito acima do normal desta etapa"
                    : "Dentro do ritmo desta etapa"}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Ladrilho
                  icone={CalendarClock}
                  cor="border-border bg-muted text-muted-foreground"
                  rotulo="Em aberto"
                  valor={negocio.diasEmAberto === null ? "—" : String(negocio.diasEmAberto)}
                  sufixo={negocio.diasEmAberto === null ? undefined : "dias"}
                />
                <Ladrilho
                  icone={estagnado ? AlarmClock : CalendarClock}
                  cor="border-border bg-muted text-muted-foreground"
                  rotulo="Parado na etapa"
                  valor={negocio.diasNaEtapa === null ? "—" : String(negocio.diasNaEtapa)}
                  sufixo={negocio.diasNaEtapa === null ? undefined : "dias"}
                  alerta={estagnado}
                />
                <Ladrilho
                  icone={CalendarClock}
                  cor="border-border bg-muted text-muted-foreground"
                  rotulo="Normal aqui"
                  valor={negocio.medianaDaEtapa === null ? "—" : String(negocio.medianaDaEtapa)}
                  sufixo={negocio.medianaDaEtapa === null ? undefined : "dias"}
                />
              </div>
              {estagnado && (
                <p className="text-[12px] leading-snug text-destructive/90">
                  {negocio.diasNaEtapa} dias contra uma mediana de{" "}
                  {negocio.medianaDaEtapa} nesta etapa. Vale decidir: avança,
                  ganha ou perde.
                </p>
              )}
            </section>
          ) : (
            <section className="flex flex-col gap-3">
              <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Desfecho</h2>
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3",
                  negocio.estado === "ganho"
                    ? "border-success/35 bg-success/[0.07]"
                    : "border-border bg-card",
                )}
              >
                <div className="flex flex-col">
                  <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                    {negocio.estado === "ganho" ? "Vendido em" : "Perdido em"}
                  </span>
                  <span className="text-[14px] font-semibold tabular-nums">
                    {new Date(negocio.desfecho?.quando ?? "").toLocaleDateString("pt-BR")}
                  </span>
                </div>
                {negocio.desfecho?.valorVenda ? (
                  <div className="flex flex-col">
                    <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                      Valor da venda
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums text-success">
                      {formatBRL(negocio.desfecho.valorVenda)}
                    </span>
                  </div>
                ) : null}
                {negocio.desfecho?.motivo && (
                  <div className="flex flex-col">
                    <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                      Motivo
                    </span>
                    <span className="text-[14px] font-medium">{negocio.desfecho.motivo}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Dinheiro — some quando não há, em vez de mostrar R$ 0,00 em 99%. */}
          {(negocio.valor > 0 || negocio.produto) && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Valor</h2>
              <div className="grid grid-cols-2 gap-2">
                {negocio.valor > 0 && (
                  <Ladrilho
                    icone={Wallet}
                    cor="border-primary/35 bg-primary/10 text-primary"
                    rotulo="Valor do negócio"
                    valor={formatBRL(negocio.valor)}
                  />
                )}
                {negocio.produto && (
                  <Ladrilho
                    icone={Package}
                    cor="border-violet-500/25 bg-violet-500/10 text-violet-400"
                    rotulo="Produto"
                    valor={negocio.produto}
                  />
                )}
              </div>
            </section>
          )}

          {negocio.reuniao && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Reunião</h2>
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border",
                    negocio.reuniao.confirmada
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  <CalendarCheck className="size-3.5" />
                </span>
                <span className="text-[13px] font-medium tabular-nums">
                  {new Date(negocio.reuniao.data).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {negocio.reuniao.confirmada ? "confirmada" : "sem confirmação"}
                </span>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Movimentação</h2>
            <DealCardTimeline movimentacoes={negocio.movimentacoes} />
          </section>

          {/* Anotação do negócio — sem o peso que ela tem no card do Lead.
              Lá `notes` está em 74,9% dos leads; aqui, em 0,9% dos negócios.
              Mesmo tratamento seria copiar a forma sem o motivo. */}
          <section className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Anotação</h2>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              onBlur={() => nota !== negocio.nota && onSaveNote?.(nota)}
              placeholder="O que precisa ser lembrado sobre este negócio…"
              rows={2}
              className={cn(
                "w-full resize-none rounded-lg border border-border bg-card px-3.5 py-2.5",
                "text-[13px] leading-relaxed placeholder:text-muted-foreground/70",
                "transition-colors hover:border-muted-foreground/30",
                "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
              )}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
