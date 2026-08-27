import { useState } from "react";
import { ChevronRight, Layers, Plus, ShoppingCart, Trophy, XCircle } from "lucide-react";
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

/**
 * Dois Negócios ABERTOS no mesmo funil.
 *
 * O modelo autoriza — é assim que recompra se representa (ADR-0023 decisão 2) —
 * e a API cria sem barrar, devolvendo `warning.code`. Mas o caso comum não é
 * recompra: é a mesma pessoa preenchendo o mesmo anúncio duas vezes. Sem esta
 * marca o vendedor trabalha a mesma venda duas vezes achando que são duas.
 *
 * Medido em produção em 2026-08-23, logo após o backfill: ZERO Leads nessa
 * situação. É capacidade nova, e a primeira vez que acontecer alguém precisa
 * perceber — por isso a marca fica na LINHA, e não num contador no topo: assim
 * ela aponta QUAIS são o par, não só que existe um.
 *
 * Âmbar e não vermelho de propósito: não é erro, é coincidência que merece um
 * olhar. Vermelho aqui treinaria o vendedor a ignorar vermelho.
 */
function MarcaDuplicado({ quantos, funil }: { quantos: number; funil: string }) {
  return (
    <span
      data-testid="negocio-duplicado-no-funil"
      title={`Este lead tem ${quantos} negócios abertos em ${funil} ao mesmo tempo. Pode ser recompra — ou o mesmo formulário preenchido duas vezes.`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5",
        "border border-amber-500/30 bg-amber-500/10 text-amber-500",
        "text-[10.5px] font-medium leading-none",
      )}
    >
      <Layers className="size-3" aria-hidden />
      {quantos} neste funil
    </span>
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

function LinhaAberta({
  deal,
  onOpen,
  atual,
  abertosNoFunil,
}: {
  deal: LeadCardDeal;
  onOpen: (id: string) => void;
  atual?: boolean;
  /** Quantos negócios ABERTOS este lead tem no mesmo funil deste aqui. */
  abertosNoFunil: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(deal.id)}
      aria-current={atual ? "true" : undefined}
      className={cn(
        "group flex w-full flex-col gap-2.5 rounded-lg border bg-card px-3 py-3 text-left",
        "transition-[border-color,box-shadow] hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        atual
          ? "border-primary/45 bg-primary/[0.05]"
          : "border-border hover:border-muted-foreground/35",
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
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{deal.titulo}</span>
            {/* Sem esta marca, a lista mostra o negócio que já está aberto como
                se fosse outro, e clicar nele parece não fazer nada. */}
            {atual && (
              <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                este
              </span>
            )}
            {/* Ao lado do título, e não no rodapé da linha: é onde o olho cai
                primeiro, e o ponto é justamente ser visto sem procurar. */}
            {abertosNoFunil > 1 && (
              <MarcaDuplicado quantos={abertosNoFunil} funil={deal.funil} />
            )}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {/* Valor só quando existe: a maioria da qualificação não tem
                `sale_value`, e "R$ 0,00" em toda linha esconde o que importa. */}
            {deal.valor > 0 ? formatBRL(deal.valor) : "sem valor lançado"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/45 transition-transform group-hover:translate-x-0.5" />
      </div>

      {/* ── O QUE ESTÁ SENDO VENDIDO ────────────────────────────────────────
          A lista de negócios dizia onde cada um está e quanto vale, e nunca o
          QUÊ. "Proposta de ago/2026 · R$ 12.400,00" não responde a pergunta que
          faz alguém abrir a ficha da pessoa antes de ligar para ela.

          Fica aqui, e não numa seção "Produtos do lead" separada, porque
          produto pertence ao NEGÓCIO: dois negócios abertos do mesmo lead
          costumam ter produtos diferentes, e uma lista única somaria coisas de
          vendas diferentes num total que não existe.

          ⚠ Leitura pura, e continua sendo: editar produto é do painel do
          negócio, a um clique daqui. */}
      {deal.produtos.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/25 px-2.5 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Produtos deste negócio
          </span>
          {deal.produtos.map((p, i) => (
            <span key={`${p.nome}-${i}`} className="flex items-baseline gap-2 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate text-foreground/85" title={p.nome}>
                {p.nome}
                {p.avulso && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground/70">avulso</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {p.quantidade} × {formatBRL(p.precoUnitario, 2)}
              </span>
              <span className="shrink-0 tabular-nums font-medium">{formatBRL(p.total, 2)}</span>
            </span>
          ))}
        </div>
      )}

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
  atual,
}: {
  negocios: LeadCardDeal[];
  onOpenDeal: (id: string) => void;
  onNewDeal: () => void;
  /**
   * O negócio que já está aberto na tela, quando esta lista é montada DENTRO de
   * um painel de negócio. No card do Lead não há "atual" e a prop fica vazia.
   */
  atual?: string;
}) {
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const abertos = negocios.filter((d) => d.estado === "aberto");

  // Só ABERTOS contam. Um ganho e um aberto no mesmo funil é o cliente que
  // voltou — exatamente o que o modelo existe para representar. Marcar isso
  // transformaria a feature em alarme falso permanente.
  const abertosPorFunil = new Map<string, number>();
  for (const d of abertos) abertosPorFunil.set(d.funil, (abertosPorFunil.get(d.funil) ?? 0) + 1);
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
            <LinhaAberta
              key={d.id}
              deal={d}
              onOpen={onOpenDeal}
              atual={d.id === atual}
              abertosNoFunil={abertosPorFunil.get(d.funil) ?? 1}
            />
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
