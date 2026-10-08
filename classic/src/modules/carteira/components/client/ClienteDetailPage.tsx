import { useParams, useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  MessageCircle,
  ShoppingCart,
  AlertTriangle,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
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

function healthRingColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function alertSeverityClass(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "warning":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ClienteDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();

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
      <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
        <SkeletonBlock className="h-16" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonBlock className="h-40" />
          <SkeletonBlock className="h-40" />
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-background">
      <div className="flex flex-col gap-5 p-5 md:p-6 max-w-7xl mx-auto w-full">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={15} />
            Voltar
          </Button>

          {/* Health ring */}
          <div className="relative w-10 h-10 shrink-0">
            <svg
              className="w-10 h-10 -rotate-90"
              viewBox="0 0 80 80"
              aria-label={`Health score: ${score}`}
            >
              <circle
                cx="40" cy="40" r="35"
                fill="none" stroke="currentColor"
                strokeWidth="8" className="text-border"
              />
              <circle
                cx="40" cy="40" r="35"
                fill="none" stroke="currentColor"
                strokeWidth="8" className={ringColor}
                strokeDasharray={dashArray}
                strokeLinecap="round"
              />
            </svg>
            <span className={cn("absolute inset-0 flex items-center justify-center text-[10px] font-bold", ringColor)}>
              {score}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1
                className="text-lg font-semibold text-foreground truncate leading-tight"
                title={clientLabel}
              >
                {clientLabel}
              </h1>
              {healthHistory.length >= 2 && (
                <HealthSparkline
                  data={healthHistory}
                  width={100}
                  height={24}
                  className="flex items-center gap-1 shrink-0"
                />
              )}
            </div>
            {clientCompany && (
              <p className="text-xs text-muted-foreground truncate">{clientCompany}</p>
            )}
          </div>

          {/* Inadimplência badge (S9) */}
          {inadimplencia?.isInadimplente && (
            <span
              className="flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full text-xs font-bold tabular-nums bg-red-500/20 text-red-400"
              title={`${inadimplencia.overdueCount} título(s) atrasado(s)`}
            >
              <AlertTriangle size={11} />
              Inadimplente · {formatBRL(inadimplencia.receitaEmRisco)}
            </span>
          )}

          {/* Churn badge */}
          {client?.churn_probability != null && client.churn_probability > 0 && (
            <span
              className={cn(
                "flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full text-xs font-bold tabular-nums",
                client.churn_probability >= 70
                  ? "bg-red-500/20 text-red-400"
                  : client.churn_probability >= 40
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-emerald-500/20 text-emerald-400",
              )}
            >
              <TrendingDown size={11} />
              {client.churn_probability}% churn
            </span>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {clientPhone && client?.lead_id && (
              <AbrirConversaButton
                leadId={client.lead_id}
                phone={clientPhone}
                size="sm"
                variant="outline"
                className="gap-1.5 border-border hover:bg-muted hover:border-green-600/50 hover:text-green-400"
              >
                <MessageCircle size={13} />
                WhatsApp
              </AbrirConversaButton>
            )}
            <Button
              size="sm"
              className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              onClick={() => setNewOrderOpen(true)}
            >
              <ShoppingCart size={13} />
              Novo Pedido
            </Button>
          </div>
        </header>

        {/* ── Alert Strip ────────────────────────────────────────────────── */}
        {alerts.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-1 px-1 scrollbar-none">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "flex items-center gap-1.5 shrink-0 rounded-md px-2.5 py-1.5 border text-xs",
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
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          <ClienteMetrics client={client ?? {}} />

          <Card className="bg-card border-border">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-card-foreground">
                Ciclo de Recompra
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {cycleDays > 0 ? (
                <ClienteReorderTimeline
                  cycleDays={cycleDays}
                  daysSinceLast={daysSinceLast}
                  lastOrderAt={lastOrderAt}
                  nextOrderExpected={nextOrderExpected}
                />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Ciclo não calculado ainda.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Mid row: Copilot + Products ─────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ClienteCopilotSuggestion
            clientId={clientId}
            leadId={client?.lead_id ?? null}
            clientName={clientName}
            phone={clientPhone}
            alerts={alerts}
            lastOrder={lastOrder}
            nextOrderExpected={nextOrderExpected}
          />

          <Card className="bg-card border-border">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-card-foreground">
                Produtos Ativos
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {loadingProducts ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <SkeletonBlock key={i} className="h-8" />
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
        <Card className="bg-card border-border">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-semibold text-card-foreground">
              Títulos a receber
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <ClienteTitulos clientId={clientId} />
          </CardContent>
        </Card>

        {/* ── Bottom row: Order History + Timeline ────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card border-border">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-card-foreground">
                Histórico de Pedidos
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 max-h-96 overflow-y-auto">
              {loadingOrders ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <SkeletonBlock key={i} className="h-12" />
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

          <Card className="bg-card border-border">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-card-foreground">
                Atividade Recente
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 max-h-96 overflow-y-auto">
              <ClienteTimeline orders={orders} alerts={alerts} />
            </CardContent>
          </Card>
        </div>

        {/* Quem atende, de que praça, de que segmento. Some sozinho para
            cliente que não veio de ERP. */}
        <ClienteDadosErp clientId={clientId} />

      </div>

      <NewOrderModal
        open={newOrderOpen}
        onOpenChange={setNewOrderOpen}
        clientId={clientId}
        clientName={clientName}
      />
    </div>
  );
}
