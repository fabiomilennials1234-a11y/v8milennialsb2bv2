import { useState } from "react";
import { ChevronRight, Plus, ShoppingCart, Trophy, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { LeadCardDeal } from "./types";

/**
 * Negócios do lead — **lista e porta, nunca painel de controle**.
 *
 * O corte: o Lead é o que sobrevive à venda; o Negócio é o que morre com ela.
 * Daqui você vê onde o negócio está e há quanto tempo, e clica. Você não o
 * move, não muda etapa, não edita orçamento nem reunião — isso é do
 * `DealDetailDialog`, que já existe e já é o que os três funis abrem.
 *
 * ── A BARRA ───────────────────────────────────────────────────────────────
 * Substitui o nome da etapa como informação primária. "proposta enviada" diz
 * onde está; a barra diz **quanto falta**, que é a pergunta de quem abre o
 * card. Segmentada e não contínua porque etapa é discreta: o funil tem 6
 * casas, não 100%.
 *
 * Negócio fechado não tem barra — progresso de algo que acabou é ruído. Ganho
 * e perdido colapsam num bloco à parte, mesmo idioma da coluna "Negócios" da
 * lista, e pelo mesmo motivo: um lead atravessa vários funis na mesma venda.
 */

function Barra({ indice, total }: { indice: number | null; total: number }) {
  if (indice === null || total <= 0) return null;
  // Teto de 8 casas desenhadas: acima disso o segmento fica fino demais para
  // ser lido e a barra vira textura. O funil mais longo em prod tem 7.
  const casas = Math.min(total, 8);
  const preenchidas = Math.max(1, Math.round(((indice + 1) / total) * casas));

  return (
    <div
      className="flex items-center gap-[3px]"
      role="img"
      aria-label={`Etapa ${indice + 1} de ${total}`}
    >
      {Array.from({ length: casas }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-[5px] w-[15px] rounded-full transition-colors",
            i < preenchidas ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function Metrica({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1">
      <span className="text-[13px] font-semibold leading-none tabular-nums">{valor}</span>
      <span className="whitespace-nowrap text-[10px] text-muted-foreground">{rotulo}</span>
    </div>
  );
}

function LinhaAberta({ deal, onOpen }: { deal: LeadCardDeal; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(deal.id)}
      className={cn(
        "group flex w-full flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-3 text-left",
        "transition-[border-color,box-shadow] hover:border-muted-foreground/35 hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <ShoppingCart className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{deal.titulo}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {/* Valor só quando existe: a maioria da qualificação não tem
                `sale_value`, e "R$ 0,00" em toda linha esconde o que importa. */}
            {deal.valor > 0 ? formatBRL(deal.valor) : "sem valor lançado"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/45 transition-transform group-hover:translate-x-0.5" />
      </div>

      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-center gap-1.5">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: deal.funilCor }}
              aria-hidden="true"
            />
            <span className="truncate text-[12px] font-medium">{deal.funil}</span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              · {deal.etapa.toLowerCase()}
            </span>
          </span>
          <Barra indice={deal.etapaIndice} total={deal.etapaTotal} />
        </span>

        {(deal.diasEmAberto !== null || deal.diasNaEtapa !== null) && (
          <span className="flex shrink-0 items-stretch divide-x divide-border">
            {deal.diasEmAberto !== null && (
              <Metrica valor={`${deal.diasEmAberto}d`} rotulo="Em aberto" />
            )}
            {deal.diasNaEtapa !== null && (
              <Metrica valor={`${deal.diasNaEtapa}d`} rotulo="Na etapa" />
            )}
          </span>
        )}
      </div>
    </button>
  );
}

export function LeadCardDeals({
  negocios,
  onOpenDeal,
  onNewDeal,
}: {
  negocios: LeadCardDeal[];
  onOpenDeal: (id: string) => void;
  onNewDeal: () => void;
}) {
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const abertos = negocios.filter((d) => d.estado === "aberto");
  const fechados = negocios.filter((d) => d.estado !== "aberto");
  const ganhos = fechados.filter((d) => d.estado === "ganho");
  const somaGanha = ganhos.reduce((s, d) => s + d.valor, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        {/* Sem título: a aba acima já diz "Negócios". Repetir o rótulo a 40px
            de distância é ruído, não hierarquia. */}
        <p className="text-[11.5px] text-muted-foreground">
          {abertos.length > 0
            ? `${abertos.length} em andamento — clique para abrir o negócio`
            : "Nenhum negócio em andamento"}
        </p>
        <button
          type="button"
          onClick={onNewDeal}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-primary",
            "transition-colors hover:bg-primary/10",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Plus className="size-3.5" />
          Criar negócio
        </button>
      </div>

      {abertos.length > 0 ? (
        <div className="flex flex-col gap-2">
          {abertos.map((d) => (
            <LinhaAberta key={d.id} deal={d} onOpen={onOpenDeal} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground">
          Sem negócio aberto
        </div>
      )}

      {fechados.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setHistoricoAberto((v) => !v)}
            aria-expanded={historicoAberto}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px]",
              "transition-colors hover:border-muted-foreground/35 hover:bg-muted/30",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Trophy className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            <span className="text-muted-foreground">
              {ganhos.length > 0 && (
                <>
                  <span className="font-medium text-success">
                    {ganhos.length} fechado{ganhos.length > 1 ? "s" : ""}
                  </span>
                  {somaGanha > 0 && (
                    <span className="font-semibold tabular-nums text-success">
                      {" · "}
                      {formatBRL(somaGanha)}
                    </span>
                  )}
                </>
              )}
              {ganhos.length > 0 && fechados.length > ganhos.length && " · "}
              {fechados.length > ganhos.length && `${fechados.length - ganhos.length} perdido`}
            </span>
            <ChevronRight
              className={cn(
                "ml-auto size-3.5 text-muted-foreground/60 transition-transform",
                historicoAberto && "rotate-90",
              )}
            />
          </button>

          {historicoAberto && (
            <div className="flex flex-col gap-1.5 pl-1">
              {fechados.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpenDeal(d.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px]",
                    "transition-colors hover:bg-muted/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {d.estado === "ganho" ? (
                    <Trophy className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <XCircle
                      className="size-3.5 shrink-0 text-muted-foreground/70"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.titulo}</span>
                  {d.valor > 0 && (
                    <span
                      className={cn(
                        "shrink-0 font-medium tabular-nums",
                        d.estado === "ganho" ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {formatBRL(d.valor)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
