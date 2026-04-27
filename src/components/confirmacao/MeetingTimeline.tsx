import { motion } from "framer-motion";
import { 
  Calendar, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  ChevronRight
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format, isToday, isTomorrow, differenceInMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";

interface MeetingTimelineProps {
  meetings: any[];
  onMeetingClick?: (meeting: any) => void;
}

export function MeetingTimeline({ meetings, onMeetingClick }: MeetingTimelineProps) {
  // Filter meetings for today and tomorrow, sorted by time
  const todayMeetings = meetings
    .filter(m => m.meeting_date && isToday(new Date(m.meeting_date)) && !["compareceu", "perdido"].includes(m.status))
    .sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());

  const tomorrowMeetings = meetings
    .filter(m => m.meeting_date && isTomorrow(new Date(m.meeting_date)) && !["compareceu", "perdido"].includes(m.status))
    .sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());

  if (todayMeetings.length === 0 && tomorrowMeetings.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Calendar className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">Nenhuma reunião agendada para hoje ou amanhã</p>
      </Card>
    );
  }

  const now = new Date();

  const renderMeetingItem = (meeting: any, idx: number) => {
    const meetingTime = new Date(meeting.meeting_date);
    const lead = meeting.lead;
    const minutesUntil = differenceInMinutes(meetingTime, now);
    const isPastMeeting = minutesUntil < 0;
    const isImminent = minutesUntil > 0 && minutesUntil <= 30;
    const isSoon = minutesUntil > 30 && minutesUntil <= 60;

    return (
      <motion.div
        key={meeting.id}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: idx * 0.1 }}
        className={cn(
          "relative flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md",
          isPastMeeting && "bg-muted/50 border-border opacity-60",
          isImminent && "bg-destructive/5 border-destructive/30 ring-1 ring-destructive/20",
          isSoon && "bg-warning/5 border-warning/30",
          !isPastMeeting && !isImminent && !isSoon && "bg-card border-border hover:border-primary/30"
        )}
        onClick={() => onMeetingClick?.(meeting)}
      >
        {/* Time Column */}
        <div className={cn(
          "flex flex-col items-center min-w-[60px]",
          isPastMeeting && "text-muted-foreground",
          isImminent && "text-destructive",
          isSoon && "text-warning"
        )}>
          <span className="text-2xl font-bold">
            {format(meetingTime, "HH:mm")}
          </span>
          {isImminent && (
            <span className="text-xs font-medium animate-pulse">
              Em {minutesUntil}min
            </span>
          )}
          {isSoon && (
            <span className="text-xs font-medium">
              Em {minutesUntil}min
            </span>
          )}
        </div>

        {/* Divider */}
        <div className={cn(
          "w-1 h-16 rounded-full",
          isPastMeeting && "bg-muted-foreground/30",
          isImminent && "bg-destructive animate-pulse",
          isSoon && "bg-warning",
          !isPastMeeting && !isImminent && !isSoon && "bg-primary/30"
        )} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold truncate">{lead?.name || "Lead"}</h4>
            {isImminent && (
              <Badge variant="destructive" className="text-xs animate-pulse">
                <AlertCircle className="w-3 h-3 mr-1" />
                Iminente
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {lead?.company || "Sem empresa"}
          </p>
          <div className="flex items-center gap-3 mt-2">
            {meeting.closer?.name && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <div className="w-4 h-4 rounded-full bg-chart-5/20 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-chart-5">C</span>
                </div>
                {meeting.closer.name}
              </span>
            )}
            {meeting.sdr?.name && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <div className="w-4 h-4 rounded-full bg-chart-2/20 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-chart-2">S</span>
                </div>
                {meeting.sdr.name}
              </span>
            )}
          </div>
        </div>

        {/* Action */}
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Today's Meetings */}
      {todayMeetings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Calendar className="w-4 h-4 text-primary" />
            </div>
            <h3 className="font-semibold">Hoje</h3>
            <Badge variant="secondary" className="ml-auto">
              {todayMeetings.length} {todayMeetings.length === 1 ? "reunião" : "reuniões"}
            </Badge>
          </div>
          <div className="space-y-2">
            {todayMeetings.map((meeting, idx) => renderMeetingItem(meeting, idx))}
          </div>
        </div>
      )}

      {/* Tomorrow's Meetings */}
      {tomorrowMeetings.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-chart-2/10">
              <Clock className="w-4 h-4 text-chart-2" />
            </div>
            <h3 className="font-semibold">Amanhã</h3>
            <Badge variant="secondary" className="ml-auto">
              {tomorrowMeetings.length} {tomorrowMeetings.length === 1 ? "reunião" : "reuniões"}
            </Badge>
          </div>
          <div className="space-y-2">
            {tomorrowMeetings.map((meeting, idx) => renderMeetingItem(meeting, idx))}
          </div>
        </div>
      )}
    </div>
  );
}
