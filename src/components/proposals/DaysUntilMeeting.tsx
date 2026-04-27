import { differenceInDays, differenceInHours, isToday, isTomorrow, isPast } from "date-fns";
import { Clock, AlertTriangle, CheckCircle2, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DaysUntilMeetingProps {
  commitmentDate: Date;
  compact?: boolean;
}

export function DaysUntilMeeting({ commitmentDate, compact = false }: DaysUntilMeetingProps) {
  const now = new Date();
  const daysUntil = differenceInDays(commitmentDate, now);
  const hoursUntil = differenceInHours(commitmentDate, now);

  let icon: React.ReactNode;
  let text: string;
  let variant: "default" | "destructive" | "warning" | "success" | "outline" = "default";
  let bgClass: string = "";
  let textClass: string = "";

  if (isPast(commitmentDate) && !isToday(commitmentDate)) {
    icon = <AlertTriangle className="w-3 h-3" />;
    text = "Atrasado";
    variant = "destructive";
    bgClass = "bg-destructive/10 border-destructive/30";
    textClass = "text-destructive";
  } else if (isToday(commitmentDate)) {
    icon = <CheckCircle2 className="w-3 h-3" />;
    text = hoursUntil <= 0 ? "Agora!" : `Hoje ${hoursUntil}h`;
    variant = "destructive";
    bgClass = "bg-destructive/10 border-destructive/30";
    textClass = "text-destructive";
  } else if (isTomorrow(commitmentDate)) {
    icon = <Clock className="w-3 h-3" />;
    text = "Amanhã";
    variant = "warning";
    bgClass = "bg-chart-5/10 border-chart-5/30";
    textClass = "text-chart-5";
  } else if (daysUntil <= 3) {
    icon = <Clock className="w-3 h-3" />;
    text = `${daysUntil} dias`;
    variant = "warning";
    bgClass = "bg-chart-5/10 border-chart-5/30";
    textClass = "text-chart-5";
  } else if (daysUntil <= 7) {
    icon = <Calendar className="w-3 h-3" />;
    text = `${daysUntil} dias`;
    variant = "outline";
    bgClass = "bg-primary/10 border-primary/30";
    textClass = "text-primary";
  } else {
    icon = <Calendar className="w-3 h-3" />;
    text = `${daysUntil} dias`;
    variant = "outline";
    bgClass = "bg-muted border-muted-foreground/20";
    textClass = "text-muted-foreground";
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border", bgClass, textClass)}>
        {icon}
        <span className="font-medium">{text}</span>
      </div>
    );
  }

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "flex items-center gap-1.5 font-medium",
        bgClass,
        textClass
      )}
    >
      {icon}
      <span>{text}</span>
    </Badge>
  );
}
