import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useUfHeatmap, useLeadsByUf, type UfHeatmapRow } from "@/modules/analytics/hooks/useUfMap";
import { UF_NAMES } from "@/shared/format/br-uf";
import brazilSvg from "@/assets/brazil-states.svg?raw";

function formatK(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)}K`;
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/** Escala de calor gold — curva côncava realça a cauda (poucos leads ainda acendem). */
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

  const { byUf, maxCount, totalMapped, unmapped, ranked } = useMemo(() => {
    const byUf = new Map<string, UfHeatmapRow>();
    for (const row of heatmap ?? []) byUf.set(row.uf.trim(), row);
    const counts = [...byUf.values()].map((r) => Number(r.leads_count));
    const maxCount = counts.length ? Math.max(...counts) : 0;
    const totalMapped = counts.reduce((a, b) => a + b, 0);
    const unmapped = heatmap?.[0] ? Number(heatmap[0].unmapped_count) : 0;
    const ranked = [...byUf.entries()].sort((a, b) => Number(b[1].leads_count) - Number(a[1].leads_count));
    return { byUf, maxCount, totalMapped, unmapped, ranked };
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
      const count = Number(byUf.get(uf)?.leads_count ?? 0);
      path.setAttribute("fill", heatColor(count, maxCount));
      path.classList.toggle("uf-sel", uf === selectedUf);
      const enter = () => setTooltip({ uf, count, x: 0, y: 0 });
      const move = (e: MouseEvent) => {
        const rect = host.getBoundingClientRect();
        setTooltip({ uf, count, x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 12 });
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
  }, [byUf, maxCount, selectedUf, isLoading]);

  const selectedRow = selectedUf ? byUf.get(selectedUf) : null;
  const selectedRank = selectedUf ? ranked.findIndex(([uf]) => uf === selectedUf) + 1 : 0;

  if (isLoading) {
    return (
      <div className="mt-3.5 grid grid-cols-[1fr_360px] gap-3.5">
        <Skeleton className="h-[620px] rounded-2xl" />
        <Skeleton className="h-[620px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className={`mt-3.5 grid gap-3.5 ${selectedUf ? "grid-cols-[1fr_360px]" : "grid-cols-1"}`}>
      {/* Mapa */}
      <div
        className="cmd-cell cmd-rise p-5"
        style={{ background: "radial-gradient(700px 420px at 35% 40%, hsl(var(--primary)/.05), transparent 70%), hsl(var(--card))" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="cmd-lbl">Mapa — onde está sua base</span>
            <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground/60">
              base completa, independente do mês · clique num estado pra ver os leads
            </div>
          </div>
          <span className="rounded-full bg-primary/15 px-[9px] py-[3px] text-[10.5px] font-extrabold text-primary tabular-nums">
            {totalMapped.toLocaleString("pt-BR")} leads mapeados
          </span>
        </div>

        <div ref={mapRef} className="tabmapa-svg relative mx-auto mt-3 flex max-w-[640px] justify-center">
          <div dangerouslySetInnerHTML={{ __html: brazilSvg.substring(brazilSvg.indexOf("<svg")) }} />
          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[10px] border border-border bg-[hsl(35_10%_15%)] px-3 py-2 shadow-[0_14px_34px_hsl(0_0%_0%/.55)]"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <b className="block text-[12.5px]">{UF_NAMES[tooltip.uf] ?? tooltip.uf} · {tooltip.count} lead{tooltip.count === 1 ? "" : "s"}</b>
              <span className="text-[11px] text-muted-foreground">clique pra ver o relatório</span>
            </div>
          )}
        </div>

        <div className="mt-3.5 flex items-center justify-center gap-2.5 text-[10.5px] font-semibold text-muted-foreground/60">
          <span>menos leads</span>
          <span className="flex gap-[3px]">
            {["hsl(35 8% 18%)", "hsl(46 45% 26%)", "hsl(46 70% 34%)", "hsl(46 90% 44%)", "hsl(47 100% 52%)"].map((c) => (
              <i key={c} className="h-2.5 w-5 rounded-[3px]" style={{ background: c }} />
            ))}
          </span>
          <span>mais leads</span>
        </div>
        <div className="mt-3.5 flex justify-between border-t border-border/70 pt-3 text-[11px] font-semibold text-muted-foreground/60">
          <span>Estado vem da resposta do lead ou do DDD do telefone</span>
          <span><b className="text-foreground">{unmapped.toLocaleString("pt-BR")} leads</b> sem estado identificado</span>
        </div>
      </div>

      {/* Drawer do estado */}
      {selectedUf && (
        <div className="cmd-rise flex flex-col overflow-hidden rounded-2xl border border-[hsl(47_60%_35%/.4)] bg-card shadow-[0_24px_60px_hsl(0_0%_0%/.45)]">
          <div className="border-b border-border/70 p-[18px] pb-3.5" style={{ background: "linear-gradient(165deg, hsl(47 70% 16%/.45), transparent)" }}>
            <div className="flex items-center gap-3">
              <span className="cmd-mono flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[hsl(40_95%_42%)] text-[16px] font-extrabold text-[hsl(30_18%_12%)]">
                {selectedUf}
              </span>
              <div>
                <h3 className="text-[17px] font-extrabold tracking-[-0.02em]">{UF_NAMES[selectedUf] ?? selectedUf}</h3>
                {selectedRank > 0 && (
                  <div className="text-[11px] font-semibold text-muted-foreground">{selectedRank}º estado da sua base</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedUf(null)}
                className="ml-auto self-start p-1 text-muted-foreground/50 hover:text-foreground"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2">
              <div className="rounded-[10px] border border-border/70 bg-background/70 px-1.5 py-2 text-center">
                <b className="block text-[16px] font-extrabold tabular-nums">{Number(selectedRow?.leads_count ?? 0)}</b>
                <span className="text-[9.5px] font-bold uppercase tracking-[.05em] text-muted-foreground/60">Leads</span>
              </div>
              <div className="rounded-[10px] border border-border/70 bg-background/70 px-1.5 py-2 text-center">
                <b className="block text-[16px] font-extrabold text-success tabular-nums">{Number(selectedRow?.clients_count ?? 0)}</b>
                <span className="text-[9.5px] font-bold uppercase tracking-[.05em] text-muted-foreground/60">Clientes</span>
              </div>
              <div className="rounded-[10px] border border-border/70 bg-background/70 px-1.5 py-2 text-center">
                <b className="block text-[16px] font-extrabold text-primary tabular-nums">{formatK(Number(selectedRow?.total_sold ?? 0))}</b>
                <span className="text-[9.5px] font-bold uppercase tracking-[.05em] text-muted-foreground/60">Vendido</span>
              </div>
            </div>
          </div>

          <div className="max-h-[420px] flex-1 overflow-y-auto p-3">
            {leadsLoading && <Skeleton className="h-40 rounded-xl" />}
            {!leadsLoading && (ufLeads ?? []).length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-muted-foreground">Nenhum lead neste estado.</p>
            )}
            {(ufLeads ?? []).map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => navigate(`/leads?lead=${lead.id}`)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-2.5 rounded-[10px] px-2 py-[9px] text-left transition-colors hover:bg-[hsl(0_0%_100%/.03)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold">{lead.name}</span>
                  <span className="mt-[1px] flex items-center gap-1.5 text-[10.5px] font-semibold text-muted-foreground/60">
                    {lead.company && <span className="truncate">{lead.company}</span>}
                    {lead.uf_source === "ddd" && (
                      <span className="rounded border border-border px-1 text-[8px] font-extrabold uppercase tracking-[.04em] text-muted-foreground/60">via DDD</span>
                    )}
                  </span>
                </span>
                {lead.is_client ? (
                  <span className="rounded-[5px] bg-success/10 px-1.5 py-[2px] text-[8.5px] font-extrabold uppercase tracking-[.03em] text-success">
                    Cliente{Number(lead.sold_value) > 0 ? ` · ${formatK(Number(lead.sold_value))}` : ""}
                  </span>
                ) : (
                  <span className="rounded-[5px] bg-[hsl(0_0%_100%/.06)] px-1.5 py-[2px] text-[8.5px] font-extrabold uppercase tracking-[.03em] text-muted-foreground">Lead</span>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-border/70 p-3">
            <button
              type="button"
              onClick={() => navigate(`/leads?uf=${selectedUf}`)}
              className="flex h-[38px] w-full items-center justify-center gap-2 rounded-[11px] bg-primary text-[12.5px] font-extrabold text-primary-foreground shadow-[0_5px_16px_hsl(var(--primary)/.2)] transition-[filter] hover:brightness-105"
            >
              Abrir os {Number(selectedRow?.leads_count ?? 0)} em Leads →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const TabMapa = memo(TabMapaBase);
