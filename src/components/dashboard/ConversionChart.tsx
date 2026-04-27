import { memo } from "react";
import { motion } from "framer-motion";
import { useConversionRates } from "@/hooks/useDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversionBarProps {
  name: string;
  rate: number;
  meetings: number;
  sales: number;
  index: number;
  type: "meetings" | "sales";
}

function ConversionBar({ name, rate, meetings, sales, index, type }: ConversionBarProps) {
  const getColor = (rate: number) => {
    if (rate >= 50) return "bg-success";
    if (rate >= 30) return "bg-chart-5";
    if (rate >= 15) return "bg-chart-3";
    return "bg-destructive";
  };

  const getTrend = (rate: number) => {
    if (rate >= 50) return { icon: TrendingUp, label: "Excelente" };
    if (rate >= 30) return { icon: TrendingUp, label: "Bom" };
    if (rate >= 15) return { icon: Minus, label: "Regular" };
    return { icon: TrendingDown, label: "Atenção" };
  };

  const trend = getTrend(rate);
  const TrendIcon = trend.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
      className="space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{name}</span>
          <Badge variant="outline" className="text-xs">
            <TrendIcon className="w-3 h-3 mr-1" />
            {trend.label}
          </Badge>
        </div>
        <span className="text-sm font-bold">{rate.toFixed(1)}%</span>
      </div>
      <div className="relative h-3 rounded-full bg-muted overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(rate, 100)}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={cn("absolute inset-y-0 left-0 rounded-full", getColor(rate))}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {type === "meetings"
            ? `${meetings} reuniões → ${sales} compareceu`
            : `${meetings} propostas → ${sales} vendas`}
        </span>
      </div>
    </motion.div>
  );
}

function ConversionChartBase() {
  const now = new Date();
  const { data, isLoading } = useConversionRates(now.getMonth() + 1, now.getFullYear());

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const hasMeetings = data?.meetingsRates && data.meetingsRates.length > 0;
  const hasSales = data?.salesRates && data.salesRates.length > 0;

  if (!hasMeetings && !hasSales) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <p className="text-sm">Nenhum dado de conversão disponível</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue={hasSales ? "sales" : "meetings"} className="w-full">
      <TabsList className="grid w-full max-w-xs grid-cols-2 mb-4">
        <TabsTrigger value="sales" disabled={!hasSales}>
          Vendas ({data?.salesRates.length || 0})
        </TabsTrigger>
        <TabsTrigger value="meetings" disabled={!hasMeetings}>
          Reuniões ({data?.meetingsRates.length || 0})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="sales" className="space-y-4">
        {data?.salesRates
          .sort((a, b) => b.rate - a.rate)
          .map((member, index) => (
            <ConversionBar
              key={member.id}
              name={member.name}
              rate={member.rate}
              meetings={member.meetings}
              sales={member.sales}
              index={index}
              type="sales"
            />
          ))}
      </TabsContent>

      <TabsContent value="meetings" className="space-y-4">
        {data?.meetingsRates
          .sort((a, b) => b.rate - a.rate)
          .map((member, index) => (
            <ConversionBar
              key={member.id}
              name={member.name}
              rate={member.rate}
              meetings={member.meetings}
              sales={member.sales}
              index={index}
              type="meetings"
            />
          ))}
      </TabsContent>
    </Tabs>
  );
}

export const ConversionChart = memo(ConversionChartBase);
