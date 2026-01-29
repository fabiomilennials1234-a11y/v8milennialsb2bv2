import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  User,
  Building2,
  Mail,
  Phone,
  Star,
  Calendar,
  Tag,
  MessageSquare,
  Clock,
  TrendingUp,
  DollarSign,
  CheckCircle,
  XCircle,
  History,
  Edit2,
  ArrowRight,
  Zap,
  Bot,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { useToggleLeadAI } from "@/hooks/useLeads";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ConversationHistoryTab } from "./ConversationHistoryTab";

interface LeadDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string | null;
  onEdit?: () => void;
}

const originLabels: Record<string, string> = {
  calendly: "Calendly",
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outro",
};

const originColors: Record<string, string> = {
  calendly: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  whatsapp: "bg-success/10 text-success border-success/20",
  meta_ads: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  outro: "bg-muted text-muted-foreground border-muted",
};

function TimelineItem({ 
  action, 
  description, 
  date, 
  isLast 
}: { 
  action: string; 
  description?: string; 
  date: string;
  isLast?: boolean;
}) {
  const getIcon = () => {
    switch (action) {
      case "lead_created": return <User className="w-3.5 h-3.5" />;
      case "status_changed": return <TrendingUp className="w-3.5 h-3.5" />;
      case "meeting_scheduled": return <Calendar className="w-3.5 h-3.5" />;
      case "meeting_attended": return <CheckCircle className="w-3.5 h-3.5 text-success" />;
      case "meeting_missed": return <XCircle className="w-3.5 h-3.5 text-destructive" />;
      case "proposal_created": return <DollarSign className="w-3.5 h-3.5" />;
      case "sale_closed": return <Zap className="w-3.5 h-3.5 text-primary" />;
      default: return <Clock className="w-3.5 h-3.5" />;
    }
  };

  const getActionLabel = () => {
    switch (action) {
      case "lead_created": return "Lead criado";
      case "status_changed": return "Status alterado";
      case "meeting_scheduled": return "Reunião agendada";
      case "meeting_attended": return "Compareceu na reunião";
      case "meeting_missed": return "Não compareceu";
      case "proposal_created": return "Proposta criada";
      case "sale_closed": return "Venda fechada";
      default: return action;
    }
  };

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          {getIcon()}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-2" />}
      </div>
      <div className="flex-1 pb-6">
        <p className="font-medium text-sm">{getActionLabel()}</p>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })}
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, variant = "default" }: { 
  label: string; 
  value: string | number; 
  icon: any;
  variant?: "default" | "success" | "warning" | "destructive";
}) {
  const variantClasses = {
    default: "bg-muted",
    success: "bg-success/10",
    warning: "bg-warning/10",
    destructive: "bg-destructive/10",
  };

  const iconClasses = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };

  return (
    <div className={cn("rounded-lg p-3", variantClasses[variant])}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("w-4 h-4", iconClasses[variant])} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export function LeadDetailModal({ open, onOpenChange, leadId, onEdit }: LeadDetailModalProps) {
  const { toast } = useToast();
  const toggleAIMutation = useToggleLeadAI();
  const [optimisticAiDisabled, setOptimisticAiDisabled] = useState<boolean | null>(null);
  
  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead-detail", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      
      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          lead_tags(
            tag:tags(id, name, color)
          )
        `)
        .eq("id", leadId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!leadId && open,
  });

  const { data: history } = useQuery({
    queryKey: ["lead-history", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      
      const { data, error } = await supabase
        .from("lead_history")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!leadId && open,
  });

  const { data: pipeData } = useQuery({
    queryKey: ["lead-pipes", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      
      const [whatsapp, confirmacao, propostas] = await Promise.all([
        supabase.from("pipe_whatsapp").select("*").eq("lead_id", leadId),
        supabase.from("pipe_confirmacao").select("*").eq("lead_id", leadId),
        supabase.from("pipe_propostas").select("*").eq("lead_id", leadId),
      ]);

      return {
        whatsapp: whatsapp.data || [],
        confirmacao: confirmacao.data || [],
        propostas: propostas.data || [],
      };
    },
    enabled: !!leadId && open,
  });

  const formatCurrency = (value: number | null | undefined) => {
    if (!value) return "R$ 0";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : lead ? (
          <>
            {/* Header */}
            <div className="p-6 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xl font-bold text-primary">
                      {lead.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{lead.name}</h2>
                    {lead.company && (
                      <p className="text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Building2 className="w-4 h-4" />
                        {lead.company}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className={originColors[lead.origin] || originColors.outro}>
                        {originLabels[lead.origin] || lead.origin}
                      </Badge>
                      <div className="flex items-center gap-0.5">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              "w-3.5 h-3.5",
                              i < Math.ceil((lead.rating || 0) / 2)
                                ? "fill-chart-5 text-chart-5"
                                : "text-muted-foreground/30"
                            )}
                          />
                        ))}
                        <span className="text-xs text-muted-foreground ml-1">({lead.rating}/10)</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {onEdit && (
                    <Button variant="outline" size="sm" onClick={onEdit}>
                      <Edit2 className="w-4 h-4 mr-2" />
                      Editar
                    </Button>
                  )}
                  
                  {/* AI Toggle */}
                  {(() => {
                    // Usar estado otimista se disponível, senão usar o valor do lead
                    const currentAiDisabled = optimisticAiDisabled !== null 
                      ? optimisticAiDisabled 
                      : (lead.ai_disabled ?? false);
                    
                    return (
                      <motion.div 
                        className="flex items-center gap-2"
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
                            "w-4 h-4 transition-colors duration-200",
                            currentAiDisabled ? "text-muted-foreground" : "text-primary"
                          )} />
                        </motion.div>
                        <motion.span 
                          className="text-xs text-muted-foreground"
                          animate={{
                            opacity: currentAiDisabled ? 0.5 : 1,
                          }}
                          transition={{ duration: 0.2 }}
                        >
                          IA Copilot
                        </motion.span>
                        <motion.div
                          animate={{
                            scale: toggleAIMutation.isPending ? 0.95 : 1,
                          }}
                          transition={{ duration: 0.15 }}
                        >
                          <Switch
                            checked={!currentAiDisabled}
                            onCheckedChange={(checked) => {
                              // Atualização otimista local imediata
                              setOptimisticAiDisabled(!checked);
                              toggleAIMutation.mutate(
                                { leadId: lead.id, disabled: !checked },
                                {
                                  onSuccess: () => {
                                    toast({
                                      title: checked ? "IA ativada" : "IA desativada",
                                      description: checked 
                                        ? "O Copilot voltará a responder mensagens deste lead."
                                        : "O Copilot não responderá mais mensagens deste lead.",
                                    });
                                    // Resetar estado otimista após sucesso
                                    setOptimisticAiDisabled(null);
                                  },
                                  onError: () => {
                                    toast({
                                      title: "Erro",
                                      description: "Não foi possível alterar o status da IA.",
                                      variant: "destructive",
                                    });
                                    // Reverter estado otimista em caso de erro
                                    setOptimisticAiDisabled(null);
                                  },
                                }
                              );
                            }}
                            disabled={toggleAIMutation.isPending}
                          />
                        </motion.div>
                      </motion.div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Content */}
            <Tabs defaultValue="info" className="flex-1">
              <div className="px-6 pt-2">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="info">Informações</TabsTrigger>
                  <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
                  <TabsTrigger value="history">Histórico</TabsTrigger>
                  <TabsTrigger value="ai" className="flex items-center gap-1">
                    <Bot className="w-3.5 h-3.5" />
                    IA Copilot
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea className="h-[400px]">
                <TabsContent value="info" className="p-6 pt-4 space-y-6 m-0">
                  {/* Contact Info */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-muted-foreground" />
                      Contato
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {lead.email && (
                        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{lead.email}</span>
                        </div>
                      )}
                      {lead.phone && (
                        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                          <Phone className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{lead.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Team Assignment */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      Equipe
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">SDR</p>
                        <p className="font-medium">{lead.sdr?.name || "Não atribuído"}</p>
                      </div>
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">Closer</p>
                        <p className="font-medium">{lead.closer?.name || "Não atribuído"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Tags */}
                  {lead.lead_tags?.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Tag className="w-4 h-4 text-muted-foreground" />
                        Tags
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {lead.lead_tags.map((lt: any) => (
                          <Badge
                            key={lt.tag?.id}
                            variant="outline"
                            style={{ borderColor: lt.tag?.color, backgroundColor: `${lt.tag?.color}20` }}
                          >
                            {lt.tag?.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Additional Info */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-muted-foreground" />
                      Detalhes
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      {lead.segment && (
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">Segmento</p>
                          <p className="font-medium text-sm">{lead.segment}</p>
                        </div>
                      )}
                      {lead.faturamento && (
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">Faturamento</p>
                          <p className="font-medium text-sm">{lead.faturamento}</p>
                        </div>
                      )}
                      {lead.urgency && (
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">Urgência</p>
                          <p className="font-medium text-sm">{lead.urgency}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Marketing (UTM) */}
                  {(lead.utm_campaign || lead.utm_source || lead.utm_medium || lead.utm_content || lead.utm_term) && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <History className="w-4 h-4 text-muted-foreground" />
                        Marketing (UTM)
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        {lead.utm_campaign && (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">utm_campaign</p>
                            <p className="font-medium text-sm break-words">{lead.utm_campaign}</p>
                          </div>
                        )}
                        {lead.utm_source && (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">utm_source</p>
                            <p className="font-medium text-sm break-words">{lead.utm_source}</p>
                          </div>
                        )}
                        {lead.utm_medium && (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">utm_medium</p>
                            <p className="font-medium text-sm break-words">{lead.utm_medium}</p>
                          </div>
                        )}
                        {lead.utm_content && (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">utm_content</p>
                            <p className="font-medium text-sm break-words">{lead.utm_content}</p>
                          </div>
                        )}
                        {lead.utm_term && (
                          <div className="p-3 bg-muted rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">utm_term</p>
                            <p className="font-medium text-sm break-words">{lead.utm_term}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {lead.notes && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3">Observações</h3>
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="pipeline" className="p-6 pt-4 space-y-6 m-0">
                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-3">
                    <StatCard
                      label="WhatsApp"
                      value={pipeData?.whatsapp?.length || 0}
                      icon={MessageSquare}
                    />
                    <StatCard
                      label="Reuniões"
                      value={pipeData?.confirmacao?.length || 0}
                      icon={Calendar}
                    />
                    <StatCard
                      label="Propostas"
                      value={pipeData?.propostas?.length || 0}
                      icon={DollarSign}
                    />
                    <StatCard
                      label="Vendas"
                      value={pipeData?.propostas?.filter((p: any) => p.status === "vendido").length || 0}
                      icon={CheckCircle}
                      variant="success"
                    />
                  </div>

                  {/* Pipeline Progress */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold">Jornada do Lead</h3>
                    
                    {/* WhatsApp */}
                    {pipeData?.whatsapp?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                      >
                        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                          <MessageSquare className="w-5 h-5 text-success" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">WhatsApp SDR</p>
                          <p className="text-xs text-muted-foreground">
                            Status: {item.status}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </motion.div>
                    ))}

                    {/* Confirmacao */}
                    {pipeData?.confirmacao?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Calendar className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">Confirmação de Reunião</p>
                          <p className="text-xs text-muted-foreground">
                            Status: {item.status}
                            {item.meeting_date && ` • ${format(new Date(item.meeting_date), "dd/MM HH:mm")}`}
                          </p>
                        </div>
                        <Badge variant={item.status === "compareceu" ? "default" : "outline"}>
                          {item.status}
                        </Badge>
                      </motion.div>
                    ))}

                    {/* Propostas */}
                    {pipeData?.propostas?.map((item: any) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg",
                          item.status === "vendido" ? "bg-success/10" : "bg-muted"
                        )}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center",
                          item.status === "vendido" ? "bg-success/20" : "bg-chart-5/10"
                        )}>
                          <DollarSign className={cn(
                            "w-5 h-5",
                            item.status === "vendido" ? "text-success" : "text-chart-5"
                          )} />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">Proposta</p>
                          <p className="text-xs text-muted-foreground">
                            {item.product_type?.toUpperCase()} • {formatCurrency(item.sale_value)}
                          </p>
                        </div>
                        <Badge 
                          variant={item.status === "vendido" ? "default" : "outline"}
                          className={item.status === "vendido" ? "bg-success text-success-foreground" : ""}
                        >
                          {item.status}
                        </Badge>
                      </motion.div>
                    ))}

                    {!pipeData?.whatsapp?.length && !pipeData?.confirmacao?.length && !pipeData?.propostas?.length && (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        Este lead ainda não entrou em nenhum pipeline.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="history" className="p-6 pt-4 m-0">
                  {history && history.length > 0 ? (
                    <div className="space-y-0">
                      {history.map((item, index) => (
                        <TimelineItem
                          key={item.id}
                          action={item.action}
                          description={item.description || undefined}
                          date={item.created_at}
                          isLast={index === history.length - 1}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Nenhum histórico registrado.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="ai" className="m-0">
                  <ConversationHistoryTab leadId={lead.id} leadName={lead.name} />
                </TabsContent>
              </ScrollArea>
            </Tabs>

            {/* Footer */}
            <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Criado em {format(new Date(lead.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </>
        ) : (
          <div className="p-6 text-center">
            <p className="text-muted-foreground">Lead não encontrado.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
