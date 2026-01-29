import { motion } from "framer-motion";
import { Trophy, Building2, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Sale {
  id: string;
  leadName: string;
  company?: string;
  value: number;
  type: "mrr" | "projeto" | null;
  closerName: string;
  closedAt: string;
}

interface MonthlySalesProps {
  sales: Sale[];
  totalMRR: number;
  totalProjeto: number;
}

export function MonthlySales({ sales, totalMRR, totalProjeto }: MonthlySalesProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${value.toFixed(0)}`;
  };

  const sortedSales = [...sales].sort((a, b) => 
    new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()
  );

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-card/80 to-card border border-border/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-success/20">
            <Trophy className="w-5 h-5 text-success" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Vendas do Mês</h3>
          <span className="bg-success/20 text-success text-xs font-semibold px-2 py-0.5 rounded-full">
            {sales.length} vendas
          </span>
        </div>
        
        <div className="flex gap-4">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">MRR</p>
            <p className="text-sm font-bold text-primary">{formatCurrency(totalMRR)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Projeto</p>
            <p className="text-sm font-bold text-purple-400">{formatCurrency(totalProjeto)}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {sortedSales.map((sale, index) => (
          <motion.div
            key={sale.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            className="p-3 rounded-lg bg-success/5 border border-success/20 hover:bg-success/10 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-10 rounded-full ${
                  sale.type === "mrr" ? "bg-primary" : "bg-purple-400"
                }`} />
                
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{sale.leadName}</span>
                    {sale.company && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        {sale.company}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {sale.closerName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(sale.closedAt), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      sale.type === "mrr" 
                        ? "bg-primary/20 text-primary" 
                        : "bg-purple-400/20 text-purple-400"
                    }`}>
                      {sale.type?.toUpperCase() || "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-success" />
                <span className="text-xl font-bold text-success">
                  {formatCurrency(sale.value)}
                </span>
              </div>
            </div>
          </motion.div>
        ))}

        {sales.length === 0 && (
          <div className="text-center py-8">
            <Trophy className="w-12 h-12 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-muted-foreground">Nenhuma venda ainda este mês</p>
            <p className="text-xs text-muted-foreground/70">É hora de fechar!</p>
          </div>
        )}
      </div>
    </div>
  );
}
