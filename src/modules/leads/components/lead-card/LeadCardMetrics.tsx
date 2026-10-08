import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { LeadCardMetrics as Metricas } from "./types";

/**
 * A RELAÇÃO — o que esta pessoa vale, não o que o negócio vale.
 *
 * Forma do mockup V5 (aba Dados da gaveta): quem já comprou ganha o cartão em
 * TINTA "Relacionamento", com os números em ladrilhos de vidro e a porta para o
 * Cliente 360. É o único painel em tinta da gaveta — é ele que diz "isto aqui é
 * cliente" antes de qualquer selo.
 *
 * Quem nunca comprou (94% da base) não ganha tinta: ganha o cartão branco com
 * os dois números que existem para todo lead — idade e silêncio —, que são a
 * única leitura de temperatura de quem ainda não comprou. O mockup não mostra
 * nada para eles; sumir com os dois números seria tirar dado da tela.
 *
 * Os números são os mesmos de antes (`useLeadCardData`, com a precedência de
 * `lib/data-metrics`) e são os que saíram da lista de Leads
 * (`lista-dados-no-card.test.tsx`): só a forma mudou.
 */

/**
 * Número e unidade em nós SEPARADOS — a regra do V5 ("unidade menor", como o
 * `ValueUnit`) e o contrato de `lista-dados-no-card.test.tsx`: o número que saiu
 * da lista de Leads tem de ser achável sozinho na ficha.
 */
function Numero({ valor, sufixo, tom }: { valor: string; sufixo?: string; tom: "tinta" | "cartao" }) {
  return (
    <>
      <span>{valor}</span>
      {sufixo && (
        <small
          className={cn(
            "ml-1 text-[0.72em] font-bold tracking-normal",
            tom === "tinta" ? "text-tinta-muted" : "text-muted-foreground",
          )}
        >
          {sufixo}
        </small>
      )}
    </>
  );
}

/** Dias como número + unidade; `null` vira a palavra do vazio, sem unidade. */
function emDias(n: number | null, vazio: string): { valor: string; sufixo?: string } {
  if (n === null) return { valor: vazio };
  return { valor: String(n), sufixo: n === 1 ? "dia" : "dias" };
}

function Vidro({
  rotulo,
  valor,
  sufixo,
  destaque,
}: {
  rotulo: string;
  valor: string;
  sufixo?: string;
  destaque?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-tinta-line bg-tinta-foreground/[0.06] px-2.5 py-2">
      <span
        className={cn(
          "truncate text-[14px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums",
          destaque ? "text-primary" : "text-tinta-foreground",
        )}
      >
        <Numero valor={valor} sufixo={sufixo} tom="tinta" />
      </span>
      <span className="truncate text-[10.5px] font-medium text-tinta-muted">{rotulo}</span>
    </div>
  );
}

export function LeadCardMetrics({ metricas }: { metricas: Metricas }) {
  const comprou = metricas.pedidos > 0;

  if (comprou) {
    return (
      <section className="flex flex-col gap-3 rounded-card bg-tinta p-3.5 text-tinta-foreground shadow-relevo-tinta">
        <div className="flex items-center gap-2">
          <h2 className="text-[10.5px] font-bold uppercase tracking-[.08em] text-tinta-muted">
            Relacionamento
          </h2>
          {/* O 360 é PÁGINA (decisão de 02/10), e a ficha não sabe de rota:
              é alcançável por `/preview.html`, que não carrega roteador. Um
              link de documento é o que sobra — e é honesto: leva à página. */}
          {metricas.clienteId && (
            <a
              href={`/carteira/${metricas.clienteId}`}
              className={cn(
                "ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-primary px-3 text-[12px] font-bold text-primary-foreground",
                "transition-transform hover:-translate-y-px",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-tinta",
              )}
            >
              Cliente 360
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-4">
          <Vidro rotulo="Já comprou" valor={formatBRL(metricas.acumulado)} destaque />
          <Vidro rotulo="Pedidos" valor={String(metricas.pedidos)} />
          <Vidro rotulo="Ticket médio" valor={formatBRL(metricas.ticketMedio)} />
          <Vidro rotulo="Última compra" {...emDias(metricas.ultimaCompraDias, "—")} />
          <Vidro rotulo="Ciclo de recompra" {...emDias(metricas.cicloDias, "—")} />
          <Vidro rotulo="Na base há" {...emDias(metricas.idadeDias, "—")} />
          <Vidro rotulo="Sem contato" {...emDias(metricas.semContatoDias, "nunca")} />
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-[18px] border border-card-border bg-card px-3.5 py-3 shadow-relevo">
      <h2 className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
        Relação
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <span className="text-[16px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums">
            <Numero {...emDias(metricas.idadeDias, "—")} tom="cartao" />
          </span>
          <span className="text-[11px] text-muted-foreground">Na base há</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[16px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums">
            <Numero {...emDias(metricas.semContatoDias, "nunca")} tom="cartao" />
          </span>
          <span className="text-[11px] text-muted-foreground">Sem contato</span>
        </div>
      </div>
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        Sem compra registrada. Os números de recompra aparecem quando o primeiro negócio for
        ganho ou o ERP trouxer um pedido.
      </p>
    </section>
  );
}
