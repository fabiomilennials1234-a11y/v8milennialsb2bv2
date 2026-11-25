import { useLayoutEffect, useRef } from "react";
import { Check, Clock, Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealCardMove, DealCardStage } from "./types";

/**
 * A trilha do funil no formato do print — círculo por etapa, ligado por linha,
 * com o nome e **a data em que o negócio entrou nela** embaixo.
 *
 * ── A DATA NÃO É ENFEITE: ELA JÁ EXISTIA E NINGUÉM VIA ────────────────────
 * `pipeline_stage_events` tem 49.739 linhas em prod e não aparecia em tela
 * nenhuma a não ser como lista de movimentação. A mesma linha que diz "foi de
 * Abordado para Respondeu" diz **quando** — então cada casa da régua pode
 * carimbar a sua data sem uma consulta a mais. Casa nunca visitada mostra um
 * traço, que é a informação oposta e igualmente útil: por aqui não passou.
 *
 * ── POR QUE AS ETAPAS TERMINAIS VOLTARAM PARA A RÉGUA ─────────────────────
 * A versão anterior deixava Vendido e Perdido FORA, com o argumento de que
 * ganhar e perder são saídas, não a última casa do caminho — e de que
 * misturá-las sugere que perder é o fim natural de quem não avançou.
 * O print do DataCrazy as coloca na régua (Novo … Vendido · Futuro · Perdido),
 * e a régua igual à dele é o pedido. O risco de leitura fica desarmado pela
 * COR, não pela ausência: as terminais vêm depois de um vão, verde para ganho
 * e vermelho para perda, e nunca herdam a cor do funil — não parecem
 * continuação, parecem porta de saída.
 */

/** Data de entrada em cada etapa, a partir da movimentação já carregada. */
function datasPorEtapa(movimentacoes: DealCardMove[]): Map<string, string> {
  const datas = new Map<string, string>();
  // `movimentacoes` chega em ordem decrescente (a mais nova primeiro), então a
  // PRIMEIRA ocorrência de cada destino é a entrada mais recente naquela etapa.
  // É a leitura certa para quem voltou de etapa: vale a última passagem.
  for (const m of movimentacoes) {
    if (!m.paraChave) continue;
    if (!datas.has(m.paraChave)) datas.set(m.paraChave, m.quando);
  }
  return datas;
}

function dataCurta(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function Casa({
  etapa,
  estado,
  cor,
  data,
  onMover,
  bloqueado,
  emTransito,
  fixa,
  ouro,
}: {
  etapa: DealCardStage;
  estado: "passou" | "aqui" | "futuro";
  cor: string;
  data: string | null;
  onMover?: (chave: string) => void;
  bloqueado: boolean;
  emTransito: boolean;
  /**
   * Largura travada em vez de `flex-1`.
   *
   * As casas terminais vivem num container `shrink-0`, e ali `flex-1` cai para
   * o `min-content` do texto — foi o que truncou "Vendido" em "Vendi…" na
   * primeira foto da bancada. 84px é o que "Vendido" e "Confirmando" pedem em
   * 11,5px sem reticências.
   */
  fixa?: boolean;
  /** Sobre o cartão de ouro: monocromática em tinta, como a jornada do mockup. */
  ouro?: boolean;
}) {
  const ganho = etapa.papel === "ganho";
  const perdido = etapa.papel === "perdido";
  const terminal = ganho || perdido;
  const aceso = estado !== "futuro";

  // Terminal NUNCA usa a cor do funil: verde é chegada, vermelho é saída.
  // Herdar a cor do funil aqui é o que faria "Perdido" parecer mais uma casa.
  const tinta = terminal ? (ganho ? "hsl(var(--success))" : "hsl(var(--destructive))") : cor;

  const Icone = terminal ? (ganho ? Trophy : X) : estado === "passou" ? Check : Clock;
  const movivel = !!onMover && estado !== "aqui" && !bloqueado;

  if (ouro) {
    // Sobre o ouro a cor do funil vira ruído (roxo e azul em cima de amarelo).
    // A régua fica em tinta: cheia por onde passou, anel onde está, vazada no
    // futuro. Ganho e perda continuam distintos pelo ícone e pelo vão antes
    // deles — não pela cor, que aqui não existe.
    return (
      <button
        type="button"
        disabled={!onMover || estado === "aqui" || bloqueado}
        onClick={() => onMover?.(etapa.chave)}
        title={estado === "aqui" ? etapa.nome : `Mover para ${etapa.nome}`}
        data-aqui={estado === "aqui" || undefined}
        className={cn(
          "group flex flex-col items-center gap-1.5 rounded pt-0.5",
          fixa ? "w-[76px] shrink-0" : "min-w-0 flex-1",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/60",
          movivel ? "cursor-pointer" : "cursor-default",
          emTransito && "animate-pulse",
        )}
      >
        <span
          className={cn(
            "flex size-[28px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            estado === "passou" && "border-primary-foreground bg-primary-foreground text-primary",
            estado === "aqui" &&
              "border-primary-foreground bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary-foreground)/0.14)]",
            estado === "futuro" && "border-primary-foreground/25 text-primary-foreground/45",
            movivel && estado === "futuro" && "group-hover:border-primary-foreground/60 group-hover:text-primary-foreground",
          )}
          aria-hidden="true"
        >
          <Icone className="size-[13px]" />
        </span>
        <span
          className={cn(
            "line-clamp-2 max-w-full break-words text-center text-[11px] leading-tight",
            estado === "aqui" ? "font-bold text-primary-foreground" : "font-medium text-primary-foreground/65",
            movivel && "group-hover:text-primary-foreground",
          )}
        >
          {etapa.nome}
        </span>
        <span className={cn("text-[10px] tabular-nums leading-none", data ? "text-primary-foreground/60" : "text-primary-foreground/30")}>
          {data ?? "—"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={!onMover || estado === "aqui" || bloqueado}
      onClick={() => onMover?.(etapa.chave)}
      title={estado === "aqui" ? etapa.nome : `Mover para ${etapa.nome}`}
      data-aqui={estado === "aqui" || undefined}
      className={cn(
        "group flex flex-col items-center gap-1.5 rounded pt-0.5",
        fixa ? "w-[84px] shrink-0" : "min-w-0 flex-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        onMover && estado !== "aqui" && !bloqueado ? "cursor-pointer" : "cursor-default",
        emTransito && "animate-pulse",
      )}
    >
      <span
        className={cn(
          "flex size-[30px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          aceso ? "" : "border-border bg-muted/40 text-muted-foreground/60",
          onMover && estado !== "aqui" && !bloqueado && !aceso && "group-hover:border-muted-foreground/50",
        )}
        style={
          aceso
            ? {
                borderColor: tinta,
                color: tinta,
                // O anel externo marca ONDE ELE ESTÁ sem trocar a forma da casa:
                // trocar o desenho da casa atual faria a régua perder o ritmo.
                background: `color-mix(in srgb, ${tinta} 14%, transparent)`,
                boxShadow: estado === "aqui" ? `0 0 0 3px color-mix(in srgb, ${tinta} 22%, transparent)` : undefined,
              }
            : undefined
        }
        aria-hidden="true"
      >
        <Icone className="size-[13px]" />
      </span>

      <span
        className={cn(
          "line-clamp-2 max-w-full break-words text-center text-[11.5px] leading-tight transition-colors",
          estado === "aqui" ? "font-semibold text-foreground" : "text-muted-foreground",
          onMover && estado !== "aqui" && !bloqueado && "group-hover:text-foreground",
        )}
      >
        {etapa.nome}
      </span>

      {/* O traço é dado, não vazio decorativo: diz "por aqui não passou". */}
      <span
        className={cn(
          "text-[10.5px] tabular-nums leading-none",
          data ? "text-muted-foreground/75" : "text-muted-foreground/35",
        )}
      >
        {data ?? "—"}
      </span>
    </button>
  );
}

/**
 * Piso de largura de cada casa aberta, em px.
 *
 * ── POR QUE O PISO MORA NO CONTAINER, NÃO NA CASA ─────────────────────────
 * Antes o piso era `min-w-[64px]` na casa e o container das abertas era
 * `min-w-0 flex-1` (a partir de `sm`). Com funil comprido (Improving: dez
 * abertas) o container encolhia abaixo de 10 × 64 px, as casas transbordavam
 * dele e duas coisas quebravam juntas: a linha — calculada em % do container —
 * parava no meio da régua, e as terminais, posicionadas logo depois do
 * container encolhido, caíam POR CIMA das últimas abertas ("Perda" sobre
 * "Negociação"). Travar o mínimo no próprio container faz a régua inteira
 * ficar mais larga que o cartão quando precisa — e aí ela rola, como já
 * rolava no celular — em vez de se sobrepor.
 */
const PISO_CASA = { ouro: 72, cartao: 76 } as const;

export function DealCardStages({
  etapas,
  atual,
  cor,
  movimentacoes = [],
  onMover,
  movendo,
  tom = "cartao",
}: {
  etapas: DealCardStage[];
  atual: string;
  cor: string;
  /** Movimentação da entry — é dela que sai a data embaixo de cada casa. */
  movimentacoes?: DealCardMove[];
  /** Move o negócio para a etapa. Sem ela a trilha só informa. */
  onMover?: (chave: string) => void;
  /** Chave em trânsito — desabilita a trilha inteira enquanto grava. */
  movendo?: string | null;
  /** `ouro`: a régua mora no cartão de ouro do negócio (V5). */
  tom?: "cartao" | "ouro";
}) {
  const ouro = tom === "ouro";
  const abertas = etapas.filter((e) => e.papel === "aberto");
  const terminais = etapas.filter((e) => e.papel !== "aberto");
  const datas = datasPorEtapa(movimentacoes);
  // Pela chave de LEITURA: `atual` vem de `pipeline_entries.stage_key`, que em
  // funil custom é o slug, nunca o uuid que `chave` carrega.
  const indiceAtual = abertas.findIndex((e) => e.chaveEntry === atual);
  const bloqueado = !!movendo;
  const trilhoRef = useRef<HTMLDivElement>(null);

  // Régua que rola esconde a etapa atual se ela estiver no fim. Centraliza a
  // casa atual na faixa visível — só na horizontal, mexendo no `scrollLeft`
  // do próprio trilho (scrollIntoView arrastaria o modal junto).
  useLayoutEffect(() => {
    const trilho = trilhoRef.current;
    if (!trilho || trilho.scrollWidth <= trilho.clientWidth) return;
    const aqui = trilho.querySelector<HTMLElement>("[data-aqui]");
    if (!aqui) return;
    // Retângulos, não `offsetLeft`: o container das abertas é `relative` e
    // vira o offsetParent da casa, então offsetLeft não mede contra o trilho.
    const r = aqui.getBoundingClientRect();
    const t = trilho.getBoundingClientRect();
    const centro = r.left - t.left + trilho.scrollLeft + r.width / 2;
    trilho.scrollLeft = Math.max(0, centro - trilho.clientWidth / 2);
  }, [atual, etapas.length]);

  if (etapas.length === 0) {
    return (
      <p
        className={cn(
          "rounded-lg border border-dashed py-5 text-center text-[12.5px]",
          ouro ? "border-primary-foreground/25 text-primary-foreground/70" : "border-border text-muted-foreground",
        )}
      >
        Este funil não tem etapas ativas.
      </p>
    );
  }

  const casa = (etapa: DealCardStage, estado: "passou" | "aqui" | "futuro", fixa?: boolean) => (
    <Casa
      key={etapa.chave}
      etapa={etapa}
      estado={estado}
      cor={cor}
      data={dataCurta(datas.get(etapa.chaveEntry))}
      onMover={onMover}
      bloqueado={bloqueado}
      emTransito={movendo === etapa.chave}
      fixa={fixa}
      ouro={ouro}
    />
  );

  // Quando as casas não cabem no cartão (celular, ou funil com muitas etapas)
  // a régua ROLA na horizontal em vez de espremer até virar textura ou
  // sobrepor casas: o piso de cada casa é garantido pelo `minWidth` do
  // container das abertas (ver `PISO_CASA`).
  return (
    <div ref={trilhoRef} className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin]">
    <div className="flex items-start">
      {/* A linha que liga as casas vive no CONTAINER, não em cada casa: assim
          ela não aparece antes da primeira nem depois da última, que é onde a
          régua costuma vazar.
          As pontas param no CENTRO do primeiro e do último círculo — metade de
          uma casa de cada lado. Com um recuo fixo (era 12%) a conta só fechava
          para quatro casas: em sete, a linha começava depois do primeiro
          círculo e deixava um vão solto antes dele. */}
      <div
        className="relative flex flex-1 items-start"
        style={{ minWidth: abertas.length * PISO_CASA[tom] }}
      >
        <span
          className={cn(
            "pointer-events-none absolute h-px",
            ouro ? "top-[14px] bg-primary-foreground/25" : "top-[15px] bg-border",
          )}
          style={{
            left: `${50 / Math.max(1, abertas.length)}%`,
            right: `${50 / Math.max(1, abertas.length)}%`,
          }}
          aria-hidden="true"
        />
        {abertas.map((e, i) =>
          casa(e, i === indiceAtual ? "aqui" : indiceAtual >= 0 && i < indiceAtual ? "passou" : "futuro"),
        )}
      </div>

      {terminais.length > 0 && (
        <>
          {/* O vão é o argumento: as saídas não são a continuação do caminho. */}
          <span
            className={cn("mx-2 mt-[3px] h-6 w-px shrink-0", ouro ? "bg-primary-foreground/25" : "bg-border")}
            aria-hidden="true"
          />
          <div className="flex shrink-0 items-start">
            {terminais.map((e) => casa(e, e.chaveEntry === atual ? "aqui" : "futuro", true))}
          </div>
        </>
      )}
    </div>
    </div>
  );
}
