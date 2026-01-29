import { motion } from "framer-motion";
import { Target, TrendingUp, User } from "lucide-react";

interface GoalData {
  name: string;
  id: string;
  current: number;
  goal: number;
  percentage: number;
}

interface IndividualGoalsProps {
  closers: GoalData[];
  sdrs: GoalData[];
}

function GoalBar({ data, index, type }: { data: GoalData; index: number; type: "closer" | "sdr" }) {
  const percentage = Math.min(data.percentage, 100);
  const isCompleted = data.percentage >= 100;
  
  const formatValue = (value: number) => {
    if (type === "closer") {
      if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
      return `R$ ${value.toFixed(0)}`;
    }
    return value.toString();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
      className={`p-3 rounded-lg border ${
        isCompleted 
          ? "bg-success/10 border-success/30" 
          : "bg-card/50 border-border/50"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isCompleted ? "bg-success" : "bg-primary/20"
          }`}>
            <User className={`w-4 h-4 ${isCompleted ? "text-white" : "text-primary"}`} />
          </div>
          <span className="font-semibold text-foreground">{data.name}</span>
        </div>
        <div className="text-right">
          <span className={`text-lg font-bold ${isCompleted ? "text-success" : "text-foreground"}`}>
            {percentage.toFixed(0)}%
          </span>
        </div>
      </div>
      
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1, delay: index * 0.1 }}
          className={`h-full rounded-full ${
            isCompleted 
              ? "bg-gradient-to-r from-success to-emerald-400" 
              : percentage >= 70 
                ? "bg-gradient-to-r from-primary to-amber-400"
                : "bg-gradient-to-r from-blue-500 to-primary"
          }`}
        />
      </div>
      
      <div className="flex justify-between mt-2 text-xs text-muted-foreground">
        <span>Atual: <span className="text-foreground font-semibold">{formatValue(data.current)}</span></span>
        <span>Meta: <span className="text-foreground font-semibold">{formatValue(data.goal)}</span></span>
      </div>
    </motion.div>
  );
}

export function IndividualGoals({ closers, sdrs }: IndividualGoalsProps) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Closers */}
      <div className="p-4 rounded-xl bg-gradient-to-br from-card/80 to-card border border-border/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-primary/20">
            <Target className="w-5 h-5 text-primary" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Metas Closers</h3>
          <span className="text-xs text-muted-foreground">(Faturamento)</span>
        </div>
        
        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
          {closers.length > 0 ? (
            closers.map((closer, index) => (
              <GoalBar key={closer.id} data={closer} index={index} type="closer" />
            ))
          ) : (
            <p className="text-muted-foreground text-sm text-center py-4">
              Nenhuma meta individual configurada
            </p>
          )}
        </div>
      </div>

      {/* SDRs */}
      <div className="p-4 rounded-xl bg-gradient-to-br from-card/80 to-card border border-border/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <TrendingUp className="w-5 h-5 text-amber-500" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Metas SDRs</h3>
          <span className="text-xs text-muted-foreground">(Reuniões)</span>
        </div>
        
        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
          {sdrs.length > 0 ? (
            sdrs.map((sdr, index) => (
              <GoalBar key={sdr.id} data={sdr} index={index} type="sdr" />
            ))
          ) : (
            <p className="text-muted-foreground text-sm text-center py-4">
              Nenhuma meta individual configurada
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
