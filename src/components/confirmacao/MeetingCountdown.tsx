import { differenceInMinutes, differenceInHours, differenceInDays, isPast } from "date-fns";
import { Clock, AlertTriangle, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

interface MeetingCountdownProps {
  meetingDate: Date;
  variant?: "default" | "compact";
  className?: string;
}

export function MeetingCountdown({ meetingDate, variant = "default", className }: MeetingCountdownProps) {
  const now = new Date();
  const isOverdue = isPast(meetingDate);
  
  const days = Math.abs(differenceInDays(meetingDate, now));
  const totalHours = Math.abs(differenceInHours(meetingDate, now));
  const totalMinutes = Math.abs(differenceInMinutes(meetingDate, now));

  const getTimeText = () => {
    if (isOverdue) {
      if (days >= 1) return `Atrasada há ${days} dia${days > 1 ? 's' : ''}`;
      if (totalHours >= 1) return `Atrasada há ${totalHours}h`;
      return `Atrasada há ${totalMinutes}min`;
    }
    
    if (days >= 1) return `Falta ${days} dia${days > 1 ? 's' : ''}`;
    if (totalHours >= 1) return `Falta ${totalHours}h`;
    if (totalMinutes >= 1) return `Falta ${totalMinutes}min`;
    return "Agora!";
  };

  const getUrgencyLevel = () => {
    if (isOverdue) return "overdue";
    if (totalMinutes <= 60) return "imminent";
    if (totalHours <= 2) return "urgent";
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days <= 3) return "soon";
    return "normal";
  };

  const urgency = getUrgencyLevel();

  return (
    <div className={cn(
      "flex items-center gap-1.5 text-xs font-medium",
      urgency === "overdue" && "text-destructive",
      urgency === "imminent" && "text-destructive animate-pulse",
      urgency === "urgent" && "text-orange-500",
      urgency === "today" && "text-warning",
      urgency === "tomorrow" && "text-yellow-500",
      urgency === "soon" && "text-blue-500",
      urgency === "normal" && "text-muted-foreground",
      className
    )}>
      {urgency === "overdue" || urgency === "imminent" ? (
        <AlertTriangle className="w-3 h-3" />
      ) : (
        <Timer className="w-3 h-3" />
      )}
      <span>{getTimeText()}</span>
    </div>
  );
}
