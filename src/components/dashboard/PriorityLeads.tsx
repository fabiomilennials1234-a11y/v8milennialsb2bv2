import { motion } from "framer-motion";
import { Sparkles, TrendingUp, Clock, Phone, ArrowRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadScoreBadge } from "@/components/leads/LeadScoreBadge";
import { useLeadScores, useCalculateBatchScores, LeadScore } from "@/hooks/useLeadScore";
import { useLeads } from "@/hooks/useLeads";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface PriorityLead {
  lead: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    origin: string;
    created_at: string;
  };
  score: LeadScore;
}

export function PriorityLeads() {
  const navigate = useNavigate();
  const { data: scores, isLoading: scoresLoading } = useLeadScores();
  const { data: leads, isLoading: leadsLoading } = useLeads();
  const calculateBatch = useCalculateBatchScores();

  const isLoading = scoresLoading || leadsLoading;

  // Combine leads with their scores and sort by score
  const priorityLeads: PriorityLead[] = [];
  
  if (scores && leads) {
    scores
      .filter(s => s.score >= 60) // Only show leads with score >= 60
      .slice(0, 8) // Top 8
      .forEach(score => {
        const lead = leads.find(l => l.id === score.lead_id);
        if (lead) {
          priorityLeads.push({ lead, score });
        }
      });
  }

  const handleCalculateBatch = () => {
    calculateBatch.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(`${data.processed || 0} leads analisados com IA!`);
      },
      onError: () => {
        toast.error("Erro ao calcular scores em lote");
      },
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const hasNoScores = !scores || scores.length === 0;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Leads Prioritários
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleCalculateBatch}
            disabled={calculateBatch.isPending}
            className="text-xs"
          >
            {calculateBatch.isPending ? (
              <>
                <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                Analisando...
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Analisar Leads
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Leads com maior probabilidade de conversão
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {hasNoScores ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8"
          >
            <Sparkles className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              Nenhum lead analisado ainda
            </p>
            <Button 
              onClick={handleCalculateBatch}
              disabled={calculateBatch.isPending}
              size="sm"
            >
              {calculateBatch.isPending ? (
                <>
                  <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                  Analisando...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3 mr-1.5" />
                  Analisar Leads com IA
                </>
              )}
            </Button>
          </motion.div>
        ) : priorityLeads.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground">
              Nenhum lead com score alto no momento
            </p>
          </div>
        ) : (
          priorityLeads.map((item, index) => (
            <motion.div
              key={item.lead.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={cn(
                "p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer group",
                item.score.score >= 80 && "border-success/30 bg-success/5"
              )}
              onClick={() => navigate("/leads")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">
                      {item.lead.name}
                    </span>
                    <LeadScoreBadge
                      score={item.score.score}
                      predictedConversion={item.score.predicted_conversion}
                      factors={item.score.factors}
                      recommendedAction={item.score.recommended_action}
                      size="sm"
                    />
                  </div>
                  {item.lead.company && (
                    <p className="text-xs text-muted-foreground truncate mb-1.5">
                      {item.lead.company}
                    </p>
                  )}
                  {item.score.recommended_action && (
                    <div className="flex items-start gap-1.5">
                      <TrendingUp className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                      <p className="text-xs text-primary line-clamp-2">
                        {item.score.recommended_action}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {item.lead.phone && (
                    <a
                      href={`https://wa.me/55${item.lead.phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-full bg-success/10 hover:bg-success/20 text-success transition-colors"
                    >
                      <Phone className="w-3 h-3" />
                    </a>
                  )}
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span className="text-[10px]">
                      {formatDistanceToNow(new Date(item.lead.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}

        {priorityLeads.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => navigate("/leads")}
          >
            Ver todos os leads
            <ArrowRight className="w-3 h-3 ml-1.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
