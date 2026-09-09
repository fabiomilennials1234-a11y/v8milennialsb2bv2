import { useState } from "react";
import { Phone, Building2, Bot } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { LeadScoreBadge } from "@/modules/leads";
import { useLeadScoresMap } from "@/modules/leads";
import { useToggleLeadAI } from "@/modules/leads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
// Badge de agendamento usa prop hasScheduledMessages passada pelo pipe pai

export interface LeadTag {
  name: string;
  color: string;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  email?: string;
  phone?: string;
  meetingDate?: string;
  origin: string;
  sdr?: string;
  sdrId?: string;
  closer?: string;
  closerId?: string;
  tags: LeadTag[];
  revenue?: string;
  segment?: string;
  leadId?: string;
  sourcePipe?: "whatsapp" | "confirmacao" | "propostas";
  sourcePipeId?: string;
  ai_disabled?: boolean;
}

interface KanbanCardProps {
  lead: Lead;
  onClick?: () => void;
}

const originColors: Record<string, string> = {
  whatsapp: "bg-success/10 text-success border-success/20",
  meta_ads: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  instagram: "bg-pink-500/10 text-pink-600 border-pink-500/20",
  tiktok: "bg-foreground/10 text-foreground border-foreground/20",
  google_ads: "bg-red-500/10 text-red-600 border-red-500/20",
  site: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  landing_page: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  remarketing: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  indicacao: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  evento: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  prospeccao_ativa: "bg-orange-600/10 text-orange-700 border-orange-600/20",
  cal: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  outro: "bg-muted text-muted-foreground border-border",
};

const originLabels: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  instagram: "Instagram",
  tiktok: "Tiktok",
  google_ads: "Google Ads",
  site: "Site",
  landing_page: "Landing Page",
  remarketing: "Remarketing",
  indicacao: "Indicação",
  evento: "Evento",
  prospeccao_ativa: "Prospecção Ativa",
  cal: "Cal.com",
  outro: "Outros",
};

export function KanbanCard({ lead, onClick }: KanbanCardProps) {
  const { toast } = useToast();
  const scoresMap = useLeadScoresMap();
  const leadScore = lead.leadId ? scoresMap.get(lead.leadId) : null;
  const toggleAIMutation = useToggleLeadAI();
  const logAction = useLogLeadAction();
  const [optimisticAiDisabled, setOptimisticAiDisabled] = useState<Record<string, boolean>>({});

  const currentAiDisabled = optimisticAiDisabled[lead.leadId || ""] !== undefined
    ? optimisticAiDisabled[lead.leadId || ""]
    : (lead.ai_disabled ?? false);

  return (
    <div
      onClick={onClick}
      className="kanban-card group w-full cursor-pointer"
    >
      {/* Tags coloridas no topo - estilo Trello */}
      {lead.tags.length > 0 && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {lead.tags.slice(0, 4).map((tag) => (
            <div
              key={tag.name}
              className="h-2 rounded-full min-w-[40px] flex-1 max-w-[60px]"
              style={{ backgroundColor: tag.color }}
              title={tag.name}
            />
          ))}
        </div>
      )}

      {/* Nome + Lead Score */}
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h4 className="font-medium text-sm break-words line-clamp-2 group-hover:text-primary transition-colors" title={lead.name}>
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

      {/* Empresa */}
      {lead.company && (
        <div className="flex items-center gap-1 text-muted-foreground mb-2 min-w-0">
          <Building2 className="w-3 h-3 shrink-0" />
          <span className="text-xs break-words line-clamp-1" title={lead.company}>{lead.company}</span>
        </div>
      )}

      {/* Badge origem + AI toggle */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <Badge variant="outline" className={cn("text-xs", originColors[lead.origin])}>
          {originLabels[lead.origin]}
        </Badge>


        {lead.leadId && (
          <motion.div
            className="flex items-center gap-1 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            initial={false}
            animate={{ opacity: toggleAIMutation.isPending ? 0.7 : 1 }}
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
              animate={{ scale: toggleAIMutation.isPending ? 0.95 : 1 }}
              transition={{ duration: 0.15 }}
            >
              <Switch
                checked={!currentAiDisabled}
                onCheckedChange={(checked) => {
                  if (!lead.leadId) return;
                  setOptimisticAiDisabled(prev => ({ ...prev, [lead.leadId!]: !checked }));
                  toggleAIMutation.mutate(
                    { leadId: lead.leadId, disabled: !checked },
                    {
                      onSuccess: () => {
                        if (lead.leadId) {
                          logAction({ leadId: lead.leadId, action: "ai_toggled", description: checked ? "IA ativada" : "IA desativada" });
                        }
                        toast({
                          title: checked ? "IA ativada" : "IA desativada",
                          description: checked
                            ? "A IA voltará a responder mensagens deste lead."
                            : "A IA não responderá mais mensagens deste lead.",
                        });
                        // Não limpar optimistic — cache update direto cuida disso
                      },
                      onError: () => {
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

      {/* Telefone no rodapé */}
      {lead.phone && (
        <div className="flex items-center gap-1.5 pt-2 border-t border-border text-muted-foreground">
          <Phone className="w-3 h-3 shrink-0" />
          <span className="text-xs truncate">{lead.phone}</span>
        </div>
      )}
    </div>
  );
}
