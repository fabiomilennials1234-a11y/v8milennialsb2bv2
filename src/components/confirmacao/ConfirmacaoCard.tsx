import { motion } from "framer-motion";
import { 
  Star, 
  Building2, 
  Calendar, 
  User, 
  Clock,
  Phone,
  Mail,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  MessageCircle,
  Check
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openWhatsApp, formatPhoneForWhatsApp } from "@/lib/whatsapp";
import { format, isToday, isTomorrow, isPast, differenceInHours, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { QuickAddDailyAction } from "./QuickAddDailyAction";
import { MeetingCountdown } from "./MeetingCountdown";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import type { Database } from "@/integrations/supabase/types";

type PipeConfirmacaoStatus = Database["public"]["Enums"]["pipe_confirmacao_status"];

interface ConfirmacaoCardProps {
  card: {
    id: string;
    name: string;
    company: string;
    email?: string;
    phone?: string;
    meetingDate?: string;
    meetingDateTime?: Date;
    rating: number;
    origin: "calendly" | "whatsapp" | "meta_ads" | "outro";
    sdr?: string;
    closer?: string;
    tags: string[];
    leadId: string;
    faturamento?: number;
    segment?: string;
    urgency?: string;
    status?: string;
    confirmacaoId?: string;
    isConfirmed?: boolean;
  };
  onClick?: () => void;
  variant?: "default" | "compact" | "detailed";
}

const urgencyConfig: Record<string, { label: string; color: string }> = {
  "imediato": { label: "🔥 Imediato", color: "bg-red-500/10 text-red-500 border-red-500/30" },
  "1-mes": { label: "⚡ 1 mês", color: "bg-orange-500/10 text-orange-500 border-orange-500/30" },
  "2-3-meses": { label: "📅 2-3 meses", color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30" },
  "6-meses": { label: "🕐 6+ meses", color: "bg-muted text-muted-foreground border-border" },
};

const originConfig = {
  calendly: { label: "Calendly", color: "bg-purple-500/10 text-purple-500 border-purple-500/30", icon: "📅" },
  whatsapp: { label: "WhatsApp", color: "bg-green-500/10 text-green-500 border-green-500/30", icon: "💬" },
  meta_ads: { label: "Meta Ads", color: "bg-blue-500/10 text-blue-500 border-blue-500/30", icon: "📱" },
  outro: { label: "Outro", color: "bg-muted text-muted-foreground border-border", icon: "📋" },
};

function getMeetingIndicator(meetingDate: Date | null, status?: string) {
  if (!meetingDate) return null;
  
  if (["compareceu", "perdido"].includes(status || "")) return null;
  
  const now = new Date();
  const hours = differenceInHours(meetingDate, now);
  const days = differenceInDays(meetingDate, now);
  
  if (isPast(meetingDate) && !isToday(meetingDate)) {
    return { 
      type: "overdue", 
      label: "Atrasada", 
      className: "bg-destructive/20 text-destructive border-destructive/30 animate-pulse" 
    };
  }
  
  if (isToday(meetingDate)) {
    if (hours <= 2 && hours > 0) {
      return { 
        type: "imminent", 
        label: `Em ${hours}h`, 
        className: "bg-destructive/20 text-destructive border-destructive/30 animate-pulse" 
      };
    }
    return { 
      type: "today", 
      label: "Hoje", 
      className: "bg-warning/20 text-warning border-warning/30" 
    };
  }
  
  if (isTomorrow(meetingDate)) {
    return { 
      type: "tomorrow", 
      label: "Amanhã", 
      className: "bg-orange-500/20 text-orange-500 border-orange-500/30" 
    };
  }
  
  if (days <= 3) {
    return { 
      type: "soon", 
      label: `D-${days}`, 
      className: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30" 
    };
  }
  
  return null;
}

export function ConfirmacaoCard({ card, onClick, variant = "default" }: ConfirmacaoCardProps) {
  const origin = originConfig[card.origin] || originConfig.outro;
  const meetingDate = card.meetingDateTime || (card.meetingDate ? new Date(card.meetingDate) : null);
  const indicator = getMeetingIndicator(meetingDate, card.status);
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isConfirmadoNoDiaState, setIsConfirmadoNoDiaState] = useState(false);
  const isMeetingDay = meetingDate ? isToday(meetingDate) : false;
  const isCompareceu = card.status === "compareceu";

  // Check localStorage for "confirmed on the day" state on mount
  useEffect(() => {
    if (card.confirmacaoId) {
      const confirmedOnDay = localStorage.getItem(`confirmed_on_day_${card.confirmacaoId}`);
      if (confirmedOnDay === "true" && isMeetingDay) {
        setIsConfirmadoNoDiaState(true);
      } else if (!isMeetingDay) {
        // Reset if not meeting day anymore
        localStorage.removeItem(`confirmed_on_day_${card.confirmacaoId}`);
        setIsConfirmadoNoDiaState(false);
      }
    }
  }, [card.confirmacaoId, isMeetingDay]);

  // Cards with "compareceu" status are always shown as green
  const showAsGreen = isConfirmadoNoDiaState || isCompareceu;

  const handleToggleConfirmed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!card.confirmacaoId || isUpdating) return;
    
    setIsUpdating(true);
    try {
      // If already confirmed on the day or compareceu, do nothing
      if (showAsGreen) {
        setIsUpdating(false);
        toast.info("Já confirmada!");
        return;
      }

      // If it's the meeting day AND already pre-confirmed, confirm fully (green)
      if (isMeetingDay && card.isConfirmed) {
        localStorage.setItem(`confirmed_on_day_${card.confirmacaoId}`, "true");
        setIsConfirmadoNoDiaState(true);
        
        const { error } = await supabase
          .from("pipe_confirmacao")
          .update({ is_confirmed: true })
          .eq("id", card.confirmacaoId);
        
        if (error) throw error;
        
        queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
        toast.success("✅ Reunião confirmada no dia!");
        setIsUpdating(false);
        return;
      }

      // Toggle pre-confirmed state
      const newIsConfirmed = !card.isConfirmed;

      const { error } = await supabase
        .from("pipe_confirmacao")
        .update({ is_confirmed: newIsConfirmed })
        .eq("id", card.confirmacaoId);
      
      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      
      if (newIsConfirmed) {
        toast.success("🔵 Reunião pré-confirmada!");
      } else {
        toast.info("Pré-confirmação removida");
      }
    } catch (error) {
      toast.error("Erro ao atualizar confirmação");
    } finally {
      setIsUpdating(false);
    }
  };

  // Determine card border color based on confirmation status
  const getConfirmationStyle = () => {
    if (showAsGreen) return "ring-2 ring-green-500/50 border-green-500/30";
    if (card.isConfirmed) return "ring-2 ring-blue-500/50 border-blue-500/30";
    return "ring-1 ring-orange-500/30 border-orange-500/20";
  };

  const confirmationStyle = getConfirmationStyle();

  if (variant === "compact") {
    return (
      <motion.div
        whileHover={{ scale: 1.02 }}
        className={cn(
          "p-3 rounded-lg border bg-card cursor-pointer hover:shadow-md transition-all",
          showAsGreen ? "border-green-500/30 bg-green-500/5" : 
          card.isConfirmed ? "border-blue-500/30 bg-blue-500/5" : 
          "border-orange-500/30 bg-orange-500/5"
        )}
        onClick={onClick}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">{origin.icon}</span>
            <span className="font-medium text-sm truncate">{card.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {showAsGreen && (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            )}
            {card.isConfirmed && !showAsGreen && (
              <CheckCircle2 className="w-4 h-4 text-blue-500" />
            )}
            {indicator && (
              <Badge variant="outline" className={cn("text-xs shrink-0", indicator.className)}>
                {indicator.label}
              </Badge>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      className={cn(
        "kanban-card group cursor-pointer relative overflow-hidden",
        confirmationStyle,
        indicator?.type === "overdue" && "ring-1 ring-destructive/50",
        indicator?.type === "imminent" && "ring-2 ring-destructive/50 shadow-lg shadow-destructive/10",
        indicator?.type === "today" && !card.isConfirmed && "ring-1 ring-warning/50"
      )}
      onClick={onClick}
    >
      {/* Confirmation status strip - green for confirmed/compareceu, blue for pre-confirmed, orange for pending */}
      {showAsGreen ? (
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-green-500 via-green-400 to-green-500" />
      ) : card.isConfirmed ? (
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500" />
      ) : (
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-orange-500 via-orange-400 to-orange-500" />
      )}
      
      {/* Urgent indicator overlay */}
      {indicator?.type === "imminent" && !card.isConfirmed && !showAsGreen && (
        <div className="absolute top-1.5 left-0 right-0 h-0.5 bg-destructive animate-pulse" />
      )}
      {indicator?.type === "overdue" && (
        <div className="absolute top-1.5 left-0 right-0 h-0.5 bg-destructive" />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
              {card.name}
            </h4>
            {indicator && (
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5 shrink-0", indicator.className)}>
                {indicator.type === "imminent" && <AlertTriangle className="w-3 h-3 mr-1" />}
                {indicator.label}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
            <Building2 className="w-3 h-3" />
            <span className="text-xs truncate">{card.company || "Sem empresa"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2">
          {card.confirmacaoId && (
            <QuickAddDailyAction 
              confirmacaoId={card.confirmacaoId} 
              leadName={card.name} 
            />
          )}
          <div className="flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={cn(
                  "w-3 h-3",
                  i < card.rating
                    ? "text-primary fill-primary"
                    : "text-muted-foreground/30"
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Meeting Date with Countdown */}
      {meetingDate && (
        <div className={cn(
          "mb-3 p-2 rounded-lg",
          indicator?.type === "today" && "bg-warning/10",
          indicator?.type === "imminent" && "bg-destructive/10",
          indicator?.type === "overdue" && "bg-destructive/10",
          !indicator && "bg-muted/50"
        )}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className={cn(
                "w-4 h-4",
                indicator?.type === "today" && "text-warning",
                indicator?.type === "imminent" && "text-destructive",
                indicator?.type === "overdue" && "text-destructive"
              )} />
              <span className="text-xs font-medium">
                {format(meetingDate, "dd MMM, HH:mm", { locale: ptBR })}
              </span>
            </div>
          </div>
          {/* Countdown Timer */}
          {!["compareceu", "perdido"].includes(card.status || "") && (
            <MeetingCountdown meetingDate={meetingDate} variant="compact" className="mt-1" />
          )}
        </div>
      )}

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <Badge variant="outline" className={cn("text-xs", origin.color)}>
          <span className="mr-1">{origin.icon}</span>
          {origin.label}
        </Badge>
        {card.urgency && urgencyConfig[card.urgency] && (
          <Badge variant="outline" className={cn("text-xs", urgencyConfig[card.urgency].color)}>
            {urgencyConfig[card.urgency].label}
          </Badge>
        )}
        {card.segment && (
          <Badge variant="secondary" className="text-xs">
            {card.segment}
          </Badge>
        )}
        {card.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            {tag}
          </Badge>
        ))}
        {card.tags.length > 2 && (
          <Badge variant="secondary" className="text-xs">
            +{card.tags.length - 2}
          </Badge>
        )}
      </div>

      {/* Faturamento */}
      {card.faturamento && (
        <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
          <span>Faturamento:</span>
          <span className="font-medium text-foreground">
            R$ {card.faturamento.toLocaleString("pt-BR")}
          </span>
        </div>
      )}

      {/* Contact Info (on hover) */}
      {variant === "detailed" && (card.phone || card.email) && (
        <div className="space-y-1 mb-3 opacity-0 group-hover:opacity-100 transition-opacity">
          {card.phone && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Phone className="w-3 h-3" />
              <span>{card.phone}</span>
            </div>
          )}
          {card.email && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mail className="w-3 h-3" />
              <span className="truncate">{card.email}</span>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Button + Responsáveis */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="flex items-center gap-3">
          {/* Confirmation Toggle Button */}
          <Button
            variant={showAsGreen ? "default" : card.isConfirmed ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-7 px-2 text-xs font-medium transition-all",
              showAsGreen 
                ? "bg-green-500 hover:bg-green-600 text-white"
                : card.isConfirmed
                  ? "bg-blue-500 hover:bg-blue-600 text-white"
                  : "border-orange-500/50 text-orange-500 hover:bg-orange-500/10"
            )}
            onClick={handleToggleConfirmed}
            disabled={isUpdating || showAsGreen}
          >
            {showAsGreen ? (
              <>
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {isCompareceu ? "Compareceu" : "Confirmado"}
              </>
            ) : card.isConfirmed ? (
              isMeetingDay ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  Confirmar Hoje
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Pré-Confirmado
                </>
              )
            ) : (
              <>
                <Check className="w-3 h-3 mr-1" />
                {isMeetingDay ? "Confirmar" : "Pré-Confirmar"}
              </>
            )}
          </Button>
          
          {card.sdr && (
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-chart-2/20 flex items-center justify-center">
                <span className="text-[8px] font-bold text-chart-2">S</span>
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-[50px]">{card.sdr}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {card.closer && (
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-chart-5/20 flex items-center justify-center">
                <span className="text-[8px] font-bold text-chart-5">C</span>
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-[50px]">{card.closer}</span>
            </div>
          )}
          {formatPhoneForWhatsApp(card.phone) && (
            <button
              onClick={(e) => openWhatsApp(card.phone, e)}
              className="p-1.5 rounded-md bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] transition-colors"
              title="Abrir WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
