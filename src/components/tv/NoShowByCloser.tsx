import { motion } from "framer-motion";
import { AlertTriangle, Shield } from "lucide-react";

interface NoShowData {
  name: string;
  rate: number;
}

interface NoShowByCloserProps {
  data: NoShowData[];
  geral: number;
}

export function NoShowByCloser({ data, geral }: NoShowByCloserProps) {
  const sortedData = [...data].sort((a, b) => a.rate - b.rate); // Best first (lowest no-show)
  const maxRate = Math.max(...data.map(d => d.rate), 50);

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-card/80 to-card border border-border/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <h3 className="text-lg font-bold text-foreground">No-Show por Closer</h3>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
          geral <= 20 ? "bg-success/20 text-success" :
          geral <= 30 ? "bg-amber-500/20 text-amber-500" :
          "bg-destructive/20 text-destructive"
        }`}>
          Geral: {geral.toFixed(1)}%
        </div>
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
                {index === 0 && closer.rate <= 20 && (
                  <Shield className="w-4 h-4 text-success" />
                )}
                <span className="font-medium text-foreground">{closer.name}</span>
              </div>
              <span className={`text-lg font-bold ${
                closer.rate <= 20 ? "text-success" :
                closer.rate <= 30 ? "text-amber-400" :
                "text-destructive"
              }`}>
                {closer.rate.toFixed(1)}%
              </span>
            </div>
            
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(closer.rate / maxRate) * 100}%` }}
                transition={{ duration: 1, delay: index * 0.1 }}
                className={`h-full rounded-full ${
                  closer.rate <= 20 ? "bg-gradient-to-r from-success to-emerald-400" :
                  closer.rate <= 30 ? "bg-gradient-to-r from-amber-400 to-orange-400" :
                  "bg-gradient-to-r from-destructive to-red-400"
                }`}
              />
            </div>
          </motion.div>
        ))}

        {data.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">
            Sem dados de no-show
          </p>
        )}
      </div>
    </div>
  );
}
