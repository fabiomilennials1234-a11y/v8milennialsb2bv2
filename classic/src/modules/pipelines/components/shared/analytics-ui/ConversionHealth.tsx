import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface ConversionHealthItem {
  label: string;
  from: number;
  to: number;
}

interface ConversionHealthProps {
  items: ConversionHealthItem[];
}

function health(rate: number) {
  if (rate >= 60) return { text: "text-success", bar: "bg-gradient-to-r from-success/60 to-success" };
  if (rate >= 30) return { text: "text-primary", bar: "bg-gradient-to-r from-primary/60 to-primary" };
  return { text: "text-destructive", bar: "bg-gradient-to-r from-destructive/60 to-destructive" };
}

/** Taxas de conversão entre etapas com cor semântica de saúde. */
export function ConversionHealth({ items }: ConversionHealthProps) {
  const rated = items.map((item) => ({
    ...item,
    rate: item.from > 0 ? (item.to / item.from) * 100 : 0,
  }));
  const worst = rated.reduce(
    (acc, item, i) => (item.rate < rated[acc].rate ? i : acc),
    0
  );

  return (
    <div className="space-y-5">
      {rated.map((item, i) => {
        const h = health(item.rate);
        return (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[13px] font-medium">{item.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                <b className={cn("text-[15px] font-bold mr-1.5", h.text)}>{item.rate.toFixed(0)}%</b>
                {item.to} de {item.from}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full", h.bar)}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(item.rate, 100)}%` }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            {i === worst && rated.length > 1 && item.from > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1.5">maior gargalo do funil</p>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
