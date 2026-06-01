import { motion } from "framer-motion";
import { Flame, Calendar, User, Building2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Proposal {
  id: string;
  lead?: {
    name: string;
    company?: string;
  };
  closer?: {
    name: string;
  };
  calor: number;
  commitment_date?: string;
  sale_value?: number;
  status: string;
}

interface HotProposalsProps {
  proposals: Proposal[];
}

export function HotProposals({ proposals }: HotProposalsProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
    return `R$ ${value.toFixed(0)}`;
  };

  const getHeatColor = (calor: number) => {
    if (calor >= 9) return "from-red-500 to-orange-500";
    if (calor >= 7) return "from-orange-500 to-amber-500";
    return "from-amber-500 to-yellow-500";
  };

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-card/80 to-card border border-border/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 rounded-lg bg-orange-500/20">
          <Flame className="w-5 h-5 text-orange-500" />
        </div>
        <h3 className="text-lg font-bold text-foreground">Propostas Quentes</h3>
        <span className="text-xs text-muted-foreground">(Calor ≥ 7)</span>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {proposals.map((proposal, index) => (
          <motion.div
            key={proposal.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Heat indicator */}
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getHeatColor(proposal.calor || 5)} flex items-center justify-center shadow-lg`}>
                  <span className="text-white font-bold text-sm">{proposal.calor || 5}</span>
                </div>
                
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{proposal.lead?.name || "Lead"}</span>
                    {proposal.lead?.company && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        {proposal.lead.company}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    {proposal.closer && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="w-3 h-3" />
                        {proposal.closer.name}
                      </span>
                    )}
                    {proposal.commitment_date && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(proposal.commitment_date), "dd/MM", { locale: ptBR })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {proposal.sale_value && (
                <div className="text-right">
                  <span className="text-lg font-bold text-primary">
                    {formatCurrency(proposal.sale_value)}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {proposals.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8">
            Nenhuma proposta quente no momento
          </p>
        )}
      </div>
    </div>
  );
}
