import { CalendarClock, LineChart, Package, RefreshCw, Timer, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { LeadCardMetrics as Metricas } from "./types";

/**
 * Métricas da RELAÇÃO — o que esta pessoa vale, não o que o negócio vale.
 *
 * Bloco que a ADR-0024 §1 tirou da lista (coluna vazia em 97,1% das linhas,
 * 290px de largura) e mandou para o card. Aqui custa pouco: some inteiro quando
 * não há compra, em vez de reservar cabeçalho e largura como fazia na lista.
 *
 * Ladrilho com ícone em vez de número solto: o ícone dá âncora de varredura —
 * a pessoa acha "ciclo de recompra" pela forma antes de ler o rótulo. Cada um
 * tem tom semântico próprio (tokens do V5, os mesmos do `KpiTile`); o ouro fica
 * reservado para o valor acumulado, que é o único número aqui que responde
 * "quanto essa relação já valeu".
 *
 * Idade e "sem contato" ficam SEMPRE, porque existem para todo lead e são a
 * única leitura de temperatura de quem nunca comprou — 94% da base.
 */

/** Tons do chip do ícone — os mesmos do `KpiTile` (V5), só tokens. */
const TOM = {
  ouro: "bg-primary text-primary-foreground",
  info: "bg-insights/10 text-insights",
  bom: "bg-success/10 text-success",
  alerta: "bg-warning/15 text-warning-strong",
  neutro: "bg-muted text-foreground/70",
} as const;

function Ladrilho({
  icone: Icone,
  tom,
  rotulo,
  valor,
  sufixo,
  destaque,
}: {
  icone: typeof Wallet;
  tom: keyof typeof TOM;
  rotulo: string;
  valor: string;
  sufixo?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border px-3 py-3 shadow-relevo",
        destaque ? "border-primary/30 bg-primary-soft" : "border-card-border bg-card",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn("flex size-[22px] shrink-0 items-center justify-center rounded-[7px]", TOM[tom])}
          aria-hidden="true"
        >
          <Icone className="size-3" />
        </span>
        {/* Sem `truncate`: o rótulo quebra em duas linhas em vez de virar
            "CICLO DE RE…". Rótulo cortado não identifica o número, que é a
            única função dele. */}
        <span
          className={cn(
            "text-[10.5px] font-bold uppercase leading-[1.25] tracking-[.06em]",
            destaque ? "text-primary-soft-foreground" : "text-muted-foreground",
          )}
        >
          {rotulo}
        </span>
      </div>
      <span
        className={cn(
          "font-extrabold leading-none tracking-[-0.04em] tabular-nums text-foreground",
          destaque ? "text-[22px]" : "text-[18px]",
        )}
      >
        {valor}
        {sufixo && (
          <span className="ml-0.5 text-[11.5px] font-bold tracking-normal text-muted-foreground">{sufixo}</span>
        )}
      </span>
    </div>
  );
}

export function LeadCardMetrics({ metricas }: { metricas: Metricas }) {
  const comprou = metricas.pedidos > 0;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-bold tracking-[-0.01em]">A relação</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {comprou ? "Quanto esta pessoa já valeu" : "Ainda sem compra registrada"}
        </p>
      </div>

      {comprou && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Ladrilho
              icone={Wallet}
              tom="ouro"
              rotulo="Já comprou"
              valor={formatBRL(metricas.acumulado)}
              destaque
            />
          </div>
          <Ladrilho
            icone={LineChart}
            tom="info"
            rotulo="Ticket médio"
            valor={formatBRL(metricas.ticketMedio, 2)}
          />
          <Ladrilho
            icone={Package}
            tom="neutro"
            rotulo="Pedidos"
            valor={String(metricas.pedidos)}
          />
          <Ladrilho
            icone={RefreshCw}
            tom="bom"
            rotulo="Ciclo de recompra"
            valor={metricas.cicloDias === null ? "—" : String(metricas.cicloDias)}
            sufixo={metricas.cicloDias === null ? undefined : "dias"}
          />
          <Ladrilho
            icone={CalendarClock}
            tom="alerta"
            rotulo="Última compra"
            valor={metricas.ultimaCompraDias === null ? "—" : String(metricas.ultimaCompraDias)}
            sufixo={metricas.ultimaCompraDias === null ? undefined : "dias"}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Ladrilho
          icone={CalendarClock}
          tom="neutro"
          rotulo="Na base há"
          valor={String(metricas.idadeDias)}
          sufixo="dias"
        />
        <Ladrilho
          icone={Timer}
          tom="neutro"
          rotulo="Sem contato"
          valor={metricas.semContatoDias === null ? "nunca" : String(metricas.semContatoDias)}
          sufixo={metricas.semContatoDias === null ? undefined : "dias"}
        />
      </div>

      {!comprou && (
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Os números de recompra aparecem quando o primeiro negócio for ganho ou
          o ERP trouxer um pedido.
        </p>
      )}
    </section>
  );
}
