import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUfHeatmap, useLeadsByUf, type UfHeatmapRow } from "@/modules/analytics/hooks/useUfMap";
import { UF_NAMES } from "@/shared/format/br-uf";
import brazilSvg from "@/assets/brazil-states.svg?raw";

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}K`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/** Escala de calor gold — curva côncava realça a cauda (pouco valor ainda acende). */
function heatColor(value: number, max: number): string {
  if (!value || max <= 0) return "hsl(35 8% 16%)";
  const t = Math.pow(value / max, 0.55);
  if (t < 0.25) return "hsl(46 40% 24%)";
  if (t < 0.45) return "hsl(46 55% 30%)";
  if (t < 0.65) return "hsl(46 75% 38%)";
  if (t < 0.85) return "hsl(46 92% 46%)";
  return "hsl(47 100% 52%)";
}

interface TooltipState {
  uf: string;
  count: number;
  sold: number;
  x: number;
  y: number;
}

/**
 * Aba Mapa — choropleth do Brasil (base inteira da org, independente do mês).
 * Clique num estado abre o drawer com leads/clientes/vendido daquele UF.
 */
function TabMapaBase() {
  const navigate = useNavigate();
  const { data: heatmap, isLoading } = useUfHeatmap();
  const [selectedUf, setSelectedUf] = useState<string | null>(null);
  const { data: ufLeads, isLoading: leadsLoading } = useLeadsByUf(selectedUf);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  // V5: o mapa pinta por RECEITA (o RPC já traz `total_sold`) e mostra os leads
  // no balão. Base sem venda nenhuma volta a pintar por leads — mapa todo
  // cinza não diria nada.
  const { byUf, maxValue, porReceita, totalMapped, unmapped, ranked } = useMemo(() => {
    const byUf = new Map<string, UfHeatmapRow>();
    for (const row of heatmap ?? []) byUf.set(row.uf.trim(), row);
    const rows = [...byUf.values()];
    const counts = rows.map((r) => Number(r.leads_count));
    const sold = rows.map((r) => Number(r.total_sold));
    const maxSold = sold.length ? Math.max(...sold) : 0;
    const porReceita = maxSold > 0;
    const valor = (r: UfHeatmapRow) => (porReceita ? Number(r.total_sold) : Number(r.leads_count));
    const maxValue = porReceita ? maxSold : counts.length ? Math.max(...counts) : 0;
    const totalMapped = counts.reduce((a, b) => a + b, 0);
    const unmapped = heatmap?.[0] ? Number(heatmap[0].unmapped_count) : 0;
    const ranked = [...byUf.entries()].sort((a, b) => valor(b[1]) - valor(a[1]));
    return { byUf, maxValue, porReceita, totalMapped, unmapped, ranked };
  }, [heatmap]);

  // Pinta e liga interação nos paths do SVG injetado
  useEffect(() => {
    const host = mapRef.current;
    if (!host || isLoading) return;
    const svg = host.querySelector("svg");
    if (!svg) return;
    svg.removeAttribute("fill");
    const paths = svg.querySelectorAll<SVGPathElement>("path[id^='BR']");
    const cleanups: Array<() => void> = [];
    paths.forEach((path) => {
      const uf = path.id.replace("BR", "");
      const row = byUf.get(uf);
      const count = Number(row?.leads_count ?? 0);
      const sold = Number(row?.total_sold ?? 0);
      path.setAttribute("fill", heatColor(porReceita ? sold : count, maxValue));
      path.classList.toggle("uf-sel", uf === selectedUf);
      const enter = () => setTooltip({ uf, count, sold, x: 0, y: 0 });
      const move = (e: MouseEvent) => {
        const rect = host.getBoundingClientRect();
        setTooltip({ uf, count, sold, x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 12 });
      };
      const leave = () => setTooltip(null);
      const click = () => setSelectedUf(uf);
      path.addEventListener("mouseenter", enter);
      path.addEventListener("mousemove", move);
      path.addEventListener("mouseleave", leave);
      path.addEventListener("click", click);
      cleanups.push(() => {
        path.removeEventListener("mouseenter", enter);
        path.removeEventListener("mousemove", move);
        path.removeEventListener("mouseleave", leave);
        path.removeEventListener("click", click);
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, [byUf, maxValue, porReceita, selectedUf, isLoading]);

  const selectedRow = selectedUf ? byUf.get(selectedUf) : null;
  const selectedRank = selectedUf ? ranked.findIndex(([uf]) => uf === selectedUf) + 1 : 0;

  if (isLoading) {
    return <Skeleton className="h-full min-h-[320px] rounded-2xl" />;
  }

  return (
    // Corpo da janela "Mapa de clientes" — o título mora na moldura. O mapa
    // fica numa superfície de tinta: a paleta do coroplético e o traço dos
    // estados (`.tabmapa-svg`, index.css) foram desenhados para fundo escuro,
    // e assim leem igual nos dois temas.
    <div className={`grid h-full min-h-0 gap-4 ${selectedUf ? "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"}`}>
      {/* Mapa */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            base completa, independente do mês · cor por {porReceita ? "receita" : "leads"} · clique num estado pra ver os leads
          </p>
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-primary-soft-foreground">
            {totalMapped.toLocaleString("pt-BR")} leads mapeados
          </span>
        </div>

        <div className="mt-3 flex shrink-0 flex-col rounded-2xl bg-tinta px-4 pb-4 pt-5 text-tinta-foreground">
          <div ref={mapRef} className="tabmapa-svg relative mx-auto flex w-full max-w-[500px] justify-center">
            <div dangerouslySetInnerHTML={{ __html: brazilSvg.substring(brazilSvg.indexOf("<svg")) }} />
            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl border border-tinta-line bg-tinta-3 px-3 py-2 text-tinta-foreground shadow-relevo-tinta"
                style={{ left: tooltip.x, top: tooltip.y }}
              >
                <b className="block text-[13px]">
                  {UF_NAMES[tooltip.uf] ?? tooltip.uf}
                  {porReceita ? ` · ${formatK(tooltip.sold)} vendido` : ""}
                </b>
                <span className="text-[11px] text-tinta-muted">
                  {tooltip.count} lead{tooltip.count === 1 ? "" : "s"} · clique pra ver o relatório
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2.5 text-[11px] font-semibold text-tinta-muted">
            <span>{porReceita ? "menos receita" : "menos leads"}</span>
            <span className="flex gap-[3px]">
              {["hsl(35 8% 18%)", "hsl(46 45% 26%)", "hsl(46 70% 34%)", "hsl(46 90% 44%)", "hsl(47 100% 52%)"].map((c) => (
                <i key={c} className="h-2.5 w-5 rounded-[3px]" style={{ background: c }} />
              ))}
            </span>
            <span>{porReceita ? "mais receita" : "mais leads"}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] font-semibold text-muted-foreground">
          <span>Estado vem da resposta do lead ou do DDD do telefone</span>
          <span><b className="text-foreground">{unmapped.toLocaleString("pt-BR")} leads</b> sem estado identificado</span>
        </div>
      </div>

      {/* Drawer do estado */}
      {selectedUf && (
        <div className="cmd-rise flex min-h-0 flex-col overflow-hidden rounded-2xl bg-sunken">
          <div className="border-b border-border/60 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-[16px] font-extrabold text-primary-foreground shadow-brilho-ouro">
                {selectedUf}
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-[17px] font-extrabold tracking-[-0.03em]">{UF_NAMES[selectedUf] ?? selectedUf}</h3>
                {selectedRank > 0 && (
                  <div className="text-xs font-semibold text-muted-foreground">{selectedRank}º estado da sua base</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedUf(null)}
                className="ml-auto grid h-8 w-8 shrink-0 place-items-center self-start rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2">
              <div className="min-w-0 rounded-xl bg-card px-1.5 py-2 text-center">
                <b className="block truncate text-[16px] font-extrabold tracking-[-0.03em] tabular-nums">{Number(selectedRow?.leads_count ?? 0)}</b>
                <span className="text-[10px] font-bold uppercase tracking-[.06em] text-muted-foreground">Leads</span>
              </div>
              <div className="min-w-0 rounded-xl bg-card px-1.5 py-2 text-center">
                <b className="block truncate text-[16px] font-extrabold tracking-[-0.03em] text-success tabular-nums">{Number(selectedRow?.clients_count ?? 0)}</b>
                <span className="text-[10px] font-bold uppercase tracking-[.06em] text-muted-foreground">Clientes</span>
              </div>
              <div className="min-w-0 rounded-xl bg-card px-1.5 py-2 text-center">
                <b className="block truncate text-[16px] font-extrabold tracking-[-0.03em] text-primary-soft-foreground tabular-nums">{formatK(Number(selectedRow?.total_sold ?? 0))}</b>
                <span className="text-[10px] font-bold uppercase tracking-[.06em] text-muted-foreground">Vendido</span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {leadsLoading && <Skeleton className="h-40 rounded-xl" />}
            {!leadsLoading && (ufLeads ?? []).length === 0 && (
              <p className="py-8 text-center text-[13px] text-muted-foreground">Nenhum lead neste estado.</p>
            )}
            {(ufLeads ?? []).map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => navigate(`/leads?lead=${lead.id}`)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-card"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold">{lead.name}</span>
                  <span className="mt-[1px] flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    {lead.company && <span className="truncate">{lead.company}</span>}
                    {lead.uf_source === "ddd" && (
                      <span className="rounded border border-border px-1 text-[9px] font-bold uppercase tracking-[.04em] text-muted-foreground">via DDD</span>
                    )}
                  </span>
                </span>
                {lead.is_client ? (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.03em] text-success">
                    Cliente{Number(lead.sold_value) > 0 ? ` · ${formatK(Number(lead.sold_value))}` : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.03em] text-muted-foreground">Lead</span>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-border/60 p-3">
            <Button className="w-full" onClick={() => navigate(`/leads?uf=${selectedUf}`)}>
              Abrir os {Number(selectedRow?.leads_count ?? 0)} em Leads →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export const TabMapa = memo(TabMapaBase);
