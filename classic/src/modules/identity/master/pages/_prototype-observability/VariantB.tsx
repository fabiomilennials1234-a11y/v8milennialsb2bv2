/** PROTOTYPE — wipe me. Variant B: unified event stream + filter rail. */
import { useState } from "react";
import { stream, kpis, type StreamEvent } from "./data";
import { Dot, ago } from "./ui";
import { AlertTriangle, Bug, ClipboardList, HeartPulse, Filter } from "lucide-react";

const KIND: Record<StreamEvent["kind"], { label: string; icon: any }> = {
  error: { label: "Erros", icon: Bug },
  alert: { label: "Alertas", icon: AlertTriangle },
  audit: { label: "Auditoria", icon: ClipboardList },
  health: { label: "Saúde", icon: HeartPulse },
};

export function VariantB() {
  const [active, setActive] = useState<Set<string>>(new Set(["error", "alert", "audit", "health"]));
  const toggle = (k: string) => {
    const n = new Set(active);
    n.has(k) ? n.delete(k) : n.add(k);
    setActive(n);
  };
  const rows = stream.filter((e) => active.has(e.kind));

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Filter rail */}
      <aside className="w-60 shrink-0 border-r border-white/10 p-4">
        <h1 className="mb-1 text-lg font-semibold">Observabilidade</h1>
        <p className="mb-5 text-xs text-zinc-500">Stream unificado</p>

        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500"><Filter className="h-3 w-3" /> Tipo</div>
        <div className="space-y-1">
          {Object.entries(KIND).map(([k, v]) => {
            const on = active.has(k);
            const Icon = v.icon;
            const n = stream.filter((e) => e.kind === k).length;
            return (
              <button key={k} onClick={() => toggle(k)} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition ${on ? "bg-white/10 text-white" : "text-zinc-500 hover:bg-white/5"}`}>
                <span className="flex items-center gap-2"><Icon className="h-4 w-4" /> {v.label}</span>
                <span className="text-xs text-zinc-500">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 mb-2 text-[11px] uppercase tracking-wider text-zinc-500">Org</div>
        <select className="w-full rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-2 text-sm"><option>Todas</option><option>Bertin</option><option>Basic4u</option></select>

        <div className="mt-8 space-y-3 rounded-xl border border-white/10 bg-zinc-900/40 p-3 text-xs">
          <div className="flex justify-between"><span className="text-zinc-500">Erros 24h</span><span className="font-semibold text-amber-400">{kpis.errors24h}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Alertas</span><span className="font-semibold text-red-400">{kpis.openAlerts}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Uptime</span><span className="font-semibold text-emerald-400">{kpis.uptimePct}%</span></div>
        </div>
      </aside>

      {/* Stream */}
      <main className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-zinc-400">{rows.length} eventos · ordem cronológica</div>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> ao vivo</span>
        </div>

        <div className="relative space-y-0">
          <div className="absolute bottom-2 left-[7px] top-2 w-px bg-white/10" />
          {rows.map((e) => {
            const Icon = KIND[e.kind].icon;
            return (
              <div key={e.id} className="group relative flex gap-4 py-3 pl-6">
                <span className="absolute left-0 top-4"><Dot s={e.severity} /></span>
                <div className="flex-1 rounded-lg border border-transparent px-3 py-2 group-hover:border-white/10 group-hover:bg-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="h-3.5 w-3.5 text-zinc-500" /> {e.title}
                    </div>
                    <span className="text-xs text-zinc-600">{ago(e.atMin)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 pl-5 text-xs text-zinc-500">
                    <span>{e.meta}</span>
                    <span className="text-zinc-700">·</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5">{e.org}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
