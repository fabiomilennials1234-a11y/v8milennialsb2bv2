import { useParams } from "react-router-dom";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MessageCircle,
  ShoppingCart,
  AlertTriangle,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { AbrirConversaComContato } from "@/modules/communication/components/chat/AbrirConversaComContato";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useClientAlerts } from "@/modules/carteira/hooks/useClientAlerts";
import { useHealthHistory } from "@/modules/platform/hooks/useHealthHistory";
import { HealthSparkline } from "./HealthSparkline";
import { NewOrderModal } from "./NewOrderModal";
import { formatBRL } from "@/lib/format";
import { useClientInadimplencia } from "@/modules/carteira/hooks/useClientInadimplencia";
import { withErpCode } from "@/shared/format/erp-code";

// ─── Derived types ────────────────────────────────────────────────────────────

type ClientWithLead = Tables<"upsell_clients"> & {
  lead: Pick<Tables<"leads">, "name" | "phone" | "email" | "company"> | null;
};
import { ClienteMetrics } from "./ClienteMetrics";
import { ClienteReorderTimeline } from "./ClienteReorderTimeline";
import { ClienteCopilotSuggestion } from "./ClienteCopilotSuggestion";
import { ClienteProductsTable } from "./ClienteProductsTable";
import { ClienteOrderHistory } from "./ClienteOrderHistory";
import { ClienteTitulos } from "./ClienteTitulos";
import { ClienteDadosErp } from "./ClienteDadosErp";
import { ClienteTimeline } from "./ClienteTimeline";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mesmas faixas de antes (80/60), em token. */
function healthRingColor(score: number) {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-destructive";
}

function alertSeverityClass(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "warning":
      return "bg-warning/10 text-warning-strong border-warning/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Mesmas faixas de churn de antes (70/40). */
function churnClass(p: number) {
  if (p >= 70) return "bg-destructive/10 text-destructive";
  if (p >= 40) return "bg-warning/15 text-warning-strong";
  return "bg-success/10 text-success-strong";
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-card bg-muted", className)} />;
}

/** Cabeçalho de cartão do V5 — título 15px bold, sem filete. */
function BlockTitle({ children }: { children: React.ReactNode }) {
  return (
    <CardHeader className="px-5 pb-2 pt-4">
      <CardTitle className="text-[15px] tracking-[-0.02em]">{children}</CardTitle>
    </CardHeader>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ClienteDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: client, isLoading: loadingClient } = useQuery({
    queryKey: ["upsell-client-detail", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("upsell_clients")
        .select("*, lead:leads(name, phone, email, company)")
        .eq("id", clientId!)
        .single();
      return data as ClientWithLead | null;
    },
    enabled: !!clientId,
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["upsell-client-orders", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("upsell_orders")
        .select("*")
        .eq("client_id", clientId!)
        .eq("approval_status", "approved")
        .order("sold_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!clientId,
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["upsell-client-products", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("upsell_client_products")
        .select("*")
        .eq("client_id", clientId!)
        .eq("status", "ativo");
      return data ?? [];
    },
    enabled: !!clientId,
  });

  const { data: alerts = [] } = useClientAlerts(clientId);
  const { data: healthHistory = [] } = useHealthHistory(clientId);
  const { data: inadimplencia } = useClientInadimplencia(clientId);
  const { data: notasFiscais = [] } = useQuery({
    queryKey: ["client-notas-fiscais", clientId],
    queryFn: async (): Promise<{ order_id: string | null }[]> => {
      if (!clientId) return [];
      const { data } = await supabase
        .from("notas_fiscais")
        .select("order_id")
        .eq("client_id", clientId);
      return data ?? [];
    },
    enabled: !!clientId,
  });
  const invoicedOrderIds = useMemo(
    () => new Set(notasFiscais.map((n) => n.order_id).filter((x): x is string => !!x)),
    [notasFiscais],
  );
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────

  const score = client?.health_score ?? 0;
  const ringColor = healthRingColor(score);
  const circumference = 220;
  const dashArray = `${Math.round((score / 100) * circumference)} ${circumference}`;

  const clientName = client?.name ?? client?.lead?.name ?? "Cliente";
  /**
   * Rótulo do cabeçalho: "1234 - João da Silva".
   *
   * 🔴 Separado de `clientName` de propósito. `clientName` continua limpo porque
   * segue para `ClienteCopilotSuggestion`, que redige a mensagem sugerida ao
   * cliente — com o código junto, a sugestão viraria "Olá 1234 - João da Silva".
   */
  const clientLabel = withErpCode(clientName, client?.external_id);
  const clientCompany = client?.company ?? client?.lead?.company ?? null;
  const clientPhone = client?.lead?.phone ?? null;

  const cycleDays = client?.reorder_cycle_days ?? 0;
  const daysSinceLast = client?.days_since_last_order ?? 0;
  const lastOrderAt = client?.last_order_at ?? null;
  const nextOrderExpected = client?.next_order_expected ?? null;

  const lastOrder = orders[0] ?? null;

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loadingClient) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        <SkeletonBlock className="h-16" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonBlock className="h-40" />
          <SkeletonBlock className="h-40" />
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // V5 (2026-10): `PageHeader` com voltar para a Carteira (a tela-mãe certa —
  // o histórico pode ter vindo de qualquer lugar). O <main> já dá o respiro da
  // página: o wrapper perdeu o `p-6`, o `max-w-7xl` e o `bg-background` que
  // escondia a grade da bancada.

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <PageHeader
        back="/upsell"
        eyebrow="Cliente 360"
        title={<span title={clientLabel}>{clientLabel}</span>}
        subtitle={clientCompany ?? undefined}
        actions={
          <>
            {clientPhone && client?.lead_id && (
              <AbrirConversaComContato
                leadId={client.lead_id}
                phone={clientPhone}
                variant="outline"
              >
                <MessageCircle />
                WhatsApp
              </AbrirConversaComContato>
            )}
            <Button onClick={() => setNewOrderOpen(true)}>
              <ShoppingCart />
              Novo pedido
            </Button>
          </>
        }
      />

      {/* ── Faixa de estado: health, inadimplência, churn ──────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2.5 rounded-full border border-card-border bg-card py-1 pl-1 pr-3.5 shadow-relevo">
          <div className="relative h-9 w-9 shrink-0">
            <svg
              className="h-9 w-9 -rotate-90"
              viewBox="0 0 80 80"
              role="img"
              aria-label={`Health score: ${score}`}
            >
              <circle
                cx="40" cy="40" r="35"
                fill="none" stroke="currentColor"
                strokeWidth="9" className="text-muted"
              />
              <circle
                cx="40" cy="40" r="35"
                fill="none" stroke="currentColor"
                strokeWidth="9" className={ringColor}
                strokeDasharray={dashArray}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10.5px] font-extrabold tabular-nums">
              {score}
            </span>
          </div>
          <span className="text-[12px] font-bold text-foreground/80">Health</span>
          {healthHistory.length >= 2 && (
            <HealthSparkline
              data={healthHistory}
              width={90}
              height={22}
              className="flex shrink-0 items-center gap-1"
            />
          )}
        </div>

        {/* Inadimplência badge (S9) */}
        {inadimplencia?.isInadimplente && (
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-bold tabular-nums text-destructive"
            title={`${inadimplencia.overdueCount} título(s) atrasado(s)`}
          >
            <AlertTriangle size={12} />
            Inadimplente · {formatBRL(inadimplencia.receitaEmRisco)}
          </span>
        )}

        {/* Churn badge */}
        {client?.churn_probability != null && client.churn_probability > 0 && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold tabular-nums",
              churnClass(client.churn_probability),
            )}
          >
            <TrendingDown size={12} />
            {client.churn_probability}% churn
          </span>
        )}
      </div>

      {/* ── Alert Strip ────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 scrollbar-hide">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                alertSeverityClass(alert.severity),
              )}
            >
              <AlertTriangle size={11} />
              <span className="whitespace-nowrap">{alert.description ?? alert.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Top row: Metrics + Reorder Timeline ────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_340px]">
        <ClienteMetrics client={client ?? {}} />

        <Card>
          <BlockTitle>Ciclo de recompra</BlockTitle>
          <CardContent className="px-5 pb-5">
            {cycleDays > 0 ? (
              <ClienteReorderTimeline
                cycleDays={cycleDays}
                daysSinceLast={daysSinceLast}
                lastOrderAt={lastOrderAt}
                nextOrderExpected={nextOrderExpected}
              />
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Ciclo não calculado ainda.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Mid row: Copilot + Products ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ClienteCopilotSuggestion
          clientId={clientId}
          leadId={client?.lead_id ?? null}
          clientName={clientName}
          phone={clientPhone}
          alerts={alerts}
          lastOrder={lastOrder}
          nextOrderExpected={nextOrderExpected}
        />

        <Card>
          <BlockTitle>Produtos ativos</BlockTitle>
          <CardContent className="px-5 pb-5">
            {loadingProducts ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <SkeletonBlock key={i} className="h-8 rounded-lg" />
                ))}
              </div>
            ) : (
              <ClienteProductsTable products={products} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Financeiro: títulos a receber (SCRUM-229 bloco 4.1) ──────────
          O ERP sincroniza contas a receber desde a integração do Toth, e até
          aqui nenhuma superfície da Carteira mostrava — o dado chegava ao
          banco e morria lá. */}
      <Card>
        <BlockTitle>Títulos a receber</BlockTitle>
        <CardContent className="px-5 pb-5">
          <ClienteTitulos clientId={clientId} />
        </CardContent>
      </Card>

      {/* ── Bottom row: Order History + Timeline ────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <BlockTitle>Histórico de pedidos</BlockTitle>
          <CardContent className="max-h-96 overflow-y-auto px-5 pb-5">
            {loadingOrders ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <SkeletonBlock key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            ) : (
              <ClienteOrderHistory
                orders={orders}
                cycleDays={cycleDays}
                invoicedOrderIds={invoicedOrderIds}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <BlockTitle>Atividade recente</BlockTitle>
          <CardContent className="max-h-96 overflow-y-auto px-5 pb-5">
            <ClienteTimeline orders={orders} alerts={alerts} />
          </CardContent>
        </Card>
      </div>

      {/* Quem atende, de que praça, de que segmento. Some sozinho para
          cliente que não veio de ERP. */}
      <ClienteDadosErp clientId={clientId} />

      <NewOrderModal
        open={newOrderOpen}
        onOpenChange={setNewOrderOpen}
        clientId={clientId}
        clientName={clientName}
      />
    </div>
  );
}
