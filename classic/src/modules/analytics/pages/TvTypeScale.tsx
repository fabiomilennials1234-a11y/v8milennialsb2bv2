/**
 * Página de CALIBRAÇÃO da escala tipográfica da TV — issue #1223.
 *
 * Spec: docs/design-tv-composable-widgets.md §1 (pesos) e §2.2–2.3 (escala).
 *
 * POR QUE ESTA PÁGINA EXISTE
 * --------------------------
 * Os cinco degraus da escala saíram de CÁLCULO (regra de sinalização:
 * altura de caractere ≈ distância ÷ 200), não de observação. É a única parte
 * da spec nessa condição, e quatro fatias (#1218–#1221) herdam esses valores.
 * Se a escala estiver errada, as quatro herdam errado e o sintoma só aparece
 * no fim. Isto aqui é o gate: renderiza os três pesos para julgamento ocular
 * na parede real, antes de qualquer widget de verdade ser construído.
 *
 * DELIBERADAMENTE SEM DADO REAL. Se 36px lê ou não a 3 metros não depende de
 * o número ser verdadeiro. Todos os valores abaixo são estáticos e fictícios —
 * nenhum hook, nenhuma query, nenhum seed. Rota isolada, fora da /tv.
 *
 * Esta página é um instrumento de medição, não uma tela de produto. Quando as
 * quatro fatias dependentes fecharem, ela pode ser removida sem dó.
 */

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Degraus de degradação da linha de proveniência, do mais completo ao mais
 * enxuto. O TIPO DE ÂNCORA nunca some — é o que responde "de onde veio este
 * número", e um widget sem isso é um número sem procedência.
 *
 * A escada existe porque a largura disponível não é conhecível em tempo de
 * escrita: depende de resolução, gap e padding. Ver `Provenance`.
 */
/**
 * Tabela de âncoras (spec §4.2), aqui para que ninguém tenha que ir buscar:
 *
 *   entradas    → leads criados, reuniões MARCADAS
 *   fechamentos → receita, nº de vendas, reuniões REALIZADAS
 *   hoje        → retrato de estado (propostas abertas, leads sem contato)
 *
 * Marcada é entrada; realizada é fechamento. É fácil trocar — e trocaram nesta
 * própria amostra, ver o card de "Reuniões realizadas".
 *
 * PERÍODO só acompanha âncora de FLUXO (entradas, fechamentos). Âncora de
 * RETRATO não leva período: "base: hoje · jul" é contradição, porque o retrato
 * é de agora e o "quando" já está na própria âncora.
 */
function provenanceLadder(anchor: string, period?: string): string[] {
  const rungs = [
    period ? `⌖ base: ${anchor} · ${period}` : `⌖ base: ${anchor}`,
    // Encurta o período se ele for longo ("julho de 2026" → "jul/26").
    // No-op quando já vem abreviado, como nesta amostra.
    period ? `⌖ base: ${anchor} · ${abbreviatePeriod(period)}` : `⌖ base: ${anchor}`,
    // Solta o "base:" — redundante quando o glifo ⌖ já marca a linha.
    period ? `⌖ ${anchor} · ${abbreviatePeriod(period)}` : `⌖ ${anchor}`,
    // Último degrau: só o tipo de âncora.
    `⌖ ${anchor}`,
  ];
  return [...new Set(rungs)];
}

function abbreviatePeriod(period: string): string {
  return period.replace(/\s+de\s+20(\d{2})$/i, "/$1");
}

/**
 * Linha de proveniência com AJUSTE MEDIDO, não limiar de layout.
 *
 * A primeira versão colapsava por contagem de célula ("widget < 2 células").
 * Isso furou: os cards secondary têm exatamente 2 células e mesmo assim a
 * linha quebrou em duas em 1920 — e NÃO quebrou em 4K. Contagem de célula é
 * procuração para largura, e procuração falha: a mesma célula tem largura
 * diferente por resolução, gap e padding.
 *
 * Aqui a largura é medida de fato (scrollWidth vs clientWidth com nowrap) e o
 * texto desce um degrau por vez até caber. `aria-label` carrega sempre a frase
 * completa, para que a degradação seja só visual.
 */
function Provenance({ anchor, period }: { anchor: string; period?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const ladder = provenanceLadder(anchor, period);
  const [rung, setRung] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Desce um degrau por passe. `rung` nas deps é o que fecha o ciclo: cada
    // incremento re-dispara a medição, e a guarda `rung < ladder.length - 1`
    // garante terminação em no máximo `ladder.length` passes.
    const overflowed = el.scrollWidth > el.clientWidth + 1;
    if (overflowed && rung < ladder.length - 1) setRung((r) => r + 1);
  }, [rung, ladder.length]);

  // Numa mudança de largura, volta ao topo da escada: o que não cabia em 1920
  // pode caber em 4K, e travar no degrau curto desperdiçaria espaço.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setRung(0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <p
      ref={ref}
      aria-label={ladder[0]}
      className="overflow-hidden tabular-nums text-muted-foreground"
      style={{
        fontSize: "var(--tv-meta)",
        letterSpacing: "0.01em",
        fontWeight: 450,
        whiteSpace: "nowrap", // load-bearing: sem isto scrollWidth nunca excede
        textOverflow: "clip",
      }}
    >
      {ladder[rung]}
    </p>
  );
}

/**
 * A casca compartilhada. Não é o `WidgetFrame` final da #1218 — é o mínimo
 * necessário para que os três pesos sejam julgados na mesma moldura, sem
 * introduzir decisões de anatomia que ainda não foram tomadas.
 */
function SampleFrame({
  eyebrow,
  anchor,
  period,
  children,
  className = "",
}: {
  eyebrow: string;
  anchor: string;
  period?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-border bg-card p-6 ${className}`}
    >
      {/* Eyebrow — a pergunta. Inter 600, +0.08em, uppercase (spec §2.3). */}
      <p
        className="font-semibold uppercase text-muted-foreground"
        style={{ fontSize: "var(--tv-label)", letterSpacing: "0.08em" }}
      >
        {eyebrow}
      </p>

      {/* Valor + delta + proveniência num ÚNICO bloco.
          Antes isto era `justify-between` com a proveniência colada no fundo
          da célula. No hero 6×3 aquilo abria ~40% de altura morta e a
          proveniência passava a ler como rodapé DA PÁGINA, não como
          procedência DAQUELE número (reprovado no review de design da #1223).
          O que amarra proveniência ao valor é PROXIMIDADE, então ela mora
          dentro do mesmo grupo. */}
      <div className="flex min-w-0 flex-col gap-2">
        {children}
        <Provenance anchor={anchor} period={period} />
      </div>
    </div>
  );
}

/**
 * Valor de cabeça. Inter 600 + tracking -0.03em + tabular-nums (spec §2.3).
 * Peso 600 e NÃO 700/800/900: em display grande sobre fundo escuro, peso alto
 * engrossa o traço e reduz legibilidade por sangramento óptico (halation).
 * Sem `font-display`: Space Grotesk tem numerais geométricos que sabotam a
 * leitura tabular a distância.
 */
function Value({
  token,
  children,
  gold = false,
}: {
  token: string;
  children: React.ReactNode;
  gold?: boolean;
}) {
  return (
    <p
      className={gold ? "tabular-nums" : "tabular-nums text-foreground"}
      style={{
        fontSize: `var(${token})`,
        fontWeight: 600,
        letterSpacing: "-0.03em",
        lineHeight: 1.05,
        // Gold é do HERO e só dele (spec §2.4: no máx. 1–2 por página). O
        // contraste com o creme dos demais é o que faz o gold significar
        // algo; se tudo fosse gold, nada seria. Primeira versão desta página
        // não tinha gold nenhum e foi reprovada por ausência de marca.
        ...(gold ? { color: "hsl(var(--primary))" } : null),
      }}
    >
      {children}
    </p>
  );
}

function Delta({ children, tone }: { children: React.ReactNode; tone: "up" | "down" }) {
  return (
    <span
      className="tabular-nums font-semibold"
      style={{
        fontSize: "var(--tv-value-sm)",
        color: tone === "up" ? "hsl(var(--success))" : "hsl(var(--destructive))",
        letterSpacing: "-0.02em",
      }}
    >
      {children}
    </span>
  );
}

export default function TvTypeScale() {
  return (
    <div
      data-surface="tv"
      className="min-h-screen bg-background p-8 text-foreground"
    >
      {/* Título da página — único lugar onde font-display entra (spec §2.3). */}
      <header className="mb-8">
        <h1
          className="font-display font-semibold text-foreground"
          style={{ fontSize: "var(--tv-value-sm)", letterSpacing: "-0.02em" }}
        >
          Calibração da escala tipográfica
        </h1>
        <p
          className="mt-1 text-muted-foreground"
          style={{ fontSize: "var(--tv-meta)" }}
        >
          #1223 · valores estáticos · julgar a 3 metros
        </p>
      </header>

      {/* Grid 12 col — mesmas proporções de célula da spec §1. */}
      <div className="grid grid-cols-12 gap-5">
        {/* ── hero · 6×2 · --tv-hero (56→192px) · máx 1 por página ──
            Foi 6×3 (vazio), depois 4×2 (supercorrigido), agora 6×2.
            O vazio vinha da terceira LINHA, não da largura — cortar largura
            junto foi consertar o sintoma errado. A 4 colunas o card tinha
            ~608px e "R$ 1,34 mi" a 96px já ocupava ~475px (85% da largura
            útil); um "R$ 123,4 mi", perfeitamente possível, estouraria.
            6×2 dá ~900px e resolve sem trazer o vazio de volta. */}
        <SampleFrame
          eyebrow="Receita no período"
          anchor="fechamentos"
          period="jul"
          className="col-span-6 row-span-2"
        >
          {/* Único gold da página (spec §2.4). */}
          <Value token="--tv-hero" gold>
            R$ 1,34 mi
          </Value>
          <Delta tone="up">↑ 18,2%</Delta>
        </SampleFrame>

        {/* ── primary · 3×2 · --tv-value (36→112px) ── */}
        <SampleFrame
          eyebrow="Ticket médio"
          anchor="fechamentos"
          period="jul"
          className="col-span-3 row-span-2"
        >
          <Value token="--tv-value">R$ 8.420</Value>
          <Delta tone="up">↑ 4,1%</Delta>
        </SampleFrame>

        {/* Reunião REALIZADA é fechamento, não entrada — marcada é que é
            entrada. Esta string estava errada e foi pega no review de design.
            O erro vale registrar porque é o caso de teste do #1205: eu tinha
            a tabela de âncoras à mão e ainda escolhi a errada. Enquanto a
            âncora for ESCOLHIDA por quem monta a tela, e não DERIVADA da
            medida dentro do motor, esse erro é reincidente por construção. */}
        <SampleFrame
          eyebrow="Reuniões realizadas"
          anchor="fechamentos"
          period="jul"
          className="col-span-3 row-span-2"
        >
          <Value token="--tv-value">127</Value>
          <Delta tone="down">↓ 6,8%</Delta>
        </SampleFrame>

        {/* ── secondary · 2 col · --tv-value-sm (24→72px) ──
            Seis, fechando as 12 colunas. Com três a fileira ficava pela
            metade, e foi justamente isso que ESCONDEU o defeito da
            proveniência: amostra pela metade testa metade. */}
        <SampleFrame eyebrow="Taxa de conversão" anchor="fechamentos" period="jul" className="col-span-2">
          <Value token="--tv-value-sm">23,4%</Value>
        </SampleFrame>

        <SampleFrame eyebrow="No-show" anchor="entradas" period="jul" className="col-span-2">
          <Value token="--tv-value-sm">11,9%</Value>
        </SampleFrame>

        <SampleFrame eyebrow="Ciclo médio" anchor="fechamentos" period="jul" className="col-span-2">
          <Value token="--tv-value-sm">18 dias</Value>
        </SampleFrame>

        <SampleFrame eyebrow="Propostas abertas" anchor="hoje" className="col-span-2">
          <Value token="--tv-value-sm">41</Value>
        </SampleFrame>

        <SampleFrame eyebrow="Leads sem contato" anchor="hoje" className="col-span-2">
          <Value token="--tv-value-sm">7</Value>
        </SampleFrame>

        <SampleFrame eyebrow="Reuniões amanhã" anchor="hoje" className="col-span-2">
          <Value token="--tv-value-sm">12</Value>
        </SampleFrame>

        {/* Régua dos cinco degraus — para julgar os saltos entre eles, que é
            o que a leitura a 3m realmente testa: se dois degraus vizinhos não
            se distinguem, a hierarquia não existe. */}
        <div className="col-span-12 rounded-xl border border-border bg-card p-6">
          <p
            className="mb-5 font-semibold uppercase text-muted-foreground"
            style={{ fontSize: "var(--tv-label)", letterSpacing: "0.08em" }}
          >
            Os cinco degraus, lado a lado
          </p>

          {[
            // Faixa completa: piso (janela) → @1920 (parede) → @3840.
            // O valor de 1920 é o que a spec calculou; o de 3840 é o dobro,
            // que é o que mantém o tamanho FÍSICO invariante entre densidades.
            ["--tv-hero", "hero", "56 · 96 · 192", "R$ 1,34 mi"],
            ["--tv-value", "value", "36 · 56 · 112", "R$ 8.420"],
            ["--tv-value-sm", "value-sm", "24 · 36 · 72", "23,4%"],
            ["--tv-label", "label", "12 · 16 · 32", "RECEITA POR CLOSER"],
            ["--tv-meta", "meta", "11 · 14 · 28", "⌖ base: fechamentos · jul"],
          ].map(([token, name, range, sample]) => (
            <div key={token} className="flex items-baseline gap-6 border-b border-border py-3 last:border-b-0">
              <code
                className="shrink-0 tabular-nums text-muted-foreground"
                style={{ fontSize: "var(--tv-meta)", width: "12ch" }}
              >
                {name}
              </code>
              <code
                className="shrink-0 tabular-nums text-muted-foreground"
                style={{ fontSize: "var(--tv-meta)", width: "14ch" }}
              >
                {range}
              </code>
              <span
                className="tabular-nums text-foreground"
                style={{
                  fontSize: `var(${token})`,
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.05,
                }}
              >
                {sample}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
