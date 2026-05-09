import { TrendingUp, Target, BarChart3, Percent } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useForecast } from "@/hooks/useForecast";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function ForecastWidget() {
  const { data, isLoading } = useForecast();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-7 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data) return null;

  const items = [
    {
      icon: BarChart3,
      label: "Forecast ponderado",
      value: formatBRL(data.weightedTotal),
      color: "text-primary",
    },
    {
      icon: Target,
      label: "Previsto este mes",
      value: formatBRL(data.expectedThisMonth),
      color: "text-emerald-500",
    },
    {
      icon: TrendingUp,
      label: "Negocios abertos",
      value: String(data.openDealCount),
      color: "text-blue-500",
    },
    {
      icon: Percent,
      label: "Probabilidade media",
      value: `${data.avgProbability}%`,
      color: "text-amber-500",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex items-center gap-4 p-4">
            <div className={`p-2 rounded-lg bg-muted/50 ${item.color}`}>
              <item.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-lg font-bold tabular-nums">{item.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
