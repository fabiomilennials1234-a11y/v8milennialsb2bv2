import { memo } from "react";
import { motion } from "framer-motion";
import { BarChart3, Activity } from "lucide-react";
import { RankingTable } from "./RankingTable";
import { SellerActivityCard } from "./SellerActivityCard";
import { ProductRanking } from "./ProductRanking";
import { PerformanceChart } from "./PerformanceChart";
import { ActivityFeed } from "./ActivityFeed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PipelineVelocity } from "@/components/analytics/PipelineVelocity";
import { ActivityMetrics } from "@/components/analytics/ActivityMetrics";
import { AnalyticsErrorBoundary } from "@/components/analytics/AnalyticsErrorBoundary";

interface TabPerformanceProps {
  month: number;
  year: number;
}

function TabPerformanceBase({ month, year }: TabPerformanceProps) {
  return (
    <div className="space-y-6">
      {/* Row 1: Ranking completo */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <RankingTable month={month} year={year} />
      </motion.div>

      {/* Row 2: Análise de vendedores */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <SellerActivityCard month={month} year={year} />
      </motion.div>

      {/* Row 3: Produtos mais vendidos */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <ProductRanking month={month} year={year} />
      </motion.div>

      {/* Row 4: Pipeline Velocity + Activity Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <AnalyticsErrorBoundary>
            <PipelineVelocity />
          </AnalyticsErrorBoundary>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
        >
          <AnalyticsErrorBoundary>
            <ActivityMetrics />
          </AnalyticsErrorBoundary>
        </motion.div>
      </div>

      {/* Row 5: Gráfico diário + Atividades */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-3"
        >
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Performance Diária
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PerformanceChart />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="lg:col-span-2"
        >
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Atividades Recentes
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 px-2">
              <ActivityFeed />
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

export const TabPerformance = memo(TabPerformanceBase);
