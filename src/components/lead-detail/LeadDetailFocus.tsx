import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Calendar } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface LeadDetailFocusProps {
  leadId: string;
}

export const LeadDetailFocus = memo(function LeadDetailFocus({ leadId }: LeadDetailFocusProps) {
  const { data: followUps } = useQuery({
    queryKey: ["lead-followups-pending", leadId],
    queryFn: async () => {
      const { data } = await supabase
        .from("follow_ups")
        .select("*")
        .eq("lead_id", leadId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1);
      return data || [];
    },
    enabled: !!leadId,
  });

  const { data: meetings } = useQuery({
    queryKey: ["lead-meetings-upcoming", leadId],
    queryFn: async () => {
      const { data } = await supabase
        .from("pipe_confirmacao")
        .select("*")
        .eq("lead_id", leadId)
        .in("status", ["marcada", "d5", "d3", "d1"])
        .order("meeting_date", { ascending: true })
        .limit(1);
      return data || [];
    },
    enabled: !!leadId,
  });

  const pendingFollowUp = followUps?.[0];
  const upcomingMeeting = meetings?.[0];

  if (!pendingFollowUp && !upcomingMeeting) return null;

  return (
    <div className="space-y-2 mb-3">
      {pendingFollowUp && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Clock className="w-3 h-3 text-amber-500" />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-500">Follow-up</span>
          </div>
          <p className="text-xs text-foreground/60">
            {pendingFollowUp.due_date
              ? formatDistanceToNow(new Date(pendingFollowUp.due_date), { addSuffix: true, locale: ptBR })
              : "Sem data"}
            {pendingFollowUp.notes && ` — ${pendingFollowUp.notes}`}
          </p>
        </div>
      )}
      {upcomingMeeting?.meeting_date && (
        <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Calendar className="w-3 h-3 text-blue-400" />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-400">Reunião</span>
          </div>
          <p className="text-xs text-foreground/60">
            {format(new Date(upcomingMeeting.meeting_date), "dd/MM 'às' HH:mm", { locale: ptBR })}
            {" — "}{upcomingMeeting.status}
          </p>
        </div>
      )}
    </div>
  );
});
