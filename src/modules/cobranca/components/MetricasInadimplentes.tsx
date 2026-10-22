import { CalendarClock, PhoneOff, Receipt, TrendingUp, X } from "lucide-react";
import type { KeyboardEvent } from "react";

import { KpiRow, KpiTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";

import { reaisCompacto, plural } from "../lib/formato";
import type { MetricasDaCobranca } from "../lib/tipos";

/**
 * Os quatro números da tela de Inadimplentes (KpiTile V5, como Leads).
 * Fonte única: a RPC `cobranca_metricas` — nada daqui soma em métrica de venda.
 *
 * A barra do primeiro cartão é a carteira por faixa de atraso (30/60/90); o
 * último cartão é controle, como em Leads: clicar filtra quem está sem contato.
 */
const FAIXAS: { chave: keyof MetricasDaCobranca["faixas"]; rotulo: string; cor: string }[] = [
  { chave: "ate30", rotulo: "1–30 d", cor: "bg-insights" },
  { chave: "ate60", rotulo: "31–60 d", cor: "bg-warning" },
  { chave: "ate90", rotulo: "61–90 d", cor: "bg-destructive/60" },
  { chave: "acima90", rotulo: "90+ d", cor: "bg-destructive" },
];

export function MetricasInadimplentes({
  m,
  carregando,
  semContatoAtivo,
  onSemContato,
}: {
  m: MetricasDaCobranca | undefined;
  carregando: boolean;
  semContatoAtivo: boolean;
  onSemContato: () => void;
}) {
  const totalFaixas = m ? FAIXAS.reduce((s, f) => s + m.faixas[f.chave], 0) : 0;
  const delta =
    m && m.recuperadoMesAnterior > 0
      ? ((m.recuperadoMes - m.recuperadoMesAnterior) / m.recuperadoMesAnterior) * 100
      : undefined;
  const v = (x: string) => (carregando || !m ? "·" : x);

  return (
    <KpiRow cols={4}>
      <KpiTile
        label="Em aberto"
        value={v(reaisCompacto(m?.emAberto ?? 0))}
        icon={Receipt}
        tone="info"
        loading={carregando}
        note={m ? `${plural(m.casosAbertos, "caso", "casos")} · ${plural(m.titulosAbertos, "título", "títulos")}` : " "}
        className="lg:col-span-1"
      >
        {m && totalFaixas > 0 && (
          <div>
            <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Carteira por faixa de atraso">
              {FAIXAS.map((f) =>
                m.faixas[f.chave] > 0 ? (
                  <span key={f.chave} className={cn("h-full", f.cor)} style={{ flexGrow: m.faixas[f.chave] }} />
                ) : null,
              )}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px] tabular-nums text-muted-foreground">
              {FAIXAS.filter((f) => m.faixas[f.chave] > 0).map((f) => (
                <span key={f.chave} className="inline-flex items-center gap-1 whitespace-nowrap">
                  <span aria-hidden className={cn("size-1.5 rounded-[2px]", f.cor)} />
                  {f.rotulo} · {reaisCompacto(m.faixas[f.chave])}
                </span>
              ))}
            </div>
          </div>
        )}
      </KpiTile>

      <KpiTile
        label="Recuperado no mês"
        value={v(reaisCompacto(m?.recuperadoMes ?? 0))}
        icon={TrendingUp}
        tone="good"
        loading={carregando}
        delta={delta}
        deltaLabel="vs mês anterior"
        note={m ? plural(m.recuperadosMes, "caso quitado", "casos quitados") : " "}
      />

      <KpiTile
        label="Compromissos para hoje"
        value={v(String(m?.compromissosHoje ?? 0))}
        icon={CalendarClock}
        tone="gold"
        loading={carregando}
        note={m ? (m.compromissosHoje ? `${reaisCompacto(m.compromissosHojeValor)} prometidos` : "Nenhuma promessa ou parcela hoje") : " "}
      />

      <KpiTile
        label="Sem contato há 7+ dias"
        value={v(String(m?.semContato7d ?? 0))}
        icon={semContatoAtivo ? X : PhoneOff}
        tone={semContatoAtivo ? "gold" : m && m.semContato7d > 0 ? "bad" : "good"}
        loading={carregando}
        note={m ? (m.semContato7d ? `${reaisCompacto(m.semContato7dValor)} parados` : "Todos com contato recente") : " "}
        role="button"
        tabIndex={0}
        aria-pressed={semContatoAtivo}
        {...{ title: semContatoAtivo ? "Remover filtro" : "Filtrar quem está sem contato" }}
        onClick={onSemContato}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSemContato();
          }
        }}
        className={cn(
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          semContatoAtivo && "ring-2 ring-primary/70",
        )}
      />
    </KpiRow>
  );
}
