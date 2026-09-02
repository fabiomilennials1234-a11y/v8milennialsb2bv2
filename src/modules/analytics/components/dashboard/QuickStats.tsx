import { memo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfDay, endOfDay, isToday, isBefore } from "date-fns";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/modules/identity";
import { limitesDoDia } from "@/shared/time/dia-da-org";
interface QuickStatsProps {
  className?: string;
}

function QuickStatsBase({ className }: QuickStatsProps) {
  const { organizationId, isReady, timezone } = useOrganization();

  const { data: stats } = useQuery({
    // `timezone` na chave: as fronteiras de dia abaixo dependem dele e ele
    // chega null nos primeiros renders.
    queryKey: ["quick-stats", organizationId, timezone],
    queryFn: async () => {
      if (!organizationId) {
        return {
          meetingsToday: 0,
          confirmedToday: 0,
          pendingFollowUps: 0,
          overdueFollowUps: 0,
          newLeadsToday: 0,
        };
      }
      const now = new Date();
      const todayStart = startOfDay(now).toISOString();
      const todayEnd = endOfDay(now).toISOString();
      // Reunião e lead novo seguem no corte do browser (fora do escopo da
      // SCRUM-607); só os dois contadores de follow-up passam para o fuso da
      // org, que é onde a divergência com a lista aparecia.
      const { inicioDeHoje, inicioDeAmanha } = limitesDoDia(timezone, now);

      const { count: meetingsToday } = await supabase
        .from("pipe_confirmacao")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("meeting_date", todayStart)
        .lte("meeting_date", todayEnd);

      const { count: confirmedToday } = await supabase
        .from("pipe_confirmacao")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("meeting_date", todayStart)
        .lte("meeting_date", todayEnd)
        .eq("is_confirmed", true);

      /**
       * Os dois contadores de follow-up, agora DISJUNTOS e no fuso da org.
       *
       * Três defeitos moravam nestas duas consultas (SCRUM-607):
       *
       *  1. "Pendentes" era `due_date <= fim de hoje`, o que INCLUÍA os
       *     atrasados. Somar os dois cartões contava a mesma linha duas vezes;
       *  2. "Atrasados" cortava por INSTANTE (`due_date < agora`), enquanto a
       *     lista da Revisão cortava por DIA. Um follow-up que vence hoje às
       *     09:00, visto às 15:00, era "Atrasado" no cartão e "de hoje" na
       *     lista — mesma linha, dois veredictos;
       *  3. nenhuma das duas filtrava `archived_at`, e a lista filtra. Era o
       *     "número que não bate com a tela": follow-up arquivado contava aqui
       *     e não existia lá.
       *
       * Agora: atrasado = venceu num dia anterior; pendente = vence HOJE. Um
       * follow-up cai em exatamente um dos dois.
       */
      const { count: pendingFollowUps } = await supabase
        .from("follow_ups")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("completed_at", null)
        .is("archived_at", null)
        .gte("due_date", inicioDeHoje)
        .lt("due_date", inicioDeAmanha);

      const { count: overdueFollowUps } = await supabase
        .from("follow_ups")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("completed_at", null)
        .is("archived_at", null)
        .lt("due_date", inicioDeHoje);

      const { count: newLeadsToday } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      return {
        meetingsToday: meetingsToday || 0,
        confirmedToday: confirmedToday || 0,
        pendingFollowUps: pendingFollowUps || 0,
        overdueFollowUps: overdueFollowUps || 0,
        newLeadsToday: newLeadsToday || 0,
      };
    },
    enabled: isReady && !!organizationId,
    refetchInterval: 1000 * 60 * 2, // 2 minutos
  });

  if (!stats) return null;

  const items = [
    {
      label: "Reuniões hoje",
      value: stats.meetingsToday,
      icon: Calendar,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Confirmadas",
      value: stats.confirmedToday,
      icon: CheckCircle,
      color: "text-success",
      bg: "bg-success/10",
    },
    {
      // "hoje", não "pendentes": o cartão deixou de somar os atrasados, e
      // manter o rótulo antigo sobre um número que mudou de significado é como
      // a divergência começa de novo.
      label: "Follow-ups hoje",
      value: stats.pendingFollowUps,
      icon: Clock,
      color: "text-warning",
      bg: "bg-warning/10",
      alert: stats.pendingFollowUps > 5,
    },
    {
      label: "Atrasados",
      value: stats.overdueFollowUps,
      icon: AlertTriangle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      alert: stats.overdueFollowUps > 0,
    },
  ];

  return (
    <div className={cn("flex items-center gap-6", className)}>
      {items.map((item, index) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className="flex items-center gap-2"
        >
          <div className={cn("p-1.5 rounded-md", item.bg)}>
            <item.icon className={cn("w-4 h-4", item.color)} />
          </div>
          <div>
            <p className={cn(
              "text-lg font-bold leading-none",
              item.alert && "text-destructive"
            )}>
              {item.value}
            </p>
            <p className="text-xs text-muted-foreground">{item.label}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export const QuickStats = memo(QuickStatsBase);
