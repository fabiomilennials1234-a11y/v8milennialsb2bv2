import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Clock,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Filter,
  Search,
  User,
  ListTodo,
  CalendarDays,
  ArrowUpRight,
  Archive,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FollowUpCard } from "@/components/followups/FollowUpCard";
import { AutomationSettings } from "@/components/followups/AutomationSettings";
import { AcoesDoDia } from "@/components/followups/AcoesDoDia";
import { useFollowUps, useCompleteFollowUp, useArchiveFollowUp, useArchiveManyFollowUps, type FollowUp } from "@/hooks/useFollowUps";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";

export default function PipeFollowUps() {
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<"today" | "overdue" | "upcoming" | "all">("today");
  const [showCompleted, setShowCompleted] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { data: userRole } = useUserRole();
  const { data: teamMembers } = useTeamMembers();
  const completeFollowUp = useCompleteFollowUp();
  const archiveFollowUp = useArchiveFollowUp();
  const archiveManyFollowUps = useArchiveManyFollowUps();

  const { data: followUps, isLoading } = useFollowUps({
    assignedTo: selectedMember === "all" ? undefined : selectedMember,
    showCompleted,
    showArchived,
    dateFilter: dateFilter === "all" ? undefined : dateFilter,
  });

  // Stats
  const stats = useMemo(() => {
    if (!followUps) return { overdue: 0, today: 0, upcoming: 0, completed: 0 };
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return followUps.reduce((acc, fup) => {
      if (fup.completed_at) {
        acc.completed++;
      } else {
        const dueDate = new Date(fup.due_date);
        if (dueDate < today) {
          acc.overdue++;
        } else if (dueDate >= today && dueDate < tomorrow) {
          acc.today++;
        } else {
          acc.upcoming++;
        }
      }
      return acc;
    }, { overdue: 0, today: 0, upcoming: 0, completed: 0 });
  }, [followUps]);

  // Filter by search
  const filteredFollowUps = useMemo(() => {
    if (!followUps) return [];
    if (!search) return followUps;
    
    const searchLower = search.toLowerCase();
    return followUps.filter(fup => 
      fup.title.toLowerCase().includes(searchLower) ||
      fup.lead?.name?.toLowerCase().includes(searchLower) ||
      fup.lead?.company?.toLowerCase().includes(searchLower)
    );
  }, [followUps, search]);

  // Group by date for display
  const groupedFollowUps = useMemo(() => {
    const groups: Record<string, FollowUp[]> = {};
    
    filteredFollowUps.forEach(fup => {
      const date = format(new Date(fup.due_date), "yyyy-MM-dd");
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(fup);
    });

    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({
        date,
        label: format(new Date(date), "EEEE, dd 'de' MMMM", { locale: ptBR }),
        items: items.sort((a, b) => 
          new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        ),
      }));
  }, [filteredFollowUps]);

  const handleComplete = (id: string) => {
    completeFollowUp.mutate(id);
  };

  const handleArchive = (id: string) => {
    archiveFollowUp.mutate(id);
  };

  const overdueIds = useMemo(() => {
    if (!followUps) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return followUps.filter((f) => !f.completed_at && new Date(f.due_date) < today).map((f) => f.id);
  }, [followUps]);

  const completedIds = useMemo(() => {
    if (!followUps) return [];
    return followUps.filter((f) => f.completed_at).map((f) => f.id);
  }, [followUps]);

  const handleArchiveOverdue = () => {
    if (overdueIds.length > 0) archiveManyFollowUps.mutate(overdueIds);
  };

  const handleArchiveCompleted = () => {
    if (completedIds.length > 0) archiveManyFollowUps.mutate(completedIds);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListTodo className="w-7 h-7 text-primary" />
            Follow Ups
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie suas tarefas e pontos de contato com leads
          </p>
        </div>

        <div className="flex items-center gap-2">
          {userRole?.role === "admin" && <AutomationSettings />}
        </div>
      </div>

      {/* Main Layout: Daily Actions + Follow Ups */}
      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Daily Actions Sidebar */}
        <div className="order-2 lg:order-1">
          <AcoesDoDia />
        </div>

        {/* Follow Ups Main Content */}
        <div className="order-1 lg:order-2 space-y-6">

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "p-4 rounded-xl border cursor-pointer transition-all",
            dateFilter === "overdue" 
              ? "border-destructive bg-destructive/10" 
              : "border-border bg-card hover:border-destructive/50"
          )}
          onClick={() => setDateFilter("overdue")}
        >
          <div className="flex items-center justify-between">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <span className="text-2xl font-bold text-destructive">{stats.overdue}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Atrasadas</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={cn(
            "p-4 rounded-xl border cursor-pointer transition-all",
            dateFilter === "today" 
              ? "border-chart-5 bg-chart-5/10" 
              : "border-border bg-card hover:border-chart-5/50"
          )}
          onClick={() => setDateFilter("today")}
        >
          <div className="flex items-center justify-between">
            <Clock className="w-5 h-5 text-chart-5" />
            <span className="text-2xl font-bold text-chart-5">{stats.today}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Para Hoje</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className={cn(
            "p-4 rounded-xl border cursor-pointer transition-all",
            dateFilter === "upcoming" 
              ? "border-chart-4 bg-chart-4/10" 
              : "border-border bg-card hover:border-chart-4/50"
          )}
          onClick={() => setDateFilter("upcoming")}
        >
          <div className="flex items-center justify-between">
            <CalendarDays className="w-5 h-5 text-chart-4" />
            <span className="text-2xl font-bold text-chart-4">{stats.upcoming}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Próximas</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={cn(
            "p-4 rounded-xl border cursor-pointer transition-all",
            dateFilter === "all" 
              ? "border-success bg-success/10" 
              : "border-border bg-card hover:border-success/50"
          )}
          onClick={() => setDateFilter("all")}
        >
          <div className="flex items-center justify-between">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <span className="text-2xl font-bold text-success">{stats.completed}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Concluídas</p>
        </motion.div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between p-4 rounded-xl bg-muted/30 border">
        <div className="flex flex-1 gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por lead ou tarefa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={selectedMember} onValueChange={setSelectedMember}>
            <SelectTrigger className="w-[180px]">
              <User className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Filtrar por..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {teamMembers?.filter(m => m.is_active).map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="show-completed"
              checked={showCompleted}
              onCheckedChange={setShowCompleted}
            />
            <Label htmlFor="show-completed" className="text-sm cursor-pointer">
              Mostrar concluídas
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="show-archived" className="text-sm cursor-pointer">
              Mostrar arquivadas
            </Label>
          </div>
          {overdueIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchiveOverdue}
              disabled={archiveManyFollowUps.isPending}
              className="gap-1.5 text-destructive border-destructive/50 hover:bg-destructive/10"
            >
              <Archive className="h-4 w-4" />
              Arquivar atrasadas ({overdueIds.length})
            </Button>
          )}
          {completedIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchiveCompleted}
              disabled={archiveManyFollowUps.isPending}
              className="gap-1.5 text-success border-success/50 hover:bg-success/10"
            >
              <Archive className="h-4 w-4" />
              Arquivar concluídas ({completedIds.length})
            </Button>
          )}
        </div>
      </div>

      {/* Follow Ups List */}
      <div className="space-y-6">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground mt-2">Carregando tarefas...</p>
          </div>
        ) : groupedFollowUps.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <CheckCircle2 className="w-16 h-16 text-success/50 mx-auto mb-4" />
            <h3 className="text-lg font-medium">Nenhuma tarefa pendente!</h3>
            <p className="text-muted-foreground text-sm mt-1">
              {dateFilter === "today" 
                ? "Você não tem follow ups para hoje"
                : dateFilter === "overdue"
                ? "Não há tarefas atrasadas"
                : "Todas as tarefas foram concluídas"}
            </p>
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            {groupedFollowUps.map((group, groupIndex) => (
              <motion.div
                key={group.date}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: groupIndex * 0.05 }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-muted-foreground capitalize">
                    {group.label}
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {group.items.length}
                  </Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((followUp) => (
                    <FollowUpCard
                      key={followUp.id}
                      followUp={followUp}
                      onComplete={handleComplete}
                      onArchive={handleArchive}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}
