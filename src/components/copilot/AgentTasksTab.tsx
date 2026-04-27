/**
 * Aba de Tarefas Pendentes do Agente
 *
 * Lista de leads que precisam de ação:
 * - Leads aguardando follow-up
 * - Reuniões para confirmar
 * - Leads para reengajar
 * - Objeções não resolvidas
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Calendar,
  RefreshCw,
  AlertCircle,
  Phone,
  Building,
  MessageSquare,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Flame,
  Thermometer,
  Snowflake,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentPendingTasks } from "@/hooks/useAgentMetrics";

interface AgentTasksTabProps {
  agentId: string;
}

type TaskType = "followup" | "confirmation" | "reengage" | "all";
type TaskPriority = "high" | "medium" | "low";

interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  title: string;
  description: string;
  lead: any;
  metadata: Record<string, any>;
}

function TaskIcon({ type }: { type: TaskType }) {
  switch (type) {
    case "followup":
      return <Clock className="w-4 h-4 text-amber-500" />;
    case "confirmation":
      return <Calendar className="w-4 h-4 text-purple-500" />;
    case "reengage":
      return <RefreshCw className="w-4 h-4 text-red-500" />;
    default:
      return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
  }
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const styles = {
    high: "bg-red-500/10 text-red-500 border-red-500/20",
    medium: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  };

  const labels = {
    high: "Alta",
    medium: "Média",
    low: "Baixa",
  };

  return (
    <Badge variant="outline" className={styles[priority]}>
      {labels[priority]}
    </Badge>
  );
}

function TemperatureIcon({ temperature }: { temperature: string }) {
  switch (temperature) {
    case "hot":
      return <Flame className="w-3 h-3 text-red-500" />;
    case "warm":
      return <Thermometer className="w-3 h-3 text-amber-500" />;
    case "cold":
      return <Snowflake className="w-3 h-3 text-blue-500" />;
    default:
      return null;
  }
}

function TaskCard({ task, onAction }: { task: Task; onAction: (task: Task, action: string) => void }) {
  const lead = task.lead;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-lg bg-muted/50 shrink-0">
            <TaskIcon type={task.type} />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-medium truncate">{task.title}</h4>
              <PriorityBadge priority={task.priority} />
              {task.metadata.temperature && (
                <div className="flex items-center gap-1">
                  <TemperatureIcon temperature={task.metadata.temperature} />
                  <span className="text-xs text-muted-foreground capitalize">
                    {task.metadata.temperature}
                  </span>
                </div>
              )}
            </div>
            
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {task.description}
            </p>
            
            {lead && (
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {lead.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {lead.phone}
                  </span>
                )}
                {lead.company && (
                  <span className="flex items-center gap-1">
                    <Building className="w-3 h-3" />
                    {lead.company}
                  </span>
                )}
                {task.metadata.engagementScore !== undefined && (
                  <span className="flex items-center gap-1">
                    Score: {task.metadata.engagementScore}/100
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lead?.phone && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g, '')}`, '_blank')}
            >
              <MessageSquare className="w-4 h-4 mr-1" />
              WhatsApp
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAction(task, 'complete')}
          >
            <CheckCircle2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function AgentTasksTab({ agentId }: AgentTasksTabProps) {
  const [filter, setFilter] = useState<TaskType>("all");
  const { data, isLoading, error, refetch } = useAgentPendingTasks(agentId);

  const handleTaskAction = (task: Task, action: string) => {
    // TODO: Implementar ações nas tarefas
    console.log('Task action:', task.id, action);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Carregando tarefas...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>Erro ao carregar tarefas</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">
          Tentar novamente
        </Button>
      </div>
    );
  }

  const tasks = data?.tasks || [];
  const summary = data?.summary || { totalTasks: 0, followups: 0, confirmations: 0, reengagements: 0 };

  const filteredTasks = filter === "all" 
    ? tasks 
    : tasks.filter((t: Task) => t.type === filter);

  return (
    <div className="space-y-6">
      {/* Header com resumo */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Tarefas Pendentes</h3>
          <p className="text-sm text-muted-foreground">
            {summary.totalTasks} tarefa(s) aguardando ação
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-3 gap-4">
        <Card 
          className={`cursor-pointer transition-all ${filter === 'followup' ? 'ring-2 ring-millennials-yellow' : ''}`}
          onClick={() => setFilter(filter === 'followup' ? 'all' : 'followup')}
        >
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Clock className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.followups}</p>
                <p className="text-xs text-muted-foreground">Follow-ups</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${filter === 'confirmation' ? 'ring-2 ring-millennials-yellow' : ''}`}
          onClick={() => setFilter(filter === 'confirmation' ? 'all' : 'confirmation')}
        >
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Calendar className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.confirmations}</p>
                <p className="text-xs text-muted-foreground">Confirmações</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${filter === 'reengage' ? 'ring-2 ring-millennials-yellow' : ''}`}
          onClick={() => setFilter(filter === 'reengage' ? 'all' : 'reengage')}
        >
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <RefreshCw className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.reengagements}</p>
                <p className="text-xs text-muted-foreground">Reengajar</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtro ativo */}
      {filter !== "all" && (
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filtrado por:</span>
          <Badge variant="secondary" className="capitalize">
            {filter === 'followup' ? 'Follow-ups' : filter === 'confirmation' ? 'Confirmações' : 'Reengajar'}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setFilter('all')}>
            Limpar
          </Button>
        </div>
      )}

      {/* Lista de tarefas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {filter === "all" ? "Todas as Tarefas" : `Tarefas de ${filter}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            {filteredTasks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-50 text-green-500" />
                <p className="font-medium">Nenhuma tarefa pendente!</p>
                <p className="text-sm">O agente está em dia com todas as ações</p>
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {filteredTasks.map((task: Task) => (
                    <TaskCard 
                      key={task.id} 
                      task={task} 
                      onAction={handleTaskAction}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
