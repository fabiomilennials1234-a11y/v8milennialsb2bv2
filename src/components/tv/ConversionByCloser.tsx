import { motion } from "framer-motion";
import { TrendingUp, Award } from "lucide-react";

interface ConversionData {
  name: string;
  rate: number;
  sales: number;
  proposals: number;
}

interface ConversionByCloserProps {
  data: ConversionData[];
}

export function ConversionByCloser({ data }: ConversionByCloserProps) {
  const sortedData = [...data].sort((a, b) => b.rate - a.rate);
  const maxRate = Math.max(...data.map(d => d.rate), 1);

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-card/80 to-card border border-border/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 rounded-lg bg-success/20">
          <TrendingUp className="w-5 h-5 text-success" />
        </div>
        <h3 className="text-lg font-bold text-foreground">Conversão por Closer</h3>
      </div>

      <div className="space-y-3">
        {sortedData.map((closer, index) => (
          <motion.div
            key={closer.name}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="relative"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                {index === 0 && closer.rate > 0 && (
                  <Award className="w-4 h-4 text-amber-400" />
                )}
                <span className="font-medium text-foreground">{closer.name}</span>
              </div>
              <div className="text-right">
                <span className={`text-lg font-bold ${
                  closer.rate >= 25 ? "text-success" :
                  closer.rate >= 15 ? "text-amber-400" :
                  "text-muted-foreground"
                }`}>
                  {closer.rate.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({closer.sales}/{closer.proposals})
                </span>
              </div>
            </div>
            
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(closer.rate / maxRate) * 100}%` }}
                transition={{ duration: 1, delay: index * 0.1 }}
                className={`h-full rounded-full ${
                  closer.rate >= 25 ? "bg-gradient-to-r from-success to-emerald-400" :
                  closer.rate >= 15 ? "bg-gradient-to-r from-amber-400 to-orange-400" :
                  "bg-gradient-to-r from-muted-foreground/50 to-muted-foreground/30"
                }`}
              />
            </div>
          </motion.div>
        ))}

        {data.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">
            Sem dados de conversão
          </p>
        )}
      </div>
    </div>
  );
}
