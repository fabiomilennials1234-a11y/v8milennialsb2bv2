import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Zap,
  UserPlus,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
import { formatDistanceToNow, isToday, isBefore, addHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface Alert {
  id: string;
  type:
    | "meeting_today"
    | "follow_up_due"
    | "meeting_soon"
    | "overdue"
    | "transfer_to_human"
    | "mention";
  title: string;
  description: string;
  time: Date;
  link?: string;
  priority: "low" | "medium" | "high";
  notificationId?: string; // Para marcar como lida ao clicar
}

const ALERTS_VIEWED_KEY = "v8-alerts-viewed-ids";
const MAX_VIEWED_IDS = 200;

function getViewedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ALERTS_VIEWED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr.slice(-MAX_VIEWED_IDS) : []);
  } catch {
    return new Set();
  }
}

function addViewedIds(ids: string[]) {
  try {
    const set = getViewedIds();
    ids.forEach((id) => set.add(id));
    const arr = Array.from(set).slice(-MAX_VIEWED_IDS);
    localStorage.setItem(ALERTS_VIEWED_KEY, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

export function AlertsDropdown() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { organizationId, isReady } = useOrganization();
  const [open, setOpen] = useState(false);
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => getViewedIds());

  useEffect(() => {
    setViewedIds(getViewedIds());
  }, []);

  const { data: alerts = [] } = useQuery({
    queryKey: ["user-alerts", organizationId, user?.id],
    queryFn: async (): Promise<Alert[]> => {
      if (!organizationId || !user?.id) return [];
      const now = new Date();
      const alerts: Alert[] = [];

      // Get meetings today (scoped to current organization)
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      const { data: meetings } = await supabase
        .from("pipe_confirmacao")
        .select(`
          id,
          meeting_date,
          status,
          lead:leads(name, company)
        `)
        .eq("organization_id", organizationId)
        .gte("meeting_date", startOfDay.toISOString())
        .lte("meeting_date", endOfDay.toISOString())
        .not("status", "in", '("compareceu","perdido")');

      meetings?.forEach((meeting) => {
        const meetingDate = new Date(meeting.meeting_date);
        const isWithinNextHour = meetingDate > now && meetingDate < addHours(now, 1);
        
        alerts.push({
          id: `meeting-${meeting.id}`,
          type: isWithinNextHour ? "meeting_soon" : "meeting_today",
          title: isWithinNextHour ? "Reunião em breve!" : "Reunião hoje",
          description: `${meeting.lead?.name}${meeting.lead?.company ? ` - ${meeting.lead.company}` : ""}`,
          time: meetingDate,
          link: "/pipe-confirmacao",
          priority: isWithinNextHour ? "high" : "medium",
        });
      });

      // Get overdue follow-ups (excluir arquivadas, scoped to organization)
      const { data: followUps } = await supabase
        .from("follow_ups")
        .select(`
          id,
          title,
          due_date,
          priority,
          lead:leads(name)
        `)
        .eq("organization_id", organizationId)
        .is("completed_at", null)
        .is("archived_at", null)
        .lte("due_date", now.toISOString())
        .order("due_date", { ascending: true })
        .limit(5);

      followUps?.forEach((followUp) => {
        alerts.push({
          id: `followup-${followUp.id}`,
          type: "overdue",
          title: "Follow-up atrasado",
          description: `${followUp.title} - ${followUp.lead?.name}`,
          time: new Date(followUp.due_date),
          link: "/follow-ups",
          priority: followUp.priority === "high" ? "high" : "medium",
        });
      });

      // Get follow-ups due today (excluir arquivadas, scoped to organization)
      const { data: todayFollowUps } = await supabase
        .from("follow_ups")
        .select(`
          id,
          title,
          due_date,
          lead:leads(name)
        `)
        .eq("organization_id", organizationId)
        .is("completed_at", null)
        .is("archived_at", null)
        .gte("due_date", startOfDay.toISOString())
        .lte("due_date", endOfDay.toISOString())
        .order("due_date", { ascending: true })
        .limit(5);

      todayFollowUps?.forEach((followUp) => {
        if (!isBefore(new Date(followUp.due_date), now)) {
          alerts.push({
            id: `followup-today-${followUp.id}`,
            type: "follow_up_due",
            title: "Follow-up para hoje",
            description: `${followUp.title} - ${followUp.lead?.name}`,
            time: new Date(followUp.due_date),
            link: "/follow-ups",
            priority: "medium",
          });
        }
      });

      // Notificações — `transfer_to_human` e `mention`.
      //
      // ⚠️ `link` PRECISA estar neste select. Ele já existia na tabela e o
      // gatilho de menção o preenche (`/leads?lead=…&comment=…`), mas o
      // PostgREST devolve só as colunas projetadas: sem pedir a coluna,
      // `n.link` chega `undefined` e o `||` abaixo recua SEMPRE para
      // `/pipe-whatsapp`. O efeito era o defeito relatado — clicar numa
      // notificação de menção não levava ao comentário, levava ao funil.
      // O compilador sabia: `.tsc-baseline.json` carregava o
      // `TS2339 Property 'link' does not exist` desta linha, e o Vite não
      // typecheca, então o erro embarcava.
      const { data: unreadNotifs } = await supabase
        .from("notifications")
        .select("id, type, title, description, lead_id, created_at, link")
        .eq("user_id", user.id)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(10);

      unreadNotifs?.forEach((n) => {
        // O tipo vinha cravado em `transfer_to_human` para TODA notificação, o
        // que dava à menção o ícone e o vermelho de "lead precisa de
        // atendimento humano". Só os tipos que esta lista sabe desenhar passam;
        // qualquer outro cai no fallback, que é o comportamento antigo.
        const tipo: Alert["type"] = n.type === "mention" ? "mention" : "transfer_to_human";
        alerts.push({
          id: `notification-${n.id}`,
          type: tipo,
          title:
            n.title ||
            (tipo === "mention" ? "Mencionaram você" : "Lead precisa de atendimento humano"),
          description: n.description || "",
          time: new Date(n.created_at),
          link: n.link || "/pipe-whatsapp",
          priority: "high",
          notificationId: n.id,
        });
      });

      // Sort by priority and time
      return alerts.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return a.time.getTime() - b.time.getTime();
      });
    },
    enabled: isReady && !!organizationId && !!user?.id,
    refetchInterval: 60000, // Refresh every minute
  });

  const unseenAlerts = alerts.filter((a) => !viewedIds.has(a.id));
  const unseenCount = unseenAlerts.length;
  const highPriorityCount = unseenAlerts.filter((a) => a.priority === "high").length;
  const hasAlerts = unseenCount > 0;

  const handleOpenChangeWithMarkSeen = useCallback((next: boolean) => {
    setOpen(next);
    if (next && alerts.length > 0) {
      addViewedIds(alerts.map((a) => a.id));
      setViewedIds((prev) => {
        const nextSet = new Set(prev);
        alerts.forEach((a) => nextSet.add(a.id));
        return nextSet;
      });
    }
  }, [alerts]);

  const getAlertIcon = (type: Alert["type"]) => {
    switch (type) {
      case "meeting_soon":
        return <Zap className="w-4 h-4 text-chart-5" />;
      case "meeting_today":
        return <Calendar className="w-4 h-4 text-primary" />;
      case "follow_up_due":
        return <Clock className="w-4 h-4 text-warning" />;
      case "overdue":
        return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case "transfer_to_human":
        return <UserPlus className="w-4 h-4 text-destructive" />;
      case "mention":
        // Âmbar é a cor do comentário em todo o produto (ver o histórico da
        // ficha do lead e o bloco do Negócio) — a menção herda dela.
        return <MessageSquare className="w-4 h-4 text-amber-400" />;
      default:
        return <Bell className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getAlertBg = (type: Alert["type"]) => {
    switch (type) {
      case "meeting_soon":
        return "bg-chart-5/10";
      case "meeting_today":
        return "bg-primary/10";
      case "follow_up_due":
        return "bg-warning/10";
      case "overdue":
        return "bg-destructive/10";
      case "transfer_to_human":
        return "bg-red-500/10";
      case "mention":
        return "bg-amber-500/10";
      default:
        return "bg-muted/50";
    }
  };

  const handleAlertClick = async (alert: Alert) => {
    if (alert.notificationId) {
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", alert.notificationId);
      queryClient.invalidateQueries({ queryKey: ["user-alerts"] });
    }
    if (alert.link) {
      navigate(alert.link);
      setOpen(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChangeWithMarkSeen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {hasAlerts && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn(
                "absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                highPriorityCount > 0
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {unseenCount > 9 ? "9+" : unseenCount}
            </motion.span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold">Notificações</h3>
          {alerts.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {alerts.length} {alerts.length === 1 ? "item" : "itens"}
            </Badge>
          )}
        </div>
        
        {alerts.length > 0 ? (
          <ScrollArea className="h-[300px]">
            <div className="p-2 space-y-1">
              <AnimatePresence mode="popLayout">
                {alerts.map((alert, index) => (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => handleAlertClick(alert)}
                    className={cn(
                      "p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted/50",
                      getAlertBg(alert.type)
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {getAlertIcon(alert.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{alert.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {alert.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(alert.time, { addSuffix: true, locale: ptBR })}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground mt-1" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </ScrollArea>
        ) : (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-success/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Tudo em dia! Nenhuma notificação pendente.
            </p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
