import { memo, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSellerActivity } from "@/hooks/useSellerActivity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ChevronDown, ChevronUp } from "lucide-react";

interface Props { month: number; year: number }

function SellerActivityCardBase({ month, year }: Props) {
  const { data: sellers, isLoading } = useSellerActivity(month, year);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const teamAvg = useMemo(() => {
    if (!sellers?.length) return { leads: 0, followups: 0, reunioes: 0, propostas: 0, vendas: 0 };
    const n = sellers.length;
    return {
      leads: sellers.reduce((s, x) => s + x.leads, 0) / n,
      followups: sellers.reduce((s, x) => s + x.followups, 0) / n,
      reunioes: sellers.reduce((s, x) => s + x.reunioes, 0) / n,
      propostas: sellers.reduce((s, x) => s + x.propostas, 0) / n,
      vendas: sellers.reduce((s, x) => s + x.vendas, 0) / n,
    };
  }, [sellers]);

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-48" /></CardContent></Card>;

  const scoreColor = (s: number) => s > 70 ? "text-success" : s >= 40 ? "text-yellow-500" : "text-destructive";
  const strokeColor = (s: number) => s > 70 ? "hsl(var(--success))" : s >= 40 ? "#eab308" : "hsl(var(--destructive))";

  const activities = [
    { key: "leads" as const, label: "Leads movimentados" },
    { key: "followups" as const, label: "Follow-ups completos" },
    { key: "reunioes" as const, label: "Reuniões realizadas" },
    { key: "propostas" as const, label: "Propostas enviadas" },
    { key: "vendas" as const, label: "Vendas fechadas" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Índice de Atividade dos Vendedores
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!sellers?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum vendedor ativo.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sellers.map((seller, i) => {
              const isExpanded = expandedId === seller.id;
              const circumference = 2 * Math.PI * 20;
              const offset = circumference - (seller.scoreNormalizado / 100) * circumference;

              return (
                <motion.div
                  key={seller.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="border border-border/50 rounded-lg p-3 cursor-pointer hover:border-primary/20 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : seller.id)}
                >
                  <div className="flex items-center gap-3">
                    {/* Ring chart */}
                    <div className="relative w-12 h-12 flex-shrink-0">
                      <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
                        <circle cx={24} cy={24} r={20} fill="none" stroke="hsl(var(--muted))" strokeWidth={4} />
                        <motion.circle
                          cx={24} cy={24} r={20} fill="none"
                          stroke={strokeColor(seller.scoreNormalizado)}
                          strokeWidth={4} strokeLinecap="round"
                          strokeDasharray={circumference}
                          initial={{ strokeDashoffset: circumference }}
                          animate={{ strokeDashoffset: offset }}
                          transition={{ duration: 0.8, delay: i * 0.05 }}
                        />
                      </svg>
                      <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${scoreColor(seller.scoreNormalizado)}`}>
                        {seller.scoreNormalizado}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{seller.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{seller.role}</p>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
                          {activities.map(act => {
                            const val = seller[act.key];
                            const avg = teamAvg[act.key];
                            const maxVal = Math.max(val, avg, 1);
                            return (
                              <div key={act.key}>
                                <div className="flex items-center justify-between text-xs mb-0.5">
                                  <span className="text-muted-foreground">{act.label}</span>
                                  <span className="font-medium">{val} <span className="text-muted-foreground">/ média {Math.round(avg)}</span></span>
                                </div>
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(val / maxVal) * 100}%` }}
                                    transition={{ duration: 0.4 }}
                                    className={`h-full rounded-full ${val >= avg ? "bg-success" : "bg-primary"}`}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const SellerActivityCard = memo(SellerActivityCardBase);
