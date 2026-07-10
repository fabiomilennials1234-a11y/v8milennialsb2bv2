/** PROTOTYPE — wipe me. Variant C: triage — health headline + action queue + tabs. */
import { useState } from "react";
import { alerts, errorGroups, edgeFns, services, crons, audit, kpis } from "./data";
import { Dot, Trend, sevText, ago } from "./ui";
import { CheckCircle2, ChevronRight } from "lucide-react";

const TABS = ["Erros", "Edge functions", "Integrações", "Auditoria"] as const;

export function VariantC() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Erros");
  const systemDown = kpis.criticalAlerts > 0;

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      {/* Health headline */}
      <div className={`mb-6 flex items-center justify-between rounded-2xl border p-6 ${systemDown ? "border-red-500/30 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
        <div className="flex items-center gap-4">
          <div className={`grid h-14 w-14 place-items-center rounded-2xl ${systemDown ? "bg-red-500/15" : "bg-emerald-500/15"}`}>
            <span className={`h-5 w-5 rounded-full ${systemDown ? "bg-red-400 animate-pulse" : "bg-emerald-400"}`} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{systemDown ? "Atenção necessária" : "Sistema saudável"}</h1>
            <p className="text-sm text-zinc-400">{kpis.criticalAlerts} alertas críticos · {kpis.errors24h} erros nas últimas 24h · uptime {kpis.uptimePct}%</p>
          </div>
        </div>
        <div className="flex gap-6 text-right">
          <div><div className="text-2xl font-bold text-red-400">{kpis.openAlerts}</div><div className="text-[11px] text-zinc-500">alertas</div></div>
          <div><div className="text-2xl font-bold text-amber-400">{kpis.p95GlobalMs}ms</div><div className="text-[11px] text-zinc-500">p95</div></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Action queue — left, primary */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">Precisa de ação · {alerts.length}</h2>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className={`group rounded-xl border p-3.5 ${a.severity === "critical" ? "border-red-500/30 bg-red-500/5" : a.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-zinc-900/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5"><Dot s={a.severity} /></span>
                    <div>
                      <div className="text-sm font-medium leading-tight">{a.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="rounded bg-white/5 px-1.5 py-0.5 uppercase">{a.category}</span>
                        <span>{a.org}</span><span>·</span><span>{ago(a.ageMin)}</span>
                      </div>
                    </div>
                  </div>
                  <button className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:bg-white/10">
                    <CheckCircle2 className="h-3 w-3" /> resolver
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Drill-down tabs — right */}
        <section className="lg:col-span-3">
          <div className="mb-3 flex gap-1 border-b border-white/10">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${tab === t ? "border-amber-400 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>{t}</button>
            ))}
          </div>

          {tab === "Erros" && (
            <div className="space-y-1.5">
              {errorGroups.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2.5 hover:bg-white/5">
                  <Dot s={e.source === "frontend" ? "warn" : "down"} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{e.title}</div><div className="font-mono text-[11px] text-zinc-500">{e.fn} · {e.org}</div></div>
                  <span className="text-sm font-semibold">{e.count}</span>
                  <Trend t={e.trend} />
                  <ChevronRight className="h-4 w-4 text-zinc-600" />
                </div>
              ))}
            </div>
          )}
          {tab === "Edge functions" && (
            <div className="space-y-1.5">
              {edgeFns.map((f) => (
                <div key={f.fn} className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2.5">
                  <div className="flex-1 font-mono text-sm">{f.fn}</div>
                  <span className="text-xs text-zinc-500">{f.calls.toLocaleString()} calls</span>
                  <span className={`text-xs ${f.errorRatePct > 1 ? "text-amber-400" : "text-emerald-400"}`}>{f.errorRatePct}%</span>
                  <span className="w-14 text-right text-xs text-zinc-400">{f.p95ms}ms</span>
                  <Trend t={f.trend} />
                </div>
              ))}
            </div>
          )}
          {tab === "Integrações" && (
            <div className="grid grid-cols-2 gap-2">
              {services.map((s) => (
                <div key={s.name} className="flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm"><Dot s={s.status} /> {s.name}</span>
                  <span className={`text-xs ${sevText[s.status]}`}>{s.status === "down" ? "offline" : `${s.latencyMs}ms`}</span>
                </div>
              ))}
              {crons.map((c) => (
                <div key={c.name} className="flex items-center justify-between rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 truncate font-mono text-xs"><Dot s={c.status} /> {c.name}</span>
                  <span className="shrink-0 text-[11px] text-zinc-500">{c.lastRun}</span>
                </div>
              ))}
            </div>
          )}
          {tab === "Auditoria" && (
            <div className="space-y-1.5">
              {audit.map((a, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-2.5 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${a.action === "DELETE" ? "bg-red-400/15 text-red-400" : a.action === "INSERT" ? "bg-emerald-400/15 text-emerald-400" : "bg-sky-400/15 text-sky-400"}`}>{a.action}</span>
                  <span className="font-mono text-xs">{a.table}</span>
                  <span className="flex-1 text-zinc-500">{a.actor} · {a.org}</span>
                  <span className="text-xs text-zinc-600">{ago(a.atMin)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
