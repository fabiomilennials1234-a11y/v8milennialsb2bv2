import { useState } from "react";
import { Calendar, Star, User, Building2, Bot } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScheduleFollowUpButton } from "@/components/followups/ScheduleFollowUpButton";
import { LeadScoreBadge } from "@/components/leads/LeadScoreBadge";
import { useLeadScoresMap } from "@/hooks/useLeadScore";
import { useToggleLeadAI } from "@/hooks/useLeads";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface Lead {
  id: string;
  name: string;
  company: string;
  email?: string;
  phone?: string;
  meetingDate?: string;
  rating: number;
  origin: "calendly" | "whatsapp" | "outro";
  sdr?: string;
  sdrId?: string;
  closer?: string;
  closerId?: string;
  tags: string[];
  revenue?: string;
  segment?: string;
  leadId?: string; // Original lead ID from DB
  sourcePipe?: "whatsapp" | "confirmacao" | "propostas";
  sourcePipeId?: string;
  ai_disabled?: boolean; // IA Copilot desabilitada
}

interface KanbanCardProps {
  lead: Lead;
  onClick?: () => void;
}

const originColors = {
  calendly: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  whatsapp: "bg-success/10 text-success border-success/20",
  outro: "bg-muted text-muted-foreground border-border",
};

const originLabels = {
  calendly: "Calendly",
  whatsapp: "WhatsApp",
  outro: "Outro",
};

export function KanbanCard({ lead, onClick }: KanbanCardProps) {
  const { toast } = useToast();
  const scoresMap = useLeadScoresMap();
  const leadScore = lead.leadId ? scoresMap.get(lead.leadId) : null;
  const toggleAIMutation = useToggleLeadAI();
  const [optimisticAiDisabled, setOptimisticAiDisabled] = useState<Record<string, boolean>>({});
  
  // Usar estado otimista se disponível, senão usar o valor do lead
  const currentAiDisabled = optimisticAiDisabled[lead.leadId || ""] !== undefined 
    ? optimisticAiDisabled[lead.leadId || ""] 
    : (lead.ai_disabled ?? false);

  return (
    <div
      onClick={onClick}
      className="kanban-card group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
              {lead.name}
            </h4>
            {leadScore ? (
              <LeadScoreBadge
                score={leadScore.score}
                predictedConversion={leadScore.predicted_conversion}
                factors={leadScore.factors}
                recommendedAction={leadScore.recommended_action}
                size="sm"
              />
            ) : lead.leadId ? (
              <LeadScoreBadge
                score={null}
                leadId={lead.leadId}
                size="sm"
              />
            ) : null}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
            <Building2 className="w-3 h-3" />
            <span className="text-xs truncate">{lead.company}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2">
          {lead.leadId && (
            <ScheduleFollowUpButton
              leadId={lead.leadId}
              leadName={lead.name}
              sourcePipe={lead.sourcePipe}
              sourcePipeId={lead.sourcePipeId}
              defaultAssignedTo={lead.sdrId || lead.closerId}
            />
          )}
          <div className="flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={`w-3 h-3 ${
                  i < lead.rating
                    ? "text-primary fill-primary"
                    : "text-muted-foreground/30"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {lead.meetingDate && (
        <div className="flex items-center gap-1.5 text-muted-foreground mb-3">
          <Calendar className="w-3.5 h-3.5" />
          <span className="text-xs">{lead.meetingDate}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <Badge variant="outline" className={originColors[lead.origin]}>
          {originLabels[lead.origin]}
        </Badge>
        {lead.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            {tag}
          </Badge>
        ))}
        {lead.tags.length > 2 && (
          <Badge variant="secondary" className="text-xs">
            +{lead.tags.length - 2}
          </Badge>
        )}
        
        {/* AI Toggle - sempre visível quando tem leadId */}
        {lead.leadId && (
          <motion.div 
            className="flex items-center gap-1 ml-auto cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            initial={false}
            animate={{
              opacity: toggleAIMutation.isPending ? 0.7 : 1,
            }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              animate={{
                scale: toggleAIMutation.isPending ? [1, 1.2, 1] : 1,
                rotate: toggleAIMutation.isPending ? [0, 10, -10, 0] : 0,
              }}
              transition={{ 
                duration: 0.5,
                repeat: toggleAIMutation.isPending ? Infinity : 0,
              }}
            >
              <Bot className={cn(
                "w-3.5 h-3.5 transition-colors duration-200",
                currentAiDisabled ? "text-muted-foreground" : "text-primary"
              )} />
            </motion.div>
            <motion.div
              animate={{
                scale: toggleAIMutation.isPending ? 0.95 : 1,
              }}
              transition={{ duration: 0.15 }}
            >
              <Switch
                checked={!currentAiDisabled}
                onCheckedChange={(checked) => {
                  if (!lead.leadId) return;
                  // Atualização otimista local imediata
                  setOptimisticAiDisabled(prev => ({ ...prev, [lead.leadId!]: !checked }));
                  toggleAIMutation.mutate(
                    { leadId: lead.leadId, disabled: !checked },
                    {
                      onSuccess: () => {
                        toast({
                          title: checked ? "IA ativada" : "IA desativada",
                          description: checked 
                            ? "O Copilot voltará a responder mensagens deste lead."
                            : "O Copilot não responderá mais mensagens deste lead.",
                        });
                        // Resetar estado otimista após sucesso
                        setOptimisticAiDisabled(prev => {
                          const newState = { ...prev };
                          delete newState[lead.leadId!];
                          return newState;
                        });
                      },
                      onError: () => {
                        // Reverter estado otimista em caso de erro
                        setOptimisticAiDisabled(prev => {
                          const newState = { ...prev };
                          delete newState[lead.leadId!];
                          return newState;
                        });
                      },
                    }
                  );
                }}
                disabled={toggleAIMutation.isPending}
                className="scale-75"
              />
            </motion.div>
          </motion.div>
        )}
      </div>

      {(lead.sdr || lead.closer) && (
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          {lead.sdr && (
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">SDR: {lead.sdr}</span>
            </div>
          )}
          {lead.closer && (
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Closer: {lead.closer}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
