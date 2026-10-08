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
 * tem cor própria e fria; o ouro fica reservado para o valor acumulado, que é o
 * único número aqui que responde "quanto essa relação já valeu".
 *
 * Idade e "sem contato" ficam SEMPRE, porque existem para todo lead e são a
 * única leitura de temperatura de quem nunca comprou — 94% da base.
 */

function Ladrilho({
  icone: Icone,
  cor,
  rotulo,
  valor,
  sufixo,
  destaque,
}: {
  icone: typeof Wallet;
  cor: string;
  rotulo: string;
  valor: string;
  sufixo?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2.5",
        destaque ? "border-primary/30 bg-primary/[0.07]" : "border-border bg-card",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "flex size-[22px] shrink-0 items-center justify-center rounded-md border",
            cor,
          )}
          aria-hidden="true"
        >
          <Icone className="size-3" />
        </span>
        {/* Sem `truncate`: o rótulo quebra em duas linhas em vez de virar
            "CICLO DE RE…". Rótulo cortado não identifica o número, que é a
            única função dele. */}
        <span className="text-[10.5px] font-medium uppercase leading-[1.25] tracking-[0.06em] text-muted-foreground">
          {rotulo}
        </span>
      </div>
      <span
        className={cn(
          "text-[17px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
          destaque ? "text-primary" : "text-foreground",
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

export function LeadCardMetrics({ metricas }: { metricas: Metricas }) {
  const comprou = metricas.pedidos > 0;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">A relação</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {comprou ? "Quanto esta pessoa já valeu" : "Ainda sem compra registrada"}
        </p>
      </div>

      {comprou && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Ladrilho
              icone={Wallet}
              cor="border-primary/35 bg-primary/10 text-primary"
              rotulo="Já comprou"
              valor={formatBRL(metricas.acumulado)}
              destaque
            />
          </div>
          <Ladrilho
            icone={LineChart}
            cor="border-sky-500/25 bg-sky-500/10 text-sky-400"
            rotulo="Ticket médio"
            valor={formatBRL(metricas.ticketMedio, 2)}
          />
          <Ladrilho
            icone={Package}
            cor="border-violet-500/25 bg-violet-500/10 text-violet-400"
            rotulo="Pedidos"
            valor={String(metricas.pedidos)}
          />
          <Ladrilho
            icone={RefreshCw}
            cor="border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
            rotulo="Ciclo de recompra"
            valor={metricas.cicloDias === null ? "—" : String(metricas.cicloDias)}
            sufixo={metricas.cicloDias === null ? undefined : "dias"}
          />
          <Ladrilho
            icone={CalendarClock}
            cor="border-amber-500/25 bg-amber-500/10 text-amber-400"
            rotulo="Última compra"
            valor={metricas.ultimaCompraDias === null ? "—" : String(metricas.ultimaCompraDias)}
            sufixo={metricas.ultimaCompraDias === null ? undefined : "dias"}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Ladrilho
          icone={CalendarClock}
          cor="border-border bg-muted text-muted-foreground"
          rotulo="Na base há"
          valor={String(metricas.idadeDias)}
          sufixo="dias"
        />
        <Ladrilho
          icone={Timer}
          cor="border-border bg-muted text-muted-foreground"
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
