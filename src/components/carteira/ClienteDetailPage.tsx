import { useParams, useNavigate } from "react-router-dom";
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
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useClientAlerts } from "@/hooks/useClientAlerts";
import { useHealthHistory } from "@/hooks/useHealthHistory";
import { HealthSparkline } from "./HealthSparkline";

// ─── Derived types ────────────────────────────────────────────────────────────

type ClientWithLead = Tables<"upsell_clients"> & {
  lead: Pick<Tables<"leads">, "name" | "phone" | "email" | "company"> | null;
};
import { ClienteMetrics } from "./ClienteMetrics";
import { ClienteReorderTimeline } from "./ClienteReorderTimeline";
import { ClienteCopilotSuggestion } from "./ClienteCopilotSuggestion";
import { ClienteProductsTable } from "./ClienteProductsTable";
import { ClienteOrderHistory } from "./ClienteOrderHistory";
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
      return "bg-zinc-700/30 text-zinc-400 border-zinc-600/20";
  }
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-zinc-800", className)} />;
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

  // ── Derived ───────────────────────────────────────────────────────────────

  const score = client?.health_score ?? 0;
  const ringColor = healthRingColor(score);
  const circumference = 220;
  const dashArray = `${Math.round((score / 100) * circumference)} ${circumference}`;

  const clientName = client?.name ?? client?.lead?.name ?? "Cliente";
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
    <div className="flex flex-col min-h-full bg-zinc-950">
      <div className="flex flex-col gap-5 p-5 md:p-6 max-w-7xl mx-auto w-full">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-zinc-400 hover:text-zinc-100 -ml-2"
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
                strokeWidth="8" className="text-zinc-800"
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
              <h1 className="text-lg font-semibold text-zinc-100 truncate leading-tight">
                {clientName}
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
              <p className="text-xs text-zinc-500 truncate">{clientCompany}</p>
            )}
          </div>

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
            {clientPhone && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-zinc-700 hover:bg-zinc-800 hover:border-green-600/50 hover:text-green-400"
                onClick={() => {
                  if (client?.lead_id) {
                    navigate(`/chat?lead=${client.lead_id}`);
                  } else if (clientPhone) {
                    window.open(`https://wa.me/${clientPhone.replace(/\D/g, "")}`, "_blank");
                  }
                }}
              >
                <MessageCircle size={13} />
                WhatsApp
              </Button>
            )}
            <Button
              size="sm"
              className="gap-1.5 bg-[hsl(47_100%_50%)] hover:bg-[hsl(47_100%_45%)] text-black font-semibold"
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

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-zinc-300">
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
                <p className="text-sm text-zinc-500 text-center py-4">
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
            clientName={clientName}
            phone={clientPhone}
            alerts={alerts}
            lastOrder={lastOrder}
            nextOrderExpected={nextOrderExpected}
          />

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-zinc-300">
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

        {/* ── Bottom row: Order History + Timeline ────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-zinc-300">
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
                <ClienteOrderHistory orders={orders} cycleDays={cycleDays} />
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-zinc-300">
                Atividade Recente
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 max-h-96 overflow-y-auto">
              <ClienteTimeline orders={orders} alerts={alerts} />
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
