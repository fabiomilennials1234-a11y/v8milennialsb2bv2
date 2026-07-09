/** PROTOTYPE — wipe me. Variant A: NOC status board (scan-first, dense grid). */
import { services, crons, drift, errorsByHour, errorGroups, edgeFns, alerts, kpis } from "./data";
import { Dot, Trend, Bars, healthColor, sevText, ago } from "./ui";
import { Activity, AlertTriangle, Boxes, Clock, Cpu, Radio } from "lucide-react";

const Panel = ({ title, icon: Icon, right, children }: any) => (
  <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      {right}
    </div>
    {children}
  </div>
);

export function VariantA() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Observabilidade</h1>
          <p className="text-sm text-zinc-500">Saúde do sistema · todas as orgs · últimas 24h</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> ao vivo</span>
          <select className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1"><option>Todas as orgs</option></select>
          <select className="rounded-md border border-white/10 bg-zinc-900 px-2 py-1"><option>24h</option></select>
        </div>
      </div>

      {/* Top semaphore strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { l: "Uptime", v: `${kpis.uptimePct}%`, s: "ok", sub: "30d" },
          { l: "Erros 24h", v: kpis.errors24h, s: "warn", sub: `+${kpis.errors24hTrend}% vs ontem` },
          { l: "Alertas abertos", v: kpis.openAlerts, s: "down", sub: `${kpis.criticalAlerts} críticos` },
          { l: "p95 global", v: `${kpis.p95GlobalMs}ms`, s: "ok", sub: `${kpis.eventsToday.toLocaleString()} eventos hoje` },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-white/10 bg-zinc-900/60 p-4">
            <div className="flex items-center gap-2 text-xs text-zinc-400"><Dot s={k.s} /> {k.l}</div>
            <div className={`mt-1 text-2xl font-bold ${sevText[k.s]}`}>{k.v}</div>
            <div className="text-[11px] text-zinc-500">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Services */}
        <Panel title="Integrações" icon={Radio}>
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><Dot s={s.status} /> {s.name}</span>
                <span className={`font-mono text-xs ${s.status === "down" ? "text-red-400" : "text-zinc-400"}`}>{s.status === "down" ? "offline" : `${s.latencyMs}ms`}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Cron */}
        <Panel title="Cron jobs" icon={Clock}>
          <div className="space-y-2">
            {crons.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 truncate"><Dot s={c.status} /> <span className="truncate font-mono text-xs">{c.name}</span></span>
                <span className="shrink-0 text-xs text-zinc-500">{c.lastRun}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* WhatsApp drift */}
        <Panel title="WhatsApp drift" icon={Boxes}>
          <div className="space-y-2">
            {drift.map((d) => (
              <div key={d.instance} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><Dot s={d.severity} /> {d.org}</span>
                <span className={`font-mono text-xs ${healthColor[d.severity]}`}>{d.driftPct}%</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Errors over time — span 2 */}
        <Panel title="Erros / hora (24h)" icon={Activity} right={<span className="text-xs text-amber-400">{kpis.errors24h} total</span>}>
          <Bars data={errorsByHour} />
        </Panel>

        {/* Open alerts */}
        <Panel title="Alertas" icon={AlertTriangle} right={<span className="rounded-full bg-red-400/15 px-2 py-0.5 text-[11px] text-red-400">{alerts.length}</span>}>
          <div className="space-y-1.5">
            {alerts.slice(0, 4).map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <Dot s={a.severity} /> <span className="flex-1 truncate">{a.title}</span>
                <span className="text-zinc-600">{ago(a.ageMin)}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Top error groups — span full */}
        <div className="lg:col-span-2">
          <Panel title="Top grupos de erro" icon={AlertTriangle}>
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-zinc-500">
                <tr><th className="pb-2 font-medium">Erro</th><th className="pb-2 font-medium">Origem</th><th className="pb-2 text-right font-medium">Ocorr.</th><th className="pb-2 text-right font-medium">Visto</th><th className="pb-2 text-right font-medium">Tend.</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {errorGroups.map((e) => (
                  <tr key={e.id} className="hover:bg-white/5">
                    <td className="py-2 pr-2"><div className="truncate font-medium">{e.title}</div><div className="text-[11px] text-zinc-500">{e.org}</div></td>
                    <td className="py-2 font-mono text-xs text-zinc-400">{e.fn}</td>
                    <td className="py-2 text-right font-semibold">{e.count}</td>
                    <td className="py-2 text-right text-xs text-zinc-500">{e.lastSeen}</td>
                    <td className="py-2"><div className="flex justify-end"><Trend t={e.trend} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        {/* Edge fn perf */}
        <Panel title="Edge functions" icon={Cpu}>
          <div className="space-y-2">
            {edgeFns.slice(0, 6).map((f) => (
              <div key={f.fn} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono">{f.fn}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={f.errorRatePct > 1 ? "text-amber-400" : "text-zinc-500"}>{f.errorRatePct}%</span>
                  <span className="text-zinc-500">{f.p95ms}ms</span>
                  <Trend t={f.trend} />
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
