/**
 * Monitoramento — uma fila de erros e saúde no lugar de cinco telas
 * separadas (regras MO-1…MO-6). As telas antigas (Automações, WhatsApp,
 * Operations, Ativos da Meta, Auditoria) viram abas desta central: aqui é a
 * triagem, lá é o detalhe da fonte.
 *
 * Composição V5 "fila em tinta + foco em ouro": a fila à esquerda, o
 * incidente selecionado à direita.
 */

import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { AlertOctagon, Building2, Globe2, Loader2, RotateCw, Ticket } from "lucide-react";
import { FocusCard, FocusTile, InkRow, InkSplit, KpiRow, KpiTile } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MasterPageHeader } from "../../components/MasterPageHeader";
import { useIncidentFeed } from "../../hooks/useIncidentFeed";
import {
  AUTO_TICKET_MIN_OCCURRENCES,
  ORIGIN_LABELS,
  SEVERITY_LABELS,
  type Incident,
  type IncidentOrigin,
} from "../../lib/incidents";

const SEVERITY_DOT = {
  critico: "bg-destructive",
  erro: "bg-warning",
  aviso: "bg-tinta-muted",
} as const;

/** Onde mora o detalhe de cada origem. */
const ORIGIN_SOURCE: Record<IncidentOrigin, { label: string; path: string } | null> = {
  sentry: null,
  automacao: { label: "Abrir Automações", path: "/master/automation-health" },
  whatsapp: { label: "Abrir WhatsApp", path: "/master/whatsapp-health" },
  meta: { label: "Abrir Ativos da Meta", path: "/master/meta-assets" },
  aplicacao: { label: "Abrir Operations", path: "/master/operations" },
};

export default function MonitoramentoCentral() {
  const { data, isLoading, error, refetch, isFetching } = useIncidentFeed();
  const [origem, setOrigem] = useState<IncidentOrigin | null>(null);
  const [selId, setSelId] = useState<string | null>(null);

  const incidents = useMemo(() => data?.incidents ?? [], [data]);
  const visiveis = origem ? incidents.filter((i) => i.origin === origem) : incidents;
  const selected = visiveis.find((i) => i.id === selId) ?? visiveis[0] ?? null;

  const criticos = incidents.filter((i) => i.severity === "critico").length;
  const globais = incidents.filter((i) => i.scope === "global").length;
  const orgsAfetadas = new Set(incidents.flatMap((i) => i.affectedOrgs.map((o) => o.id))).size;
  const viramChamado = incidents.filter((i) => i.shouldOpenTicket).length;
  const origens = [...new Set(incidents.map((i) => i.origin))];

  return (
    <div className="space-y-5">
      <MasterPageHeader
        title="Monitoramento"
        subtitle="Erros e saúde numa fila só. O mesmo erro vira um item; espalhado em várias orgs, vira incidente global."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RotateCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden />
            Atualizar
          </Button>
        }
      />

      <KpiRow cols={4}>
        <KpiTile label="Críticos" value={criticos} icon={AlertOctagon} tone={criticos > 0 ? "bad" : "good"} loading={isLoading} note="abertos agora" />
        <KpiTile label="Globais" value={globais} icon={Globe2} tone={globais > 0 ? "warn" : "good"} loading={isLoading} note="mesmo erro em 3+ orgs" />
        <KpiTile label="Orgs afetadas" value={orgsAfetadas} icon={Building2} tone="info" loading={isLoading} note="com ao menos um incidente" />
        <KpiTile
          label="Pedem chamado"
          value={viramChamado}
          icon={Ticket}
          tone={viramChamado > 0 ? "gold" : "neutral"}
          loading={isLoading}
          note={`crítico com +${AUTO_TICKET_MIN_OCCURRENCES} ocorrências`}
        />
      </KpiRow>

      {data?.truncated && (
        <p role="status" className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning-strong">
          Uma das fontes passou de 1.000 linhas no período. As contagens abaixo são o mínimo, não o total.
        </p>
      )}

      {error ? (
        <p role="alert" className="rounded-card border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Não deu para carregar os incidentes.
        </p>
      ) : isLoading ? (
        <div className="grid place-items-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando incidentes" />
        </div>
      ) : incidents.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card p-10 text-center text-sm text-muted-foreground shadow-relevo">
          Nenhum incidente nas últimas 24 horas. Alertas abertos dos últimos 7 dias também entram aqui.
        </p>
      ) : (
        <InkSplit
          title="Incidentes"
          count={visiveis.length}
          actions={
            <div className="flex max-w-full gap-1 overflow-x-auto scrollbar-hide">
              {[null, ...origens].map((o) => (
                <button
                  key={o ?? "todas"}
                  type="button"
                  aria-pressed={origem === o}
                  onClick={() => setOrigem(o)}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
                    origem === o ? "bg-primary text-primary-foreground" : "bg-white/10 text-tinta-foreground hover:bg-white/15",
                  )}
                >
                  {o ? ORIGIN_LABELS[o] : "Todas"}
                </button>
              ))}
            </div>
          }
          listClassName="max-h-[640px] overflow-y-auto pr-1"
          list={visiveis.map((i) => (
            <InkRow key={i.id} selected={selected?.id === i.id} onClick={() => setSelId(i.id)}>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[i.severity])} aria-label={SEVERITY_LABELS[i.severity]} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{i.title}</span>
                <span className="block truncate text-[11px] opacity-70">
                  {ORIGIN_LABELS[i.origin]} · {scopeLabel(i)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold tabular-nums">{i.occurrences}×</span>
            </InkRow>
          ))}
          detail={selected ? <IncidentFocus incident={selected} /> : null}
        />
      )}
    </div>
  );
}

function scopeLabel(i: Incident) {
  if (i.scope === "global") return `${i.affectedOrgs.length} orgs`;
  if (i.scope === "plataforma") return "plataforma";
  return i.organizationName ?? "org";
}

function IncidentFocus({ incident: i }: { incident: Incident }) {
  const fonte = ORIGIN_SOURCE[i.origin];

  return (
    <FocusCard>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] opacity-80">
        <span>{SEVERITY_LABELS[i.severity]}</span>
        <span aria-hidden>·</span>
        <span>{ORIGIN_LABELS[i.origin]}</span>
        <span aria-hidden>·</span>
        <span>{i.scope === "global" ? "Global" : i.scope === "plataforma" ? "Plataforma" : "Org"}</span>
      </div>
      <h3 className="text-2xl font-extrabold leading-tight tracking-tight">{i.title}</h3>
      {i.detail && <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm opacity-90">{i.detail}</p>}

      <div className="grid gap-2 sm:grid-cols-3">
        <FocusTile>
          <p className="text-[11px] font-semibold opacity-70">Ocorrências</p>
          <p className="text-2xl font-extrabold tabular-nums tracking-tight">{i.occurrences}</p>
        </FocusTile>
        <FocusTile>
          <p className="text-[11px] font-semibold opacity-70">Primeira</p>
          <p className="text-sm font-bold">{format(new Date(i.firstAt), "dd/MM HH:mm", { locale: ptBR })}</p>
        </FocusTile>
        <FocusTile>
          <p className="text-[11px] font-semibold opacity-70">Última</p>
          <p className="text-sm font-bold">{formatDistanceToNow(new Date(i.lastAt), { addSuffix: true, locale: ptBR })}</p>
        </FocusTile>
      </div>

      {i.scope === "global" && (
        <FocusTile>
          <p className="text-[11px] font-semibold opacity-70">
            Atinge {i.affectedOrgs.length} orgs — é da plataforma, não vira chamado de uma org só.
          </p>
          <p className="mt-1 text-sm font-semibold">
            {i.affectedOrgs
              .slice(0, 8)
              .map((o) => o.name ?? "org")
              .join(", ")}
            {i.affectedOrgs.length > 8 && ` e mais ${i.affectedOrgs.length - 8}`}
          </p>
        </FocusTile>
      )}

      {i.shouldOpenTicket && (
        <FocusTile className="flex items-start gap-2">
          <Ticket className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="text-sm font-semibold">
            Crítico com mais de {AUTO_TICKET_MIN_OCCURRENCES} ocorrências: pela regra, vira chamado desta org. A
            abertura automática ainda não está ligada.
          </p>
        </FocusTile>
      )}

      <div className="flex flex-wrap gap-2">
        {i.organizationId && (
          <Button asChild variant="on-gold" size="sm">
            <Link to={`/master/organizations?org=${i.organizationId}`}>Ficha da org</Link>
          </Button>
        )}
        {fonte && (
          <Button asChild variant="ink" size="sm">
            <Link to={fonte.path}>{fonte.label}</Link>
          </Button>
        )}
      </div>
    </FocusCard>
  );
}
