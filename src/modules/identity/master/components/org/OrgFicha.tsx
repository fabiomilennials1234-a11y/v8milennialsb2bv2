/**
 * Ficha da org — a central Organizações numa gaveta: plano, uso, usuários,
 * features, vendas e chamados de UM cliente (board das 5 centrais).
 *
 * Junta o que estava espalhado em Dashboard, Organizações, Usuários, Planos,
 * Features e /insights. Nada aqui é dado novo: cada aba lê a fonte que a tela
 * antiga já lia — só mudou o recipiente.
 */

import { useMemo, useState } from "react";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { AlertTriangle, CreditCard, Loader2, MessageSquare, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notifyError } from "@/shared/errors";
import { STATUS_LABELS_STAFF } from "@/modules/platform/lib/support-ticket-draft";
import { BillingOverrideModal } from "../BillingOverrideModal";
import { QuotaManagementPanel } from "../QuotaManagementPanel";
import { useMasterAuth } from "../../hooks/useMasterAuth";
import { useMasterOrganizationMembers, type MasterOrganization } from "../../hooks/useMasterOrganizations";
import { useMasterImplementations } from "../../hooks/useMasterImplementations";
import { useMasterSupportTickets } from "../../hooks/useMasterSupportTickets";
import { useOrgFeatures, useSetOrgFeature } from "../../hooks/useOrgFicha";
import { useOrgSalesSummary } from "../../hooks/useOrgSalesSummary";
import { usePlanCatalog } from "../../hooks/usePlanCatalog";
import { planLabel } from "../../lib/plan-label";
import { IMPLEMENTACAO_STAGE_LABELS } from "../../lib/implementacao-kanban";
import { healthBand, QUOTA_RESOURCE_LABELS, type OrgHealth } from "../../lib/org-health";
import type { ResolvedFeature } from "../../lib/org-features";

const BAND_TONE = {
  good: "text-success-strong",
  warn: "text-warning-strong",
  bad: "text-destructive",
} as const;

const BAND_BAR = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
} as const;

const SOURCE_LABELS = { plano: "do plano", extra: "extra da org", padrao: "padrão" } as const;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function OrgFicha({ org, health }: { org: MasterOrganization; health: OrgHealth | null }) {
  const { isOutbounder } = useMasterAuth();
  const [billingOpen, setBillingOpen] = useState(false);
  const { data: planos } = usePlanCatalog();
  const plano = planLabel(org.subscription_plan, planos);

  return (
    <div className="space-y-5">
      <SheetHeader className="space-y-2 pr-8 text-left">
        <div className="flex flex-wrap items-center gap-2">
          {health && (
            <Badge variant={health.atRisk ? "destructive" : "soft"} className={cn("text-[11px]", health.atRisk && "bg-destructive/10 text-destructive")}>
              {health.atRisk ? "Em risco" : "Saudável"} · nota {health.score}
            </Badge>
          )}
          <Badge variant="soft" className="text-[11px]">
            {plano}
          </Badge>
          {org.billing_override && (
            <Badge variant="gold" className="text-[11px]">
              Override
            </Badge>
          )}
        </div>
        <SheetTitle className="text-2xl font-extrabold tracking-tight">{org.name}</SheetTitle>
        <SheetDescription>
          {org.slug} · cliente desde {format(new Date(org.created_at), "MMM 'de' yyyy", { locale: ptBR })}
        </SheetDescription>
      </SheetHeader>

      <Tabs defaultValue="visao">
        <TabsList className="w-full justify-start overflow-x-auto scrollbar-hide">
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="plano">Plano e uso</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="vendas">Vendas</TabsTrigger>
          <TabsTrigger value="chamados">Chamados</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="pt-4">
          <VisaoGeral orgId={org.id} health={health} />
        </TabsContent>

        <TabsContent value="plano" className="space-y-4 pt-4">
          <section className="flex flex-wrap items-center gap-3 rounded-card border border-card-border bg-card p-4 shadow-relevo">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{plano}</p>
              <p className="text-xs text-muted-foreground">
                Assinatura {org.subscription_status}
                {org.subscription_expires_at &&
                  ` · vence ${format(new Date(org.subscription_expires_at), "dd/MM/yyyy", { locale: ptBR })}`}
                {org.billing_override && org.billing_override_reason && ` · override: ${org.billing_override_reason}`}
              </p>
            </div>
            {!isOutbounder && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBillingOpen(true)}>
                <CreditCard className="h-4 w-4" aria-hidden />
                Liberar plano
              </Button>
            )}
          </section>
          {health?.quotaWarning && (
            <p role="alert" className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning-strong">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {Math.round(health.quotaWarning.ratio * 100)}% do limite de{" "}
              {QUOTA_RESOURCE_LABELS[health.quotaWarning.resource] ?? health.quotaWarning.resource} em uso. Avise o gestor antes de travar.
            </p>
          )}
          <QuotaManagementPanel organizationId={org.id} />
        </TabsContent>

        <TabsContent value="usuarios" className="pt-4">
          <Membros orgId={org.id} />
        </TabsContent>

        <TabsContent value="features" className="pt-4">
          <Features orgId={org.id} readOnly={isOutbounder} />
        </TabsContent>

        <TabsContent value="vendas" className="pt-4">
          <Vendas orgId={org.id} />
        </TabsContent>

        <TabsContent value="chamados" className="pt-4">
          <Chamados orgId={org.id} />
        </TabsContent>
      </Tabs>

      <BillingOverrideModal open={billingOpen} onOpenChange={setBillingOpen} organization={org} />
    </div>
  );
}

function VisaoGeral({ orgId, health }: { orgId: string; health: OrgHealth | null }) {
  const { data: impl = [] } = useMasterImplementations();
  const implantacao = impl.find((i) => i.organization_id === orgId);

  if (!health) {
    return <p className="text-sm text-muted-foreground">Sem sinais de saúde para esta org.</p>;
  }
  const band = healthBand(health.score);

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-card-border bg-card p-5 shadow-relevo">
        <div className="flex items-end gap-3">
          <span className={cn("text-5xl font-extrabold leading-none tracking-[-0.05em] tabular-nums", BAND_TONE[band])}>
            {health.score}
          </span>
          <span className="pb-1 text-sm font-semibold text-muted-foreground">de 100</span>
        </div>
        {health.riskReasons.length > 0 && (
          <p className="mt-2 text-sm font-semibold text-destructive">Em risco: {health.riskReasons.join(" e ")}.</p>
        )}
        <ul className="mt-4 space-y-3">
          {health.parts.map((p) => (
            <li key={p.key} className="space-y-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="font-semibold">{p.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.detail}</span>
                <span className="text-xs font-bold tabular-nums">
                  {p.points}/{p.max}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", BAND_BAR[healthBand((p.points / p.max) * 100)])}
                  style={{ width: `${(p.points / p.max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {implantacao && implantacao.stage !== "concluido" && (
        <Link
          to="/master/implementacao"
          className="flex items-center gap-3 rounded-card border border-card-border bg-card p-4 shadow-relevo transition-shadow hover:shadow-relevo-alto"
        >
          <Rocket className="h-4 w-4 text-insights" aria-hidden />
          <span className="text-sm">
            Em implantação: <strong>{IMPLEMENTACAO_STAGE_LABELS[implantacao.stage]}</strong>
          </span>
        </Link>
      )}
    </div>
  );
}

function Membros({ orgId }: { orgId: string }) {
  const { data: members = [], isLoading } = useMasterOrganizationMembers(orgId);
  const ativos = members.filter((m) => m.is_active);

  if (isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />;
  if (members.length === 0) return <p className="text-sm text-muted-foreground">Nenhum membro.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {ativos.length} ativos de {members.length}. Mover, trocar papel ou redefinir senha: aba Usuários da central.
      </p>
      <ul className="divide-y divide-border/60 rounded-card border border-card-border bg-card shadow-relevo">
        {members.map((m) => (
          <li key={m.id} className={cn("flex items-center gap-3 px-4 py-2.5", !m.is_active && "opacity-50")}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
            <Badge variant="soft" className="shrink-0 text-[10px] capitalize">
              {String(m.role)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Features({ orgId, readOnly }: { orgId: string; readOnly: boolean }) {
  const { data: features = [], isLoading } = useOrgFeatures(orgId);
  const [editing, setEditing] = useState<ResolvedFeature | null>(null);

  const porCategoria = useMemo(() => {
    const m = new Map<string, ResolvedFeature[]>();
    for (const f of features) m.set(f.category, [...(m.get(f.category) ?? []), f]);
    return [...m.entries()];
  }, [features]);

  if (isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />;
  if (features.length === 0) {
    return <p className="text-sm text-muted-foreground">O catálogo de features está vazio. Cadastre na aba Features da central.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Feature vem do plano ou de um extra da org. Ligar ou desligar exige motivo e fica na auditoria.
      </p>
      {porCategoria.map(([cat, list]) => (
        <section key={cat} className="space-y-1.5">
          <h4 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">{cat}</h4>
          <ul className="divide-y divide-border/60 rounded-card border border-card-border bg-card shadow-relevo">
            {list.map((f) => (
              <li key={f.key} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{f.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {SOURCE_LABELS[f.source]}
                    {f.override?.override_reason && ` · ${f.override.override_reason}`}
                    {f.override?.expires_at &&
                      ` · até ${format(new Date(f.override.expires_at), "dd/MM/yyyy", { locale: ptBR })}`}
                    {f.expiredOverride && " · extra expirado"}
                  </p>
                </div>
                <Switch
                  checked={f.enabled}
                  disabled={readOnly}
                  onCheckedChange={() => setEditing(f)}
                  aria-label={`${f.enabled ? "Desligar" : "Ligar"} ${f.name}`}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <FeatureReasonDialog orgId={orgId} feature={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function FeatureReasonDialog({
  orgId,
  feature,
  onClose,
}: {
  orgId: string;
  feature: ResolvedFeature | null;
  onClose: () => void;
}) {
  const set = useSetOrgFeature();
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const enable = feature ? !feature.enabled : false;

  function close() {
    setReason("");
    setExpires("");
    onClose();
  }

  return (
    <Dialog open={!!feature} onOpenChange={(v) => !v && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {enable ? "Ligar" : "Desligar"} {feature?.name}
          </DialogTitle>
          <DialogDescription>O motivo fica na auditoria do master, com quem fez e quando.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="feat-reason">Motivo</Label>
            <Textarea id="feat-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {enable && (
            <div className="space-y-1.5">
              <Label htmlFor="feat-exp">Expira em (opcional)</Label>
              <Input id="feat-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button
            disabled={reason.trim().length < 3 || set.isPending}
            onClick={() =>
              feature &&
              set.mutate(
                {
                  orgId,
                  featureKey: feature.key,
                  enable,
                  reason,
                  expiresAt: enable && expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
                },
                {
                  onSuccess: () => {
                    toast.success(`${feature.name} ${enable ? "ligada" : "desligada"}.`);
                    close();
                  },
                  onError: (e: unknown) => notifyError(e, { fallback: "Não deu para mudar a feature." }),
                },
              )
            }
          >
            {enable ? "Ligar" : "Desligar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Vendas({ orgId }: { orgId: string }) {
  const end = format(new Date(), "yyyy-MM-dd");
  const start = format(subDays(new Date(), 90), "yyyy-MM-dd");
  const { data, isLoading, error } = useOrgSalesSummary(orgId, start, end);

  if (error) return <p className="text-sm text-destructive">Não deu para carregar as vendas.</p>;
  return (
    <div className="space-y-3">
      <KpiRow cols={3}>
        <KpiTile label="Vendas" value={data?.num_vendas ?? 0} loading={isLoading} note="leads dos últimos 90 dias" />
        <KpiTile label="Receita" value={brl(Number(data?.receita_total ?? 0))} loading={isLoading} tone="gold" />
        <KpiTile label="Ticket médio" value={brl(Number(data?.ticket_medio ?? 0))} loading={isLoading} />
      </KpiRow>
      <Link to="/insights" className="inline-block text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Unit economics completo em Insights
      </Link>
    </div>
  );
}

function Chamados({ orgId }: { orgId: string }) {
  const { data: tickets = [], isLoading } = useMasterSupportTickets({ organizationId: orgId });
  if (isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />;
  if (tickets.length === 0) return <p className="text-sm text-muted-foreground">Nenhum chamado desta org.</p>;

  return (
    <ul className="divide-y divide-border/60 rounded-card border border-card-border bg-card shadow-relevo">
      {tickets.map((t) => (
        <li key={t.id}>
          <Link
            to={`/master/operacao?chamado=${t.id}`}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {STATUS_LABELS_STAFF[t.status]} ·{" "}
                {formatDistanceToNow(new Date(t.created_at), { addSuffix: true, locale: ptBR })}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

